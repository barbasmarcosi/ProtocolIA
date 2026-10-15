# UX7 — Contract-aware server validation feedback

**Status:** implementation verified in isolated NestJS/Spring/PostgreSQL integration and Chromium; awaiting final visual-artifact gate and promotion.

Both NestJS and Spring Boot now return structured field validation issues as part of HTTP 400, using a portable and allowlisted code vocabulary. Example: `{"statusCode":400,"message":"Validation failed","issues":[{"field":"period","code":"invalid_format"}]}`. The field names originate only from generated contract entities. No arbitrary text, SQL, or database constraint details are exposed.

The shared generated React frontend maps the server's approved field/error codes to accessible, localized inline field messages. This handles mismatches that the browser-side rules missed and keeps the server authoritative; the client checks every incoming field name and code against the manifest allowlists. Unauthorized fields, unknown payload properties and database constraints retain the existing generic errors. The update does not claim that every database-level uniqueness/FK conflict can be pinpointed yet.

Acceptance: both generated backends must return identical issues for invalid periods, out-of-range and mistyped scores, and missing required fields. Existing frozen HTTP, PostgreSQL and Chromium regressions remain mandatory. Test contracts must include at least one unrelated domain to guard against application-specific logic. No deployment before validation.

## Initial integration evidence

- [UX7 two-target generated app run #38809792937 — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38809792937).
- A generated browser form receives a simulated, contract-conformant server-only 400 validation response. Chromium verifies the generated field has `aria-invalid=true`, that `aria-describedby` references the actual React-created inline error, and that the entered values survive.
- The independent frozen HTTP oracle exercises real Nest and Spring servers against PostgreSQL and requires identical `issues` for malformed months, score bounds/types, and missing required fields.
- A separate `FacilitySearch` contract validates generator consistency without VolunteerEvaluations-specific error branches.
- Positive creation, relational selectors, draft protection, mobile/desktop regression and access capabilities remain under the same generated-app test.
