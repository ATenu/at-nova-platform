"""A2A server trust-pipeline tests (native a2a-sdk, JSON-RPC over HTTP).

These drive the compiled graph end-to-end through the real A2A surface so the
inbound auth middleware, snapshot fetch, Layer B gate, and skill routing are all
exercised. The LLM is the deterministic ``FakeReasoner`` (offline)."""

from __future__ import annotations

import os
import uuid
from typing import Any

os.environ.setdefault("KEYCLOAK_ISSUER_URL", "http://kc/realms/nova")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

from starlette.testclient import TestClient  # noqa: E402

from at_sql_analyser.config import AgentConfig  # noqa: E402
from at_sql_analyser.harness.llm import WriteItem  # noqa: E402
from at_sql_analyser.server import create_app  # noqa: E402

from .fakes import (  # noqa: E402
    FakeCapabilityClient,
    FakeDataClient,
    FakeReasoner,
    FakeRegistryClient,
    FakeResourceServer,
    FakeSnapshotClient,
    make_snapshot,
    read_query,
)

HEADERS = {"Authorization": "Bearer test"}


def make_config() -> AgentConfig:
    return AgentConfig(
        port=8003,
        public_url="http://at-sql-analyser:8003",
        keycloak_issuer_url="http://kc/realms/nova",
        keycloak_jwks_uri="http://kc/realms/nova/protocol/openid-connect/certs",
        agent_audience="nova-agent-sql-analyst",
        authorized_parties=("nova-celery-worker",),
        keycloak_token_url="http://kc/realms/nova/protocol/openid-connect/token",
        agent_client_id="nova-agent-sql-analyst",
        agent_client_secret="",
        mcp_audience_scope="nova-mcp-data",
        request_audience_scopes=False,
        orchestrator_internal_url="http://orchestrator:8001",
        orchestrator_audience_scope="nova-orchestrator",
        registration_enabled=False,
        registration_heartbeat_s=60,
        nova_api_internal_url="http://nova-api:3000",
        db_mcp_url="http://db-mcp-server:8002",
        capability_audience_scope="nova-mcp-sales",
        max_iterations=5,
        max_queries=5,
        step_timeout_s=30,
        total_timeout_s=30,
        openai_api_key="test-key",
        llm_model="gpt-4o-mini",
        llm_temperature=0.0,
        llm_timeout_s=30.0,
        openai_base_url=None,
        redis_agent_url=None,
        agent_state_enabled=False,
        agent_state_key_prefix="nova:agent:",
        agent_state_ttl_s=7200,
        agent_history_read_limit=20,
    )


def build_client(
    *,
    snapshot: Any = None,
    reasoner: FakeReasoner | None = None,
    data: FakeDataClient | None = None,
    capability_client: FakeCapabilityClient | None = None,
    snap_error: Exception | None = None,
    catalog: list[dict[str, Any]] | None = None,
) -> tuple[TestClient, FakeDataClient, FakeCapabilityClient]:
    data = data or FakeDataClient()
    snap_client = FakeSnapshotClient(snapshot or make_snapshot())
    if snap_error is not None:
        snap_client.error = snap_error
    the_reasoner = reasoner or FakeReasoner(
        queries=[read_query("SELECT 1 FROM mcp_read.sales")], answer="ok"
    )
    cap_client = capability_client or FakeCapabilityClient()
    app = create_app(
        make_config(),
        reasoner=the_reasoner,
        snapshot_client=snap_client,
        registry_client=FakeRegistryClient(),
        resource_server=FakeResourceServer(),
        data_client_factory=lambda _run_id: data,
        capability_client=cap_client,
        # Inject the catalog so the card builds without a live MCP fetch.
        catalog=catalog if catalog is not None else [],
    )
    return TestClient(app), data, cap_client


def send_task(
    client: TestClient,
    *,
    skill_id: str = "data.analyse.read",
    goal: str = "how many sales",
    approval_granted: bool = False,
    run_id: str = "run-1",
    headers: dict[str, str] | None = HEADERS,
) -> Any:
    data: dict[str, Any] = {
        "runId": run_id,
        "skillId": skill_id,
        "goal": goal,
        "correlationId": "corr-1",
        "approvalGranted": approval_granted,
    }
    rpc = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": str(uuid.uuid4()),
                "kind": "message",
                "parts": [
                    {"kind": "data", "data": data},
                    {"kind": "text", "text": goal},
                ],
            }
        },
    }
    return client.post("/", json=rpc, headers=headers or {})


