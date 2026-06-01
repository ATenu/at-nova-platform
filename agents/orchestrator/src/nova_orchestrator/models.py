"""SQLAlchemy models for the isolated `postgres-agents` database.

The Node control plane owns the schema (via TypeORM migrations); these models
map the same tables so the execution plane can read runs + entitlement
snapshots and append events/steps/audit rows. The execution plane never connects
to the business `nova` database.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AgentRunEntitlement(Base):
    __tablename__ = "agent_run_entitlements"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    owner_subject: Mapped[str] = mapped_column(Text, nullable=False)
    owner_user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    roles: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    capability_allowlist: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(Text, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    owner_subject: Mapped[str] = mapped_column(Text, nullable=False)
    owner_user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    org_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    conversation_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_ref: Mapped[str] = mapped_column(Text, nullable=False)
    response_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    callback_auth_config_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    entitlement_snapshot_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("agent_run_entitlements.id"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("agent_runs.id"), nullable=False
    )
    owner_subject: Mapped[str] = mapped_column(Text, nullable=False)
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    visibility: Mapped[str] = mapped_column(Text, nullable=False)
    # Idempotency key for agent sub-events (streamed frame vs terminal-artifact
    # twin vs reconnect replay). NULL for lifecycle events emitted exactly once;
    # uniqueness enforced by a partial index (WHERE dedupe_key IS NOT NULL).
    dedupe_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("agent_runs.id"), nullable=False
    )
    parent_step_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    capability: Mapped[str | None] = mapped_column(Text, nullable=True)
    required_permission: Mapped[str | None] = mapped_column(Text, nullable=True)
    agent_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class WebhookAuthConfig(Base):
    __tablename__ = "webhook_auth_configs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    owner_subject: Mapped[str] = mapped_column(Text, nullable=False)
    auth_type: Mapped[str] = mapped_column(Text, nullable=False)
    token_secret_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    hmac_secret_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    jwks_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    issuer: Mapped[str | None] = mapped_column(Text, nullable=True)
    destination_url: Mapped[str] = mapped_column(Text, nullable=False)
    # Which event visibilities this owner's webhook receives (default all three).
    # The browser SSE stream is always user-only regardless of this value.
    visibility_scope: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    # Optional event-type allowlist; NULL = all types (full firehose).
    event_type_allowlist: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    # Entitlement-gated opt-in for literal SQL / raw rows (default OFF).
    include_raw_payloads: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("agent_runs.id"), nullable=False
    )
    event_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("agent_run_events.id"), nullable=False
    )
    owner_subject: Mapped[str] = mapped_column(Text, nullable=False)
    destination_url: Mapped[str] = mapped_column(Text, nullable=False)
    auth_config_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class A2aAgentRegistration(Base):
    """Self-registered A2A agent (native discovery).

    Agents publish their Agent Card to the orchestrator on startup and refresh
    it via heartbeat; the worker reads rows whose ``last_seen_at`` is within the
    configured TTL to build its routing table + LLM menu metadata. Trusted for
    discovery only - the per-run snapshot + shared catalog + Layer B gate remain
    authoritative for authorization.
    """

    __tablename__ = "a2a_agent_registrations"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(Text, nullable=False)
    card: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    skill_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentAuditLog(Base):
    __tablename__ = "agent_audit_log"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    run_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    owner_subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    capability: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
