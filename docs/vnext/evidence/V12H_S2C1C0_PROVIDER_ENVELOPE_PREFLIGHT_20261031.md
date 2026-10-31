# S2c-1c0 — provider-neutral HMAC envelope preflight, verified evidence

Date: 2026-10-31 UTC. Functional SHA `47a79a8fc0960cb5f06ef8f43dc18cf0b377d9ed`. Base `8b74ff822cf3e94c0ab6fb076aa4e7ba4e0114b6`. [PR #75](https://github.com/barbasmarcosi/ProtocolIA/pull/75). Synthetic event fixture only; TL-14 / issue #57 remains OPEN.

## Real GitHub Actions on functional SHA

- [New cross-language envelope + independently generated PostgreSQL/HTTP #41194418818](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41194418818): **SUCCESS** for both NestJS and modular Spring. Each job executed Node 24 TypeScript-strip adversarial HMAC tests, Java 21 `javac` + verifier fixture/rejection test, independent TypeSpec generation and real isolated PostgreSQL/HTTP generated-app conformance. The frozen Node/Java vector has signature `v1=12eb6b3aca418544295012e183c6401db154e9c536b85470a2c37145927eabdb` and body SHA-256 `20ece580daf2c31f7706a02043618938a28ea1fdf4041fabab1fc2f9558259eb`.
- [Existing S2b/S2c itemized finance and 390px Chromium #41194418857](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41194418857): **SUCCESS NestJS and Spring**, including immutable charges, signed adjustments, CAS, outcome recovery and the mobile financial UI regression.
- [Existing S2a exact receipt/drift guard #41194418892](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41194418892): **SUCCESS NestJS and Spring** with real PostgreSQL/HTTP and existing finance/mobile regression.
- [General quality #41194418902](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41194418902): **SUCCESS 5/5 jobs**.

## Observed security properties

Both dormant generated verifiers authenticate the **original raw bytes** under the same domain-separated HMAC-SHA256 format, select exactly one server-configured 32-byte key by ID, enforce canonical ASCII identifiers and lowercase signatures, reject trailing line breaks in signed headers, require a bounded ±300-second timestamp, reject missing/oversized bodies and oversized keyrings, and return only the authenticated event identity and SHA-256 digest. A second identical event verifies again: **this intentionally demonstrates that signature authentication is not replay prevention**.

The generation and conformance tests prove no regression in existing workshop app behavior. No HTTP webhook route, provider-specific semantics, financial settlement, replay inbox or refund was added. No real provider request, production deployment or stable finance tag occurred.

## Next blocking milestone

Implement provider-specific raw-body HTTP capture and single-value header parsing, server-controlled provider identity/key configuration, PostgreSQL atomic deduplication keyed by **(trusted provider identity, event ID), not signing key ID**, digest conflict handling, deterministic acknowledgement semantics and crash/retry tests in both generated targets. Only after independent verification and business approval may a provider event transition a receipt to externally verified. Do not close #57 or claim TL-14 complete.
