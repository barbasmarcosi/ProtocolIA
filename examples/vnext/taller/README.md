# Taller vNext — contract-first fixture

This TypeSpec contract models the independently tested manual Taller oracle at
`experiments/p5-taller-real-requirements-v1`, without copying its Java/React/SQL.

Source of truth: `contracts/main.tsp`. API routes/statuses are native TypeSpec HTTP;
`@protocolia/domain` declares public identity, persistence entity, behavior,
read/write capability, and a UI view hint. JDL and IR must be derived.

Pending first remote/local installation: `npm install --package-lock-only`, then
`npm ci && npm run compile:taller`. No claim of a passing compilation until run.

`Tool.code` is the public resource key. JHipster's generated numeric ID is not
automatically accepted as a replacement. Any adapter asserting full support must
prove external identity, error parity, authorization and transaction semantics.
