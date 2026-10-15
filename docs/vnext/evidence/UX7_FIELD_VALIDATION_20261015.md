# UX7 — Contract-aware server validation feedback

**Status:** isolated implementation, pending independent two-backend/browser verification.

Both NestJS and Spring Boot now return structured field validation issues as part of HTTP 400, using a portable and allowlisted code vocabulary. Example: `{"statusCode":400,"message":"Validation failed","issues":[{"field":"period","code":"invalid_format"}]}`. The field names originate only from generated contract entities. No arbitrary text, SQL, or database constraint details are exposed.

The shared generated React frontend maps the server's approved field/error codes to accessible, localized inline field messages. This handles mismatches that the browser-side rules missed and keeps the server authoritative; the client checks every incoming field name and code against the manifest allowlists. Unauthorized fields, unknown payload properties and database constraints retain the existing generic errors. The update does not claim that every database-level uniqueness/FK conflict can be pinpointed yet.

Acceptance: both generated backends must return identical issues for invalid periods, out-of-range and mistyped scores, and missing required fields. Existing frozen HTTP, PostgreSQL and Chromium regressions remain mandatory. Test contracts must include at least one unrelated domain to guard against application-specific logic. No deployment before validation.
