"""Orchestrator task gateway (FastAPI).

Exists so the Node API never needs broker credentials. Validates the inbound
``nova-api`` service token (issuer, ``aud: nova-orchestrator``, ``exp``,
``alg``, signature against Keycloak JWKS) and enqueues the Celery task by ID
only. The body carries no prompt, secret, or user token.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .agents import card_skills_from_card, is_allowed_base_url
from .config import OrchestratorConfig, load_config
from .db import get_session_factory
from .models import A2aAgentRegistration

_ALLOWED_ALGS = ["RS256", "ES256"]


class EnqueueRunRequest(BaseModel):
    runId: str = Field(min_length=1)
    requestId: str = Field(min_length=1)
    idempotencyKey: str = Field(min_length=1)
    actingSubject: str = Field(min_length=1)
    entitlementSnapshotId: str = Field(min_length=1)
    entitlementSnapshotHash: str = Field(min_length=1)


class RegisterAgentRequest(BaseModel):
    """Native A2A self-registration payload (also serves as heartbeat)."""

    name: str = Field(min_length=1, max_length=255)
    baseUrl: str = Field(min_length=1)
    audience: str = Field(min_length=1)
    card: dict[str, Any]


def create_app(config: OrchestratorConfig | None = None) -> FastAPI:
    cfg = config or load_config()
    app = FastAPI(title="Nova Orchestrator", version="0.1.0")
    jwks_client = PyJWKClient(cfg.keycloak_jwks_uri)

    def require_service_token(authorization: str = Header(default="")) -> dict[str, object]:
        if not authorization.startswith("Bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bearer token required")
        token = authorization.removeprefix("Bearer ").strip()
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=_ALLOWED_ALGS,
                audience=cfg.orchestrator_audience,
                issuer=cfg.keycloak_issuer_url,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError as exc:  # invalid/expired/wrong-audience/wrong-issuer
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token") from exc
        return claims

    def require_agent_registrar(
        claims: dict[str, object] = Depends(require_service_token),
    ) -> dict[str, object]:
        # Default deny: even though agents are trusted for discovery, the
        # registrar must present a valid orchestrator-audience token whose ``azp``
        # is an allowlisted agent client. Adding an agent = add its client id to
        # AGENT_REGISTRATION_AUTHORIZED_PARTIES.
        azp = claims.get("azp")
        if not isinstance(azp, str) or azp not in cfg.agent_registration_authorized_parties:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "registration not permitted")
        return claims

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/internal/runs", status_code=status.HTTP_202_ACCEPTED)
    def enqueue_run(
        body: EnqueueRunRequest,
        _claims: dict[str, object] = Depends(require_service_token),
    ) -> dict[str, str]:
        # Import lazily so importing the gateway module doesn't require a broker.
        from .tasks import run_orchestration

        run_orchestration.apply_async(
            kwargs={
                "run_id": body.runId,
                "request_id": body.requestId,
                "idempotency_key": body.idempotencyKey,
                "entitlement_snapshot_id": body.entitlementSnapshotId,
                "entitlement_snapshot_hash": body.entitlementSnapshotHash,
            },
            queue="orchestrator.longrunning",
        )
        return {"runId": body.runId, "status": "queued"}

    @app.post("/internal/agents/register", status_code=status.HTTP_200_OK)
    def register_agent(
        body: RegisterAgentRequest,
        _claims: dict[str, object] = Depends(require_agent_registrar),
    ) -> dict[str, str]:
        # SSRF guard: the worker later mints tokens for and sends tasks to this
        # base_url, so constrain scheme/host before persisting it.
        if not is_allowed_base_url(body.baseUrl, cfg.agent_registration_allowed_hosts):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base url")
        skill_ids = [skill.id for skill in card_skills_from_card(body.card)]
        if not skill_ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "card advertises no skills")
        now = datetime.now(UTC)
        # Atomic upsert doubles as the heartbeat (refreshes last_seen_at).
        statement = (
            pg_insert(A2aAgentRegistration)
            .values(
                name=body.name,
                base_url=body.baseUrl,
                audience=body.audience,
                card=body.card,
                skill_ids=skill_ids,
                registered_at=now,
                last_seen_at=now,
            )
            .on_conflict_do_update(
                index_elements=[A2aAgentRegistration.name],
                set_={
                    "base_url": body.baseUrl,
                    "audience": body.audience,
                    "card": body.card,
                    "skill_ids": skill_ids,
                    "last_seen_at": now,
                },
            )
        )
        with get_session_factory(cfg)() as session:
            session.execute(statement)
            session.commit()
        return {"name": body.name, "status": "registered"}

    @app.delete("/internal/agents/{name}", status_code=status.HTTP_200_OK)
    def deregister_agent(
        name: str,
        _claims: dict[str, object] = Depends(require_agent_registrar),
    ) -> dict[str, str]:
        with get_session_factory(cfg)() as session:
            row = session.get(A2aAgentRegistration, name)
            if row is not None:
                session.delete(row)
                session.commit()
        return {"name": name, "status": "deregistered"}

    return app
