"""Authorization parity layer (mirrors `@nova/shared` via the generated registry).

`nova_authz.py` is GENERATED from the canonical TypeScript registry by
`agents/orchestrator/scripts/generate_nova_authz.py`; the CI parity gate fails
on any drift. `registry.py` and `policy_gate.py` are byte-for-byte the same logic
the orchestrator worker uses, so the agent's Layer B decisions are identical.
"""
