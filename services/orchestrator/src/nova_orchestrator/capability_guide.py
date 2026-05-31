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
    # --- Conversational resolver + detail reads -------------------------------
    # These let you turn a human reference (a name, email, or title the user gave)
    # into the record UUID that a scoped read/write needs. Prefer calling the
    # matching search/list tool FIRST, then read the id from OBSERVATIONS, instead
    # of asking the user to paste a UUID.
    "customers.search": CapabilityToolSpec(
        capability_id="customers.search",
        summary="Find customers by name or email; returns each match's id + name.",
        when_to_use=(
            "When the user names a customer but no customerId UUID is known yet. "
            "Use this to resolve the name to a customerId, then call the scoped tool "
            "(e.g. sales.report.customer) with the id from OBSERVATIONS."
        ),
        input_fields=("search", "active"),
        input_schema={
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Name or email fragment."},
                "active": {"type": "boolean", "description": "Optional active filter."},
            },
            "additionalProperties": False,
        },
    ),
    "customers.get": CapabilityToolSpec(
        capability_id="customers.get",
        summary="Fetch one customer's details by UUID.",
        when_to_use="When a customerId UUID is known and the user wants that customer's details.",
        input_fields=("customerId",),
        input_schema={
            "type": "object",
            "properties": {"customerId": {"type": "string", "description": "Customer UUID."}},
            "required": ["customerId"],
            "additionalProperties": False,
        },
    ),
    "products.search": CapabilityToolSpec(
        capability_id="products.search",
        summary="Find products by name, description, or category; returns id + name.",
        when_to_use=(
            "When the user names a product but no productId UUID is known. Resolve "
            "the name to a productId, then use it where required (e.g. sales.create)."
        ),
        input_fields=("search", "category", "inCatalog"),
        input_schema={
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Name or description fragment."},
                "category": {"type": "string", "description": "Optional exact category."},
                "inCatalog": {"type": "boolean", "description": "Optional in-catalog filter."},
            },
            "additionalProperties": False,
        },
    ),
    "products.get": CapabilityToolSpec(
        capability_id="products.get",
        summary="Fetch one product's details by UUID.",
        when_to_use="When a productId UUID is known and the user wants that product's details.",
        input_fields=("productId",),
        input_schema={
            "type": "object",
            "properties": {"productId": {"type": "string", "description": "Product UUID."}},
            "required": ["productId"],
            "additionalProperties": False,
        },
    ),
    "sales.list": CapabilityToolSpec(
        capability_id="sales.list",
        summary="List sales, optionally filtered by customer, payment, or date range.",
        when_to_use=(
            "When the user wants to find or browse sales (e.g. 'a customer's sales', "
            "'unpaid sales'). Returns sale ids you can pass to scoped tools."
        ),
        input_fields=("customerId", "paymentReceived", "from", "to"),
        input_schema={
            "type": "object",
            "properties": {
                "customerId": {"type": "string", "description": "Optional customer UUID filter."},
                "paymentReceived": {"type": "boolean", "description": "Optional payment filter."},
                "from": {"type": "string", "description": "Optional ISO start datetime."},
                "to": {"type": "string", "description": "Optional ISO end datetime."},
            },
            "additionalProperties": False,
        },
    ),
    "sales.get": CapabilityToolSpec(
        capability_id="sales.get",
        summary="Fetch one sale's details by UUID.",
        when_to_use="When a saleId UUID is known and the user wants that sale's details.",
        input_fields=("saleId",),
        input_schema={
            "type": "object",
            "properties": {"saleId": {"type": "string", "description": "Sale UUID."}},
            "required": ["saleId"],
            "additionalProperties": False,
        },
    ),
    "issues.list": CapabilityToolSpec(
        capability_id="issues.list",
        summary="List customer issues, optionally filtered by status, customer, or date.",
        when_to_use=(
            "When the user wants to find issues to act on (e.g. 'open issues'). Returns "
            "issue ids you can pass to issues.get / issues.update."
        ),
        input_fields=("status", "customerId", "from", "to"),
        input_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "Optional issue status."},
                "customerId": {"type": "string", "description": "Optional customer UUID filter."},
                "from": {"type": "string", "description": "Optional ISO start datetime."},
                "to": {"type": "string", "description": "Optional ISO end datetime."},
            },
            "additionalProperties": False,
        },
    ),
    "issues.get": CapabilityToolSpec(
        capability_id="issues.get",
        summary="Fetch one customer issue's details by UUID.",
        when_to_use="When an issueId UUID is known and the user wants that issue's details.",
        input_fields=("issueId",),
        input_schema={
            "type": "object",
            "properties": {"issueId": {"type": "string", "description": "Issue UUID."}},
            "required": ["issueId"],
            "additionalProperties": False,
        },
    ),
    "actions.list": CapabilityToolSpec(
        capability_id="actions.list",
        summary="List issue actions by title/status/owner/issue; returns id + title.",
        when_to_use=(
            "When the user refers to an action by title or wants actions for an issue, "
            "but no actionId UUID is known. Resolve to an actionId, then call the scoped "
            "tool (actions.get / actions.update / actions.addComment / actions.markCompleted)."
        ),
        input_fields=("status", "assignedOwnerId", "issueId"),
        input_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "Optional action status."},
                "assignedOwnerId": {"type": "string", "description": "Optional owner UUID filter."},
                "issueId": {"type": "string", "description": "Optional issue UUID filter."},
            },
            "additionalProperties": False,
        },
    ),
    "actions.get": CapabilityToolSpec(
        capability_id="actions.get",
        summary="Fetch one issue action's details by UUID.",
        when_to_use="When an actionId UUID is known and the user wants that action's details.",
        input_fields=("actionId",),
        input_schema={
            "type": "object",
            "properties": {"actionId": {"type": "string", "description": "Action UUID."}},
            "required": ["actionId"],
            "additionalProperties": False,
        },
    ),
    # --- Domain writes --------------------------------------------------------
    "actions.addComment": CapabilityToolSpec(
        capability_id="actions.addComment",
        summary="Add a comment to an issue action (timestamp recorded server-side).",
        when_to_use=(
            "When the user asks to add/leave a note or comment on an action AND an "
            "actionId UUID is present (resolve via actions.list first if needed)."
        ),
        input_fields=("actionId", "comment"),
        input_schema={
            "type": "object",
            "properties": {
                "actionId": {"type": "string", "description": "Action UUID."},
                "comment": {"type": "string", "description": "Comment text."},
            },
            "required": ["actionId", "comment"],
            "additionalProperties": False,
        },
    ),
    "actions.update": CapabilityToolSpec(
        capability_id="actions.update",
        summary="Update an issue action's status, description, or assigned owner.",
        when_to_use=(
            "When the user asks to change an action's status (other than the simple "
            "mark-completed), edit its description, or reassign it, AND an actionId UUID "
            "is present. Provide at least one field to change."
        ),
        input_fields=("actionId", "status", "description", "assignedOwnerId"),
        input_schema={
            "type": "object",
            "properties": {
                "actionId": {"type": "string", "description": "Action UUID."},
                "status": {"type": "string", "description": "New status."},
                "description": {"type": "string", "description": "New description."},
                "assignedOwnerId": {"type": "string", "description": "New owner UUID."},
            },
            "required": ["actionId"],
            "additionalProperties": False,
        },
    ),
    "issues.update": CapabilityToolSpec(
        capability_id="issues.update",
        summary="Update a customer issue's description or status.",
        when_to_use=(
            "When the user asks to edit an issue's description or change its status "
            "(e.g. close/reject) AND an issueId UUID is present. Provide at least one field."
        ),
        input_fields=("issueId", "description", "status"),
        input_schema={
            "type": "object",
            "properties": {
                "issueId": {"type": "string", "description": "Issue UUID."},
                "description": {"type": "string", "description": "New description."},
                "status": {"type": "string", "description": "New status."},
            },
            "required": ["issueId"],
            "additionalProperties": False,
        },
    ),
    "sop.create": CapabilityToolSpec(
        capability_id="sop.create",
        summary="Create a new SOP with its first version of full text.",
        when_to_use="When the user explicitly asks to create a new SOP and provides its content.",
        input_fields=("name", "description", "fullText", "active"),
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "SOP name/title."},
                "description": {"type": "string", "description": "Short description."},
                "fullText": {"type": "string", "description": "First version full text."},
                "active": {"type": "boolean", "description": "Whether the SOP is active."},
            },
            "required": ["name", "description", "fullText"],
            "additionalProperties": False,
        },
    ),
    "sop.update": CapabilityToolSpec(
        capability_id="sop.update",
        summary="Update an existing SOP's name, description, or active flag.",
        when_to_use=(
            "When the user asks to rename, re-describe, or (de)activate a SOP AND a "
            "sopId UUID is present. Provide at least one field. To change the document "
            "text, use sop.addVersion instead."
        ),
        input_fields=("sopId", "name", "description", "active"),
        input_schema={
            "type": "object",
            "properties": {
                "sopId": {"type": "string", "description": "SOP UUID."},
                "name": {"type": "string", "description": "New name."},
                "description": {"type": "string", "description": "New description."},
                "active": {"type": "boolean", "description": "New active flag."},
            },
            "required": ["sopId"],
            "additionalProperties": False,
        },
    ),
    "sop.addVersion": CapabilityToolSpec(
        capability_id="sop.addVersion",
        summary="Add a new full-text version to an existing SOP (history preserved).",
        when_to_use=(
            "When the user asks to update/revise the content of a SOP AND a sopId UUID "
            "is present. This appends a new version rather than overwriting history."
        ),
        input_fields=("sopId", "fullText"),
        input_schema={
            "type": "object",
            "properties": {
                "sopId": {"type": "string", "description": "SOP UUID."},
                "fullText": {"type": "string", "description": "New version full text."},
            },
            "required": ["sopId", "fullText"],
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