def result_data(response: Any) -> dict[str, Any]:
    """Extract the agent's typed {status, reason, answer} DataPart artifact."""
    result = response.json()["result"]
    for artifact in result.get("artifacts", []):
        for part in artifact.get("parts", []):
            if part.get("kind") == "data" and "status" in part.get("data", {}):
                data: dict[str, Any] = part["data"]
                return data
    raise AssertionError("no status DataPart in A2A result")


def test_agent_card_is_public_and_lists_skills() -> None:
    client, _, _ = build_client()
    res = client.get("/.well-known/agent-card.json")
    assert res.status_code == 200
    ids = {s["id"] for s in res.json()["skills"]}
    assert "data.analyse.read" in ids


def test_agent_card_advertises_both_skills_with_metadata() -> None:
    # The card is the source of truth for dynamic discovery: every advertised
    # skill must carry a non-empty description and intent tags so the
    # orchestrator can build a meaningful Layer A menu without a code change.
    client, _, _ = build_client()
    skills = client.get("/.well-known/agent-card.json").json()["skills"]
    by_id = {s["id"]: s for s in skills}
    assert {"data.analyse.read", "data.act.write"} <= set(by_id)
    for skill in by_id.values():
        assert skill["description"].strip()
        assert skill["tags"]


def test_agent_card_read_skill_is_routing_grade_from_catalog() -> None:
    # The card advertises the data AREAS (view names) for accurate delegation but
    # NOT column-level detail: column/filter grounding stays in the agent's own
    # per-run planner, and the orchestrator never needs (or fetches) the schema.
    catalog = [
        {
            "schema": "mcp_read",
            "name": "sales",
            "description": "Sales facts.",
            "ownerScoped": False,
            "columns": [
                {"name": "id", "type": "uuid", "pii": False},
                {"name": "total_amount_receipt", "type": "numeric", "pii": False},
            ],
        },
        {
            "schema": "mcp_read",
            "name": "customers",
            "description": "Customers.",
            "ownerScoped": False,
            "columns": [{"name": "full_name", "type": "varchar", "pii": True}],
        },
    ]
    client, _, _ = build_client(catalog=catalog)
    skills = client.get("/.well-known/agent-card.json").json()["skills"]
    read = next(s for s in skills if s["id"] == "data.analyse.read")
    # Data areas are advertised for routing...
    assert "sales" in read["description"]
    assert "customers" in read["description"]
    # ...but column-level detail is NOT leaked into the orchestrator menu.
    assert "full_name" not in read["description"]
    assert "total_amount_receipt" not in read["description"]
    # View names still become intent tags for steering.
    assert "sales" in read["tags"]
    assert "customers" in read["tags"]


def test_read_task_completes() -> None:
    client, data, _ = build_client()
    res = send_task(client)
    assert res.status_code == 200
    body = result_data(res)
    assert body["status"] == "completed"
    assert body["answer"] == "ok"
    assert data.closed is True  # read path closes its MCP client


def test_read_task_returns_progress_events() -> None:
    # Every sub-step the agent runs is returned to the orchestrator so the worker
    # can stream it to the user (SSE) and deliver it to the webhook.
    client, _, _ = build_client()
    body = result_data(send_task(client))
    events = body["events"]
    assert isinstance(events, list)
    types = {event["type"] for event in events}
    assert "agent.task.received" in types
    assert "agent.query.completed" in types


def test_read_task_returns_node_and_authz_events_with_monotonic_seq() -> None:
    # Full audit firehose: every graph-node execution and the agent's own
    # Layer-B allow are returned alongside the user-facing sub-steps, each tagged
    # with a monotonic agentSeq so the worker can order + dedupe deterministically.
    client, _, _ = build_client()
    events = result_data(send_task(client))["events"]
    types = {event["type"] for event in events}
    assert "agent.node.started" in types
    assert "agent.node.completed" in types
    assert "agent.authz.allowed" in types
    seqs = [event["agentSeq"] for event in events]
    assert all(isinstance(seq, int) for seq in seqs)
    assert seqs == sorted(seqs)
    assert len(seqs) == len(set(seqs))  # strictly unique + monotonic


def test_denied_task_emits_no_progress_or_allow_events() -> None:
    # A task denied at the skill gate must never emit user-visible progress or an
    # allow projection — only the terminal denial.
    client, _, _ = build_client(snapshot=make_snapshot(allowlist=()))
    body = result_data(send_task(client))
    assert body["status"] == "denied"
    types = {event["type"] for event in body["events"]}
    assert "agent.authz.allowed" not in types
    assert "agent.query.started" not in types
    assert "agent.node.started" not in types


