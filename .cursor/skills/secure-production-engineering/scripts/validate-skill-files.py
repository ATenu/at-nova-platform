#!/usr/bin/env python3
"""Read-only validator for the secure-production-engineering Cursor Skill library.

This script never modifies files. It verifies that required files exist, that the
top-level SKILL.md declares the required frontmatter, that the bridge rules are
present, and that security-sensitive resources mention the core security concepts.

Run from the repository root:

    python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py

Exit code 0 = all checks passed. Non-zero = at least one failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RESOURCES_DIR = SKILL_DIR / "resources"
SCRIPTS_DIR = SKILL_DIR / "scripts"
CURSOR_DIR = SKILL_DIR.parent.parent
RULES_DIR = CURSOR_DIR / "rules"
REPO_ROOT = CURSOR_DIR.parent

REQUIRED_RESOURCES = [
    "core-engineering-principles.md",
    "architecture-and-reuse.md",
    "security-by-design.md",
    "backend-node-typeorm.md",
    "auth-keycloak-rbac.md",
    "frontend-react.md",
    "python-langgraph-agents.md",
    "observability-langfuse.md",
    "testing-quality-gates.md",
    "database-typeorm-data-access.md",
    "api-contracts-and-errors.md",
    "ci-cd-and-release-quality.md",
    "code-review-checklist.md",
    "anti-patterns.md",
]

REQUIRED_RULES = [
    "000-core-engineering.mdc",
    "010-security-by-design.mdc",
    "020-backend-node-typeorm.mdc",
    "030-frontend-react.mdc",
    "040-python-langgraph-agents.mdc",
    "050-testing-quality-gates.mdc",
]

# Security concepts each listed resource must mention (case-insensitive substring).
SECURITY_CONCEPT_CHECKS = {
    "security-by-design.md": ["default deny", "least privilege", "keycloak", "rbac", "scope"],
    "auth-keycloak-rbac.md": ["centraliz", "keycloak", "rbac", "scope", "fail clos"],
}


class Reporter:
    def __init__(self) -> None:
        self.failures = 0
        self.checks = 0

    def record(self, ok: bool, message: str) -> None:
        self.checks += 1
        if ok:
            print(f"PASS: {message}")
        else:
            self.failures += 1
            print(f"FAIL: {message}")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def check_file_exists(reporter: Reporter, path: Path, label: str) -> bool:
    exists = path.is_file()
    reporter.record(exists, f"{label} exists ({path})")
    return exists


def check_skill_frontmatter(reporter: Reporter) -> None:
    skill_path = SKILL_DIR / "SKILL.md"
    if not check_file_exists(reporter, skill_path, "SKILL.md"):
        return
    text = read_text(skill_path)
    lines = text.splitlines()
    has_fence = len(lines) >= 1 and lines[0].strip() == "---"
    reporter.record(has_fence, "SKILL.md starts with YAML frontmatter fence")
    reporter.record("name:" in text.split("---")[1] if has_fence and len(text.split("---")) > 1 else False,
                    "SKILL.md frontmatter contains 'name'")
    reporter.record("description:" in text.split("---")[1] if has_fence and len(text.split("---")) > 1 else False,
                    "SKILL.md frontmatter contains 'description'")


def check_resources(reporter: Reporter) -> None:
    for name in REQUIRED_RESOURCES:
        check_file_exists(reporter, RESOURCES_DIR / name, f"resource {name}")


def check_rules(reporter: Reporter) -> None:
    for name in REQUIRED_RULES:
        check_file_exists(reporter, RULES_DIR / name, f"rule {name}")


def check_scripts(reporter: Reporter) -> None:
    check_file_exists(reporter, SCRIPTS_DIR / "README.md", "scripts README.md")
    check_file_exists(reporter, SCRIPTS_DIR / "validate-skill-files.py", "validate-skill-files.py")


def check_agents_md(reporter: Reporter) -> None:
    check_file_exists(reporter, REPO_ROOT / "AGENTS.md", "AGENTS.md")


def check_security_concepts(reporter: Reporter) -> None:
    for name, concepts in SECURITY_CONCEPT_CHECKS.items():
        path = RESOURCES_DIR / name
        text = read_text(path).lower()
        for concept in concepts:
            reporter.record(concept.lower() in text, f"{name} mentions '{concept}'")


def main() -> int:
    print("Validating secure-production-engineering Skill library...\n")
    reporter = Reporter()

    check_skill_frontmatter(reporter)
    check_resources(reporter)
    check_rules(reporter)
    check_scripts(reporter)
    check_agents_md(reporter)
    check_security_concepts(reporter)

    print(f"\n{reporter.checks - reporter.failures}/{reporter.checks} checks passed.")
    if reporter.failures:
        print(f"{reporter.failures} check(s) FAILED.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
