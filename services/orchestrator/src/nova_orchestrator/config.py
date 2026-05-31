"""Typed configuration for the orchestration plane, loaded from the environment.

No module reads ``os.environ`` directly; the process fails fast on missing
required configuration. Secrets (client secrets, broker passwords) are never
logged. Importable without third-party dependencies so the authz tests stay
lightweight.
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
    return os.environ.get(name) or default


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:  # noqa: TRY003
        raise ConfigError(f"Environment variable {name} must be an integer") from exc


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:  # noqa: TRY003
        raise ConfigError(f"Environment variable {name} must be a number") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class OrchestratorConfig:
    role: str
    broker_url: str
    result_backend: str
    agents_database_url: str
    keycloak_issuer_url: str
    keycloak_jwks_uri: str
    keycloak_token_url: str
    orchestrator_audience: str
    worker_client_id: str
    worker_client_secret: str
    # When true, forward the target audience to the IdP as an OAuth scope (realm
    # exposes per-audience client scopes). When false, the realm injects the
    # audience via protocol mappers on the worker client and azp pinning guards
    # each resource server (the dev realm's mode).
    worker_request_audience_scopes: bool
    run_soft_time_limit_s: int
    run_time_limit_s: int
    # Internal MCP tool gateway (Node control plane) the worker calls back into.
    nova_api_internal_url: str
    max_run_steps: int
    # A2A SQL analyst agent: endpoint + the audience the worker mints tokens for.
    sql_analyst_agent_url: str
    sql_analyst_agent_audience: str
    # LLM (OpenAI) powering the autonomous reasoning/critique/compose nodes.
    openai_api_key: str
    llm_model: str
    llm_temperature: float
    llm_timeout_s: float
    openai_base_url: str | None

    @property
    def is_worker(self) -> bool:
        return self.role == "worker"


def load_config() -> OrchestratorConfig:
    issuer = _require("KEYCLOAK_ISSUER_URL")
    jwks = _optional(
        "KEYCLOAK_JWKS_URI",
        f"{issuer.rstrip('/')}/protocol/openid-connect/certs",
    )
    token_url = _optional(
        "KEYCLOAK_TOKEN_URL",
        f"{issuer.rstrip('/')}/protocol/openid-connect/token",
    )
    return OrchestratorConfig(
        role=_optional("ORCHESTRATOR_ROLE", "worker"),
        broker_url=_require("CELERY_BROKER_URL"),
        result_backend=_require("CELERY_RESULT_BACKEND"),
        agents_database_url=_require("AGENTS_DATABASE_URL"),
        keycloak_issuer_url=issuer,
        keycloak_jwks_uri=jwks,
        keycloak_token_url=token_url,
        orchestrator_audience=_optional("ORCHESTRATOR_AUDIENCE", "nova-orchestrator"),
        worker_client_id=_optional("WORKER_CLIENT_ID", "nova-celery-worker"),
        # Secret is only required when the worker actually mints per-hop tokens.
        worker_client_secret=_optional("WORKER_CLIENT_SECRET", ""),
        worker_request_audience_scopes=_bool("WORKER_REQUEST_AUDIENCE_SCOPES", False),
        run_soft_time_limit_s=_int("RUN_SOFT_TIME_LIMIT_S", 6900),
        run_time_limit_s=_int("RUN_TIME_LIMIT_S", 7200),
        nova_api_internal_url=_optional("NOVA_API_INTERNAL_URL", "http://nova-api:3000"),
        max_run_steps=_int("MAX_RUN_STEPS", 8),
        sql_analyst_agent_url=_optional(
            "SQL_ANALYST_AGENT_URL", "http://at-sql-analyser:8003"
        ),
        sql_analyst_agent_audience=_optional(
            "SQL_ANALYST_AGENT_AUDIENCE", "nova-agent-sql-analyst"
        ),
        # Optional at boot (the gateway role does not reason); the worker's LLM
        # client fails fast if it is missing when reasoning is actually needed.
        openai_api_key=_optional("OPENAI_API_KEY", ""),
        llm_model=_optional("LLM_MODEL", "gpt-4o-mini"),
        llm_temperature=_float("LLM_TEMPERATURE", 0.0),
        llm_timeout_s=_float("LLM_TIMEOUT_S", 30.0),
        openai_base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )
