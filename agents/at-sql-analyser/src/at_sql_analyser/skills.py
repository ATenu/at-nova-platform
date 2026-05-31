"""Advertised skills for the Agent Card — mirrors the shared capability catalog.

The agent never invents skills: each entry's id and required permission match a
capability in `nova_authz` (the generated parity registry). The Agent Card
advertises these so the orchestrator's steering layer can match intents, but
authorization is always decided by the snapshot + Layer B gate, never by the card.
"""

from __future__ import annotations

from dataclasses import dataclass

from .authz.registry import get_capability

# Read skill: free-form data Q&A over the curated views (gated read-data).
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


_SKILLS: tuple[AdvertisedSkill, ...] = (
    AdvertisedSkill(
        id=SKILL_ANALYSE_READ,
        name="Analyse data",
        description=(
            "Answer questions about business data by running safe, read-only queries "
            "over curated, PII-aware views."
        ),
        intent_keywords=(
            "data",
            "report",
            "how many",
            "count",
            "trend",
            "list",
            "show",
            "analyse",
            "analyze",
            "summary",
            "total",
            "revenue",
            "sales",
            "customers",
        ),
    ),
    AdvertisedSkill(
        id=SKILL_ACT_WRITE,
        name="Act on data",
        description=(
            "Carry out a requested change by dispatching an already-cataloged, "
            "permission-gated write capability (requires recorded approval)."
        ),
        intent_keywords=("create", "update", "mark", "resolve", "close", "add"),
    ),
)


def advertised_skills() -> tuple[AdvertisedSkill, ...]:
    """Skills whose ids resolve to a real capability (defense against drift)."""
    return tuple(skill for skill in _SKILLS if get_capability(skill.id) is not None)
