"""Database engine/session factory for the agents DB (lazy singleton)."""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import OrchestratorConfig, load_config

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine(config: OrchestratorConfig | None = None) -> Engine:
    global _engine
    if _engine is None:
        cfg = config or load_config()
        _engine = create_engine(cfg.agents_database_url, pool_pre_ping=True, future=True)
    return _engine


def get_session_factory(config: OrchestratorConfig | None = None) -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(config), expire_on_commit=False)
    return _session_factory
