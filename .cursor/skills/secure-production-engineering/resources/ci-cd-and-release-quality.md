# CI/CD and Release Quality

Standards for continuous integration, delivery, and release safety.

## CI must run

- Lint.
- Typecheck.
- Tests.
- Build.

## CI should run where available

- Dependency audit.
- Secret scan.
- SAST (static analysis security testing).
- Container image scan.
- License checks.

## Database and deployment

- Database migrations must be checked before deployment.
- Containers must run as non-root where possible.
- Images should be minimal and pinned appropriately.
- Services must expose health/readiness checks.
- Production config must fail fast when invalid.
- Releases must include rollback considerations.

## Hard rule

Do not weaken CI, lint, type, or test settings to make generated code pass. Fix the
code instead. A green pipeline achieved by lowering the gate is a regression.
