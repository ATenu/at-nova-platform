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
from typing import Any

import httpx

from .auth.tokens import ServiceTokenClient, ServiceTokenError

logger = logging.getLogger(__name__)

_TIMEOUT_S = 10.0


class AgentRegistrar:
    """Posts the agent card to the orchestrator on startup + on a heartbeat."""

    def __init__(
        self,
        *,
        orchestrator_url: str,
        audience_scope: str,
        tokens: ServiceTokenClient,
        name: str,
        base_url: str,
        audience: str,
        card: dict[str, Any],
        heartbeat_s: int,
    ) -> None:
        root = orchestrator_url.rstrip("/")
        self._register_url = f"{root}/internal/agents/register"
        self._deregister_url = f"{root}/internal/agents/{name}"
        self._audience_scope = audience_scope
        self._tokens = tokens
        self._name = name
        self._payload: dict[str, Any] = {
            "name": name,
            "baseUrl": base_url,
            "audience": audience,
            "card": card,
        }
        self._heartbeat_s = max(1, heartbeat_s)
        self._task: asyncio.Task[None] | None = None

    def _auth_header(self) -> dict[str, str] | None:
        try:
            token = self._tokens.get_token(self._audience_scope)
        except ServiceTokenError:
            logger.warning("a2a registration: could not mint orchestrator token")
            return None
        return {"Authorization": f"Bearer {token}"}

    async def register_once(self) -> bool:
        headers = self._auth_header()
        if headers is None:
            return False
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                response = await client.post(
                    self._register_url, json=self._payload, headers=headers
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
