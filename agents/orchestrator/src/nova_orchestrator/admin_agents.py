"""Server-side synthetic heartbeat for admin-onboarded A2A agents.

Admin-onboarded agents may not run Nova's self-registration heartbeat, so the
worker treats them as durable (see ``load_registry_from_store``). To keep that
honest — never silently routing to a dead endpoint — a periodic beat task
re-fetches each admin card and maintains real liveness:

- success -> refresh ``last_seen_at`` / ``last_card_fetch_at``, clear the error,
  set ``status='onboarded'``, and update the card/skills/version if changed;
- failure -> increment a consecutive-failure counter; after a threshold flip
  ``status='unreachable'`` with a sanitised, coarse ``last_error``.

It never deletes a row (an admin decides) and never touches ``source='self'``
rows (those are owned by the agent's own heartbeat/deregister lifecycle).
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agents import card_skills_from_card, is_allowed_base_url
from .config import OrchestratorConfig
from .models import A2aAgentRegistration

_logger = logging.getLogger(__name__)

# Coarse, non-leaky reasons stored in ``last_error`` (never raw upstream bodies).
_REASON_UNREACHABLE = "unreachable"
_REASON_NO_SKILLS = "no routable skills"
_REASON_UNSAFE_URL = "host no longer allowed"

# A card fetcher raises this when resolution fails (unreachable/unparseable).
CardFetchFn = Callable[[str], Mapping[str, Any]]


def revalidate_admin_agents(
    session: Session,
    config: OrchestratorConfig,
    *,
    fetch_card: CardFetchFn,
    now: datetime | None = None,
) -> dict[str, int]:
    """Re-validate every enabled admin-onboarded agent. Returns a small summary.

    ``fetch_card`` resolves a card from a base url and must raise on any failure
    (the orchestrator gateway's ``resolve_agent_card`` is the production fetcher;
    tests inject a fake). Idempotent and safe to run repeatedly.
    """
    moment = now or datetime.now(UTC)
    rows = (
        session.execute(
            select(A2aAgentRegistration).where(
                A2aAgentRegistration.source == "admin",
                A2aAgentRegistration.enabled.is_(True),
            )
        )
        .scalars()
        .all()
    )
    summary = {"checked": 0, "healthy": 0, "unreachable": 0}
    for row in rows:
        summary["checked"] += 1
        if _revalidate_one(row, config, fetch_card=fetch_card, moment=moment):
            summary["healthy"] += 1
        elif row.status == "unreachable":
            summary["unreachable"] += 1
    session.commit()
    return summary


def _revalidate_one(
    row: A2aAgentRegistration,
    config: OrchestratorConfig,
    *,
    fetch_card: CardFetchFn,
    moment: datetime,
) -> bool:
    """Mutate one row in place. Returns True when the agent is healthy."""
    # The SSRF allowlist can change after onboarding; re-check before reaching out.
    if not is_allowed_base_url(row.base_url, config.agent_registration_allowed_hosts):
        _mark_failure(row, config, reason=_REASON_UNSAFE_URL)
        return False

    try:
        card = fetch_card(row.base_url)
    except Exception:  # noqa: BLE001 - upstream A2A/httpx failure space is broad
        _mark_failure(row, config, reason=_REASON_UNREACHABLE)
        return False

    skill_ids = [skill.id for skill in card_skills_from_card(card)]
    if not skill_ids:
        _mark_failure(row, config, reason=_REASON_NO_SKILLS)
        return False

    raw_version = card.get("version") if isinstance(card, Mapping) else None
    row.card = dict(card)
    row.skill_ids = skill_ids
    row.version = raw_version if isinstance(raw_version, str) and raw_version else None
    row.status = "onboarded"
    row.last_seen_at = moment
    row.last_card_fetch_at = moment
    row.consecutive_failures = 0
    row.last_error = None
    return True


def _mark_failure(row: A2aAgentRegistration, config: OrchestratorConfig, *, reason: str) -> None:
    row.consecutive_failures = (row.consecutive_failures or 0) + 1
    row.last_card_fetch_at = datetime.now(UTC)
    row.last_error = reason
    if row.consecutive_failures >= config.admin_agent_unreachable_threshold:
        row.status = "unreachable"
