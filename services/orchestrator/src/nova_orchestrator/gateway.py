"""Orchestrator task gateway (FastAPI).

Exists so the Node API never needs broker credentials. Validates the inbound
``nova-api`` service token (issuer, ``aud: nova-orchestrator``, ``exp``,
``alg``, signature against Keycloak JWKS) and enqueues the Celery task by ID
only. The body carries no prompt, secret, or user token.
"""

from __future__ import annotations

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel, Field

from .config import OrchestratorConfig, load_config

_ALLOWED_ALGS = ["RS256", "ES256"]


class EnqueueRunRequest(BaseModel):
    runId: str = Field(min_length=1)
    requestId: str = Field(min_length=1)
    idempotencyKey: str = Field(min_length=1)
    actingSubject: str = Field(min_length=1)
    entitlementSnapshotId: str = Field(min_length=1)
    entitlementSnapshotHash: str = Field(min_length=1)


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

    return app
