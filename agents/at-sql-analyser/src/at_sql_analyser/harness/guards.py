"""Mandatory guardrails for the bounded loop (fail-closed, no runaway agents)."""

from __future__ import annotations

from dataclasses import dataclass

from .state import QueryAttempt


@dataclass(frozen=True)
class GuardLimits:
    max_iterations: int
    max_queries: int
    total_timeout_s: float

    def __post_init__(self) -> None:
        if self.max_iterations <= 0 or self.max_queries <= 0 or self.total_timeout_s <= 0:
            raise ValueError("guard limits must be positive")


@dataclass(frozen=True)
class GuardState:
    stop: bool
    reason: str | None = None


def evaluate_guards(
    *,
    iterations: int,
    attempts: tuple[QueryAttempt, ...],
    elapsed_s: float,
    limits: GuardLimits,
) -> GuardState:
    """Decide whether the loop must terminate before another step."""
    if elapsed_s >= limits.total_timeout_s:
        return GuardState(stop=True, reason="time_budget_exhausted")
    if iterations >= limits.max_iterations:
        return GuardState(stop=True, reason="iteration_budget_exhausted")
    if len(attempts) >= limits.max_queries:
        return GuardState(stop=True, reason="query_budget_exhausted")
    if _no_progress(attempts):
        return GuardState(stop=True, reason="no_progress")
    return GuardState(stop=False)


def _no_progress(attempts: tuple[QueryAttempt, ...]) -> bool:
    """Break loops that repeat an identical query or keep erroring."""
    if len(attempts) < 2:
        return False
    last, prev = attempts[-1], attempts[-2]
    if last.sql_hash is not None and last.sql_hash == prev.sql_hash:
        return True
    return last.error is not None and prev.error is not None
