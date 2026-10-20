# Taller vNext — TypeSpec-first A0 fixture

Contract source: `contracts/main.tsp`. This uses native TypeSpec HTTP and
stable `@protocolia/domain` decorators to express entity persistence, external
identity, field constraints, operation behavior, capability and an optional UI hint.

```sh
npm ci
npm run check:vnext
npm run compile:taller
bash tests/vnext/negative-check.sh
```

The compiler emits canonical `ir.json`, JHipster `entities.jdl`,
`jhipster-app.jdl`, capability blockers, and official OpenAPI 3.1 under
`tsp-output/`. JDL must **not** be edited independently.

Optional generator spike (isolated, requires an installed pinned generator):

```sh
npm install --no-save --package-lock=false --ignore-scripts generator-jhipster@9.4.0
npm run probe:jhipster
```

The generated Java 21/Spring/React app can be compiled in isolation with:

```sh
docker build -f Dockerfile.a0-jhipster --progress=plain .
```

**Not production:** JHipster stock REST and React use numeric `Tool.id`
instead of contractual `Tool.code`, and generic domain writes/authorization
are not implemented. That conflict is recorded in `docs/vnext/evidence/A0.md`.
No JHipster output is used as a handwritten domain template; the fixture's
historical Java/React/SQL oracle remains unchanged.
