"""Shared test fixtures for the orchestrator.

Publishes a seeded, DB-identical RBAC registry as the process-wide active policy
for the duration of each test, so the dynamic Layer B gate has deterministic
policy without a running control plane. Tests that exercise the fail-closed
(no-policy) path reset it explicitly.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from nova_orchestrator.authz.rbac_registry import reset_active_registry, set_active_registry

from ._rbac_fixture import build_seed_registry


@pytest.fixture(autouse=True)
def _active_rbac_registry() -> Iterator[None]:
    set_active_registry(build_seed_registry())
    try:
        yield
    finally:
        reset_active_registry()
