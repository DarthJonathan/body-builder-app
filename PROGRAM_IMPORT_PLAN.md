# Structured program library and app imports

Requested 11 October 2026: generate complete evidence-informed gym programs and provide a text-based way to upsert them from BodyBuilder.

## Scope and acceptance

- Author BodyBuilder programs using scientific principles, with explicit sets, rep ranges, rest, warmups, progression guidance, audience/equipment constraints and nutrition guidance. Preserve the seven existing source-based templates.
- Use a documented, versioned JSON text format. A stable `key` identifies a program; an increasing integer `version` identifies an update. Human-readable workout and exercise keys preserve private identities during updates.
- Any account can preview, import, update and export its own programs. Importing the same content twice does not create duplicates. Invalid input, unknown exercises, duplicate keys and unsupported versions fail before saving.
- Preview the concrete program before applying it. Preserve existing calendar references and logged session snapshots; reject removal of an assigned workout instead of leaving dangling dates. Import does not assign dates or change nutrition targets.
- Confirmed: administrators publish to the shared starter library; everyone can import personal programs, with server-enforced admin authorization, durable storage, conflict detection, and no changes to existing personal copies.
- Expose progression and nutrition guidance in the app. Guidance is evidence-informed app policy, with citations; do not label generated plans clinically validated or claim automatic progression that is not implemented.
- Include downloadable/pasteable plan examples, an exercise-ID reference and import instructions in the repository and app.

## Execution

- [x] Research primary exercise/nutrition sources and record provenance.
- [x] Define the JSON format and equivalent Go/TypeScript validation and conversion.
- [x] Generate complete program documents and add them to the bundled catalogue.
- [x] Implement private upsert/export with stable keys and history/calendar protection.
- [x] Implement shared admin template upsert if selected, and merge it into the chooser.
- [x] Add mobile-friendly paste/upload, validation preview, export and plan guidance UI.
- [x] Add backend/client tests for input validation, create/update/idempotency, ownership, references and authorization; add mobile Chromium/WebKit UI and live Go/Postgres checks.
- [x] Run catalogue parity, backend tests, frontend checks/build and focused browser checks; document results and deployment requirements.

## Data design

Keep generated programs as checked-in JSON, deriving runtime templates from the same documents in Go and TypeScript. Imported programs carry the document metadata; workout/prescription keys are optional additions to existing records. Personal records keep server-generated IDs. Shared templates use their document key and a database revision for concurrent update protection.

Nutrition guidance stores reusable principles rather than personal calorie targets. Actual calories/macros continue to be calculated from a person's body/activity/goal inputs and can be manually overridden. Program selection and import remain explicit user actions; the broader expert-system ranking/adaptation engine is a separate extension.

## Verification

Verified locally on 11 October 2026:

- Svelte/TypeScript: zero errors and warnings; production frontend build passed.
- Frontend unit suites: 16 mock/client/catalogue cases, nine goal cases and twelve nutrition cases passed. All ten generated documents validate and round-trip; all seventeen templates preserve catalogue parity and exportable prescriptions.
- Go formatting, `go vet` and the full race-enabled suite passed against real PostgreSQL, including private import atomicity, stable identities, calendar/history retention, restart persistence, shared revisions and admin role revocation.
- Mobile Chromium and WebKit: eighteen focused development program/import cases and eight production import/PWA cases passed, with retries disabled.
- Live Go/PostgreSQL UI: ten development and ten production program/workout cases passed with isolated accounts and schema cleanup, including second-device sync and unchanged private copies after shared updates.
- Both production Docker images built successfully with the new catalogue, UI and API.
- `git diff --check` passed. CI includes the new program-import cases in development and production; hosted Actions and GHCR publication have not been run from this workspace.

Deployment requires both frontend and backend images. The existing backend migration mechanism creates `program_templates`; no new environment variable is needed. See [program instructions](docs/programs/README.md).
