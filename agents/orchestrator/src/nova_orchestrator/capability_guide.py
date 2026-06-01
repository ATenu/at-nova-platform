"""Fallback tool documentation for the orchestrator reasoner (Layer A menu).

The orchestrator is a PURE DELEGATOR: its menu only ever contains the two
umbrella delegation skills (``data.analyse.read`` / ``data.act.write``), each
owned by a registered A2A agent. The agent's live, trusted Agent Card is the
source of truth for the menu text — see ``graph._build_menu`` — and the agent
derives that text from the DB MCP server's curated view catalog, so the surface
stays accurate without being hand-maintained here. The two specs below are the
FALLBACK used only when no card is present (the static seed path).

Concrete business capabilities (``sales.*``, ``issues.*``, ...) and the low-level
``mcp-tool`` capabilities are agent-internal and never appear on the menu, so
they are intentionally NOT documented here: the agent's own planner builds their
inputs (re-validated by the Node gateway). This is NOT authorization — Layer B
still gates every hop. Descriptions are safe to show the model (no secrets/PII).
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


# Static catalog keyed by capability id. The orchestrator is a pure delegator,
# so its menu only ever contains the two umbrella delegation skills; the concrete
# business capabilities and the low-level MCP tools are agent-internal and are
# never placed on the menu (their input shapes live with the agent's planner +
# the Node gateway's validation). These two entries are the fallback used only
# when an umbrella's Agent Card is unavailable (the static seed path).
_TOOL_SPECS: dict[str, CapabilityToolSpec] = {
    "data.analyse.read": CapabilityToolSpec(
        capability_id="data.analyse.read",
        summary=(
            "Data analyst agent: retrieves, analyses, and answers any question "
            "about business data (sales, customers, products, issues, actions, "
            "SOPs) via analytics or specific record lookups."
        ),
        when_to_use=(
            "DEFAULT for any data/analytics/reporting/lookup question. Use when "
            "the user asks how many, how much, list, show, count, total, trend, "
            "summary, details of, or to find records — the agent resolves names "
            "and ids itself, so no specific UUID is needed."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "data.act.write": CapabilityToolSpec(
        capability_id="data.act.write",
        summary=(
            "High-risk write dispatch agent: carries out a requested change by "
            "invoking a cataloged, permission-gated write capability (requires "
            "recorded human approval)."
        ),
        when_to_use=(
            "Only when the user clearly requests a create/update/mark/close/resolve "
            "action and a specific write applies. Never for read-only questions."
        ),
        input_fields=(),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
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
