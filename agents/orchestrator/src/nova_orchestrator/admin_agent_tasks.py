"""Celery beat task: synthetic heartbeat for admin-onboarded A2A agents.

Scheduled by Celery beat (``agents.revalidate_admin``). Kept thin: it wires a
synchronous card fetcher (driving the async A2A resolver through a short-lived
event loop, as the worker does for outbound calls) into the idempotent
``revalidate_admin_agents`` routine.
"""

from __future__ import annotations

import asyncio
from typing import Any

from .admin_agents import revalidate_admin_agents
from .celery_app import app
from .config import load_config
from .db import get_session_factory
from .gateway import resolve_agent_card


def _sync_fetch_card(host_url: str) -> dict[str, Any]:
    return asyncio.run(resolve_agent_card(host_url))


@app.task(name="agents.revalidate_admin")
def revalidate_admin_agents_task() -> dict[str, int]:
    """Re-validate every enabled admin-onboarded agent. Returns a summary."""
    config = load_config()
    with get_session_factory(config)() as session:
        return revalidate_admin_agents(session, config, fetch_card=_sync_fetch_card)
