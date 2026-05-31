"""Typed registry of A2A agents the orchestrator may delegate to.

Maps an agent-skill capability id (from the shared catalog) to the agent that
implements it, plus the audience-restricted endpoint used to reach it. The
registry is built once from typed config. A skill id only appears here if it
resolves to a real ``agent-skill`` capability in ``nova_authz`` (guards against
drift between the catalog and the routing table). Routing is NOT authorization:
every delegated hop still passes the Layer B gate before dispatch and is
re-verified by the agent itself.
"""

from __future__ import annotations

from dataclasses import dataclass

from .authz.registry import get_capability
from .config import OrchestratorConfig

SQL_ANALYST_NAME = "at-sql-analyser"
SQL_ANALYST_SKILLS = ("data.analyse.read", "data.act.write")


@dataclass(frozen=True)
class AgentDescriptor:
    name: str
    receiver: str
    base_url: str
    audience_scope: str
    skills: frozenset[str]


class AgentRegistry:
    def __init__(self, agents: tuple[AgentDescriptor, ...]) -> None:
        self._agents = agents
        by_skill: dict[str, AgentDescriptor] = {}
        for agent in agents:
            for skill in agent.skills:
                by_skill[skill] = agent
        self._by_skill = by_skill

    def agent_for_skill(self, skill_id: str) -> AgentDescriptor | None:
        return self._by_skill.get(skill_id)

    def skills(self) -> frozenset[str]:
        return frozenset(self._by_skill)

    def all(self) -> tuple[AgentDescriptor, ...]:
        return self._agents


def _valid_agent_skills(candidates: tuple[str, ...]) -> frozenset[str]:
    """Keep only ids that resolve to a real agent-skill capability."""
    valid: set[str] = set()
    for skill_id in candidates:
        capability = get_capability(skill_id)
        if capability is not None and capability.kind == "agent-skill":
            valid.add(skill_id)
    return frozenset(valid)


def build_default_registry(config: OrchestratorConfig) -> AgentRegistry:
    sql_analyst = AgentDescriptor(
        name=SQL_ANALYST_NAME,
        receiver=SQL_ANALYST_NAME,
        base_url=config.sql_analyst_agent_url,
        audience_scope=config.sql_analyst_agent_audience,
        skills=_valid_agent_skills(SQL_ANALYST_SKILLS),
    )
    return AgentRegistry((sql_analyst,))
