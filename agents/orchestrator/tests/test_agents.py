"""The agent registry routes only real agent-skill capabilities, no drift.

Covers both the static seed (``build_default_registry``) and the native A2A
self-registration loader (``load_registry_from_store``): live rows are trusted
for discovery, but a card can never widen what is dispatchable (skills are
intersected with the shared catalog), SSRF-unsafe base URLs are dropped, and the
static seed is used only as a fallback when nothing live is found.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from nova_orchestrator.agents import (
    AgentDescriptor,
    AgentRegistry,
    build_default_registry,
    card_skills_from_card,
    is_allowed_base_url,
    load_registry_from_store,
)
from nova_orchestrator.config import OrchestratorConfig


def _config(**overrides: Any) -> OrchestratorConfig:
    base = dict(
        role="worker",
        broker_url="redis://x",
        result_backend="redis://x",
        agents_database_url="postgresql+psycopg://x/y",
        keycloak_issuer_url="http://kc/realms/nova",
        keycloak_jwks_uri="http://kc/certs",
        keycloak_token_url="http://kc/token",
        orchestrator_audience="nova-orchestrator",
        worker_client_id="nova-celery-worker",
        worker_client_secret="",
        worker_request_audience_scopes=False,
        run_soft_time_limit_s=6900,
        run_time_limit_s=7200,
        nova_api_internal_url="http://api:3000",
        max_run_steps=8,
        sql_analyst_agent_url="http://at-sql-analyser:8003",
        sql_analyst_agent_audience="nova-agent-sql-analyst",
        a2a_registry_ttl_s=120,
        agent_registration_authorized_parties=("nova-agent-sql-analyst",),
        agent_registration_allowed_hosts=(),
        a2a_registry_seed_sql_analyst=True,
        agent_request_timeout_s=180.0,
        openai_api_key="",
        llm_model="gpt-4o-mini",
        llm_temperature=0.0,
        llm_timeout_s=30.0,
        openai_base_url=None,
        redis_agent_url=None,
        agent_state_enabled=False,
        agent_state_key_prefix="nova:agent:",
        agent_state_ttl_s=7200,
        agent_history_ttl_s=2_592_000,
        agent_history_max_entries=200,
        agent_history_read_limit=20,
    )
    base.update(overrides)
    return OrchestratorConfig(**base)


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _FakeResult:
        return self

    def all(self) -> list[Any]:
        return self._rows


class _FakeSession:
    """Returns the given rows for any query (the TTL filter is the DB's job)."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def execute(self, _statement: Any) -> _FakeResult:
        return _FakeResult(self._rows)


def _row(
    *,
    name: str = "at-sql-analyser",
    base_url: str = "http://at-sql-analyser:8003",
    audience: str = "nova-agent-sql-analyst",
    skill_ids: list[str] | None = None,
    card: dict[str, Any] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        base_url=base_url,
        audience=audience,
        skill_ids=skill_ids if skill_ids is not None else ["data.analyse.read"],
        card=card if card is not None else {"skills": []},
        last_seen_at=datetime.now(UTC),
    )


def test_default_registry_routes_known_agent_skills() -> None:
    registry = build_default_registry(_config())
    agent = registry.agent_for_skill("data.analyse.read")
    assert agent is not None
    assert agent.name == "at-sql-analyser"
    assert agent.base_url == "http://at-sql-analyser:8003"
    assert agent.audience_scope == "nova-agent-sql-analyst"


def test_registry_excludes_unknown_skills() -> None:
    registry = build_default_registry(_config())
    assert registry.agent_for_skill("sales.report.customer") is None
    assert registry.agent_for_skill("data.unknown") is None


def test_registry_only_contains_real_agent_skill_capabilities() -> None:
    registry = build_default_registry(_config())
    # Both seeded skills resolve to agent-skill capabilities in the catalog.
    assert "data.analyse.read" in registry.skills()
    assert "data.act.write" in registry.skills()


def test_agent_for_skill_lookup_is_exact() -> None:
    agent = AgentDescriptor(
        name="a",
        receiver="a",
        base_url="http://a",
        audience_scope="aud",
        skills=frozenset({"data.analyse.read"}),
    )
    registry = AgentRegistry((agent,))
    assert registry.agent_for_skill("data.analyse.read") is agent
    assert registry.agent_for_skill("data.analyse") is None


# --- Native A2A self-registration loader -------------------------------------


def test_load_registry_routes_live_registration_with_card_metadata() -> None:
    card = {
        "skills": [
            {
                "id": "data.analyse.read",
                "name": "Analyse",
                "description": "Answer questions over curated views.",
                "tags": ["count", "trend"],
            }
        ]
    }
    session = _FakeSession([_row(skill_ids=["data.analyse.read"], card=card)])
    registry = load_registry_from_store(session, _config())

    agent = registry.agent_for_skill("data.analyse.read")
    assert agent is not None
    assert agent.base_url == "http://at-sql-analyser:8003"
    assert agent.audience_scope == "nova-agent-sql-analyst"
    card_skill = registry.card_skill_for("data.analyse.read")
    assert card_skill is not None
    assert card_skill.description == "Answer questions over curated views."
    assert card_skill.tags == ("count", "trend")


def test_load_registry_drops_skills_not_in_catalog() -> None:
    # A card can advertise anything; only ids resolving to a real agent-skill in
    # the shared catalog are routable (drift / privilege-escalation guard).
    session = _FakeSession(
        [_row(skill_ids=["data.analyse.read", "totally.made.up", "data.query.select"])]
    )
    registry = load_registry_from_store(session, _config())
    assert registry.agent_for_skill("data.analyse.read") is not None
    assert registry.agent_for_skill("totally.made.up") is None
    # data.query.select is an mcp-tool, not an agent-skill -> never routable.
    assert registry.agent_for_skill("data.query.select") is None


def test_load_registry_drops_ssrf_unsafe_base_url_and_falls_back_to_seed() -> None:
    session = _FakeSession([_row(base_url="ftp://evil/internal")])
    registry = load_registry_from_store(session, _config())
    # The unsafe row is dropped; with seeding enabled the static SQL analyst
    # keeps the platform working.
    agent = registry.agent_for_skill("data.analyse.read")
    assert agent is not None
    assert agent.name == "at-sql-analyser"
    assert agent.base_url == "http://at-sql-analyser:8003"


def test_load_registry_enforces_host_allowlist() -> None:
    session = _FakeSession([_row(base_url="http://attacker.example:8003")])
    config = _config(
        agent_registration_allowed_hosts=("at-sql-analyser",),
        a2a_registry_seed_sql_analyst=False,
    )
    registry = load_registry_from_store(session, config)
    assert registry.all() == ()


def test_load_registry_seeds_when_empty() -> None:
    registry = load_registry_from_store(_FakeSession([]), _config())
    assert registry.agent_for_skill("data.analyse.read") is not None


def test_load_registry_empty_without_seed() -> None:
    registry = load_registry_from_store(
        _FakeSession([]), _config(a2a_registry_seed_sql_analyst=False)
    )
    assert registry.all() == ()
    assert registry.agent_for_skill("data.analyse.read") is None


def test_is_allowed_base_url() -> None:
    assert is_allowed_base_url("http://agent:8003", ())
    assert is_allowed_base_url("https://agent", ())
    assert not is_allowed_base_url("ftp://agent", ())
    assert not is_allowed_base_url("not-a-url", ())
    assert is_allowed_base_url("http://agent:8003", ("agent",))
    assert not is_allowed_base_url("http://other:8003", ("agent",))


def test_card_skills_from_card_is_defensive() -> None:
    assert card_skills_from_card({}) == ()
    assert card_skills_from_card({"skills": "nope"}) == ()
    parsed = card_skills_from_card(
        {"skills": [{"id": "x", "name": "X"}, {"no_id": True}, {"id": ""}]}
    )
    assert len(parsed) == 1
    assert parsed[0].id == "x"
    assert parsed[0].description == ""
