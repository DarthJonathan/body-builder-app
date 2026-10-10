# GitHub Actions

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) follows `/Users/nathan/Development/expense_tracker/.github/workflows/publish.yml`: a push to `main` or a manual run on `main` builds and pushes separate backend and frontend images to GitHub Container Registry. Publishing runs independently of the [CI workflow](../.github/workflows/ci.yml).

Pull requests and pushes to branches other than `main` start CI directly without publishing. A `main` push starts only the publishing workflow. Once the workflows are on the default branch, **Actions → publish → Run workflow → main** builds and pushes images manually. **Actions → CI → Run workflow** runs checks only. A manual publishing run from another branch skips publishing.

The published image names use the lowercase GitHub repository owner:

```text
ghcr.io/<owner>/bodybuilder-backend:latest
ghcr.io/<owner>/bodybuilder-frontend:latest
```

Login uses `github.actor` and GitHub's built-in `GITHUB_TOKEN`; no personal registry token is needed. Only the `publish-images` job receives `packages: write`. Image source labels associate packages with this repository. Existing packages must permit this repository's Actions token to write to them. The workflow follows expense_tracker's single-platform Docker builds and does not deploy services.

| Job | Checks |
| --- | --- |
| Go / PostgreSQL | Formatting, `go vet`, race-enabled unit and real PostgreSQL integration tests, API/admin builds, importer self-tests, and E2E lifecycle safety tests |
| Frontend / Chromium / WebKit | Svelte/TypeScript, mock-client and nutrition unit tests, fixture UI, production PWA, live API UI, and production nutrition/offline replay |
| Docker / backend | Production backend Dockerfile builds after the test jobs pass |
| Docker / frontend | Production frontend Dockerfile builds after the test jobs pass |
| publish-images (separate workflow) | On `main` only, logs into GHCR and builds/pushes both `latest` images independently of CI |

Go 1.26 and Node 22 match the Dockerfiles. CI uses Ubuntu 24.04 and PostgreSQL 16. External actions are pinned to verified commit revisions. Test job permissions are read-only and checkout does not persist credentials. New commits cancel superseded standalone CI runs for the same branch or pull request; publishing runs are serialized per branch so two jobs cannot push `latest` concurrently.

The browser selection covers 72 fixture development cases, two production PWA cases, 28 live development cases, and twelve production nutrition/offline cases across Chromium and WebKit (114 total). Production builds run sequentially because they share SvelteKit output. The workout regression pauses and then forwards a genuine API request to verify an effort tap while saving reps. It checks stable button coordinates, picker opening, and persisted effort/reps in PostgreSQL. The notification regression positions a check-in card beneath a visible save notification and sends a native pointer click through their overlap. This selection does not imply every development case has also run against production or on a physical phone.

The `browser-reports` artifact contains separate reports/results for each suite and `live/api.log`. HTML reports contain review screenshots; failure results retain traces, screenshots, and videos. Artifacts are kept for seven days and are uploaded after success or failure when the job is not cancelled.

## Test isolation

Each CI test job receives its own disposable PostgreSQL service and synthetic database credentials. Integration tests create and remove their own random schemas. The live helper creates a separate `bb_e2e_*` schema and synthetic administrator, directs every AI/food upstream to a local error stub, and removes only its owned schema on normal exit or termination. Cleanup errors fail the live job. No production `.env`, real accounts, paid keys, or registry credentials are needed.

`scripts/run_e2e_backend.py` reads `BODYBUILDER_E2E_BIN_DIR` for the API/admin executables. Its default preserves `/private/tmp` on macOS and uses the system temporary directory elsewhere. Cleanup uses native `psql` against the configured PostgreSQL connection URI, preserving connection options and passing its password through the environment rather than command arguments. The existing local Compose fallback is allowed only for the documented local database URL; a different URL requires `psql`.

## Reproduce the live CI checks locally

With the local PostgreSQL service running, execute these commands from the repository root:

```sh
export BODYBUILDER_E2E_BIN_DIR="${TMPDIR:-/tmp}/bodybuilder-e2e"
export TEST_DATABASE_URL='postgres://training:training@127.0.0.1:5433/training?sslmode=disable'
mkdir -p "$BODYBUILDER_E2E_BIN_DIR"
cd backend
go build -trimpath -o "$BODYBUILDER_E2E_BIN_DIR/bodybuilder-api" .
go build -trimpath -o "$BODYBUILDER_E2E_BIN_DIR/bodybuilder-admin" ./cmd/admin
cd ..
CI=1 python3 scripts/run_live_ui_checks.py
```

Install the frontend dependencies and matching Playwright browsers first. The runner starts its own API on port 8082, waits until the synthetic administrator is ready, runs both selected live suites, stops the API, and checks schema cleanup. It saves local reports under ignored `frontend/ci-artifacts/live/`. Do not run another isolated API on 8082 at the same time.

The standalone CI workflow tests and builds images without publishing. The publishing workflow builds and pushes to GHCR on `main` without waiting for CI. Hosted verification of these changes and registry publishing require a GitHub run after they are committed and pushed.

## Local verification

On 10 October 2026, workflow validation, Go formatting/vet/race tests with real PostgreSQL, API/admin builds, importer and eight E2E-helper tests, Svelte/TypeScript and client unit tests, all 112 selected browser checks, and both production Docker builds passed. The complete live selections passed after the workout tap fix. A Linux PostgreSQL 16 client verified the corrected native cleanup command against a newly generated schema; SQL queries also confirmed the failed regression run and subsequent browser runs removed their owned schemas. The local API and frontend were restarted and returned HTTP 200 on ports 8081 and 5174.

A subsequent hosted failure in `nutrition-calculation.spec.ts` was reproduced twice in Ubuntu 24.04 amd64 with Playwright 1.52.0: the save notification intercepted a click at the Daily Check-in card. Notifications now ignore pointer input. The new overlap regression failed in both browsers before this change; afterward all 72 fixture cases passed in Linux Chromium/WebKit, and all sixteen nutrition/check-in cases passed on macOS. Both runs disabled retries. Svelte/TypeScript and workflow validation also passed. The publishing workflow was separated from CI as requested; hosted verification and GHCR publication of this follow-up have not been performed from this workspace.

References: [Playwright CI](https://playwright.dev/docs/ci-intro), [GitHub PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers), [Docker GHCR login](https://github.com/docker/login-action#github-container-registry).
