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
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.client.middleware import ClientCallContext, ClientCallInterceptor
from a2a.types import (
    AgentCard,
    DataPart,
    Message,
    Part,
    Role,
    Task,
    TaskState,
    TaskStatusUpdateEvent,
    TextPart,
)
from a2a.utils import get_data_parts, get_text_parts

from .tokens import ServiceTokenClient

# Fail fast on an unreachable agent, but give a reachable-but-working agent its
# full read budget. The read/write/pool span must cover the agent's entire
# bounded loop (see OrchestratorConfig.agent_request_timeout_s); only the TCP
# connect phase is held to a short ceiling.
_CONNECT_TIMEOUT_S = 10.0
_DEFAULT_TIMEOUT_S = 180.0
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
    # Monotonic per-task ordinal the agent assigns to each sub-step. Lets the
    # worker compute a deterministic dedupe key so a live-streamed frame and its
    # terminal-artifact twin (or a reconnect replay) never double-write.
    agent_seq: int | None = None


# Live per-frame callback the worker passes in to persist sub-events mid-run.
AgentEventCallback = Callable[[AgentEvent], None]


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
    def __init__(
        self, *, tokens: ServiceTokenClient, timeout_s: float = _DEFAULT_TIMEOUT_S
    ) -> None:
        self._tokens = tokens
        # Short connect ceiling (unreachable agent fails fast); the agent's full
        # bounded loop is bounded by the read/write/pool span, never cut short.
        self._timeout = httpx.Timeout(
            timeout_s, connect=min(_CONNECT_TIMEOUT_S, timeout_s)
        )

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
        conversation_id: str = "",
        langfuse_trace_id: str | None = None,
        langfuse_parent_observation_id: str | None = None,
        on_event: AgentEventCallback | None = None,
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
            # Conversation id lets the agent read the orchestrator-aligned, shared
            # history for multi-turn context. Never carries tokens/PII itself.
            "conversationId": conversation_id,
        }
        # Non-sensitive W3C trace identifiers so the agent joins the SAME Langfuse
        # trace and nests under this run's dispatch span. Omitted when tracing is
        # disabled. These are ids only — never tokens/PII.
        if langfuse_trace_id:
            payload["langfuseTraceId"] = langfuse_trace_id
        if langfuse_parent_observation_id:
            payload["langfuseParentObservationId"] = langfuse_parent_observation_id
        try:
            return asyncio.run(self._send(base_url, token, goal, payload, on_event))
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
        self,
        base_url: str,
        token: str,
        goal: str,
        payload: dict[str, Any],
        on_event: AgentEventCallback | None = None,
    ) -> AgentTaskResult:
        async with httpx.AsyncClient(timeout=self._timeout) as http:
            resolver = A2ACardResolver(httpx_client=http, base_url=base_url.rstrip("/"))
            card = await resolver.get_agent_card()
            # Feature-detect from the resolved card: stream only when a callback
            # is provided AND the agent advertises streaming. Otherwise fall back
            # to the batch path (intermediate sub-steps arrive in the terminal
            # artifact, exactly as before).
            streaming = bool(
                on_event is not None
                and card.capabilities is not None
                and card.capabilities.streaming
            )
            config = ClientConfig(
                httpx_client=http,
                streaming=streaming,
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
            final_task: Task | None = None
            final_message: Message | None = None
            async for event in client.send_message(message):
                if isinstance(event, tuple):
                    task, update = event
                    final_task = task
                    if streaming and on_event is not None:
                        await self._forward_frame(update, on_event)
                else:
                    final_message = event
            return _parse_result(final_task, final_message)

    @staticmethod
    async def _forward_frame(
        update: object, on_event: AgentEventCallback
    ) -> None:
        """Persist one non-final streamed sub-event via the worker's callback.

        The frame is UNTRUSTED: only a well-formed ``metadata.novaEvent`` is read
        (same discipline as ``_coerce_events``); anything else is dropped. The DB
        write is sync, so it runs in a thread to avoid blocking the event loop.
        """
        if not isinstance(update, TaskStatusUpdateEvent) or update.final:
            return
        metadata = update.metadata or {}
        nova = metadata.get("novaEvent") if isinstance(metadata, dict) else None
        agent_event = _coerce_stream_event(nova)
        if agent_event is not None:
            await asyncio.to_thread(on_event, agent_event)


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
            events=_coerce_events(data.get("events")),
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


def _coerce_stream_event(value: object) -> AgentEvent | None:
    """Coerce ONE untrusted ``metadata.novaEvent`` envelope into an AgentEvent.

    Only ``{type: str, payload: dict, agentSeq?: int}`` is accepted; the worker
    redacts + bounds the payload before it becomes a persisted event. Anything
    malformed is dropped (never trusted verbatim, never authorizes).
    """
    if not isinstance(value, dict):
        return None
    event_type = value.get("type")
    if not isinstance(event_type, str) or not event_type:
        return None
    payload = value.get("payload")
    agent_seq = value.get("agentSeq")
    # bool is an int subclass; reject it so a stray `true` never becomes ordinal 1.
    ordinal = agent_seq if isinstance(agent_seq, int) and not isinstance(agent_seq, bool) else None
    return AgentEvent(
        type=event_type,
        payload=payload if isinstance(payload, dict) else {},
        agent_seq=ordinal,
    )


def _coerce_events(value: object) -> tuple[AgentEvent, ...]:
    """Read the agent's typed progress events from its result DataPart.

    Untrusted input: only ``{type: str, payload: dict}`` entries are kept (with
    an optional ``agentSeq`` ordinal used for dedupe); the payload is preserved
    (the orchestrator redacts + bounds it before it becomes a persisted event).
    Anything malformed is dropped, never trusted verbatim.
    """
    events: list[AgentEvent] = []
    if isinstance(value, list):
        for item in value:
            coerced = _coerce_stream_event(item)
            if coerced is not None:
                events.append(coerced)
    return tuple(events)


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
