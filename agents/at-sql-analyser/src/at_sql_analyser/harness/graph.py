"""The autonomous SQL-analyst DAG (LangGraph).

A bounded, guarded directed graph the agent navigates by LLM judgment:

    start ─▶ load_schema ─▶ propose ─▶ validate ─▶ execute ─▶ critique ─┐
                              ▲                       │                  │
                              └───────── refine ──────┴── (loop) ◀───────┘
                                                                  │
                                              satisfied / budget ─▶ compose ─▶ END

    start ─▶ plan_writes ─▶ dispatch_writes ─▶ compose_writes ─▶ END   (write intent)

Discipline (rule 040): typed state, node outputs validated before they touch
state, explicit termination, max-iteration/query/time + no-progress guards, and
a hard ``recursion_limit`` backstop. The LLM proposes; it never authorizes. The
DB MCP server is the authoritative SQL gate; every write capability is gated
again by ``authorize`` before dispatch.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, cast, get_args

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from ..mcp.data_client import DataClient, DataClientError
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
    on_event: EventSink = _noop
    clock: Callable[[], float] = time.monotonic


def build_graph(deps: GraphDeps) -> CompiledStateGraph:
    """Compile the agent DAG with its dependencies bound into the nodes."""
    emit = deps.on_event

    async def start(state: GraphState) -> dict[str, Any]:
        return {"started_monotonic": deps.clock(), "iteration": 0, "write_outcomes": []}

    def route_intent(state: GraphState) -> str:
        return "plan_writes" if state.get("intent") == "write" else "load_schema"

    # -- read path ----------------------------------------------------------
    async def load_schema(state: GraphState) -> dict[str, Any]:
        views: tuple[SchemaView, ...] = ()
        if deps.data_client is not None:
            try:
                raw = await deps.data_client.describe_schema()
                views = _parse_schema(raw)
            except DataClientError:
                views = ()
        emit("agent.schema.loaded", {"viewCount": len(views)})
        return {"schema": views}

    async def propose(state: GraphState) -> dict[str, Any]:
        iteration = int(state.get("iteration", 0))
        guard = evaluate_guards(
            iterations=iteration,
            attempts=tuple(state.get("attempts", [])),
            elapsed_s=deps.clock() - float(state.get("started_monotonic", 0.0)),
            limits=deps.limits,
        )
        if guard.stop:
            return {"route": "compose", "reason": guard.reason, "pending_sql": ""}
        decision = await deps.reasoner.propose_query(
            goal=state["goal"],
            schema=state.get("schema", ()),
            history=tuple(state.get("attempts", [])),
        )
        if decision.action == "finish" or not decision.sql.strip():
            return {"route": "compose", "pending_sql": ""}
        return {
            "route": "validate",
            "pending_sql": decision.sql,
            "pending_params": list(decision.params),
            "iteration": iteration + 1,
        }

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
        emit("agent.query.started", {"sqlHash": hash_sql(sql)})
        attempt = await _execute_query(deps.data_client, sql, params)
        emit(
            "agent.query.completed",
            {
                "sqlHash": attempt.sql_hash,
                "rowCount": attempt.row_count,
                "truncated": attempt.truncated,
                "error": attempt.error is not None,
            },
        )
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
        return {"route": "propose"}

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
    async def plan_writes(state: GraphState) -> dict[str, Any]:
        authorized = _authorized_write_ids(deps.authorize)
        plan = await deps.reasoner.plan_writes(
            goal=state["goal"], authorized_writes=authorized
        )
        calls = [
            CapabilityCall(
                capability_id=item.capability_id,
                tool_input=dict(item.input),
                rationale=item.rationale,
            )
            for item in plan.writes
        ][: deps.limits.max_queries]
        return {"write_calls": calls}

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
        if not outcomes:
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
    builder.add_node("start", start)
    builder.add_node("load_schema", load_schema)
    builder.add_node("propose", propose)
    builder.add_node("validate", validate)
    builder.add_node("execute", execute)
    builder.add_node("critique", critique)
    builder.add_node("compose", compose)
    builder.add_node("plan_writes", plan_writes)
    builder.add_node("dispatch_writes", dispatch_writes)
    builder.add_node("compose_writes", compose_writes)

    builder.add_edge(START, "start")
    builder.add_conditional_edges(
        "start", route_intent, {"load_schema": "load_schema", "plan_writes": "plan_writes"}
    )
    builder.add_edge("load_schema", "propose")
    builder.add_conditional_edges(
        "propose", _route, {"validate": "validate", "compose": "compose"}
    )
    builder.add_conditional_edges(
        "validate", _route, {"execute": "execute", "critique": "critique"}
    )
    builder.add_edge("execute", "critique")
    builder.add_conditional_edges(
        "critique", _route, {"propose": "propose", "compose": "compose"}
    )
    builder.add_edge("compose", END)
    builder.add_edge("plan_writes", "dispatch_writes")
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
    final: dict[str, Any] = await compiled.ainvoke(
        {"goal": task.goal, "intent": task.intent, "run_id": task.run_id, "attempts": []},
        config={"recursion_limit": recursion_limit},
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
        if capability_client is None:
            outcomes.append(
                WriteOutcome(call.capability_id, "failed", "", reason="no_write_channel")
            )
            continue
        idempotency_key = f"agent-write:{run_id}:{call.capability_id}:{index}"
        emit("agent.write.started", {"capability": call.capability_id})
        try:
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
        emit("agent.write.completed", {"capability": call.capability_id})
        outcomes.append(
            WriteOutcome(call.capability_id, "completed", result.summary, links=result.links)
        )
    return outcomes
