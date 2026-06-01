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


def test_scrub_keeps_query_io_out_of_traces() -> None:
    # The owner's stream carries verbatim input/output (SQL + rows); the tracer
    # must collapse those nested structures so neither SQL nor rows reach Langfuse.
    started = scrub(
        {
            "tool": "run_select_query",
            "sqlHash": "sha256:abc",
            "input": {"sql": "SELECT full_name FROM mcp_read.customers", "params": []},
        }
    )
    assert started["tool"] == "run_select_query"
    assert started["sqlHash"] == "sha256:abc"
    assert started["input"] == "<dict>"

    completed = scrub(
        {
            "tool": "run_select_query",
            "sqlHash": "sha256:abc",
            "rowCount": 1,
            "truncated": False,
            "error": False,
            "output": {"rows": [{"full_name": "Jane Doe"}], "rowCount": 1},
        }
    )
    assert completed["output"] == "<dict>"
    assert "Jane Doe" not in str(completed)
