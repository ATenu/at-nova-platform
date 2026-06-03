"""Shared test fixtures for the SQL analyst agent.

Publishes a seeded, DB-identical RBAC registry as the process-wide active policy
for the duration of each test, so the dynamic Layer B gate has deterministic
policy without a running control plane.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from at_sql_analyser.authz.rbac_registry import reset_active_registry, set_active_registry

from ._rbac_fixture import build_seed_registry


@pytest.fixture(autouse=True)
def _active_rbac_registry() -> Iterator[None]:
    set_active_registry(build_seed_registry())
    try:
        yield
    finally:
        reset_active_registry()
