"""Celery task for the webhook dispatcher (transactional outbox poller).

Scheduled by Celery beat (`webhook.dispatch`). Kept separate from the
orchestration task so webhook delivery runs in its own worker pool/queue and a
slow receiver never blocks orchestration (plan section 17).
"""

from __future__ import annotations

import httpx

from .celery_app import app
from .db import get_session_factory
from .webhooks import dispatch_due

_TIMEOUT_S = 15.0


def _http_sender(url: str, headers: dict[str, str], raw_body: bytes) -> int:
    response = httpx.post(url, headers=headers, content=raw_body, timeout=_TIMEOUT_S)
    return response.status_code


@app.task(name="webhook.dispatch")
def dispatch_webhooks() -> int:
    """Send all due webhook deliveries. Returns the number handled."""
    return dispatch_due(get_session_factory(), sender=_http_sender)
