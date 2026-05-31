"""Celery application for the orchestration plane (hardened per plan section 17).

``postgres-agents`` is the source of truth; Redis is the broker + result
backend with ``noeviction`` so queued/running task state is never silently
dropped. Tasks are idempotent and resumable, so Redis durability tradeoffs are
bounded (state can always be rebuilt from Postgres).
"""

from __future__ import annotations

from celery import Celery

from .config import load_config

_config = load_config()

app = Celery(
    "nova_orchestrator",
    broker=_config.broker_url,
    backend=_config.result_backend,
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=_config.run_soft_time_limit_s,
    task_time_limit=_config.run_time_limit_s,
    task_default_retry_delay=30,
    task_routes={
        "orchestrator.run": {"queue": "orchestrator.longrunning"},
        "webhook.dispatch": {"queue": "webhooks"},
    },
    worker_cancel_long_running_tasks_on_connection_loss=True,
    broker_connection_retry_on_startup=True,
    # The webhook dispatcher polls the outbox on a fixed cadence (Celery beat).
    beat_schedule={
        "dispatch-due-webhooks": {
            "task": "webhook.dispatch",
            "schedule": 10.0,
        },
    },
    # rediss:// outside local enables TLS automatically; broker_use_ssl is set by
    # the URL scheme. Never expose the broker publicly.
)

# Ensure the task modules are imported so the worker registers the tasks.
app.autodiscover_tasks(
    ["nova_orchestrator"], related_name="tasks"
)
app.autodiscover_tasks(
    ["nova_orchestrator"], related_name="webhook_tasks"
)
