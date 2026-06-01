"""Typed registry of A2A agents the orchestrator may delegate to.

Native A2A discovery: agents self-register their Agent Card (see the gateway
``/internal/agents/register`` endpoint), and the worker builds this registry at
run time from the live registrations. The card is trusted for *discovery* -
which agent/URL serves a skill, plus the human-facing menu text - but never for
authorization: a skill is routable only if it resolves to a real ``agent-skill``
capability in ``nova_authz`` (guards drift), and every delegated hop still passes
the Layer B gate and is re-verified by the agent itself against the run snapshot.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .authz.registry import get_capability
from .config import OrchestratorConfig
from .models import A2aAgentRegistration

SQL_ANALYST_NAME = "at-sql-analyser"
SQL_ANALYST_SKILLS = ("data.analyse.read", "data.act.write")


@dataclass(frozen=True)
class CardSkill:
    """Advertised skill metadata from a trusted Agent Card (menu text only)."""

    id: str
    name: str
    description: str
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentDescriptor:
    name: str
    receiver: str
    base_url: str
    audience_scope: str
    skills: frozenset[str]
    # Advertised card metadata per skill id; absent for statically seeded agents
    # (the menu then falls back to the local capability guide).
    skill_cards: tuple[CardSkill, ...] = field(default_factory=tuple)


class AgentRegistry:
    def __init__(self, agents: tuple[AgentDescriptor, ...]) -> None:
        self._agents = agents
        by_skill: dict[str, AgentDescriptor] = {}
        card_by_skill: dict[str, CardSkill] = {}
        for agent in agents:
            for skill in agent.skills:
                by_skill[skill] = agent
            for card in agent.skill_cards:
                card_by_skill[card.id] = card
        self._by_skill = by_skill
        self._card_by_skill = card_by_skill

    def agent_for_skill(self, skill_id: str) -> AgentDescriptor | None:
        return self._by_skill.get(skill_id)

    def card_skill_for(self, skill_id: str) -> CardSkill | None:
        """Advertised card metadata for a routable skill (menu text), if any."""
        return self._card_by_skill.get(skill_id)

    def skills(self) -> frozenset[str]:
        return frozenset(self._by_skill)

    def all(self) -> tuple[AgentDescriptor, ...]:
        return self._agents


def _valid_agent_skills(candidates: Iterable[str]) -> frozenset[str]:
    """Keep only ids that resolve to a real agent-skill capability."""
    valid: set[str] = set()
    for skill_id in candidates:
        capability = get_capability(skill_id)
        if capability is not None and capability.kind == "agent-skill":
            valid.add(skill_id)
    return frozenset(valid)


def is_allowed_base_url(base_url: str, allowed_hosts: Iterable[str]) -> bool:
    """SSRF guard: the worker sends tokens/tasks to this URL, so constrain it.

    Requires an http/https scheme and a host; when ``allowed_hosts`` is non-empty
    the host must be in the allowlist. Empty allowlist = scheme/host check only.
    """
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    allowed = tuple(allowed_hosts)
    return not allowed or parsed.hostname in allowed


def card_skills_from_card(card: Mapping[str, object]) -> tuple[CardSkill, ...]:
    """Parse advertised skills out of a stored Agent Card (defensive: typed only)."""
    raw_skills = card.get("skills") if isinstance(card, Mapping) else None
    if not isinstance(raw_skills, list):
        return ()
    parsed: list[CardSkill] = []
    for item in raw_skills:
        if not isinstance(item, Mapping):
            continue
        skill_id = item.get("id")
        if not isinstance(skill_id, str) or not skill_id:
            continue
        name = item.get("name")
        description = item.get("description")
        tags = item.get("tags")
        parsed.append(
            CardSkill(
                id=skill_id,
                name=name if isinstance(name, str) else skill_id,
                description=description if isinstance(description, str) else "",
                tags=tuple(t for t in tags if isinstance(t, str)) if isinstance(tags, list) else (),
            )
        )
    return tuple(parsed)


def _descriptor_from_row(row: A2aAgentRegistration) -> AgentDescriptor | None:
    """Build a routing descriptor from a registration row (drift-guarded)."""
    skill_ids = row.skill_ids if isinstance(row.skill_ids, list) else []
    skills = _valid_agent_skills(s for s in skill_ids if isinstance(s, str))
    if not skills:
        return None
    cards = tuple(c for c in card_skills_from_card(row.card or {}) if c.id in skills)
    return AgentDescriptor(
        name=row.name,
        receiver=row.name,
        base_url=row.base_url,
        audience_scope=row.audience,
        skills=skills,
        skill_cards=cards,
    )


def _seed_descriptor(config: OrchestratorConfig) -> AgentDescriptor | None:
    """Static SQL analyst seed for resilience when the live registry is empty."""
    skills = _valid_agent_skills(SQL_ANALYST_SKILLS)
    if not skills:
        return None
    return AgentDescriptor(
        name=SQL_ANALYST_NAME,
        receiver=SQL_ANALYST_NAME,
        base_url=config.sql_analyst_agent_url,
        audience_scope=config.sql_analyst_agent_audience,
        skills=skills,
    )


def load_registry_from_store(
    session: Session,
    config: OrchestratorConfig,
    *,
    now: datetime | None = None,
) -> AgentRegistry:
    """Build the routing table from live self-registrations (native discovery).

    Only registrations refreshed within ``a2a_registry_ttl_s`` are considered
    live. Skills are intersected with the shared catalog (``_valid_agent_skills``)
    so a card can never widen what is dispatchable. If nothing live is found and
    seeding is enabled, fall back to the statically configured SQL analyst.
    """
    moment = now or datetime.now(UTC)
    cutoff = moment - timedelta(seconds=config.a2a_registry_ttl_s)
    rows = (
        session.execute(
            select(A2aAgentRegistration).where(A2aAgentRegistration.last_seen_at >= cutoff)
        )
        .scalars()
        .all()
    )
    descriptors: list[AgentDescriptor] = []
    for row in rows:
        if not is_allowed_base_url(row.base_url, config.agent_registration_allowed_hosts):
            continue
        descriptor = _descriptor_from_row(row)
        if descriptor is not None:
            descriptors.append(descriptor)
    if not descriptors and config.a2a_registry_seed_sql_analyst:
        seed = _seed_descriptor(config)
        if seed is not None:
            descriptors.append(seed)
    return AgentRegistry(tuple(descriptors))


def build_default_registry(config: OrchestratorConfig) -> AgentRegistry:
    """Static SQL-analyst registry (seed/fallback; used when no DB session)."""
    seed = _seed_descriptor(config)
    return AgentRegistry((seed,) if seed is not None else ())
