"""Startup-time catalog discovery against the DB MCP server.

Before any user run (and therefore any entitlement snapshot) exists, the agent
fetches the curated view catalog from the MCP server's snapshot-free ``/catalog``
route so its Agent Card can advertise an accurate, MCP-derived data surface. The
call is authenticated with the same audience-restricted ``nova-mcp-data`` service
token used for the data tools (``azp`` pinned at the MCP server), but carries no
run id. It is strictly best-effort: any failure returns an empty catalog so card
building falls back to the static description and serving is never blocked.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..auth.tokens import ServiceTokenClient, ServiceTokenError

logger = logging.getLogger(__name__)

_TIMEOUT_S = 10.0


def fetch_catalog(
    *, base_url: str, tokens: ServiceTokenClient, audience_scope: str
) -> list[dict[str, Any]]:
    """Return the curated MCP view catalog, or ``[]`` on any failure (fail-soft)."""
    url = f"{base_url.rstrip('/')}/catalog"
    try:
        token = tokens.get_token(audience_scope)
    except ServiceTokenError:
        logger.warning("catalog discovery: could not mint a data-plane token")
        return []
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=_TIMEOUT_S,
        )
    except httpx.HTTPError:
        logger.warning("catalog discovery: DB MCP server unreachable")
        return []
    if response.status_code != 200:
        logger.warning("catalog discovery rejected (status=%s)", response.status_code)
        return []
    try:
        body = response.json()
    except ValueError:
        logger.warning("catalog discovery: malformed response body")
        return []
    views = body.get("views") if isinstance(body, dict) else None
    if not isinstance(views, list):
        return []
    return [view for view in views if isinstance(view, dict)]
