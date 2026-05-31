"""Native A2A client: the worker's outbound channel to a Nova agent.

Speaks the A2A protocol via the official ``a2a-sdk`` client. The worker resolves
the agent's card, then sends a task carrying ONLY the run id, the skill id, the
goal text, and correlation/approval flags — never the entitlement snapshot, never
a user token, never a secret. The audience-restricted service token
(``aud: nova-agent-<name>``) is injected per call by an interceptor. The agent
independently re-verifies the snapshot by run id and re-runs its own Layer B
gate, so a compromised worker cannot widen what the agent will do.

Responses are treated as untrusted: only typed fields are read (the agent's
typed ``status``/``answer``/``reason`` plus any links), and nothing is trusted to
authorize. The worker runs synchronously (Celery), so the async client is driven
through a short-lived event loop per call.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.client.middleware import ClientCallContext, ClientCallInterceptor
from a2a.types import AgentCard, DataPart, Message, Part, Role, Task, TaskState, TextPart
from a2a.utils import get_data_parts, get_text_parts

from .tokens import ServiceTokenClient

_TIMEOUT_S = 60.0
_WORKER_SENDER = "nova-celery-worker"

# Map the A2A task state to Nova's internal step status vocabulary.
_STATE_TO_STATUS: dict[TaskState, str] = {
    TaskState.completed: "completed",
    TaskState.failed: "failed",
    TaskState.canceled: "failed",
    TaskState.rejected: "denied",
    TaskState.input_required: "needs_approval",
    TaskState.auth_required: "needs_approval",
}


class AgentClientError(RuntimeError):
    """Raised when the agent is unreachable or returns a non-success response."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AgentEvent:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentTaskResult:
    status: str
    answer: str | None
    reason: str | None
    events: tuple[AgentEvent, ...] = ()
    links: tuple[dict[str, str], ...] = ()


class _BearerInterceptor(ClientCallInterceptor):
    """Injects the audience-restricted bearer token on every outbound A2A call."""

    def __init__(self, token: str) -> None:
        self._token = token

    async def intercept(
        self,
        method_name: str,
        request_payload: dict[str, Any],
        http_kwargs: dict[str, Any],
        agent_card: AgentCard | None,
        context: ClientCallContext | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        headers = dict(http_kwargs.get("headers") or {})
        headers["Authorization"] = f"Bearer {self._token}"
        return request_payload, {**http_kwargs, "headers": headers}


class AgentClient:
    def __init__(self, *, tokens: ServiceTokenClient) -> None:
        self._tokens = tokens

    def send_task(
        self,
        *,
        base_url: str,
        audience_scope: str,
        receiver: str,
        run_id: str,
        skill_id: str,
        goal: str,
        correlation_id: str,
        intent: str = "read",
        approval_granted: bool = False,
    ) -> AgentTaskResult:
        token = self._tokens.get_token(audience_scope)
        payload = {
            "correlationId": correlation_id,
            "sender": _WORKER_SENDER,
            "receiver": receiver,
            "runId": run_id,
            "skillId": skill_id,
            "goal": goal,
            "intent": intent,
            "approvalGranted": approval_granted,
        }
        try:
            return asyncio.run(self._send(base_url, token, goal, payload))
        except AgentClientError as exc:
            if exc.status_code == 401:
                self._tokens.invalidate(audience_scope)
            raise
        except Exception as exc:  # noqa: BLE001 - normalise any transport/protocol failure
            status_code = getattr(exc, "status_code", None)
            if status_code == 401:
                self._tokens.invalidate(audience_scope)
            raise AgentClientError(
                "agent request failed",
                status_code=status_code if isinstance(status_code, int) else None,
            ) from exc

    async def _send(
        self, base_url: str, token: str, goal: str, payload: dict[str, Any]
    ) -> AgentTaskResult:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as http:
            resolver = A2ACardResolver(httpx_client=http, base_url=base_url.rstrip("/"))
            card = await resolver.get_agent_card()
            config = ClientConfig(
                httpx_client=http,
                streaming=False,
                accepted_output_modes=["text/plain", "application/json"],
            )
            client = ClientFactory(config).create(
                card, interceptors=[_BearerInterceptor(token)]
            )
            message = Message(
                role=Role.user,
                message_id=str(uuid.uuid4()),
                parts=[
                    Part(root=DataPart(data=payload)),
                    Part(root=TextPart(text=goal)),
                ],
            )
            final_task = None
            final_message: Message | None = None
            async for event in client.send_message(message):
                if isinstance(event, tuple):
                    final_task = event[0]
                else:
                    final_message = event
            return _parse_result(final_task, final_message)


def _parse_result(task: Task | None, message: Message | None) -> AgentTaskResult:
    if task is not None:
        parts: list[Part] = []
        for artifact in task.artifacts or []:
            parts.extend(artifact.parts)
        data = _merge_data(get_data_parts(parts))
        texts = get_text_parts(parts)
        state = task.status.state if task.status else None
        status = data.get("status")
        if not isinstance(status, str):
            status = _STATE_TO_STATUS.get(state, "failed") if state else "failed"
        answer = data.get("answer")
        if not isinstance(answer, str):
            answer = texts[0] if texts else None
        reason = data.get("reason")
        return AgentTaskResult(
            status=status,
            answer=answer if isinstance(answer, str) else None,
            reason=reason if isinstance(reason, str) else None,
            links=_coerce_links(data.get("links")),
        )
    if message is not None:
        texts = get_text_parts(message.parts)
        return AgentTaskResult(
            status="completed",
            answer=texts[0] if texts else None,
            reason=None,
        )
    raise AgentClientError("agent returned no task or message")


def _merge_data(parts: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for part in parts:
        if isinstance(part, dict):
            merged.update(part)
    return merged


def _coerce_links(value: object) -> tuple[dict[str, str], ...]:
    links: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                label = item.get("label")
                href = item.get("href")
                if isinstance(label, str) and isinstance(href, str):
                    links.append({"label": label, "href": href})
    return tuple(links)
