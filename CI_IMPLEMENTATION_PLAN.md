# GitHub Actions implementation plan

## Scope

Follow `/Users/nathan/Development/expense_tracker/.github/workflows/publish.yml`: build and push separate backend/frontend images to GitHub Container Registry on `main` pushes or manual runs using `GITHUB_TOKEN` and the lowercase repository owner. Per the updated request, publishing runs independently of automated tests. Pull requests, other branch pushes, and manual CI runs retain the test workflow. This work configures the workflows locally; it does not push this repository or deploy services.

## Execution

- [x] Add a workflow with read-only repository permissions, dependency caches, bounded job times, and cancellation of superseded runs.
- [x] Run Go formatting, vet, race-enabled tests with real PostgreSQL, and API/admin builds.
- [x] Run Svelte/TypeScript checks, mock-client and nutrition tests, and Chromium/WebKit tests for fixture, live API, and production/offline behavior.
- [x] Make the isolated E2E helper portable to Linux. Only its freshly generated schema may be removed; providers remain local stubs with synthetic credentials.
- [x] Retain separate browser reports, screenshots, traces, and isolated API logs for debugging failures.
- [x] Build both existing Dockerfiles without registry credentials or deployment secrets.
- [x] Add the expense_tracker publishing pattern for `bodybuilder-backend:latest` and `bodybuilder-frontend:latest`. Limit publishing to `main` and grant package write permission only to its publishing job; the follow-up removes its original CI dependency.
- [x] Fix the workout effort tap lost when an input save inserts the sync banner, and add a pending-save UI regression check.
- [x] Validate the workflow and its executable checks locally, then document how GitHub starts the workflow.

## Acceptance

Checks must fail on unavailable PostgreSQL, test failures, failed schema cleanup, or image build failures. Test jobs must not require production secrets, use real accounts, or call paid AI providers. Publishing uses GitHub's scoped token to build and push both images without a dependency on CI. Hosted verification of the current changes and registry publishing require committing and pushing them to GitHub.

## Follow-up — publishing independence and reported CI failure

- [x] Remove the reusable CI job and dependency from the publishing workflow; retain standalone checks.
- [x] Inspect and reproduce the reported nutrition calculation test failure when opening a daily check-in.
- [x] Fix the underlying interaction and verify it with an appropriate regression test, without masking failures with retries or longer timeouts.
- [x] Run affected UI checks and workflow validation, then update documentation with the actual results.


## Local verification — 10 October 2026

- Both workflow files pass `actionlint`; Svelte/TypeScript reports zero errors and warnings.
- Go formatting, `go vet`, race-enabled tests (including twelve real PostgreSQL integration cases), API/admin builds, and the USDA importer self-test passed.
- Eight E2E lifecycle/connection tests passed. The generated native `psql` command was exercised with PostgreSQL 16 in a Linux container: it connected to the configured database and removed only its newly created test schema. Passwords stay out of command arguments.
- The CI browser selection passed: 70 fixture development, two fixture production PWA, 28 live development, and twelve live production nutrition/offline cases (112 total).
- The new pending-save effort regression failed in both browsers before the fix, showing a 43-pixel control movement. The regression and complete live selections passed after the sync banner was moved out of page layout; retries remain disabled.
- Both production Docker images built successfully; the frontend image was rebuilt after the UI fix.
- Database queries confirmed cleanup of all four owned E2E schemas, including the intentionally failing regression run. The normal application schema remains present. The restarted API on 8081 and frontend on 5174 both return HTTP 200.
- Hosted Actions execution and GHCR publishing are not verified; no repository push, registry push, or server deployment was performed from this workspace.

## Follow-up verification — 10 October 2026

- Reproduced the reported nutrition calculation failure twice with retries disabled in an Ubuntu 24.04 amd64 container using Playwright 1.52.0, matching the installed CI dependency. The trace showed the save notification overlapping the Daily Check-in card.
- A new native pointer regression deliberately clicks through that overlap. Both Chromium and WebKit failed before the fix. Non-interactive notifications now ignore pointer input while keeping their visible text and status announcement.
- After the fix, all 72 fixture UI cases passed in Linux Chromium/WebKit with retries disabled. All sixteen nutrition/check-in cases also passed on the macOS host with retries disabled.
- Svelte/TypeScript reported zero errors and warnings. Both workflows passed `actionlint`, and `git diff --check` passed.
- Publishing now builds and pushes both images on `main` independently of CI. These changes remain local; no commit, repository push, registry push, or deployment was performed.
