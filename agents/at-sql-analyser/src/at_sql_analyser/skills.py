"""Advertised skills for the Agent Card — mirrors the shared capability catalog.

The agent never invents skills: each entry's id and required permission match a
capability in the dynamic, DB-driven RBAC registry (fetched at runtime). The Agent
Card advertises these so the orchestrator's steering layer can match intents, but
authorization is always decided by the snapshot + Layer B gate, never by the card.

The read skill's description is composed at startup from the DB MCP server's live
curated-view catalog (see `mcp.catalog_client`) at ROUTING grade: it advertises
the data AREAS the agent covers so the orchestrator can delegate accurately, but
NOT column-level detail. The exact columns and filters are resolved by the
agent's own per-run planner from the live schema (`describe_schema`); the
orchestrator never needs them and never talks to the MCP server directly. When
the catalog is unavailable the agent falls back to the static base text below
(fail-soft) — advertising is never blocking.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .authz.registry import get_capability

# Read skill: free-form data Q&A over the curated views (per-view domain gating).
SKILL_ANALYSE_READ = "data.analyse.read"
# Write dispatch skill: high-risk, may only invoke cataloged write capabilities,
# each independently gated + approval-gated (the agent mints no write authority).
SKILL_ACT_WRITE = "data.act.write"

AGENT_NAME = "at-sql-analyser"


@dataclass(frozen=True)
class AdvertisedSkill:
    id: str
    name: str
    description: str
    intent_keywords: tuple[str, ...]


_READ_BASE_DESCRIPTION = (
    "Retrieves, analyses, and answers any question about the user's business "
    "data - sales, customers, products, issues, actions, and SOPs - whether by "
    "open-ended analytics (counts, totals, lists, trends, aggregates) over "
    "curated, PII-aware views or by specific record lookups. It resolves human "
    "references itself (e.g. a customer or product by name) and chains the right "
    "reads to gather what it needs, so a record UUID is NOT required. Use as the "
    "DEFAULT for any data, analytics, reporting, or look-it-up question - for "
    "example how many, how much, list, show, count, total, trend, summary, "
    "details of, or find - covering both broad analytics and targeted lookups."
)

_READ_BASE_KEYWORDS: tuple[str, ...] = (
    "data",
    "report",
    "analytics",
    "how many",
    "how much",
    "count",
    "total",
    "trend",
    "list",
    "show",
    "analyse",
    "analyze",
    "summary",
    "aggregate",
    "revenue",
    "sales",
    "customers",
    "products",
    "issues",
    "actions",
    "sop",
    "find",
    "details",
    "lookup",
)


def compose_read_description(catalog: list[dict[str, Any]] | None) -> str:
    """Routing-grade read-skill description, derived from the MCP view catalog.

    Advertises the data AREAS the agent covers (the curated view names) so the
    orchestrator can delegate accurately, plus a single generic note on scoping
    and PII masking. It intentionally omits column-level detail: those are
    resolved by the agent's own per-run planner from the live schema. Falls back
    to the static base text when the catalog is empty/unavailable.
    """
    names = [
        str(view["name"]).strip()
        for view in (catalog or [])
        if isinstance(view, dict) and str(view.get("name", "")).strip()
    ]
    if not names:
        return _READ_BASE_DESCRIPTION
    owner_scoped = any(
        isinstance(view, dict) and view.get("ownerScoped") for view in (catalog or [])
    )
    scope_note = (
        " Some areas are scoped to the acting user; PII columns are always masked."
        if owner_scoped
        else " PII columns are always masked."
    )
    return (
        f"{_READ_BASE_DESCRIPTION}\n\n"
        f"It can answer questions across these curated, read-only data areas: "
        f"{', '.join(names)}.{scope_note} The exact columns and filters are "
        "resolved by the agent at query time from the live schema."
    )


def _read_keywords(catalog: list[dict[str, Any]] | None) -> tuple[str, ...]:
    """Base intent keywords plus the actual view names (deduped, order-stable)."""
    keywords: list[str] = list(_READ_BASE_KEYWORDS)
    seen = set(keywords)
    for view in catalog or []:
        if not isinstance(view, dict):
            continue
        name = str(view.get("name", "")).strip()
        if name and name not in seen:
            keywords.append(name)
            seen.add(name)
    return tuple(keywords)


_WRITE_SKILL = AdvertisedSkill(
    id=SKILL_ACT_WRITE,
    name="Act on data",
    description=(
        "High-risk write dispatcher that carries out a requested change by "
        "invoking an already-cataloged, permission-gated write capability (each "
        "independently gated and, by default, approval-gated; the agent mints no "
        "write authority itself). Use only when the user clearly requests a "
        "create, update, mark, close, or resolve action and a specific write "
        "capability applies - never for read-only questions."
    ),
    intent_keywords=(
        "create",
        "update",
        "mark",
        "resolve",
        "close",
        "add",
        "write",
        "change",
        "modify",
    ),
)


def advertised_skills(
    catalog: list[dict[str, Any]] | None = None,
) -> tuple[AdvertisedSkill, ...]:
    """Skills whose ids resolve to a real capability (defense against drift).

    The read skill is enriched from the live MCP view catalog when available; the
    write skill's targets come from the shared catalog, not the MCP server, so it
    is unaffected by ``catalog``.
    """
    read_skill = AdvertisedSkill(
        id=SKILL_ANALYSE_READ,
        name="Analyse data",
        description=compose_read_description(catalog),
        intent_keywords=_read_keywords(catalog),
    )
    skills = (read_skill, _WRITE_SKILL)
    return tuple(skill for skill in skills if get_capability(skill.id) is not None)
