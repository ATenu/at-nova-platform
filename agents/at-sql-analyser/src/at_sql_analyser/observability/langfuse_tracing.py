"""Thin, fail-soft wiring around the native Langfuse v3 SDK (agent side).

Mirrors the orchestrator module: configures the OpenTelemetry-native Langfuse
client, exposes a masking callable and a few helpers, and adds NO custom tracing
protocol. The agent JOINS the orchestrator's per-run trace (via W3C trace
context) so its spans nest under the same shared context.

Two non-negotiables (rules 010 / 040): never send secrets to Langfuse, and fail
soft. The mask strips credential-like keys/strings; every helper degrades to a
no-op when Langfuse is disabled, unconfigured, or unreachable.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("at_sql_analyser.observability")

_TRUTHY = {"1", "true", "yes", "on"}

_SECRET_KEY_FRAGMENTS = (
    "authorization",
    "token",
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "api-key",
    "cookie",
    "credential",
    "bearer",
    "private_key",
    "client_secret",
)

_TOKEN_PATTERNS = (
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE),
    re.compile(r"eyJ[A-Za-z0-9._\-]{10,}"),  # JWT
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9._\-]{8,}\b"),  # provider API keys
)

_REDACTED = "[redacted]"
_MAX_STRING = 2000
_MAX_DEPTH = 8
_MAX_ITEMS = 200

_initialized = False
_client: Any | None = None


def _enabled() -> bool:
    flag = os.environ.get("LANGFUSE_TRACING_ENABLED", "true").strip().lower() in _TRUTHY
    has_keys = bool(
        os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")
    )
    return flag and has_keys


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in _SECRET_KEY_FRAGMENTS)


def _redact_string(value: str) -> str:
    redacted = value
    for pattern in _TOKEN_PATTERNS:
        redacted = pattern.sub(_REDACTED, redacted)
    if len(redacted) > _MAX_STRING:
        redacted = redacted[:_MAX_STRING] + "…"
    return redacted


def mask(data: Any, *, _depth: int = 0) -> Any:
    """Strip credential-like keys/strings and bound size before export."""
    try:
        if _depth >= _MAX_DEPTH:
            return "[truncated]"
        if isinstance(data, bool) or data is None or isinstance(data, int | float):
            return data
        if isinstance(data, str):
            return _redact_string(data)
        if isinstance(data, dict):
            safe: dict[str, Any] = {}
            for index, (key, value) in enumerate(data.items()):
                if index >= _MAX_ITEMS:
                    safe["…"] = "[truncated]"
                    break
                key_str = str(key)
                safe[key_str] = (
                    _REDACTED if _is_secret_key(key_str) else mask(value, _depth=_depth + 1)
                )
            return safe
        if isinstance(data, list | tuple):
            items = [mask(item, _depth=_depth + 1) for item in list(data)[:_MAX_ITEMS]]
            if len(data) > _MAX_ITEMS:
                items.append("[truncated]")
            return items
        text = str(data)
        return _redact_string(text)
    except Exception:  # noqa: BLE001 - masking must never raise into the SDK
        return _REDACTED


def get_tracer() -> Any | None:
    """Return the configured native Langfuse client, or ``None`` (no-op)."""
    global _initialized, _client
    if _initialized:
        return _client
    _initialized = True
    if not _enabled():
        _client = None
        return None
    try:
        from langfuse import Langfuse

        # blocked_instrumentation_scopes drops the a2a-sdk's own OpenTelemetry
        # spans (transport/event-queue internals) so they never pollute Langfuse
        # as standalone traces; our explicit spans capture the A2A hop instead.
        _client = Langfuse(
            mask=mask,
            environment=os.environ.get("LANGFUSE_ENVIRONMENT") or None,
            blocked_instrumentation_scopes=["a2a-python-sdk"],
        )
    except Exception:  # noqa: BLE001 - never let observability break startup
        logger.warning("langfuse client init failed; tracing disabled", exc_info=False)
        _client = None
    return _client


def trace_id_for(run_id: str) -> str | None:
    """Deterministic trace id seeded from the run id (matches the orchestrator)."""
    if get_tracer() is None:
        return None
    try:
        from langfuse import Langfuse

        return str(Langfuse.create_trace_id(seed=run_id))
    except Exception:  # noqa: BLE001
        return None


def make_callback_handler() -> Any | None:
    """Native LangChain/LangGraph CallbackHandler bound to the active context."""
    if get_tracer() is None:
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception:  # noqa: BLE001
        logger.warning(
            "langfuse langchain CallbackHandler unavailable; LLM calls will not be "
            "traced (is the 'langchain' package installed?)",
            exc_info=False,
        )
        return None


def _valid_hex(value: str | None, length: int) -> str | None:
    if value is None:
        return None
    candidate = value.strip().lower()
    if len(candidate) == length and all(c in "0123456789abcdef" for c in candidate):
        return candidate
    return None


def _safe_exit(observation: Any, *exc_info: Any) -> None:
    """Close a native observation, never letting a tracing error escape the task."""
    try:
        observation.__exit__(*exc_info)
    except Exception:  # noqa: BLE001 - tracing teardown must never break a task
        logger.warning("langfuse observation teardown failed; continuing", exc_info=False)


@contextmanager
def _observation(**kwargs: Any) -> Iterator[Any | None]:
    """Enter a native Langfuse observation with fail-soft tracing semantics.

    Tracing *setup/teardown* failures degrade to a no-op so a broken, disabled,
    or unreachable Langfuse never breaks a task (rules 010/040). Exceptions raised
    by the wrapped body are deliberately NOT swallowed: they are recorded on the
    span (via ``__exit__``) and re-raised so the caller's own error handling runs.

    Swallowing a body exception here and then yielding again — as the previous
    implementation did — re-entered the generator after ``throw()`` and raised
    ``RuntimeError: generator didn't stop after throw()``, which crashed the
    entire agent task on ANY tool/capability failure (e.g. a rejected write
    input) instead of letting the graph mark the step failed and respond.
    """
    client = get_tracer()
    if client is None:
        yield None
        return
    try:
        observation = client.start_as_current_observation(**kwargs)
        span = observation.__enter__()
    except Exception:  # noqa: BLE001 - tracing setup must never break a task
        logger.warning("langfuse observation setup failed; continuing untraced", exc_info=False)
        yield None
        return
    try:
        yield span
    except BaseException:
        _safe_exit(observation, *sys.exc_info())
        raise
    else:
        _safe_exit(observation, None, None, None)


@contextmanager
def agent_trace(
    *,
    run_id: str,
    name: str,
    parent_trace_id: str | None = None,
    parent_observation_id: str | None = None,
) -> Iterator[Any | None]:
    """Open the agent's root span, JOINED to the orchestrator's per-run trace.

    Uses the W3C trace context passed over A2A so the agent's spans nest under
    the orchestrator's run trace. Falls back to a deterministic trace id seeded
    from ``run_id`` when the orchestrator did not supply one (e.g. direct call).
    A tracing failure degrades to a no-op; exceptions from the wrapped body
    propagate unchanged.
    """
    trace_id = _valid_hex(parent_trace_id, 32) or trace_id_for(run_id)
    parent_span = _valid_hex(parent_observation_id, 16) or (
        run_id.replace("-", "")[:16] or "0"
    ).ljust(16, "0")
    trace_context = {"trace_id": trace_id, "parent_span_id": parent_span}
    with _observation(
        as_type="span", name=name, trace_context=trace_context
    ) as span:
        yield span


@contextmanager
def tool_span(name: str, **metadata: Any) -> Iterator[None]:
    """Native span around a single tool/MCP/capability invocation.

    Fail-soft on tracing; the wrapped call's own exceptions propagate so the
    step-level error handling (mark failed, emit event, audit) still runs.
    """
    with _observation(as_type="span", name=name, metadata=metadata or None):
        yield None


def flush() -> None:
    """Best-effort flush of buffered spans (call at the end of a task)."""
    client = get_tracer()
    if client is None:
        return
    try:
        client.flush()
    except Exception:  # noqa: BLE001
        pass
