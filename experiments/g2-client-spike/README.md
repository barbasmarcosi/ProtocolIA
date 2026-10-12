# G2 — historical Orval vs Kubb bounded comparison

This directory is an **isolated experiment, not a production dependency**.
It compiles **the same generated Books v0.3 OpenAPI 3.1** using both code
generators, and runs strict TypeScript typechecking. The sole supported client
lives in [`examples/books-web`](../../examples/books-web/README.md).

| Candidate | Exact tested versions | Bounded observed result |
| --- | --- | --- |
| Orval | `orval@8.41.0` | Generated Book API/query hooks, TS PASS; selected client passes independent real backend HTTP/cache tests |
| Kubb | `kubb@5.8.0`, `@kubb/plugin-ts@5.0.6`, `@kubb/plugin-fetch@5.5.7`, `@kubb/plugin-react-query@5.2.1` | Generated Book types/clients/query hooks, TS PASS; real Kubb HTTP tests not run |

The research's proposed uniform `5.5.5` version **did not resolve**:
`@kubb/plugin-react-query@5.5.5` was unavailable in npm. Using latest
compatible published releases was documented and pinned rather than hidden.
This experiment demonstrates compatibility with the initial Books corpus,
not a fair feature-by-feature performance benchmark or productivity benefit.

Decision: **Orval** for the supported Books client (fewer separate generator
dependencies, generated query key factories and mutation hooks, and working
error-aware transport/caching evidenced by real HTTP tests). Kubb remains
a candidate only if later requirements justify its additional plugin surface.

The test Dockerfile runs the independent comparison, then builds the
**Orval-only** client from `examples/books-web` with `npm ci` and a pinned
lockfile. It tests against an *isolated local* Spring Boot API and never sends
state-changing checks to the public deployment. Evidence and limitations:
[`docs/G2_TYPESCRIPT_CLIENT_EVIDENCE.md`](../../docs/G2_TYPESCRIPT_CLIENT_EVIDENCE.md).
