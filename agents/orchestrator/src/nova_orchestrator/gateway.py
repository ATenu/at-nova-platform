"""Orchestrator task gateway (FastAPI).

Exists so the Node API never needs broker credentials. Validates the inbound
``nova-api`` service token (issuer, ``aud: nova-orchestrator``, ``exp``,
``alg``, signature against Keycloak JWKS) and enqueues the Celery task by ID
only. The body carries no prompt, secret, or user token.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx
import jwt
from a2a.client import A2ACardResolver
from fastapi import Depends, FastAPI, Header, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .agents import card_skills_from_card, is_allowed_base_url
from .config import OrchestratorConfig, load_config
from .db import get_session_factory
from .models import A2aAgentRegistration

_ALLOWED_ALGS = ["RS256", "ES256"]
# A single GET against the well-known card path; fail fast on an unreachable host.
_CARD_TIMEOUT_S = 15.0

_logger = logging.getLogger(__name__)


class CardFetchError(Exception):
    """Native A2A card resolution failed (unreachable / non-2xx / unparseable)."""


async def resolve_agent_card(
    host_url: str, *, timeout_s: float = _CARD_TIMEOUT_S
) -> dict[str, Any]:
    """Fetch + parse an Agent Card over native A2A (discovery data only).

    Reuses the same ``A2ACardResolver`` mechanism the worker uses outbound, so
    admin onboarding resolves the card exactly as self-registration's source
    would publish it. Raises ``CardFetchError`` on any failure; the card is
    never trusted for authorization (typed parse only).
    """
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as http:
            resolver = A2ACardResolver(httpx_client=http, base_url=host_url.rstrip("/"))
            card = await resolver.get_agent_card()
    except Exception as exc:  # noqa: BLE001 - upstream A2A/httpx failure space is broad
        raise CardFetchError(str(exc)) from exc
    return card.model_dump(mode="json", by_alias=True, exclude_none=True)


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


class OnboardAgentRequest(BaseModel):
    """Operator-driven onboarding payload (control plane -> orchestrator).

    The card is NOT supplied: it is fetched live over native A2A from
    ``hostUrl``. The control plane sends only ID/metadata (never a secret).
    """

    hostUrl: str = Field(min_length=1)
    audience: str = Field(min_length=1, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    displayName: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    tags: list[str] = Field(default_factory=list)
    enabled: bool = True
    # Actor subject for audit/attribution only (never a secret, never trusted
    # for authorization).
    onboardedBy: str | None = Field(default=None, max_length=255)


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

    def require_agent_onboarder(
        claims: dict[str, object] = Depends(require_service_token),
    ) -> dict[str, object]:
        # Default deny: admin onboarding is driven only by the control plane.
        # A distinct azp allowlist (default ``nova-api``) from agent
        # self-registration: even if the Node route were misconfigured, the
        # execution plane refuses non-control-plane callers (defense in depth).
        azp = claims.get("azp")
        if not isinstance(azp, str) or azp not in cfg.agent_onboard_authorized_parties:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "onboarding not permitted")
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
        with get_session_factory(cfg)() as session:
            existing = session.get(A2aAgentRegistration, body.name)
            if existing is None:
                # First registration: insert. The on-conflict clause keeps the
                # write idempotent if a replica's heartbeat races us in (treat it
                # as a liveness refresh).
                session.execute(
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
                        set_={"last_seen_at": now},
                    )
                )
                session.commit()
                return {"name": body.name, "status": "registered"}
            # Heartbeat: ALWAYS refresh liveness + endpoint coordinates (the
            # TTL gate must keep treating the agent as live). Only rewrite the
            # card + derived skills when the published card actually changed, so
            # an unchanged heartbeat is a pure liveness refresh, not card churn.
            existing.last_seen_at = now
            existing.base_url = body.baseUrl
            existing.audience = body.audience
            card_changed = existing.card != body.card
            if card_changed:
                existing.card = body.card
                existing.skill_ids = skill_ids
            session.commit()
        return {"name": body.name, "status": "updated" if card_changed else "heartbeat"}

    @app.post("/internal/agents/onboard", status_code=status.HTTP_201_CREATED)
    async def onboard_agent(
        body: OnboardAgentRequest,
        _claims: dict[str, object] = Depends(require_agent_onboarder),
    ) -> dict[str, Any]:
        # SSRF guard first: the worker later mints tokens for and sends tasks to
        # this host, so constrain scheme/host (+ optional allowlist) before we
        # ever make an outbound request to it.
        if not is_allowed_base_url(body.hostUrl, cfg.agent_registration_allowed_hosts):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid host url")

        # Success-gating: only a successfully retrieved, parseable card proceeds.
        try:
            card = await resolve_agent_card(body.hostUrl)
        except CardFetchError:
            # Coarse, non-leaky reason only (never the raw upstream body).
            _logger.warning("agent card fetch failed for onboarding host")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "agent card could not be retrieved"
            ) from None

        skill_ids = [skill.id for skill in card_skills_from_card(card)]
        if not skill_ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "card advertises no skills")

        raw_name = card.get("name")
        name = body.name or (raw_name if isinstance(raw_name, str) and raw_name else None)
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "agent name could not be determined")

        raw_version = card.get("version")
        version = raw_version if isinstance(raw_version, str) and raw_version else None
        now = datetime.now(UTC)

        with get_session_factory(cfg)() as session:
            existing = session.execute(
                select(A2aAgentRegistration).where(A2aAgentRegistration.name == name)
            ).scalar_one_or_none()
            # Preserve clear ownership: never let an admin row silently overwrite
            # a self-registered agent of the same name (and the poller never
            # touches self rows). Re-onboarding an existing admin row updates it.
            if existing is not None and existing.source == "self":
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "name already registered by a self-registered agent"
                )

            statement = (
                pg_insert(A2aAgentRegistration)
                .values(
                    name=name,
                    base_url=body.hostUrl,
                    audience=body.audience,
                    card=card,
                    skill_ids=skill_ids,
                    registered_at=now,
                    last_seen_at=now,
                    source="admin",
                    status="onboarded",
                    enabled=body.enabled,
                    display_name=body.displayName,
                    description=body.description,
                    version=version,
                    tags=list(body.tags),
                    onboarded_by=body.onboardedBy,
                    onboarded_at=now,
                    last_card_fetch_at=now,
                    consecutive_failures=0,
                    last_error=None,
                )
                .on_conflict_do_update(
                    index_elements=[A2aAgentRegistration.name],
                    set_={
                        "base_url": body.hostUrl,
                        "audience": body.audience,
                        "card": card,
                        "skill_ids": skill_ids,
                        "last_seen_at": now,
                        "source": "admin",
                        "status": "onboarded",
                        "enabled": body.enabled,
                        "display_name": body.displayName,
                        "description": body.description,
                        "version": version,
                        "tags": list(body.tags),
                        "onboarded_by": body.onboardedBy,
                        "onboarded_at": now,
                        "last_card_fetch_at": now,
                        "consecutive_failures": 0,
                        "last_error": None,
                    },
                )
            )
            session.execute(statement)
            session.commit()

        return {
            "name": name,
            "baseUrl": body.hostUrl,
            "audience": body.audience,
            "skillIds": skill_ids,
            "version": version,
            "status": "onboarded",
            "card": card,
        }

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
