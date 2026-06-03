"""Dynamic, DB-driven authorization layer (mirrors the API's RbacRegistry).

`rbac_registry.py` fetches the effective authorization policy from the Node
control plane at `GET /internal/rbac/registry` and publishes it as the
process-wide active registry. `registry.py` and `policy_gate.py` read that policy,
so the agent's Layer B decisions are identical to the worker's and the control
plane's. Fail closed when no policy is loaded (startup or outage).
"""
