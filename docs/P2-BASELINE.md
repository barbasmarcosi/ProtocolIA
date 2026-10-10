# P2 — Fair Spring Generator Reference

Conventional reference: OpenAPI Generator 7.20.0, generator spring with useSpringBoot4=true, consuming the SAME OpenAPI 3.1 output emitted for ProtocolIA's inventory-v0.2 sample. GitHub p2-baseline.yml executes that command.

This is a reproducibility/scaffold reference, NOT the P4 A/B/C benchmark. OpenAPI Generator is not asked to implement atomic stock decrement, SQL isolation or idempotency; those are not expressible in the existing portable HTTP contract. It is invalid to report that absence as a failure or to claim ProtocolIA economics from a different behavioral scope.

P4 must compare matched, independently scored missions, including the agent/human engineering needed to implement business behavior using each arm, security verification and overall USD/success. Publish negative results. Do not use P2 self-authored fixtures as held-out tasks.
