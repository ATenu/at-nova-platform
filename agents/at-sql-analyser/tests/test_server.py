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
    )


def build_client(
    *,
    snapshot: Any = None,
    reasoner: FakeReasoner | None = None,
    data: FakeDataClient | None = None,
    capability_client: FakeCapabilityClient | None = None,
    snap_error: Exception | None = None,
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
        resource_server=FakeResourceServer(),
        data_client_factory=lambda _run_id: data,
        capability_client=cap_client,
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


def test_read_task_completes() -> None:
    client, data, _ = build_client()
    res = send_task(client)
    assert res.status_code == 200
    body = result_data(res)
    assert body["status"] == "completed"
    assert body["answer"] == "ok"
    assert data.closed is True  # read path closes its MCP client


def test_missing_auth_is_rejected() -> None:
    client, _, _ = build_client()
    res = send_task(client, headers=None)
    assert res.status_code == 401


def test_denied_when_skill_not_in_allowlist() -> None:
    client, _, _ = build_client(snapshot=make_snapshot(allowlist=()))
    assert result_data(send_task(client))["status"] == "denied"


def test_high_risk_write_needs_approval() -> None:
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write",))
    client, _, cap = build_client(snapshot=snap)
    body = result_data(send_task(client, skill_id="data.act.write"))
    assert body["status"] == "needs_approval"
    assert body["reason"] == "approval_required"
    assert cap.calls == []  # nothing dispatched without approval


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


def test_unknown_skill_rejected() -> None:
    snap = make_snapshot(allowlist=("data.analyse.read", "data.other"))
    client, _, _ = build_client(snapshot=snap)
    body = result_data(send_task(client, skill_id="data.other"))
    assert body["status"] == "denied"
    assert body["reason"] == "unsupported_skill"
