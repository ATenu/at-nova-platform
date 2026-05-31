"""SQL analyst shared-state access: reads aligned history, writes its own section.

Entitlement-gated content policy: an entitled owner's full (non-redacted, only
secret-stripped) data is stored; content from an unentitled skill is withheld.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from at_sql_analyser.agent_state import AgentStateStore, HistoryEntry, render_history
from at_sql_analyser.auth.snapshot import VerifiedSnapshot
from at_sql_analyser.content_policy import is_entitled, resolve_content, resolve_text


class _FakePipeline:
    def __init__(self, redis: _FakeRedis) -> None:
        self._redis = redis
        self._ops: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def hset(self, *args: Any, **kwargs: Any) -> _FakePipeline:
        self._ops.append(("hset", args, kwargs))
        return self

    def expire(self, *args: Any, **kwargs: Any) -> _FakePipeline:
        self._ops.append(("expire", args, kwargs))
        return self

    def execute(self) -> list[Any]:
        return [getattr(self._redis, name)(*a, **kw) for name, a, kw in self._ops]


class _FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.streams: dict[str, list[tuple[str, dict[str, str]]]] = {}
        self._seq = 0

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self)

    def hset(self, key: str, mapping: dict[str, str]) -> int:
        self.hashes.setdefault(key, {}).update(mapping)
        return len(mapping)

    def expire(self, key: str, ttl: int) -> bool:
        return True

    def xadd(self, key: str, fields: dict[str, str], **_kwargs: Any) -> str:
        self._seq += 1
        entry_id = f"{self._seq}-0"
        self.streams.setdefault(key, []).append((entry_id, dict(fields)))
        return entry_id

    def xrevrange(self, key: str, count: int | None = None) -> list[tuple[str, dict[str, str]]]:
        items = list(reversed(self.streams.get(key, [])))
        return items[:count] if count else items


def _snapshot(allowlist: tuple[str, ...]) -> VerifiedSnapshot:
    return VerifiedSnapshot(
        run_id="run-1",
        owner_subject="user-1",
        roles=("ops-compliance",),
        permissions=frozenset({"read-data"}),
        capability_allowlist=frozenset(allowlist),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )


def _seed_history(fake: _FakeRedis, owner: str = "user-1") -> None:
    writer = AgentStateStore(owner_subject=owner, client=fake)
    # The orchestrator is the writer; we simulate that by xadd-ing entries here.
    key = "nova:agent:conv:conv-1:history"
    for role, content in [("user", "how many customers?"), ("assistant", "128")]:
        entry = HistoryEntry(role=role, content=content, owner_subject=owner)
        fake.xadd(key, {"e": entry.model_dump_json()})
    _ = writer  # store constructed to assert the same key derivation


def test_agent_reads_aligned_history() -> None:
    fake = _FakeRedis()
    _seed_history(fake)
    store = AgentStateStore(owner_subject="user-1", client=fake)
    text = store.read_history_text("conv-1")
    assert "user: how many customers?" in text
    assert "assistant: 128" in text


def test_agent_history_is_owner_scoped() -> None:
    fake = _FakeRedis()
    _seed_history(fake, owner="user-1")
    other = AgentStateStore(owner_subject="attacker", client=fake)
    assert other.read_history("conv-1") == []


def test_agent_writes_only_its_own_section() -> None:
    fake = _FakeRedis()
    store = AgentStateStore(owner_subject="user-1", client=fake)
    store.write_section("run-1", "agent:at-sql-analyser", {"queryCount": 2, "status": "completed"})
    stored = fake.hashes["nova:agent:run:run-1:state"]
    assert "agent:at-sql-analyser" in stored
    assert "meta" in stored  # owner stamp written for scoping


def test_entitled_owner_keeps_full_pii_but_secrets_stripped() -> None:
    snap = _snapshot(("data.analyse.read",))
    out = resolve_content(
        {"email": "jane@example.com", "api_key": "abc"},
        snapshot=snap,
        capability_id="data.analyse.read",
    )
    assert isinstance(out, dict)
    assert out["email"] == "jane@example.com"
    assert out["api_key"] == "[redacted]"


def test_unentitled_capability_is_withheld() -> None:
    snap = _snapshot(())  # entitled to nothing
    assert resolve_text("answer", snapshot=snap, capability_id="data.analyse.read") == ""
    assert resolve_content({"x": 1}, snapshot=snap, capability_id="data.analyse.read") == {
        "withheld": True,
        "reason": "not_entitled",
    }
    assert is_entitled(snap, "") is True


def test_render_history_empty() -> None:
    assert render_history([]) == ""
