"""The autonomous SQL-analyst DAG (LangGraph).

A bounded, guarded directed graph the agent navigates by LLM judgment. The read
path is a ReAct loop over TWO tool families — free-form SQL (DB MCP server) and
entitled structured read capabilities (Node gateway) — that the planner
interleaves to resolve references and answer the question:

    start ─▶ load_schema ─▶ plan_read ─┬─▶ validate ─▶ execute ─────▶ critique ─┐
                              ▲         │                                        │
                              │         └─▶ dispatch_read ───────────▶ critique ─┤
                              └────────────────── (loop) ◀──── refine ───────────┘
                                                                  │
                                              satisfied / budget ─▶ compose ─▶ END

The write path is itself a bounded resolve→act loop: the planner may dispatch
entitled READ capabilities to resolve inputs the request names only by handle
(e.g. an action title ─▶ its id) before emitting the final, fully-populated
writes — so a write whose ids are not stated up front is resolved from the DB
autonomously rather than failing:

    start ─▶ plan_write ─┬─▶ resolve_read ──▶ (loop back) ─┐   (write intent)
                ▲        │                                  │
                └────────┴───── (resolve, bounded) ◀────────┘
                         │
                         ├─▶ dispatch_writes ─▶ compose_writes ─▶ END
                         └─▶ compose_writes (nothing to do) ─▶ END

Discipline (rule 040): typed state, node outputs validated before they touch
state, explicit termination, max-iteration/query/time + no-progress guards, and
a hard ``recursion_limit`` backstop. The LLM proposes; it never authorizes. The
DB MCP server is the authoritative SQL gate; every concrete read AND write
capability is re-gated by ``authorize`` (Layer B) before dispatch and re-checked
by the Node gateway.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, cast, get_args

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from ..mcp.data_client import DataClient, DataClientError
from ..observability import langfuse_tracing as lf
from ..skills import AGENT_NAME
from ..tools.capability_client import CapabilityClient, CapabilityClientError
from .guards import GuardLimits, evaluate_guards
from .llm import Reasoner
from .state import (
    AgentResult,
    CapabilityCall,
    GraphState,
    QueryAttempt,
    SchemaView,
    TaskInput,
    WriteOutcome,
)

EventSink = Callable[[str, dict[str, Any]], None]
# (allowed, reason) for a concrete capability against the verified snapshot.
Authorizer = Callable[[str], tuple[bool, str]]

AgentStatus = Literal["completed", "failed", "denied", "needs_approval"]
_STATUSES: frozenset[str] = frozenset(get_args(AgentStatus))

# Local, lightweight pre-checks (defense in depth; the MCP server is authoritative).
_WRITE_KEYWORDS = frozenset(
    {"insert", "update", "delete", "drop", "alter", "create", "truncate", "grant",
     "revoke", "copy", "merge", "into"}
)
_FORBIDDEN_REFS = ("pg_", "information_schema")
_ALLOWED_SCHEMA = "mcp_read"


def _noop(_type: str, _payload: dict[str, Any]) -> None:
    return None


def hash_sql(sql: str) -> str:
    return "sha256:" + hashlib.sha256(sql.encode("utf-8")).hexdigest()


def local_validation_error(sql: str) -> str | None:
    """Cheap, fail-closed pre-checks before paying for an MCP round trip."""
    stripped = sql.strip().rstrip(";")
    lowered = stripped.lower()
    if not lowered:
        return "empty_sql"
    if ";" in stripped:
        return "multiple_statements"
    if not lowered.startswith("select") and not lowered.startswith("with"):
        return "not_a_select"
    tokens = set(lowered.replace("(", " ").replace(",", " ").split())
    if tokens & _WRITE_KEYWORDS:
        return "forbidden_keyword"
    if any(ref in lowered for ref in _FORBIDDEN_REFS):
        return "forbidden_reference"
    if _ALLOWED_SCHEMA not in lowered:
        return "no_allowlisted_relation"
    return None


@dataclass
class GraphDeps:
    reasoner: Reasoner
    limits: GuardLimits
    data_client: DataClient | None = None
    capability_client: CapabilityClient | None = None
    authorize: Authorizer | None = None
    # Whether the free-form SQL tool family is offered this run. True only when
    # the caller holds the data-layer entitlement (``data.query.select``); when
    # False the read loop uses ONLY the entitled structured read capabilities.
    sql_enabled: bool = True
    on_event: EventSink = _noop
    clock: Callable[[], float] = time.monotonic
    # Read-only, orchestrator-aligned prior-turn context (from redis-agent). The
    # agent grounds its planning on it but never authorizes from it.
    conversation_history: str = ""
    # Native Langfuse CallbackHandler (or ``None``). Passed to the LangGraph
    # invoke so each node + LLM generation nests under the shared run trace.
    langfuse_callbacks: object | None = None


NodeFn = Callable[[GraphState], Awaitable[dict[str, Any]]]


def build_graph(deps: GraphDeps) -> CompiledStateGraph:
    """Compile the agent DAG with its dependencies bound into the nodes."""
    emit = deps.on_event

    def instrument(name: str, fn: NodeFn) -> NodeFn:
        """Wrap a node so each execution emits bounded entry/exit markers.

        Surfaces EVERY graph-node execution to the audit firehose generically
        (no per-node hand-coding). Bounded metadata only — node name, iteration,
        duration, outcome — never raw state, prompt text, SQL, or rows (those are
        summarized by the agent.query.*/agent.write.* events). These are
        agent-internal (``internal`` visibility), so they ride the same stream
        but never reach the browser SSE channel.
        """

        async def wrapped(state: GraphState) -> dict[str, Any]:
            emit(
                "agent.node.started",
                {"node": name, "iteration": int(state.get("iteration", 0))},
            )
            start_t = deps.clock()
            outcome = "error"
            try:
                result = await fn(state)
                outcome = "ok"
                return result
            finally:
                emit(
                    "agent.node.completed",
                    {
                        "node": name,
                        "ms": round((deps.clock() - start_t) * 1000),
                        "outcome": outcome,
                    },
                )

        return wrapped

    async def start(state: GraphState) -> dict[str, Any]:
        return {"started_monotonic": deps.clock(), "iteration": 0, "write_outcomes": []}

    def route_intent(state: GraphState) -> str:
        return "plan_write" if state.get("intent") == "write" else "load_schema"

    # -- read path ----------------------------------------------------------
    async def load_schema(state: GraphState) -> dict[str, Any]:
        # The schema is only useful for the free-form SQL family. When SQL is not
        # available (caller lacks `data.query.select`) skip the MCP round trip
        # entirely — the MCP server would deny it — and plan from structured
        # reads only. The set of views returned is already filtered by the MCP
        # server to those the caller is entitled to (per-view domain permission).
        views: tuple[SchemaView, ...] = ()
        if deps.sql_enabled and deps.data_client is not None:
            try:
                with lf.tool_span("mcp:describe_schema"):
                    raw = await deps.data_client.describe_schema()
                views = _parse_schema(raw)
            except DataClientError:
                views = ()
        emit("agent.schema.loaded", {"viewCount": len(views)})
        return {"schema": views}

    async def plan_read(state: GraphState) -> dict[str, Any]:
        iteration = int(state.get("iteration", 0))
        guard = evaluate_guards(
            iterations=iteration,
            attempts=tuple(state.get("attempts", [])),
            elapsed_s=deps.clock() - float(state.get("started_monotonic", 0.0)),
            limits=deps.limits,
        )
        if guard.stop:
            return {"route": "compose", "reason": guard.reason, "pending_sql": "",
                    "pending_read": None}
        authorized_reads = _authorized_read_ids(deps.authorize)
        decision = await deps.reasoner.plan_read_step(
            goal=state["goal"],
            schema=state.get("schema", ()),
            authorized_reads=authorized_reads,
            history=tuple(state.get("attempts", [])),
            sql_enabled=deps.sql_enabled,
            conversation_history=deps.conversation_history,
        )
        if (
            decision.action == "capability"
            and decision.capability_id in authorized_reads
        ):
            # Layer A: the planner may only pick from the entitled closed set;
            # an out-of-set id is ignored here and re-gated again in dispatch.
            call = CapabilityCall(
                capability_id=decision.capability_id,
                tool_input=dict(decision.input),
                rationale=decision.rationale,
            )
            return {
                "route": "dispatch_read",
                "pending_read": call,
                "pending_sql": "",
                "iteration": iteration + 1,
            }
        if decision.action == "sql" and deps.sql_enabled and decision.sql.strip():
            return {
                "route": "validate",
                "pending_sql": decision.sql,
                "pending_params": list(decision.params),
                "pending_read": None,
                "iteration": iteration + 1,
            }
        return {"route": "compose", "pending_sql": "", "pending_read": None}

    async def dispatch_read(state: GraphState) -> dict[str, Any]:
        call = state.get("pending_read")
        if call is None:
            return {"route": "critique"}
        attempt = await _dispatch_read(
            call=call,
            authorize=deps.authorize,
            capability_client=deps.capability_client,
            run_id=state.get("run_id", ""),
            index=len(state.get("attempts", [])),
            emit=emit,
        )
        return {"route": "critique", "attempts": [attempt], "pending_read": None}

    async def validate(state: GraphState) -> dict[str, Any]:
        sql = state.get("pending_sql", "")
        error = local_validation_error(sql)
        if error is not None:
            attempt = QueryAttempt(
                sql=sql, sql_hash=hash_sql(sql), row_count=0, truncated=False,
                error=f"local_validation:{error}",
            )
            emit("agent.query.rejected", {"reason": error})
            return {"route": "critique", "skip_execute": True, "attempts": [attempt]}
        return {"route": "execute", "skip_execute": False}

    async def execute(state: GraphState) -> dict[str, Any]:
        sql = state.get("pending_sql", "")
        params = list(state.get("pending_params", []))
        # The owner's trace surfaces the tool name + verbatim input (SQL + params)
        # and output (rows). The tracer (Langfuse) still scrubs `sql`/`rows`, so
        # the full data only ever travels the owner's own SSE/webhook channel.
        emit(
            "agent.query.started",
            {
                "tool": "run_select_query",
                "sqlHash": hash_sql(sql),
                "input": {"sql": sql, "params": params},
            },
        )
        with lf.tool_span("mcp:run_select_query", sqlHash=hash_sql(sql)):
            attempt = await _execute_query(deps.data_client, sql, params)
        completed: dict[str, Any] = {
            "tool": "run_select_query",
            "sqlHash": attempt.sql_hash,
            "rowCount": attempt.row_count,
            "truncated": attempt.truncated,
            "error": attempt.error is not None,
        }
        # Carry the caller-safe failure reason (e.g. the SQL-rejection code +
        # offending view) so the trace shows WHY a query failed instead of a
        # misleading "0 rows". Never SQL text, params, or rows in the reason.
        if attempt.error is not None:
            completed["reason"] = attempt.error
        else:
            completed["output"] = {
                "rows": [dict(row) for row in attempt.rows],
                "rowCount": attempt.row_count,
                "truncated": attempt.truncated,
            }
        emit("agent.query.completed", completed)
        return {"attempts": [attempt]}

    async def critique(state: GraphState) -> dict[str, Any]:
        outcome = await deps.reasoner.critique(
            goal=state["goal"], history=tuple(state.get("attempts", []))
        )
        if outcome.satisfied:
            return {"route": "compose"}
        guard = evaluate_guards(
            iterations=int(state.get("iteration", 0)),
            attempts=tuple(state.get("attempts", [])),
            elapsed_s=deps.clock() - float(state.get("started_monotonic", 0.0)),
            limits=deps.limits,
        )
        if guard.stop:
            return {"route": "compose", "reason": guard.reason}
        return {"route": "plan_read"}

    async def compose(state: GraphState) -> dict[str, Any]:
        answer = (
            await deps.reasoner.compose(
                goal=state["goal"], history=tuple(state.get("attempts", []))
            )
        ).strip()
        attempts = len(state.get("attempts", []))
        if answer:
            emit("agent.completed", {"status": "completed", "queryCount": attempts})
            return {"answer": answer, "status": "completed", "reason": None}
        emit("agent.completed", {"status": "failed", "queryCount": attempts})
        return {"answer": None, "status": "failed", "reason": state.get("reason") or "no_answer"}

    # -- write path ---------------------------------------------------------
    async def plan_write(state: GraphState) -> dict[str, Any]:
        # Bounded resolve→act loop. RBAC (Layer A/B) is the ONLY gate on whether
        # a write may run; the planner must not refuse on "safety" grounds. When
        # the model returns finish or an invalid step while entitled writes exist,
        # the harness forces progress (bootstrap reads, replan) until dispatch or
        # a guard budget stops the run (then fail closed — no silent no-op).
        iteration = int(state.get("iteration", 0))
        guard = evaluate_guards(
            iterations=iteration,
            attempts=tuple(state.get("attempts", [])),
            elapsed_s=deps.clock() - float(state.get("started_monotonic", 0.0)),
            limits=deps.limits,
        )
        authorized_reads = _authorized_read_ids(deps.authorize)
        authorized_writes = _authorized_write_ids(deps.authorize)
        base: dict[str, Any] = {"entitled_writes": bool(authorized_writes)}

        if guard.stop:
            return {
                **base,
                "route": "compose_writes",
                "write_calls": [],
                "pending_read": None,
                "reason": guard.reason,
            }

        step = await deps.reasoner.plan_write_step(
            goal=state["goal"],
            authorized_reads=authorized_reads,
            authorized_writes=authorized_writes,
            history=tuple(state.get("attempts", [])),
            conversation_history=deps.conversation_history,
        )
        if step.action == "write" and step.writes:
            calls = [
                CapabilityCall(
                    capability_id=item.capability_id,
                    tool_input=dict(item.input),
                    rationale=item.rationale,
                )
                for item in step.writes
            ][: deps.limits.max_queries]
            return {
                **base,
                "route": "dispatch_writes",
                "write_calls": calls,
                "pending_read": None,
            }
        if step.action == "read" and step.read_capability_id in authorized_reads:
            call = CapabilityCall(
                capability_id=step.read_capability_id,
                tool_input=dict(step.read_input),
                rationale=step.rationale,
            )
            return {
                **base,
                "route": "resolve_read",
                "pending_read": call,
                "iteration": iteration + 1,
            }

        if not authorized_writes:
            return {
                **base,
                "route": "compose_writes",
                "write_calls": [],
                "pending_read": None,
                "reason": "no_entitled_writes",
            }

        # Planner did not advance — RBAC already allows writes; force the next step.
        bootstrap = _bootstrap_resolve_read(
            authorized_reads, tuple(state.get("attempts", []))
        )
        if bootstrap is not None:
            return {
                **base,
                "route": "resolve_read",
                "pending_read": bootstrap,
                "iteration": iteration + 1,
            }
        return {
            **base,
            "route": "plan_write",
            "write_calls": [],
            "pending_read": None,
            "iteration": iteration + 1,
        }

    async def resolve_read(state: GraphState) -> dict[str, Any]:
        # Reuse the read path's dispatch helper so a write-time resolution read is
        # re-gated (Layer B), idempotency-keyed, and audited with the same
        # PII-safe events as any read, then loop back to plan_write with the rows.
        call = state.get("pending_read")
        if call is None:
            return {"route": "plan_write"}
        attempt = await _dispatch_read(
            call=call,
            authorize=deps.authorize,
            capability_client=deps.capability_client,
            run_id=state.get("run_id", ""),
            index=len(state.get("attempts", [])),
            emit=emit,
        )
        return {"route": "plan_write", "attempts": [attempt], "pending_read": None}

    async def dispatch_writes(state: GraphState) -> dict[str, Any]:
        calls = state.get("write_calls", [])
        outcomes = await _dispatch_writes(
            run_goal=state["goal"],
            calls=calls,
            authorize=deps.authorize,
            capability_client=deps.capability_client,
            run_id=state.get("run_id", ""),
            emit=emit,
        )
        return {"write_outcomes": outcomes}

    async def compose_writes(state: GraphState) -> dict[str, Any]:
        outcomes = state.get("write_outcomes", [])
        completed = [o for o in outcomes if o.status == "completed"]
        entitled = bool(state.get("entitled_writes"))
        if not outcomes:
            if entitled:
                reason = state.get("reason") or "no_write_executed"
                emit("agent.completed", {"status": "failed", "writeCount": 0})
                return {"answer": None, "status": "failed", "reason": reason}
            answer = await deps.reasoner.compose_writes(goal=state["goal"], outcomes=())
            return {"answer": answer or "No actions were required.", "status": "completed"}
        if completed:
            answer = await deps.reasoner.compose_writes(
                goal=state["goal"], outcomes=tuple(outcomes)
            )
            emit("agent.completed", {"status": "completed", "writeCount": len(completed)})
            return {"answer": answer or "Completed the requested actions.", "status": "completed"}
        reason = outcomes[0].reason or "write_failed"
        emit("agent.completed", {"status": "failed", "writeCount": 0})
        return {"answer": None, "status": "failed", "reason": reason}

    builder = StateGraph(GraphState)
    builder.add_node("start", instrument("start", start))
    builder.add_node("load_schema", instrument("load_schema", load_schema))
    builder.add_node("plan_read", instrument("plan_read", plan_read))
    builder.add_node("dispatch_read", instrument("dispatch_read", dispatch_read))
    builder.add_node("validate", instrument("validate", validate))
    builder.add_node("execute", instrument("execute", execute))
    builder.add_node("critique", instrument("critique", critique))
    builder.add_node("compose", instrument("compose", compose))
    builder.add_node("plan_write", instrument("plan_write", plan_write))
    builder.add_node("resolve_read", instrument("resolve_read", resolve_read))
    builder.add_node("dispatch_writes", instrument("dispatch_writes", dispatch_writes))
    builder.add_node("compose_writes", instrument("compose_writes", compose_writes))

    builder.add_edge(START, "start")
    builder.add_conditional_edges(
        "start", route_intent, {"load_schema": "load_schema", "plan_write": "plan_write"}
    )
    builder.add_edge("load_schema", "plan_read")
    builder.add_conditional_edges(
        "plan_read",
        _route,
        {"validate": "validate", "dispatch_read": "dispatch_read", "compose": "compose"},
    )
    builder.add_conditional_edges(
        "validate", _route, {"execute": "execute", "critique": "critique"}
    )
    builder.add_edge("execute", "critique")
    builder.add_edge("dispatch_read", "critique")
    builder.add_conditional_edges(
        "critique", _route, {"plan_read": "plan_read", "compose": "compose"}
    )
    builder.add_edge("compose", END)
    builder.add_conditional_edges(
        "plan_write",
        _route,
        {
            "resolve_read": "resolve_read",
            "dispatch_writes": "dispatch_writes",
            "compose_writes": "compose_writes",
            "plan_write": "plan_write",
        },
    )
    builder.add_edge("resolve_read", "plan_write")
    builder.add_edge("dispatch_writes", "compose_writes")
    builder.add_edge("compose_writes", END)
    return builder.compile()


def _route(state: GraphState) -> str:
    route = state.get("route")
    return route if isinstance(route, str) else "compose"


async def run_task(task: TaskInput, deps: GraphDeps) -> AgentResult:
    """Run the DAG to a terminal state and return the typed result."""
    compiled = build_graph(deps)
    # Recursion backstop independent of the explicit iteration/time/query guards.
    recursion_limit = max(deps.limits.max_iterations, deps.limits.max_queries) * 4 + 8
    config: dict[str, Any] = {"recursion_limit": recursion_limit}
    if deps.langfuse_callbacks is not None:
        config["callbacks"] = [deps.langfuse_callbacks]
    final: dict[str, Any] = await compiled.ainvoke(
        {"goal": task.goal, "intent": task.intent, "run_id": task.run_id, "attempts": []},
        config=cast(Any, config),
    )
    raw_status = final.get("status") or ("completed" if final.get("answer") else "failed")
    status: AgentStatus = cast(AgentStatus, raw_status) if raw_status in _STATUSES else "failed"
    return AgentResult(
        status=status,
        answer=final.get("answer"),
        reason=final.get("reason"),
        query_count=len(final.get("attempts", [])),
    )


def _parse_schema(raw: list[dict[str, Any]]) -> tuple[SchemaView, ...]:
    views: list[SchemaView] = []
    for entry in raw:
        name = entry.get("name")
        if not isinstance(name, str):
            continue
        columns = entry.get("columns")
        if isinstance(columns, list):
            column_names = tuple(
                c["name"]
                for c in columns
                if isinstance(c, dict) and isinstance(c.get("name"), str)
            )
        else:
            column_names = ()
        description = entry.get("description")
        views.append(
            SchemaView(
                name=name,
                description=description if isinstance(description, str) else "",
                columns=column_names,
            )
        )
    return tuple(views)


async def _execute_query(
    data_client: DataClient | None, sql: str, params: list[Any]
) -> QueryAttempt:
    sql_hash = hash_sql(sql)
    if data_client is None:
        return QueryAttempt(sql, sql_hash, 0, False, "no_data_channel")
    try:
        result = await data_client.run_select_query(sql, params)
    except DataClientError as exc:
        return QueryAttempt(sql, sql_hash, 0, False, str(exc))
    rows = result.get("rows")
    row_tuple = tuple(rows) if isinstance(rows, list) else ()
    server_hash = result.get("sqlHash")
    row_count = result.get("rowCount")
    return QueryAttempt(
        sql=sql,
        sql_hash=server_hash if isinstance(server_hash, str) else sql_hash,
        row_count=row_count if isinstance(row_count, int) else len(row_tuple),
        truncated=bool(result.get("truncated")),
        error=None,
        rows=row_tuple,
    )


def _authorized_write_ids(authorize: Authorizer | None) -> tuple[str, ...]:
    """The cataloged write capability ids this run is entitled to invoke.

    This is the Layer A menu shown to the planner: the model may only propose
    from here, and ``dispatch_writes`` re-checks each one (Layer B) regardless.
    """
    from ..authz.registry import write_capability_ids

    if authorize is None:
        return ()
    return tuple(cap_id for cap_id in write_capability_ids() if authorize(cap_id)[0])


# Preferred resolver reads when the planner refuses to advance (bootstrap order).
_RESOLVE_READ_PRIORITY: tuple[str, ...] = (
    "issues.list",
    "actions.list",
    "actions.next",
    "customers.search",
    "sales.list",
    "issues.list.pendingForCustomer",
)


def _used_read_capability_ids(history: tuple[QueryAttempt, ...]) -> set[str]:
    return {
        attempt.capability_id
        for attempt in history
        if attempt.source == "capability" and attempt.capability_id
    }


def _bootstrap_resolve_read(
    authorized_reads: tuple[str, ...],
    history: tuple[QueryAttempt, ...],
) -> CapabilityCall | None:
    """Pick the next entitled resolver when the planner did not advance.

    RBAC already granted read+write access; this keeps the resolve→act loop
    moving without letting the model veto execution as "unsafe".
    """
    used = _used_read_capability_ids(history)
    for capability_id in _RESOLVE_READ_PRIORITY:
        if capability_id in authorized_reads and capability_id not in used:
            return CapabilityCall(
                capability_id=capability_id,
                tool_input={},
                rationale="bootstrap resolve (entitled read)",
            )
    for capability_id in authorized_reads:
        if capability_id not in used:
            return CapabilityCall(
                capability_id=capability_id,
                tool_input={},
                rationale="bootstrap resolve (entitled read)",
            )
    return None


def _authorized_read_ids(authorize: Authorizer | None) -> tuple[str, ...]:
    """The cataloged STRUCTURED read capability ids this run is entitled to use.

    The Layer A menu for the read planner: only the entitled subset of the
    ``delegated`` read closed set is shown, and ``dispatch_read`` re-checks each
    one (Layer B) before invoking it, exactly like the write path.
    """
    from ..authz.registry import read_capability_ids

    if authorize is None:
        return ()
    return tuple(cap_id for cap_id in read_capability_ids() if authorize(cap_id)[0])


def _rows_from_capability_data(data: object) -> tuple[dict[str, Any], ...]:
    """Coerce a structured read's result into rows for grounding + resolution.

    Reads return the owner's own entitled business data (ids, names) so the
    planner can resolve a reference (e.g. a customer id) and ground the answer.
    Accepts a list of records, a single record, or a common envelope
    (``items``/``rows``/``results``); anything else yields no rows (the summary
    still carries the outcome).
    """
    if isinstance(data, list):
        return tuple(row for row in data if isinstance(row, dict))
    if isinstance(data, dict):
        for key in ("items", "rows", "results", "data"):
            inner = data.get(key)
            if isinstance(inner, list):
                return tuple(row for row in inner if isinstance(row, dict))
        return (data,)
    return ()


async def _dispatch_read(
    *,
    call: CapabilityCall,
    authorize: Authorizer | None,
    capability_client: CapabilityClient | None,
    run_id: str,
    index: int,
    emit: EventSink,
) -> QueryAttempt:
    """Re-gate (Layer B) and invoke ONE structured read via the Node gateway.

    Mirrors ``_dispatch_writes``: the capability is authorized again against the
    snapshot regardless of the planner's choice, dispatched with an idempotency
    key, and the result is recorded as a ``capability`` read attempt so the loop
    stays bounded and the planner/critique/compose can ground in the rows.
    """
    label = f"{call.capability_id} input={json.dumps(call.tool_input, sort_keys=True, default=str)}"
    step_hash = hash_sql(f"read:{label}")
    allowed, reason = authorize(call.capability_id) if authorize else (False, "no_authorizer")
    if not allowed:
        emit("agent.read.denied", {"capability": call.capability_id, "reason": reason})
        return QueryAttempt(
            sql=label, sql_hash=step_hash, row_count=0, truncated=False,
            error=f"denied:{reason}", source="capability", capability_id=call.capability_id,
        )
    emit(
        "agent.authz.allowed",
        {"capability": call.capability_id, "decision": "allow", "reasonCode": reason,
         "actor": AGENT_NAME},
    )
    if capability_client is None:
        return QueryAttempt(
            sql=label, sql_hash=step_hash, row_count=0, truncated=False,
            error="no_read_channel", source="capability", capability_id=call.capability_id,
        )
    idempotency_key = f"agent-read:{run_id}:{call.capability_id}:{index}"
    emit(
        "agent.read.started",
        {
            "tool": call.capability_id,
            "capability": call.capability_id,
            "input": dict(call.tool_input),
        },
    )
    try:
        with lf.tool_span(f"capability:{call.capability_id}", capability=call.capability_id):
            result = await capability_client.execute(
                run_id=run_id,
                capability_id=call.capability_id,
                tool_input=call.tool_input,
                idempotency_key=idempotency_key,
            )
    except CapabilityClientError as exc:
        code = f"capability_error:{exc.status_code or 'network'}"
        emit("agent.read.failed", {"capability": call.capability_id, "reason": code})
        return QueryAttempt(
            sql=label, sql_hash=step_hash, row_count=0, truncated=False,
            error=code, source="capability", capability_id=call.capability_id,
        )
    rows = _rows_from_capability_data(result.data)
    emit(
        "agent.read.completed",
        {
            "tool": call.capability_id,
            "capability": call.capability_id,
            "rowCount": len(rows),
            "output": {"rows": [dict(row) for row in rows], "rowCount": len(rows)},
        },
    )
    return QueryAttempt(
        sql=label,
        sql_hash=step_hash,
        row_count=len(rows),
        truncated=False,
        error=None,
        rows=rows,
        source="capability",
        capability_id=call.capability_id,
    )


async def _dispatch_writes(
    *,
    run_goal: str,
    calls: list[CapabilityCall],
    authorize: Authorizer | None,
    capability_client: CapabilityClient | None,
    run_id: str,
    emit: EventSink,
) -> list[WriteOutcome]:
    outcomes: list[WriteOutcome] = []
    for index, call in enumerate(calls):
        allowed, reason = authorize(call.capability_id) if authorize else (False, "no_authorizer")
        if not allowed:
            emit("agent.write.denied", {"capability": call.capability_id, "reason": reason})
            outcomes.append(
                WriteOutcome(call.capability_id, "denied", "", reason=reason)
            )
            continue
        emit(
            "agent.authz.allowed",
            {"capability": call.capability_id, "decision": "allow", "reasonCode": reason,
             "actor": AGENT_NAME},
        )
        if capability_client is None:
            outcomes.append(
                WriteOutcome(call.capability_id, "failed", "", reason="no_write_channel")
            )
            continue
        idempotency_key = f"agent-write:{run_id}:{call.capability_id}:{index}"
        emit(
            "agent.write.started",
            {
                "tool": call.capability_id,
                "capability": call.capability_id,
                "input": dict(call.tool_input),
            },
        )
        try:
            with lf.tool_span(f"capability:{call.capability_id}", capability=call.capability_id):
                result = await capability_client.execute(
                    run_id=run_id,
                    capability_id=call.capability_id,
                    tool_input=call.tool_input,
                    idempotency_key=idempotency_key,
                )
        except CapabilityClientError as exc:
            code = f"capability_error:{exc.status_code or 'network'}"
            emit("agent.write.failed", {"capability": call.capability_id, "reason": code})
            outcomes.append(WriteOutcome(call.capability_id, "failed", "", reason=code))
            continue
        # ``input``/``output`` are nested structures: the tracer scrubs them to
        # ``<dict>`` (no PII in logs), while the verbatim payload is returned to
        # the orchestrator for the owner's own SSE/webhook stream.
        emit(
            "agent.write.completed",
            {"tool": call.capability_id, "capability": call.capability_id, "output": result.data},
        )
        outcomes.append(
            WriteOutcome(call.capability_id, "completed", result.summary, links=result.links)
        )
    return outcomes
