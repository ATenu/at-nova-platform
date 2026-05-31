"""Generate the Python `nova_authz` parity module from the TypeScript registry.

The TypeScript `@nova/shared` RBAC + capability registry is the single source of
truth. This script reads the JSON it exports
(`backend-services/packages/shared/rbac-registry.json`) and writes
`src/nova_orchestrator/authz/nova_authz.py`. CI runs this and fails on any diff,
so the two language sides can never drift.

Usage (from repo root):
    npm run build -w @nova/shared
    npm run rbac:export -w @nova/shared
    python services/orchestrator/scripts/generate_nova_authz.py
    git diff --exit-code services/orchestrator/src/nova_orchestrator/authz/nova_authz.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVICE_ROOT = HERE.parent
REPO_ROOT = SERVICE_ROOT.parent.parent
REGISTRY_PATH = REPO_ROOT / "backend-services" / "packages" / "shared" / "rbac-registry.json"
OUTPUT_PATH = SERVICE_ROOT / "src" / "nova_orchestrator" / "authz" / "nova_authz.py"


def _py_str_tuple(values: list[str]) -> str:
    return "(" + ", ".join(f'"{value}"' for value in values) + (",)" if values else ")")


def render(registry: dict[str, Any]) -> str:
    permissions: list[str] = registry["permissions"]
    roles: list[str] = registry["roles"]
    role_permissions: dict[str, list[str]] = registry["rolePermissions"]
    capabilities: list[dict[str, Any]] = registry["capabilities"]

    lines: list[str] = []
    lines.append('"""GENERATED FILE — do not edit by hand.')
    lines.append("")
    lines.append("Mirrors the canonical TypeScript RBAC + capability registry in `@nova/shared`.")
    lines.append("Regenerate with `scripts/generate_nova_authz.py`; CI fails on drift.")
    lines.append('"""')
    lines.append("")
    lines.append("from __future__ import annotations")
    lines.append("")
    lines.append("from dataclasses import dataclass")
    lines.append("")
    lines.append("")
    lines.append(f"PERMISSIONS: tuple[str, ...] = {_py_str_tuple(permissions)}")
    lines.append("")
    lines.append(f"ROLES: tuple[str, ...] = {_py_str_tuple(roles)}")
    lines.append("")
    lines.append("ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {")
    for role in roles:
        lines.append(f'    "{role}": {_py_str_tuple(role_permissions[role])},')
    lines.append("}")
    lines.append("")
    lines.append("")
    lines.append("@dataclass(frozen=True)")
    lines.append("class CapabilityDescriptor:")
    lines.append("    id: str")
    lines.append("    kind: str")
    lines.append("    mode: str")
    lines.append("    required_permissions: tuple[str, ...]")
    lines.append("    risk: str")
    lines.append("    resource_scoped: bool")
    lines.append("")
    lines.append("")
    lines.append("CAPABILITY_CATALOG: tuple[CapabilityDescriptor, ...] = (")
    for capability in capabilities:
        required = _py_str_tuple(capability["requiredPermissions"])
        lines.append("    CapabilityDescriptor(")
        lines.append(f'        id="{capability["id"]}",')
        lines.append(f'        kind="{capability["kind"]}",')
        lines.append(f'        mode="{capability["mode"]}",')
        lines.append(f"        required_permissions={required},")
        lines.append(f'        risk="{capability["risk"]}",')
        lines.append(f"        resource_scoped={bool(capability['resourceScoped'])},")
        lines.append("    ),")
    lines.append(")")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    check_only = "--check" in sys.argv[1:]
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    rendered = render(registry)

    if check_only:
        # CI parity gate: fail (non-zero) if the committed Python registry has
        # drifted from the canonical TypeScript source of truth (section 23).
        current = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
        if current != rendered:
            print(
                "nova_authz parity check FAILED: the generated Python registry is "
                "out of date with @nova/shared.\n"
                "Run: npm run build -w @nova/shared && npm run rbac:export -w @nova/shared "
                "&& python services/orchestrator/scripts/generate_nova_authz.py",
                file=sys.stderr,
            )
            sys.exit(1)
        print("nova_authz parity check passed.")
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
