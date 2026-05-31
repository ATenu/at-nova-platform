"""Human-facing tool documentation for the orchestrator reasoner (Layer A menu).

Each cataloged capability the user is entitled to is described here the way an
LLM tool catalog should read: what it does, when to choose it, and what input
fields it accepts. This is NOT authorization — Layer B still gates every hop.
Descriptions are safe to show the model (no secrets, no SQL, no PII).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .authz.registry import get_capability

# OpenAI function names: alphanumeric + underscore only.
TOOL_NAME_SEP = "__"
FINISH_TOOL_NAME = "finish_orchestration"


@dataclass(frozen=True)
class CapabilityToolSpec:
    capability_id: str
    summary: str
    when_to_use: str
    input_fields: tuple[str, ...]
    input_schema: dict[str, Any]


def tool_name_for(capability_id: str) -> str:
    return capability_id.replace(".", TOOL_NAME_SEP)


def capability_id_for(tool_name: str) -> str | None:
    if tool_name == FINISH_TOOL_NAME:
        return None
    return tool_name.replace(TOOL_NAME_SEP, ".")


# Static catalog keyed by capability id. Keep in sync with CAPABILITY_CATALOG.
_TOOL_SPECS: dict[str, CapabilityToolSpec] = {
    "data.analyse.read": CapabilityToolSpec(
        capability_id="data.analyse.read",
        summary=(
            "SQL data analyst agent: answers open-ended business/data questions "
            "(counts, totals, lists, trends, aggregates) over curated read-only views."
        ),
        when_to_use=(
            "DEFAULT for any data/analytics question when no narrower tool fits. "
            "Use when the user asks how many, how much, list, show, count, total, "
            "trend, summary, or any question about records/customers/sales/issues "
            "without providing a specific customer/action/sale UUID."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "data.schema.describe": CapabilityToolSpec(
        capability_id="data.schema.describe",
        summary="List curated read-only database views and columns (schema discovery).",
        when_to_use=(
            "Only when the user explicitly asks what data/views/columns exist. "
            "Do NOT use for business questions — use data.analyse.read instead."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "data.query.select": CapabilityToolSpec(
        capability_id="data.query.select",
        summary="Run a single pre-authored read-only SELECT (low-level MCP tool).",
        when_to_use=(
            "Rarely needed. Prefer data.analyse.read for natural-language data "
            "questions. Only when you already have an exact validated SELECT."
        ),
        input_fields=("sql", "params"),
        input_schema={
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "Read-only SELECT over mcp_read views."},
                "params": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional bind parameters.",
                },
            },
            "required": ["sql"],
            "additionalProperties": False,
        },
    ),
    "data.act.write": CapabilityToolSpec(
        capability_id="data.act.write",
        summary=(
            "High-risk write dispatch agent: executes cataloged write capabilities "
            "(requires recorded human approval)."
        ),
        when_to_use=(
            "Only when the user clearly requests a create/update/mark/close action "
            "and a specific write capability applies. Never for read-only questions."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "sales.report.customer": CapabilityToolSpec(
        capability_id="sales.report.customer",
        summary="Sales report for one specific customer (by UUID).",
        when_to_use=(
            "When the user asks about sales for a named customer AND a customerId "
            "UUID is present in the request or observations."
        ),
        input_fields=("customerId",),
        input_schema={
            "type": "object",
            "properties": {
                "customerId": {"type": "string", "description": "Customer UUID."},
            },
            "required": ["customerId"],
            "additionalProperties": False,
        },
    ),
    "issues.list.pendingForCustomer": CapabilityToolSpec(
        capability_id="issues.list.pendingForCustomer",
        summary="List pending issues for one specific customer (by UUID).",
        when_to_use=(
            "When the user asks about a customer's open/pending issues AND customerId "
            "UUID is present in the request or observations."
        ),
        input_fields=("customerId",),
        input_schema={
            "type": "object",
            "properties": {
                "customerId": {"type": "string", "description": "Customer UUID."},
            },
            "required": ["customerId"],
            "additionalProperties": False,
        },
    ),
    "actions.next": CapabilityToolSpec(
        capability_id="actions.next",
        summary="Fetch the user's next pending action item.",
        when_to_use=(
            "When the user asks what to do next, their next task, or pending actions."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "actions.markCompleted": CapabilityToolSpec(
        capability_id="actions.markCompleted",
        summary="Mark a specific action as completed (by UUID).",
        when_to_use=(
            "When the user asks to complete/mark done an action AND actionId UUID "
            "is present in the request or observations."
        ),
        input_fields=("actionId",),
        input_schema={
            "type": "object",
            "properties": {
                "actionId": {"type": "string", "description": "Action UUID."},
            },
            "required": ["actionId"],
            "additionalProperties": False,
        },
    ),
    "sales.create": CapabilityToolSpec(
        capability_id="sales.create",
        summary="Create a new sale (structured write).",
        when_to_use="When the user explicitly requests creating a sale with required details.",
        input_fields=("customerId", "date", "items", "..."),
        input_schema={
            "type": "object",
            "properties": {
                "customerId": {"type": "string"},
                "date": {"type": "string", "description": "ISO datetime."},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "productId": {"type": "string"},
                            "quantity": {"type": "integer"},
                        },
                        "required": ["productId", "quantity"],
                    },
                },
            },
            "required": ["customerId", "date", "items"],
            "additionalProperties": True,
        },
    ),
    "issues.create": CapabilityToolSpec(
        capability_id="issues.create",
        summary="Create a new customer issue (structured write).",
        when_to_use=(
            "When the user explicitly requests opening/creating an issue with "
            "salesId and description."
        ),
        input_fields=("salesId", "description"),
        input_schema={
            "type": "object",
            "properties": {
                "salesId": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["salesId", "description"],
            "additionalProperties": False,
        },
    ),
    "sop.read": CapabilityToolSpec(
        capability_id="sop.read",
        summary="Read SOP documentation (one SOP by id, or list available SOPs).",
        when_to_use=(
            "When the user asks about procedures, SOPs, compliance docs, or "
            "how-to process questions."
        ),
        input_fields=("sopId (optional)",),
        input_schema={
            "type": "object",
            "properties": {
                "sopId": {"type": "string", "description": "Optional SOP UUID."},
            },
            "additionalProperties": False,
        },
    ),
}


def spec_for(capability_id: str) -> CapabilityToolSpec:
    """Tool documentation for a catalog id.

    Prefers the curated entry. For any capability without one, synthesises an
    accurate spec from the authoritative capability descriptor (mode + resource
    scope) so newly added capabilities are immediately usable by the reasoner
    without a hand-written guide entry. A drift test still asserts that every
    agent-skill capability is curated, so the synthesis is a safety net, not the
    norm.
    """
    known = _TOOL_SPECS.get(capability_id)
    if known is not None:
        return known
    return _synthesise_spec(capability_id)


def _synthesise_spec(capability_id: str) -> CapabilityToolSpec:
    capability = get_capability(capability_id)
    # Permissive schema: we cannot know an undocumented capability's field names,
    # so let the model pass arguments (Layer B re-validates the actual shape).
    schema: dict[str, Any] = {"type": "object", "properties": {}, "additionalProperties": True}
    if capability is None:
        return CapabilityToolSpec(
            capability_id=capability_id,
            summary=f"Execute capability {capability_id}.",
            when_to_use="When this capability directly matches the user request.",
            input_fields=(),
            input_schema=schema,
        )
    verb = "Perform a write/mutation via" if capability.mode == "write" else "Read data via"
    scope = (
        " Requires a specific record id (UUID) to be present in the request."
        if capability.resource_scoped
        else ""
    )
    return CapabilityToolSpec(
        capability_id=capability_id,
        summary=f"{verb} the `{capability_id}` capability.",
        when_to_use=f"When the user's request clearly maps to `{capability_id}`.{scope}",
        input_fields=(),
        input_schema=schema,
    )


def finish_tool_schema() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": FINISH_TOOL_NAME,
            "description": (
                "End orchestration and compose the final answer. ONLY call when "
                "OBSERVATIONS already contain grounded facts that fully answer the "
                "REQUEST, or when no authorized tool can help and you must ask the "
                "user for a missing required id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {
                        "type": "string",
                        "description": "Brief reason for finishing (user-facing hint if blocked).",
                    },
                },
                "additionalProperties": False,
            },
        },
    }
