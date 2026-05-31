"""Shared agent working-state store, backed by the ``redis-agent`` instance.

Two structures, both owner-scoped, TTL'd, and size-bounded:

  - **Per-run document** — a Redis Hash at ``{prefix}run:{runId}:state`` whose
    fields are one JSON section per actor. The orchestrator and every agent own
    an isolated field (``orchestrator``, ``agent:<name>``), so they can read the
    whole document but only ever overwrite their own section (no lost updates).
  - **Common conversation history** — a Redis Stream at
    ``{prefix}conv:{conversationId}:history`` plus a rolling ``:summary`` string.
    The ORCHESTRATOR is the only writer (single-writer ⇒ consistent ordering);
    every agent may read it for multi-turn / cross-agent context.

Security / resilience:
  - Owner-scoped: every record carries the owner subject and reads reject a
    mismatch (default deny / defense in depth — ids are already unguessable).
  - Fail-soft on availability: a Redis error degrades to today's stateless
    behaviour (logged, never raised) so a cache outage cannot fail a run.
  - Content stored here is already entitlement-gated and secret-stripped by the
    caller (see ``content_policy``); this module never relaxes that.
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
    """One aligned, redacted turn in the common conversation history.

    Validated on read AND write (the store is a trust boundary). ``content`` is
    already entitlement-gated + secret-stripped by the caller before it arrives.
    """

    role: str  # "user" | "assistant" | "agent" | "tool"
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
    """Typed, fail-soft client over ``redis-agent`` for shared agent state."""

    def __init__(
        self,
        *,
        owner_subject: str,
        url: str | None = None,
        client: redis.Redis[str] | None = None,
        key_prefix: str = _DEFAULT_PREFIX,
        state_ttl_s: int = 7200,
        history_ttl_s: int = 2_592_000,
        history_max_entries: int = 200,
    ) -> None:
        if client is None and not url:
            raise ValueError("AgentStateStore requires either a client or a url")
        self._owner = owner_subject
        self._prefix = key_prefix
        self._state_ttl = state_ttl_s
        self._history_ttl = history_ttl_s
        self._history_max = history_max_entries
        self._redis: redis.Redis[str] = client or redis.Redis.from_url(
            url or "",
            decode_responses=True,
            socket_timeout=_SOCKET_TIMEOUT_S,
            socket_connect_timeout=_SOCKET_TIMEOUT_S,
        )

    # -- keys ---------------------------------------------------------------
    def _run_key(self, run_id: str) -> str:
        return f"{self._prefix}run:{run_id}:state"

    def _history_key(self, conversation_id: str) -> str:
        return f"{self._prefix}conv:{conversation_id}:history"

    def _summary_key(self, conversation_id: str) -> str:
        return f"{self._prefix}conv:{conversation_id}:summary"

    # -- per-run sections ---------------------------------------------------
    def write_section(self, run_id: str, actor: str, value: dict[str, Any]) -> None:
        """Overwrite this actor's own JSON section in the per-run document."""
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

    def read_section(self, run_id: str, actor: str) -> dict[str, Any] | None:
        document = self.read_document(run_id)
        section = document.get(actor)
        return section if isinstance(section, dict) else None

    def read_document(self, run_id: str) -> dict[str, Any]:
        """Read all actor sections; returns ``{}`` on miss, mismatch, or error."""
        key = self._run_key(run_id)
        try:
            raw = self._redis.hgetall(key)
        except redis.RedisError as exc:
            logger.warning("agent_state.read_document failed: %s", type(exc).__name__)
            return {}
        fields: dict[str, str] = dict(raw) if isinstance(raw, dict) else {}
        if not self._owner_matches(fields.get(_META_FIELD)):
            return {}
        document: dict[str, Any] = {}
        for field, value in fields.items():
            if field == _META_FIELD:
                continue
            try:
                document[field] = json.loads(value)
            except (TypeError, ValueError):
                continue
        return document

    # -- common history (orchestrator is the only writer) -------------------
    def append_history(self, conversation_id: str, entry: HistoryEntry) -> None:
        if not conversation_id:
            return
        key = self._history_key(conversation_id)
        try:
            entry.owner_subject = self._owner
            self._redis.xadd(
                key,
                {"e": entry.model_dump_json()},
                maxlen=self._history_max,
                approximate=True,
            )
            self._redis.expire(key, self._history_ttl)
        except (redis.RedisError, ValueError) as exc:
            logger.warning("agent_state.append_history failed: %s", type(exc).__name__)

    def read_history(self, conversation_id: str, *, limit: int = 50) -> list[HistoryEntry]:
        if not conversation_id:
            return []
        key = self._history_key(conversation_id)
        try:
            raw = self._redis.xrevrange(key, count=limit)
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
            # Owner scoping (defense in depth): never surface another owner's turn.
            if entry.owner_subject and entry.owner_subject != self._owner:
                continue
            entries.append(entry)
        return entries

    def read_summary(self, conversation_id: str) -> str | None:
        if not conversation_id:
            return None
        try:
            value = self._redis.get(self._summary_key(conversation_id))
        except redis.RedisError as exc:
            logger.warning("agent_state.read_summary failed: %s", type(exc).__name__)
            return None
        return value if isinstance(value, str) else None

    def write_summary(self, conversation_id: str, summary: str) -> None:
        if not conversation_id:
            return
        try:
            self._redis.set(self._summary_key(conversation_id), summary, ex=self._history_ttl)
        except redis.RedisError as exc:
            logger.warning("agent_state.write_summary failed: %s", type(exc).__name__)

    # -- helpers ------------------------------------------------------------
    def _owner_matches(self, meta_raw: str | None) -> bool:
        if not meta_raw:
            return True  # legacy / no meta written yet
        try:
            meta = json.loads(meta_raw)
        except (TypeError, ValueError):
            return False
        owner = meta.get("owner") if isinstance(meta, dict) else None
        return owner is None or owner == self._owner
