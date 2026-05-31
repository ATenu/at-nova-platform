"""The A2A client trusts only typed response fields and fails closed.

The transport is the official ``a2a-sdk`` client; these tests pin the trust
boundary: the worker reads ONLY the agent's typed ``status``/``answer``/links
DataPart (never free-form instructions), maps task state defensively, injects
the audience-restricted bearer token, and invalidates the token on 401.
"""

from __future__ import annotations

import pytest
from a2a.types import Artifact, DataPart, Message, Part, Role, Task, TaskState, TaskStatus, TextPart

from nova_orchestrator.agent_client import (
    AgentClient,
    AgentClientError,
    _BearerInterceptor,
    _coerce_links,
    _parse_result,
)


class _StubTokens:
    def __init__(self) -> None:
        self.invalidated: list[str | None] = []

    def get_token(self, scope: str | None = None) -> str:
        return f"token-for-{scope}"

    def invalidate(self, scope: str | None = None) -> None:
        self.invalidated.append(scope)


def _task(
    state: TaskState, *, data: dict[str, object] | None = None, text: str | None = None
) -> Task:
    parts: list[Part] = []
    if data is not None:
        parts.append(Part(root=DataPart(data=data)))
    if text is not None:
        parts.append(Part(root=TextPart(text=text)))
    artifacts = [Artifact(artifact_id="a", parts=parts)] if parts else []
    return Task(id="t", context_id="c", status=TaskStatus(state=state), artifacts=artifacts)


def test_parse_reads_typed_status_datapart() -> None:
    task = _task(
        TaskState.completed,
        data={
            "status": "completed",
            "answer": "There are 12 sales.",
            "links": [{"label": "Report", "href": "https://x/y"}, {"bad": "link"}],
        },
        text="There are 12 sales.",
    )
    result = _parse_result(task, None)
    assert result.status == "completed"
    assert result.answer == "There are 12 sales."
    # A malformed link entry is dropped, not trusted verbatim.
    assert result.links == ({"label": "Report", "href": "https://x/y"},)


def test_parse_maps_task_state_when_no_status_datapart() -> None:
    # No typed status DataPart: fall back to the A2A task state mapping.
    task = _task(TaskState.rejected, text="nope")
    result = _parse_result(task, None)
    assert result.status == "denied"
    assert result.answer == "nope"


def test_parse_maps_input_required_to_needs_approval() -> None:
    task = _task(TaskState.input_required)
    assert _parse_result(task, None).status == "needs_approval"


def test_parse_message_only_response() -> None:
    message = Message(role=Role.agent, message_id="m", parts=[Part(root=TextPart(text="hello"))])
    result = _parse_result(None, message)
    assert result.status == "completed"
    assert result.answer == "hello"


def test_parse_raises_when_no_task_or_message() -> None:
    with pytest.raises(AgentClientError):
        _parse_result(None, None)


def test_coerce_links_filters_malformed_entries() -> None:
    assert _coerce_links([{"label": "A", "href": "h"}, {"bad": 1}, "x"]) == (
        {"label": "A", "href": "h"},
    )
    assert _coerce_links(None) == ()


async def test_interceptor_injects_bearer_token() -> None:
    interceptor = _BearerInterceptor("tok-123")
    _payload, http_kwargs = await interceptor.intercept(
        "message/send", {}, {"headers": {"X": "y"}}, None, None
    )
    assert http_kwargs["headers"]["Authorization"] == "Bearer tok-123"
    assert http_kwargs["headers"]["X"] == "y"  # existing headers preserved


def test_send_task_invalidates_token_on_401(monkeypatch: pytest.MonkeyPatch) -> None:
    tokens = _StubTokens()
    client = AgentClient(tokens=tokens)  # type: ignore[arg-type]

    async def _boom(*_args: object, **_kwargs: object) -> object:
        raise AgentClientError("unauthorized", status_code=401)

    monkeypatch.setattr(client, "_send", _boom)
    with pytest.raises(AgentClientError):
        client.send_task(
            base_url="http://agent",
            audience_scope="nova-agent-sql-analyst",
            receiver="at-sql-analyser",
            run_id="r",
            skill_id="data.analyse.read",
            goal="g",
            correlation_id="r",
        )
    assert tokens.invalidated == ["nova-agent-sql-analyst"]


def test_send_task_normalizes_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    tokens = _StubTokens()
    client = AgentClient(tokens=tokens)  # type: ignore[arg-type]

    async def _boom(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("connection reset")

    monkeypatch.setattr(client, "_send", _boom)
    with pytest.raises(AgentClientError):
        client.send_task(
            base_url="http://agent",
            audience_scope="nova-agent-sql-analyst",
            receiver="at-sql-analyser",
            run_id="r",
            skill_id="data.analyse.read",
            goal="g",
            correlation_id="r",
        )
    assert tokens.invalidated == []  # non-401 does not invalidate
