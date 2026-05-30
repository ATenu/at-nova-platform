# Skill validation scripts

Read-only helpers that verify the `secure-production-engineering` Skill library is
complete and internally consistent. These scripts never modify files.

## `validate-skill-files.py`

Checks that:

- All required Skill, resource, and rule files exist.
- `SKILL.md` contains `name` and `description` frontmatter.
- `.cursor/rules` contains the required bridge rules.
- Security-sensitive resources mention centralized authz, Keycloak, RBAC, scopes, and default deny.

### Usage

Run from the repository root:

```bash
python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py
```

Exit code `0` means all checks passed; non-zero means at least one check failed. The
script prints a clear pass/fail line for every check.
