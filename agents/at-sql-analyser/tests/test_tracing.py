from __future__ import annotations

from at_sql_analyser.observability.tracing import scrub


def test_scrub_drops_forbidden_keys() -> None:
    out = scrub({"sql": "SELECT 1", "rows": [1, 2], "rowCount": 2, "truncated": False})
    assert "sql" not in out
    assert "rows" not in out
    assert out == {"rowCount": 2, "truncated": False}


def test_scrub_truncates_long_strings() -> None:
    out = scrub({"reason": "x" * 1000})
    assert len(out["reason"]) == 256


def test_scrub_replaces_complex_values() -> None:
    out = scrub({"meta": {"nested": True}})
    assert out["meta"] == "<dict>"
