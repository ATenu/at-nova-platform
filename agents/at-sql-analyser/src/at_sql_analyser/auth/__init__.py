"""Trust-boundary enforcement for the SQL analyst agent.

Inbound: `resource_server` validates the worker's audience-restricted token and
pins `azp`. Per run: `snapshot` fetches and re-verifies the immutable entitlement
snapshot from the control plane (decision D2). `policy` re-runs the Layer B gate
for every skill and concrete write capability. `tokens` mints the outbound
audience-restricted service tokens. Default deny throughout.
"""
