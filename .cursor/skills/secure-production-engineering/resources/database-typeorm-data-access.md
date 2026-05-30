# Database and TypeORM Data Access

Standards for schema and data access. Pairs with `backend-node-typeorm.md`.

## Schema and migrations

- Use migrations for all schema changes.
- Keep migrations reversible where practical.
- Review generated migrations before committing; never commit an unreviewed auto-generated migration.
- Use explicit column types and constraints.
- Use indexes intentionally for common filters and joins.
- Avoid nullable columns unless the domain meaning of null is clear.
- Avoid storing derived data unless justified (and document the justification).

## Queries and transactions

- Keep transaction boundaries explicit.
- Add isolation/concurrency handling for high-risk operations.
- Protect against SQL injection with parameterized queries.
- Avoid raw SQL unless necessary; if used, isolate, type, parameterize, and test it.
- Prevent N+1 query patterns (use relations, joins, or batched loads).
- Use pagination and limits for list queries.

## Boundaries

- Do not return ORM entities directly from API responses.
- Map persistence models to DTOs at the boundary.

## Data lifecycle

- Add data retention and deletion considerations for sensitive data.
- Classify sensitive columns and minimize what is persisted.
- Use encryption at rest where the data classification requires it.
