# Architecture and Reuse

Force reusable, layered design. Respect an existing established convention if the
repository already has one; otherwise apply the shapes below.

## Layering

Backend code follows this shape:

```text
transport layer:      routes / controllers / http adapters
application layer:     use cases / services / orchestrators
domain layer:          entities / value objects / domain rules / interfaces
infrastructure layer:  TypeORM repositories, Keycloak adapters, external clients
shared layer:          typed contracts, errors, logging, config, auth primitives
```

Dependencies point inward: transport depends on application, application depends on
domain, infrastructure implements domain interfaces. Domain depends on nothing
framework-specific.

Frontend code separates:

```text
pages/routes -> feature containers -> hooks -> presentational components -> shared UI primitives -> typed API client
```

Python agent code separates:

```text
agent graph definitions -> typed state schemas -> node functions -> tool adapters -> external clients -> observability/eval utilities
```

## Reuse rules

- If logic is used twice, extract it.
- If logic is security-sensitive, centralize it before first use.
- If a pattern exists, extend the pattern instead of creating a parallel one.
- All shared modules must have stable public interfaces.
- Avoid dumping unrelated helpers into generic `utils` files.
- Use feature/domain-oriented modules rather than technical-layer dumping grounds when appropriate.

## Anti-fragmentation rules

- Do not create multiple competing API clients.
- Do not create multiple auth clients.
- Do not create multiple logging helpers.
- Do not create multiple error formats.
- Do not create multiple validation approaches unless a documented transition plan exists.
- Do not create local role/scope/permission constants inside features. Use the centralized definitions.

## When to add an abstraction

Add an abstraction only when one of these is true:

- It is a security boundary (auth, validation, secrets).
- It is a real domain concept with a stable interface.
- It removes genuine duplication (two or more current callers).

Do not add an abstraction that has a single caller and no security or domain meaning.
