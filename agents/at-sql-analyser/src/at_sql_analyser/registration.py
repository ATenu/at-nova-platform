"""Native A2A self-registration: publish this agent's card to the orchestrator.

On startup (and then on a heartbeat) the agent POSTs its Agent Card plus its
inbound audience and public URL to the orchestrator's authenticated registration
endpoint, so the orchestrator can discover and route to it with no static config.

This is discovery only: authorization always stays with the per-run entitlement
snapshot + Layer B gate, re-verified by this agent on every task. Registration is
best-effort and fail-soft - an unreachable or rejecting orchestrator only logs a
warning and never prevents the agent from serving tasks (the orchestrator keeps a
static seed for rollout). No secret or token is ever logged.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from typing import Any

import httpx

from .auth.tokens import ServiceTokenClient, ServiceTokenError

logger = logging.getLogger(__name__)

_TIMEOUT_S = 10.0

# Rebuilds the agent's discovery card from live sources (MCP view catalog). Must
# be fail-soft and side-effect free: it runs on every heartbeat.
CardProvider = Callable[[], dict[str, Any]]


class AgentRegistrar:
    """Publishes the agent card to the orchestrator on startup + on a heartbeat.

    The card is REBUILT on every heartbeat (``card_provider``) rather than frozen
    at startup, so changes to the agent's live data surface propagate to the
    orchestrator's routing menu without a restart. The heartbeat always POSTs
    (the upsert doubles as the orchestrator's liveness refresh / TTL guard); the
    orchestrator independently skips rewriting an unchanged card.
    """

    def __init__(
        self,
        *,
        orchestrator_url: str,
        audience_scope: str,
        tokens: ServiceTokenClient,
        name: str,
        base_url: str,
        audience: str,
        card_provider: CardProvider,
        heartbeat_s: int,
    ) -> None:
        root = orchestrator_url.rstrip("/")
        self._register_url = f"{root}/internal/agents/register"
        self._deregister_url = f"{root}/internal/agents/{name}"
        self._audience_scope = audience_scope
        self._tokens = tokens
        self._name = name
        self._base_url = base_url
        self._audience = audience
        self._card_provider = card_provider
        self._heartbeat_s = max(1, heartbeat_s)
        self._task: asyncio.Task[None] | None = None

    def _auth_header(self) -> dict[str, str] | None:
        try:
            token = self._tokens.get_token(self._audience_scope)
        except ServiceTokenError:
            logger.warning("a2a registration: could not mint orchestrator token")
            return None
        return {"Authorization": f"Bearer {token}"}

    async def _build_payload(self) -> dict[str, Any] | None:
        # Rebuild off the event loop: the provider does blocking IO (catalog
        # fetch / token mint). Fail-soft: a provider error skips this heartbeat
        # rather than crashing the loop or serving.
        try:
            card = await asyncio.to_thread(self._card_provider)
        except Exception:  # noqa: BLE001 - provider failure must never kill the heartbeat
            logger.warning("a2a registration: failed to rebuild agent card")
            return None
        return {
            "name": self._name,
            "baseUrl": self._base_url,
            "audience": self._audience,
            "card": card,
        }

    async def register_once(self) -> bool:
        headers = self._auth_header()
        if headers is None:
            return False
        payload = await self._build_payload()
        if payload is None:
            return False
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                response = await client.post(
                    self._register_url, json=payload, headers=headers
                )
        except httpx.HTTPError:
            logger.warning("a2a registration: orchestrator unreachable")
            return False
        if response.status_code >= 400:
            logger.warning("a2a registration rejected (status=%s)", response.status_code)
            return False
        return True

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self._heartbeat_s)
            await self.register_once()

    async def start(self) -> None:
        await self.register_once()
        if self._task is None:
            self._task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        headers = self._auth_header()
        if headers is None:
            return
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                await client.delete(self._deregister_url, headers=headers)
        except httpx.HTTPError:
            logger.warning("a2a deregistration: orchestrator unreachable")
