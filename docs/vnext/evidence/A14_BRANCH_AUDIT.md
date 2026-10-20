# vNext branch audit — 2026-10-14

Authoritative integration branch: `feature/vnext-a0-typespec-jhipster-spike`. PR #52 targets `main` but must not merge until product release decision.

The branch `feature/vnext-a14-contract-filtering` diverged with **9 historical commits** using the former `@filterBy` operation decorator and ad hoc list/count predicate implementations. They covered a requirements note, decorator/IR, compiler guards, Spring and Nest projections, and parameterized query predicates. Main integration branch instead implements `@queryFilter` on typed parameters, `@queryOrder` on queryPage and the shared allowlisted one-hop query planner, tested in real A14.2 PostgreSQL/HTTP/Chromium on both backends (Actions 38648198637 and later regression). Blind cherry-pick would reintroduce competing abstractions; no unique functional behavior requiring merge was found in those nine changes. Keep historical branch for reference; do not delete without retention review.

The former mirror `feature/vnext-a3-nest-relations-a5-evolution` was one commit behind integration at the original audit and carried no unique commits. A1/A3/A4/A5 older branches are ancestors. `main` was not modified by this reconciliation or A14.3 work. Do not describe a divergent branch as necessarily obsolete without reviewing exclusive commits.

This audit is source-history reconciliation, not a substitute for empirical query and migration acceptance.
