"""The agent registry routes only real agent-skill capabilities, no drift."""

from __future__ import annotations

from nova_orchestrator.agents import (
    AgentDescriptor,
    AgentRegistry,
    build_default_registry,
)
from nova_orchestrator.config import OrchestratorConfig


def _config() -> OrchestratorConfig:
    return OrchestratorConfig(
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
