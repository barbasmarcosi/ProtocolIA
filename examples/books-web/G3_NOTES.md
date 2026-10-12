## G3 — Browser UI candidate (NOT YET VERIFIED)

The React/Vite shell is user-owned and consumes generated Orval hooks,
ProtocolIA `ui-manifest.json` and `payload.schema.json` emitted from
**v0.3 Books**. RJSF **6.7.1** with Ajv2020 validates the form constraints.
The UI cannot grant capabilities; demo authorization stays in Spring.

`src/protocolia-ui/bindings.ts` fails closed when resource identities,
view fields, operation names or form schema models drift. Forms' field
metadata and JSON Schema are not handwritten in React. Generated Orval code
remains deletable. Tests must pass actual Chromium + local Java HTTP before
claiming G3 verified; no screenshots or mock-only approvals.

**Security:** HTTP Basic here is solely an in-memory demo. Credentials are
entered by the tester in the browser, never bundled in JavaScript. For real
user accounts, G4 must implement JWT/OIDC, secure transport and trusted
capability mapping. The selected 'reader/writer' view is a convenience only.

**G3 status:** development branch until exact test evidence in
`docs/G3_BOOKS_UI_EVIDENCE.md`.
