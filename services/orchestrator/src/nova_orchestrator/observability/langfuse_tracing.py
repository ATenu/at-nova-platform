"""Thin, fail-soft wiring around the native Langfuse v3 SDK.

This module configures the OpenTelemetry-native Langfuse client and exposes a
few helpers; it deliberately adds NO custom tracing protocol — callers use the
native SDK objects (the client, ``CallbackHandler``, ``start_as_current_observation``)
directly.

Two non-negotiables (rules 010 / 040): never send secrets to Langfuse, and fail
soft. A masking callable strips credential-like keys and token-like strings from
every exported input/output, and every helper degrades to a no-op when Langfuse
is disabled, unconfigured, or unreachable (a tracing failure never breaks a run).
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("nova_orchestrator.observability")

_TRUTHY = {"1", "true", "yes", "on"}

# Credential-like key fragments: any dict key containing one of these (case
# insensitive) has its value redacted, regardless of nesting depth.
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

# Token-like string patterns redacted anywhere they appear (defense in depth).
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
    """Strip credential-like keys/strings and bound size before export.

    Applied by the Langfuse client to every captured input/output. Business
    content is preserved (operator telemetry, like the existing SSE redaction),
    but secrets are always removed and structures are bounded.
    """
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

        # Keys/host are read from LANGFUSE_* env automatically; the mask + env are
        # passed explicitly. tracing_enabled gates export without removing the API.
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
    """Deterministic, correlatable trace id seeded from the run id (or ``None``)."""
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


def current_observation_id() -> str | None:
    client = get_tracer()
    if client is None:
        return None
    try:
        observation_id = client.get_current_observation_id()
        return str(observation_id) if observation_id else None
    except Exception:  # noqa: BLE001
        return None


@contextmanager
def run_trace(
    *,
    run_id: str,
    name: str,
    user_id: str = "",
    session_id: str = "",
) -> Iterator[Any | None]:
    """Open the per-run root span (one trace per run, seeded from ``run_id``).

    Yields the native Langfuse client (or ``None`` when disabled). All child
    observations created within this block — LangGraph node spans and LLM
    generations from the CallbackHandler, plus tool spans — nest under it.
    """
    client = get_tracer()
    if client is None:
        yield None
        return
    trace_id = trace_id_for(run_id)
    # A new trace with a predetermined trace id needs an arbitrary 16-hex parent
    # span id for trace-id inheritance (its value is irrelevant).
    parent_span_id = (run_id.replace("-", "")[:16] or "0").ljust(16, "0")
    trace_context = {"trace_id": trace_id, "parent_span_id": parent_span_id}
    try:
        with client.start_as_current_observation(
            as_type="span", name=name, trace_context=trace_context
        ) as span:
            try:
                attrs: dict[str, Any] = {"name": name}
                if session_id:
                    attrs["session_id"] = session_id
                if user_id:
                    attrs["user_id"] = user_id
                client.update_current_trace(**attrs)
            except Exception:  # noqa: BLE001
                pass
            yield span
    except Exception:  # noqa: BLE001 - a tracing failure must never break a run
        logger.warning("langfuse run_trace failed; continuing untraced", exc_info=False)
        yield None


@contextmanager
def tool_span(name: str, **metadata: Any) -> Iterator[None]:
    """Native span around a single tool/MCP/agent invocation (safe metadata only)."""
    client = get_tracer()
    if client is None:
        yield None
        return
    try:
        with client.start_as_current_observation(
            as_type="span", name=name, metadata=metadata or None
        ):
            yield None
    except Exception:  # noqa: BLE001
        yield None


def flush() -> None:
    """Best-effort flush of buffered spans (call at the end of a run)."""
    client = get_tracer()
    if client is None:
        return
    try:
        client.flush()
    except Exception:  # noqa: BLE001
        pass
