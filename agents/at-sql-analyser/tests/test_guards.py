from __future__ import annotations

import pytest

from at_sql_analyser.harness.guards import GuardLimits, evaluate_guards
from at_sql_analyser.harness.state import QueryAttempt

LIMITS = GuardLimits(max_iterations=3, max_queries=4, total_timeout_s=10.0)


def _attempt(sql_hash: str, error: str | None = None) -> QueryAttempt:
    return QueryAttempt(sql="x", sql_hash=sql_hash, row_count=0, truncated=False, error=error)


def test_continues_when_within_budgets() -> None:
    g = evaluate_guards(iterations=0, attempts=(), elapsed_s=0.0, limits=LIMITS)
    assert g.stop is False


def test_stops_on_timeout() -> None:
    g = evaluate_guards(iterations=0, attempts=(), elapsed_s=10.0, limits=LIMITS)
    assert g.stop and g.reason == "time_budget_exhausted"


def test_stops_on_iteration_budget() -> None:
    g = evaluate_guards(iterations=3, attempts=(), elapsed_s=0.0, limits=LIMITS)
    assert g.stop and g.reason == "iteration_budget_exhausted"


def test_stops_on_query_budget() -> None:
    attempts = tuple(_attempt(f"h{i}") for i in range(4))
    g = evaluate_guards(iterations=0, attempts=attempts, elapsed_s=0.0, limits=LIMITS)
    assert g.stop and g.reason == "query_budget_exhausted"


def test_stops_on_repeated_query() -> None:
    attempts = (_attempt("same"), _attempt("same"))
    g = evaluate_guards(iterations=2, attempts=attempts, elapsed_s=0.0, limits=LIMITS)
    assert g.stop and g.reason == "no_progress"


def test_stops_on_consecutive_errors() -> None:
    attempts = (_attempt("a", error="boom"), _attempt("b", error="boom2"))
    g = evaluate_guards(iterations=2, attempts=attempts, elapsed_s=0.0, limits=LIMITS)
    assert g.stop and g.reason == "no_progress"


def test_rejects_nonpositive_limits() -> None:
    with pytest.raises(ValueError):
        GuardLimits(max_iterations=0, max_queries=1, total_timeout_s=1.0)
