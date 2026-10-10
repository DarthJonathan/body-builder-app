# GitHub Actions implementation plan

## Scope

Follow `/Users/nathan/Development/expense_tracker/.github/workflows/publish.yml`: build and push separate backend/frontend images to GitHub Container Registry on `main` pushes or manual runs using `GITHUB_TOKEN` and the lowercase repository owner. BodyBuilder's automated checks must pass before publishing. Pull requests and other branch pushes run the same checks without publishing. This work configures the workflows locally; it does not push this repository or deploy services.

## Execution

- [x] Add a workflow with read-only repository permissions, dependency caches, bounded job times, and cancellation of superseded runs.
- [x] Run Go formatting, vet, race-enabled tests with real PostgreSQL, and API/admin builds.
- [x] Run Svelte/TypeScript checks, mock-client and nutrition tests, and Chromium/WebKit tests for fixture, live API, and production/offline behavior.
- [x] Make the isolated E2E helper portable to Linux. Only its freshly generated schema may be removed; providers remain local stubs with synthetic credentials.
- [x] Retain separate browser reports, screenshots, traces, and isolated API logs for debugging failures.
- [x] Build both existing Dockerfiles without registry credentials or deployment secrets.
- [x] Add the expense_tracker publishing pattern for `bodybuilder-backend:latest` and `bodybuilder-frontend:latest`, gated by the reusable CI workflow. Limit publishing to `main` and grant package write permission only to its publishing job.
- [x] Fix the workout effort tap lost when an input save inserts the sync banner, and add a pending-save UI regression check.
- [x] Validate the workflow and its executable checks locally, then document how GitHub starts the workflow.

## Acceptance

Checks must fail on unavailable PostgreSQL, test failures, failed schema cleanup, or image build failures. Test jobs must not require production secrets, use real accounts, or call paid AI providers. The publishing job uses GitHub's scoped token only after those checks pass. An actual GitHub run and registry publishing remain unverified until this repository is pushed to GitHub.


## Local verification — 10 October 2026

- Both workflow files pass `actionlint`; Svelte/TypeScript reports zero errors and warnings.
- Go formatting, `go vet`, race-enabled tests (including twelve real PostgreSQL integration cases), API/admin builds, and the USDA importer self-test passed.
- Eight E2E lifecycle/connection tests passed. The generated native `psql` command was exercised with PostgreSQL 16 in a Linux container: it connected to the configured database and removed only its newly created test schema. Passwords stay out of command arguments.
- The CI browser selection passed: 70 fixture development, two fixture production PWA, 28 live development, and twelve live production nutrition/offline cases (112 total).
- The new pending-save effort regression failed in both browsers before the fix, showing a 43-pixel control movement. The regression and complete live selections passed after the sync banner was moved out of page layout; retries remain disabled.
- Both production Docker images built successfully; the frontend image was rebuilt after the UI fix.
- Database queries confirmed cleanup of all four owned E2E schemas, including the intentionally failing regression run. The normal application schema remains present. The restarted API on 8081 and frontend on 5174 both return HTTP 200.
- Hosted Actions execution and GHCR publishing are not verified; no repository push, registry push, or server deployment was performed from this workspace.
