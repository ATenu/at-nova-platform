"""Typed, fail-fast configuration for the SQL analyst agent.

Mirrors the orchestrator's config discipline: a frozen dataclass loaded once at
startup from validated env vars. The process refuses to boot on missing required
configuration. No module reads ``os.environ`` directly. Secrets are never logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def _optional(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"Environment variable {name} must be an integer") from exc


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"Environment variable {name} must be a number") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: str) -> tuple[str, ...]:
    raw = _optional(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class AgentConfig:
    port: int
    # Public base URL advertised in the A2A Agent Card (where clients reach us).
    public_url: str

    # Inbound auth: this agent's audience + the only client allowed to call it.
    keycloak_issuer_url: str
    keycloak_jwks_uri: str
    agent_audience: str
    authorized_parties: tuple[str, ...]

    # Outbound: mint client_credentials tokens to reach the DB MCP server and the
    # control-plane entitlement endpoint (both audience nova-mcp-data, decision D5).
    keycloak_token_url: str
    agent_client_id: str
    agent_client_secret: str
    mcp_audience_scope: str
    # When true, forward the target audience to the IdP as an OAuth scope (realm
    # exposes per-audience client scopes). When false, the realm injects the
    # audience via protocol mappers on the agent client and azp pinning guards
    # each resource server (the dev realm's mode).
    request_audience_scopes: bool

    # Native A2A self-registration: publish this agent's card to the orchestrator
    # on startup + heartbeat so it is discovered without static config. Discovery
    # only - authorization stays with the per-run snapshot + Layer B gate. The
    # agent mints an ``orchestrator_audience_scope`` token to call the endpoint.
    orchestrator_internal_url: str
    orchestrator_audience_scope: str
    registration_enabled: bool
    registration_heartbeat_s: int

    # Downstream endpoints.
    nova_api_internal_url: str
    db_mcp_url: str
    # Audience the agent mints tokens for when calling the Node capability tool
    # gateway (writes / scoped reads). Distinct from the read (nova-mcp-data) path.
    capability_audience_scope: str

    # Harness guardrails (bounded loop).
    max_iterations: int
    max_queries: int
    step_timeout_s: int
    total_timeout_s: int

    # LLM (OpenAI) powering the autonomous planning/reasoning/compose nodes.
    openai_api_key: str
    llm_model: str
    llm_temperature: float
    llm_timeout_s: float
    openai_base_url: str | None

    # Shared agent working-state + aligned conversation history (redis-agent).
    # Optional: unset/disabled keeps the agent stateless/single-turn as before.
    redis_agent_url: str | None
    agent_state_enabled: bool
    agent_state_key_prefix: str
    agent_state_ttl_s: int
    agent_history_read_limit: int


def load_config() -> AgentConfig:
    issuer = _require("KEYCLOAK_ISSUER_URL")
    jwks = _optional(
        "KEYCLOAK_JWKS_URI", f"{issuer.rstrip('/')}/protocol/openid-connect/certs"
    )
    token_url = _optional(
        "KEYCLOAK_TOKEN_URL", f"{issuer.rstrip('/')}/protocol/openid-connect/token"
    )
    port = _int("AGENT_PORT", 8003)
    return AgentConfig(
        port=port,
        public_url=_optional("AGENT_PUBLIC_URL", f"http://at-sql-analyser:{port}"),
        keycloak_issuer_url=issuer,
        keycloak_jwks_uri=jwks,
        agent_audience=_optional("AGENT_AUDIENCE", "nova-agent-sql-analyst"),
        # Only the Celery worker may task this agent.
        authorized_parties=_csv("AGENT_AUTHORIZED_PARTIES", "nova-celery-worker"),
        keycloak_token_url=token_url,
        agent_client_id=_optional("AGENT_CLIENT_ID", "nova-agent-sql-analyst"),
        agent_client_secret=_optional("AGENT_CLIENT_SECRET", ""),
        mcp_audience_scope=_optional("MCP_AUDIENCE_SCOPE", "nova-mcp-data"),
        request_audience_scopes=_bool("AGENT_REQUEST_AUDIENCE_SCOPES", False),
        orchestrator_internal_url=_optional(
            "ORCHESTRATOR_INTERNAL_URL", "http://orchestrator:8001"
        ),
        orchestrator_audience_scope=_optional(
            "ORCHESTRATOR_AUDIENCE_SCOPE", "nova-orchestrator"
        ),
        registration_enabled=_bool("A2A_REGISTRATION_ENABLED", True),
        registration_heartbeat_s=_int("A2A_REGISTRATION_HEARTBEAT_SECONDS", 60),
        nova_api_internal_url=_optional("NOVA_API_INTERNAL_URL", "http://nova-api:3000"),
        db_mcp_url=_optional("DB_MCP_URL", "http://db-mcp-server:8002"),
        capability_audience_scope=_optional("CAPABILITY_AUDIENCE_SCOPE", "nova-mcp-sales"),
        max_iterations=_int("AGENT_MAX_ITERATIONS", 6),
        max_queries=_int("AGENT_MAX_QUERIES", 8),
        step_timeout_s=_int("AGENT_STEP_TIMEOUT_S", 30),
        total_timeout_s=_int("AGENT_TOTAL_TIMEOUT_S", 120),
        openai_api_key=_require("OPENAI_API_KEY"),
        llm_model=_optional("LLM_MODEL", "gpt-4o-mini"),
        llm_temperature=_float("LLM_TEMPERATURE", 0.0),
        llm_timeout_s=_float("LLM_TIMEOUT_S", 30.0),
        openai_base_url=os.environ.get("OPENAI_BASE_URL") or None,
        redis_agent_url=os.environ.get("REDIS_AGENT_URL") or None,
        agent_state_enabled=_bool("AGENT_STATE_ENABLED", True),
        agent_state_key_prefix=_optional("AGENT_STATE_KEY_PREFIX", "nova:agent:"),
        agent_state_ttl_s=_int("AGENT_STATE_TTL_SECONDS", 7200),
        agent_history_read_limit=_int("AGENT_HISTORY_READ_LIMIT", 20),
    )
