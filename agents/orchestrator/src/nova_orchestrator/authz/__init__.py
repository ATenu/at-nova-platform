"""Dynamic, DB-driven authorization layer for the execution plane.

`rbac_registry.py` fetches the effective authorization policy (role->permission
grants and the capability catalog with required permissions, risk and enabled
flags) from the Node control plane at `GET /internal/rbac/registry` and publishes
it as the process-wide active registry. `registry.py` and `policy_gate.py` read
that policy, so the worker's Layer B decisions match the control plane's and the
agents' (all read the same DB-backed source). Fail closed when no policy is loaded.
"""
