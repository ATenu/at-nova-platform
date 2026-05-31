"""Process entry point for the SQL analyst agent (ASGI app factory)."""

from __future__ import annotations

from .config import load_config
from .server import create_app


def build() -> object:
    return create_app(load_config())


app = build()
