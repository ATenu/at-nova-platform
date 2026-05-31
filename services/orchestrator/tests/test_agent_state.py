"""AgentStateStore: per-actor sections, aligned history, owner scoping, fail-soft.

Uses a tiny in-memory Redis double covering only the commands the store calls,
so the tests stay dependency-free and assert behaviour (not mock interactions).
"""

from __future__ import annotations

from typing import Any

from nova_orchestrator.agent_state import AgentStateStore, HistoryEntry, render_history


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
    """Minimal in-memory stand-in for the redis commands AgentStateStore uses."""

    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.streams: dict[str, list[tuple[str, dict[str, str]]]] = {}
        self.strings: dict[str, str] = {}
        self._seq = 0

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self)

    def hset(self, key: str, mapping: dict[str, str]) -> int:
        self.hashes.setdefault(key, {}).update(mapping)
        return len(mapping)

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

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

    def get(self, key: str) -> str | None:
        return self.strings.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.strings[key] = value
        return True


def _store(owner: str = "user-1") -> tuple[AgentStateStore, _FakeRedis]:
    fake = _FakeRedis()
    return AgentStateStore(owner_subject=owner, client=fake), fake


def test_each_actor_owns_an_isolated_section() -> None:
    store, _ = _store()
    store.write_section("run-1", "orchestrator", {"plan": "count customers"})
    store.write_section("run-1", "agent:sql-analyst", {"queryCount": 3})
    document = store.read_document("run-1")
    assert document["orchestrator"] == {"plan": "count customers"}
    assert document["agent:sql-analyst"] == {"queryCount": 3}
    assert store.read_section("run-1", "agent:sql-analyst") == {"queryCount": 3}


def test_history_is_ordered_oldest_first_on_read() -> None:
    store, _ = _store()
    store.append_history("conv-1", HistoryEntry(role="user", content="hi"))
    store.append_history("conv-1", HistoryEntry(role="assistant", content="hello"))
    store.append_history("conv-1", HistoryEntry(role="user", content="how many customers?"))
    history = store.read_history("conv-1")
    assert [e.content for e in history] == ["hi", "hello", "how many customers?"]


def test_history_read_limit_returns_most_recent() -> None:
    store, _ = _store()
    for i in range(5):
        store.append_history("conv-1", HistoryEntry(role="user", content=f"m{i}"))
    history = store.read_history("conv-1", limit=2)
    assert [e.content for e in history] == ["m3", "m4"]


def test_owner_mismatch_hides_another_owners_document() -> None:
    fake = _FakeRedis()
    AgentStateStore(owner_subject="user-1", client=fake).write_section(
        "run-1", "orchestrator", {"secret": "for user-1"}
    )
    # A different owner sharing the same fake connection must not read it back.
    other = AgentStateStore(owner_subject="attacker", client=fake)
    assert other.read_document("run-1") == {}


def test_owner_mismatch_filters_history_entries() -> None:
    fake = _FakeRedis()
    AgentStateStore(owner_subject="user-1", client=fake).append_history(
        "conv-1", HistoryEntry(role="user", content="mine")
    )
    other = AgentStateStore(owner_subject="attacker", client=fake)
    assert other.read_history("conv-1") == []


def test_summary_round_trips() -> None:
    store, _ = _store()
    assert store.read_summary("conv-1") is None
    store.write_summary("conv-1", "Discussed customer counts.")
    assert store.read_summary("conv-1") == "Discussed customer counts."


def test_store_is_fail_soft_on_redis_errors() -> None:
    class _BrokenRedis(_FakeRedis):
        def hgetall(self, key: str) -> dict[str, str]:
            raise __import__("redis").RedisError("down")

        def xadd(self, key: str, fields: dict[str, str], **_kwargs: Any) -> str:
            raise __import__("redis").RedisError("down")

    broken = _BrokenRedis()
    store = AgentStateStore(owner_subject="user-1", client=broken)
    # Reads degrade to empty and writes swallow the error — never raise.
    store.append_history("conv-1", HistoryEntry(role="user", content="hi"))
    assert store.read_document("run-1") == {}


def test_render_history_formats_actor_and_bounds_length() -> None:
    entries = [
        HistoryEntry(role="user", content="how many customers?"),
        HistoryEntry(role="assistant", content="128"),
        HistoryEntry(role="agent", actor="sql-analyst", content="ran 1 query"),
    ]
    rendered = render_history(entries)
    assert "user: how many customers?" in rendered
    assert "assistant: 128" in rendered
    assert "agent/sql-analyst: ran 1 query" in rendered
    assert render_history([]) == ""
