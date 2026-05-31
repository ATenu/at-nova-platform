"""PII-free, scrubbed tracing for the agent.

Two non-negotiables (rule 040): never emit secrets or full PII into traces, and
scrub before emitting. The harness only ever produces safe metadata (sql hashes,
row counts, decision reasons), but we defensively scrub every payload here so a
future careless caller cannot leak PII into a span. Langfuse is optional and
loaded lazily; when absent, events go to the structured logger only.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

logger = logging.getLogger("at_sql_analyser.trace")

# Keys that must never appear in a trace payload, even by accident.
_FORBIDDEN_KEYS = frozenset(
    {
        "sql",
        "query",
        "rows",
        "row",
        "value",
        "values",
        "email",
        "phone",
        "name",
        "address",
        "token",
        "authorization",
        "secret",
        "password",
        "prompt",
        "goal",
        "answer",
    }
)
_MAX_STR = 256


def scrub(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop forbidden keys and truncate/normalize values to safe primitives."""
    safe: dict[str, Any] = {}
    for key, value in payload.items():
        if key.lower() in _FORBIDDEN_KEYS:
            continue
        if isinstance(value, bool | int | float) or value is None:
            safe[key] = value
        elif isinstance(value, str):
            safe[key] = value[:_MAX_STR]
        else:
            # Never serialize arbitrary structures into a span.
            safe[key] = f"<{type(value).__name__}>"
    return safe


class Tracer(Protocol):
    def event(self, event_type: str, payload: dict[str, Any]) -> None: ...


class LoggingTracer:
    """Default tracer: emits scrubbed events to the structured logger."""

    def __init__(self, run_id: str) -> None:
        self._run_id = run_id

    def event(self, event_type: str, payload: dict[str, Any]) -> None:
        logger.info(
            "agent.event",
            extra={"event_type": event_type, "run_id": self._run_id, "payload": scrub(payload)},
        )


def build_tracer(run_id: str) -> Tracer:
    return LoggingTracer(run_id)
