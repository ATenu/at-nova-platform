"""Shared agent working-state access for the SQL analyst, backed by ``redis-agent``.

The agent is a PARTICIPANT in the shared state the orchestrator owns:

  - it READS the common, orchestrator-aligned conversation history
    (``{prefix}conv:{conversationId}:history``) for multi-turn / cross-agent
    context — read-only, it never writes history (single-writer alignment);
  - it WRITES only its OWN isolated JSON section
    (``{prefix}run:{runId}:state`` field ``agent:<name>``) — never another
    actor's section.

Owner-scoped, TTL'd, size-bounded, and fail-soft: a Redis outage degrades to the
agent's existing stateless behaviour and never fails a task. Content written here
is entitlement-gated + secret-stripped by the caller (see ``content_policy``).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from typing import Any

import redis
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

_DEFAULT_PREFIX = "nova:agent:"
_SOCKET_TIMEOUT_S = 2.0
_META_FIELD = "meta"


class HistoryEntry(BaseModel):
    """One aligned turn of the shared conversation history (read-only here)."""

    role: str
    content: str = ""
    actor: str = "orchestrator"
    run_id: str = ""
    owner_subject: str = ""
    ts: float = Field(default_factory=time.time)


def render_history(entries: Sequence[HistoryEntry], *, max_chars: int = 4000) -> str:
    """Render history as a compact, bounded text block for prompt grounding."""
    if not entries:
        return ""
    lines: list[str] = []
    for entry in entries:
        label = entry.role if entry.actor == "orchestrator" else f"{entry.role}/{entry.actor}"
        text = entry.content.strip()
        if text:
            lines.append(f"{label}: {text}")
    rendered = "\n".join(lines)
    if len(rendered) > max_chars:
        rendered = "…" + rendered[-max_chars:]
    return rendered


class AgentStateStore:
    """Fail-soft client over ``redis-agent``: read shared history, write own section."""

    def __init__(
        self,
        *,
        owner_subject: str,
        url: str | None = None,
        client: redis.Redis[str] | None = None,
        key_prefix: str = _DEFAULT_PREFIX,
        state_ttl_s: int = 7200,
        history_read_limit: int = 20,
    ) -> None:
        if client is None and not url:
            raise ValueError("AgentStateStore requires either a client or a url")
        self._owner = owner_subject
        self._prefix = key_prefix
        self._state_ttl = state_ttl_s
        self._history_read_limit = history_read_limit
        self._redis: redis.Redis[str] = client or redis.Redis.from_url(
            url or "",
            decode_responses=True,
            socket_timeout=_SOCKET_TIMEOUT_S,
            socket_connect_timeout=_SOCKET_TIMEOUT_S,
        )

    def _run_key(self, run_id: str) -> str:
        return f"{self._prefix}run:{run_id}:state"

    def _history_key(self, conversation_id: str) -> str:
        return f"{self._prefix}conv:{conversation_id}:history"

    def write_section(self, run_id: str, actor: str, value: dict[str, Any]) -> None:
        """Overwrite this agent's own JSON section in the per-run document."""
        key = self._run_key(run_id)
        try:
            payload = json.dumps(value, default=str)
            meta = json.dumps({"owner": self._owner, "updatedAt": time.time()})
            pipe = self._redis.pipeline()
            pipe.hset(key, mapping={actor: payload, _META_FIELD: meta})
            pipe.expire(key, self._state_ttl)
            pipe.execute()
        except (redis.RedisError, TypeError, ValueError) as exc:
            logger.warning("agent_state.write_section failed: %s", type(exc).__name__)

    def read_history(self, conversation_id: str, *, limit: int | None = None) -> list[HistoryEntry]:
        if not conversation_id:
            return []
        count = limit if limit is not None else self._history_read_limit
        key = self._history_key(conversation_id)
        try:
            raw = self._redis.xrevrange(key, count=count)
        except redis.RedisError as exc:
            logger.warning("agent_state.read_history failed: %s", type(exc).__name__)
            return []
        entries: list[HistoryEntry] = []
        for _entry_id, fields in reversed(list(raw)):
            value = fields.get("e") if isinstance(fields, dict) else None
            if not isinstance(value, str):
                continue
            try:
                entry = HistoryEntry.model_validate_json(value)
            except ValidationError:
                continue
            if entry.owner_subject and entry.owner_subject != self._owner:
                continue
            entries.append(entry)
        return entries

    def read_history_text(self, conversation_id: str) -> str:
        return render_history(self.read_history(conversation_id))