def test_approved_write_returns_io_events() -> None:
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write", "issues.create"))
    reasoner = FakeReasoner(writes=[WriteItem(capability_id="issues.create", input={"title": "x"})])
    client, _, _ = build_client(snapshot=snap, reasoner=reasoner)
    body = result_data(send_task(client, skill_id="data.act.write", approval_granted=True))
    events = body["events"]
    started = next(event for event in events if event["type"] == "agent.write.started")
    assert started["payload"]["input"] == {"title": "x"}
    assert any(event["type"] == "agent.write.completed" for event in events)


def test_missing_auth_is_rejected() -> None:
    client, _, _ = build_client()
    res = send_task(client, headers=None)
    assert res.status_code == 401


def test_denied_when_skill_not_in_allowlist() -> None:
    client, _, _ = build_client(snapshot=make_snapshot(allowlist=()))
    assert result_data(send_task(client))["status"] == "denied"


def test_write_proceeds_without_approval_by_default() -> None:
    # Approval is opt-in (default false) and decoupled from risk: an entitled
    # user's write is authorized by permission consent alone and dispatches the
    # concrete capability without a separate approval step.
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write", "issues.create"))
    reasoner = FakeReasoner(writes=[WriteItem(capability_id="issues.create", input={"title": "x"})])
    client, _, cap = build_client(snapshot=snap, reasoner=reasoner)
    body = result_data(send_task(client, skill_id="data.act.write"))
    assert body["status"] == "completed"
    assert cap.calls == [("issues.create", "agent-write:run-1:issues.create:0")]


def test_approved_write_dispatches_entitled_capability() -> None:
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write", "issues.create"))
    reasoner = FakeReasoner(writes=[WriteItem(capability_id="issues.create", input={"title": "x"})])
    cap = FakeCapabilityClient()
    client, _, cap = build_client(snapshot=snap, reasoner=reasoner, capability_client=cap)
    body = result_data(send_task(client, skill_id="data.act.write", approval_granted=True))
    assert body["status"] == "completed"
    assert cap.calls == [("issues.create", "agent-write:run-1:issues.create:0")]


def test_approved_write_denies_unentitled_concrete_capability() -> None:
    # Approval covers the skill, but the concrete capability is not entitled.
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write",))
    reasoner = FakeReasoner(writes=[WriteItem(capability_id="issues.create", input={})])
    cap = FakeCapabilityClient()
    client, _, cap = build_client(snapshot=snap, reasoner=reasoner, capability_client=cap)
    body = result_data(send_task(client, skill_id="data.act.write", approval_granted=True))
    assert body["status"] == "failed"
    assert cap.calls == []  # concrete capability not in allowlist -> never dispatched


def test_snapshot_unavailable_denies() -> None:
    from at_sql_analyser.auth.snapshot import SnapshotError

    client, _, _ = build_client(snap_error=SnapshotError("nope"))
    body = result_data(send_task(client))
    assert body["status"] == "denied"
    assert body["reason"] == "entitlement_unavailable"


def test_registry_outage_fails_closed() -> None:
    # The dynamic policy source is unavailable: the agent must deny rather than
    # authorize against absent policy (fail closed).
    from at_sql_analyser.authz.rbac_registry import RbacRegistryError

    registry = FakeRegistryClient()
    registry.error = RbacRegistryError("registry down")
    data = FakeDataClient()
    snap_client = FakeSnapshotClient(make_snapshot())
    app = create_app(
        make_config(),
        reasoner=FakeReasoner(answer="ok"),
        snapshot_client=snap_client,
        registry_client=registry,
        resource_server=FakeResourceServer(),
        data_client_factory=lambda _run_id: data,
        capability_client=FakeCapabilityClient(),
        catalog=[],
    )
    body = result_data(send_task(TestClient(app)))
    assert body["status"] == "denied"
    assert body["reason"] == "registry_unavailable"


def test_unknown_skill_rejected() -> None:
    snap = make_snapshot(allowlist=("data.analyse.read", "data.other"))
    client, _, _ = build_client(snapshot=snap)
    body = result_data(send_task(client, skill_id="data.other"))
    assert body["status"] == "denied"
    assert body["reason"] == "unsupported_skill"
