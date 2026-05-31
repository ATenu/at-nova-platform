"""Planner is deterministic, allow-list constrained, and never invents inputs."""

from __future__ import annotations

from nova_orchestrator.planner import plan

CUSTOMER_ID = "11111111-1111-1111-1111-111111111111"
ALL = {
    "sales.report.customer",
    "issues.list.pendingForCustomer",
    "actions.next",
    "sop.read",
}


def test_plans_sales_report_when_allowed_and_id_present() -> None:
    result = plan(f"Give me a sales report for {CUSTOMER_ID}", ALL)
    assert [s.capability_id for s in result.steps] == ["sales.report.customer"]
    assert result.steps[0].tool_input == {"customerId": CUSTOMER_ID}


def test_capability_not_allowed_is_never_planned() -> None:
    # Same intent, but the snapshot does not allow the capability (Layer A).
    result = plan(f"sales report for {CUSTOMER_ID}", {"actions.next"})
    assert result.steps == ()


def test_missing_required_id_is_skipped_not_fabricated() -> None:
    result = plan("give me a sales report", ALL)
    assert result.steps == ()
    assert "sales.report.customer" in result.skipped_for_missing_input


def test_actions_next_needs_no_id() -> None:
    result = plan("what is my next action", ALL)
    assert [s.capability_id for s in result.steps] == ["actions.next"]


def test_unmappable_prompt_yields_empty_plan() -> None:
    result = plan("hello there", ALL)
    assert result.steps == ()
    assert result.skipped_for_missing_input == ()
