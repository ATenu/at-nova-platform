"""Deterministic, dependency-free planner.

It maps a user prompt to a small, ordered set of capabilities, restricted to the
capabilities the entitlement snapshot already allows (Layer A toolset filtering).
It never calls an LLM and never fabricates data — mirroring ``LocalAgentGateway``
on the Node side — so the pipeline runs end to end without model credentials. A
LangGraph + LLM planner is a drop-in replacement: it would emit the same typed
``PlannedStep`` list, and the authoritative Layer B policy gate (section 9.3)
re-checks every step regardless of how the plan was produced.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)


@dataclass(frozen=True)
class PlannedStep:
    capability_id: str
    tool_input: dict[str, Any] = field(default_factory=dict)
    reason: str = ""


@dataclass(frozen=True)
class Plan:
    steps: tuple[PlannedStep, ...]
    # Capabilities matched by intent but withheld because a required input
    # (e.g. a customer id) was not present in the prompt. Surfaced to the user.
    skipped_for_missing_input: tuple[str, ...] = ()


def _first_uuid(text: str) -> str | None:
    match = _UUID_RE.search(text)
    return match.group(0) if match else None


def plan(prompt: str, allowed_capabilities: set[str]) -> Plan:
    """Produce an ordered, allow-listed plan for the prompt. Default empty."""
    lower = prompt.lower()
    uuid = _first_uuid(prompt)
    steps: list[PlannedStep] = []
    skipped: list[str] = []

    def offer(capability_id: str, *, needs_uuid_as: str | None, reason: str) -> None:
        if capability_id not in allowed_capabilities:
            return
        if needs_uuid_as is not None:
            if uuid is None:
                skipped.append(capability_id)
                return
            steps.append(PlannedStep(capability_id, {needs_uuid_as: uuid}, reason))
        else:
            steps.append(PlannedStep(capability_id, {}, reason))

    if "sale" in lower and ("report" in lower or "summary" in lower or "how many" in lower):
        offer("sales.report.customer", needs_uuid_as="customerId", reason="sales report intent")

    if "issue" in lower and ("pending" in lower or "open" in lower or "list" in lower):
        offer(
            "issues.list.pendingForCustomer",
            needs_uuid_as="customerId",
            reason="pending issues intent",
        )

    if "action" in lower and "next" in lower:
        offer("actions.next", needs_uuid_as=None, reason="next action intent")

    if "sop" in lower or "procedure" in lower or "policy" in lower:
        offer("sop.read", needs_uuid_as=None, reason="sop intent")

    return Plan(steps=tuple(steps), skipped_for_missing_input=tuple(skipped))
