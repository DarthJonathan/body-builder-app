# BodyBuilder

A training PWA with SvelteKit 5/TypeScript and a Go/PostgreSQL backend. The five-tab dark mobile layout follows the supplied iPhone references, with draggable sheets. Go follows the sibling expense tracker's Gorilla mux, controller/service/DAO, GORM, bcrypt/JWT, and JSON response patterns. The expense tracker itself is unchanged.

## Live features

Public registration and password sign-in are real. New accounts start empty. Programs, calendar assignments, workout sets/effort/rest/completion, food logs, dated nutrition overrides, daily weight-and-notes check-ins, progress summaries, and lesson links/notes save privately to PostgreSQL and sync between devices. Templates are explicitly chosen and copied. Session prescriptions are frozen so later program edits cannot rewrite workout history.

The live client keeps an account-specific IndexedDB snapshot and durable outbox. Existing records can be edited through a connection outage and replayed with stable retry IDs. Conflicting device edits require an explicit keep-local/use-server decision. Pending changes remain visible and can be reviewed or discarded. Copying a template or food day and starting a new workout need server acknowledgement before the new records can be edited. Signing out clears visible private data and drafts. Private API responses are excluded from service-worker caches.

Food search uses bundled USDA ingredient records without an API key, then Open Food Facts for unmatched packaged-food searches. Database sources, servings, and reviewed quantities are retained. Saved foods and USDA matches remain available during upstream failures; manual entry is available. Optional **Ask AI** and **Estimate from Photo** actions use an administrator's OpenAI, Anthropic, or OpenRouter configuration. Photo drafts require review and explicit saving. Regular calculation, food search, and logging do not call AI. Keys are encrypted in PostgreSQL and never appear in snapshots or the outbox. See [provider and pinned-dataset details](backend/providers/README.md).

**Calculate Targets** asks for age, equation sex, height, weight, activity and goal, with adjustable calorie/protein/fat settings. It shows a Mifflin–St Jeor estimate before **Apply Targets** saves it. Manual overrides keep the original inputs/version; later calculations and check-ins do not silently replace saved targets. The same version can prepare an offline preview. See the [calculation policy](NUTRITION_IMPLEMENTATION_PLAN.md). Steps and progress-photo galleries are outside this release. Exercise photographs retain [provenance](frontend/static/images/README.md); hero/anatomy vectors are temporary artwork.

## Run locally

This workspace has a private local `.env`. For a fresh checkout, copy `.env.example` to `.env`, generate the JWT secret with `openssl rand -hex 32`, and the provider encryption secret with `openssl rand -base64 32`. Put the results in their corresponding fields. Keep the encryption secret stable to read saved AI keys. Never commit `.env`.

From the repository root:

```sh
docker compose up -d postgres
python3 scripts/run_backend.py
```

The helper loads `.env` as data and runs Go. In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open [BodyBuilder](http://localhost:5174/) and create an account. Go listens on `127.0.0.1:8081`; PostgreSQL uses port `5433` and schema `training`. SvelteKit proxies `/api/v1/*` to Go on the same frontend origin. Set `BACKEND_API_URL` before starting SvelteKit if Go's address differs. Dedicated ports avoid the expense app's cached page.

For the production PWA locally, run `npm run build` then `npm run preview` inside `frontend` (port `4174`). To run the container stack, stop the local API occupying 8081 first, then use `docker compose up --build` from the root (frontend port `3000`). Production hosting must supply HTTPS, durable PostgreSQL, its own database credentials, and stable secrets. Physical iPhone/Android installation is not yet verified.

## Administrator and AI

Registration always creates a normal user. After the intended administrator has registered, promote that explicitly named account locally:

```sh
python3 scripts/run_backend.py go run ./cmd/admin -email you@example.com
```

Refresh/sign in again, open Account information → AI Provider Settings, and enter a provider, compatible model, API key, and daily limit. Blank key input retains a saved key; changing providers requires a new key. The CLI supports `-role user` to demote the named account. AI is optional. External LLM calls need a valid key/model and were not paid-tested during development.

## Fixture preview

The screenshot fixtures remain separate from real accounts:

```sh
cd frontend
PUBLIC_API_MODE=mock npm run dev -- --port 5175 --strictPort
```

This mode uses simulated accounts, food search, and AI, saves only in the browser, and accepts no real provider credentials. It never seeds or migrates fixture records into live accounts.

`PUBLIC_API_MODE` is fixed at build time. Rebuild before switching a production preview between live and fixture mode; setting the environment only when starting preview does not change an existing build.

## Checks

From `backend`:

```sh
GOCACHE=/private/tmp/bodybuilder-go-cache TEST_DATABASE_URL='postgres://training:training@127.0.0.1:5433/training?sslmode=disable' go test -race ./...
GOCACHE=/private/tmp/bodybuilder-go-cache go vet ./...
```

Database tests create fresh schemas and remove only their own schemas. They fail if `TEST_DATABASE_URL` is missing; a skipped database suite does not count as verification. Provider tests use local HTTP stubs and fake keys.

From `frontend`:

```sh
npm run check
npm run test:mock
npm run test:nutrition
npm run test:ui
npm run test:ui:production -- tests/pwa.spec.ts
```

For live browser tests, build isolated test executables from `backend`:

```sh
GOCACHE=/private/tmp/bodybuilder-go-cache go build -o /private/tmp/bodybuilder-api .
GOCACHE=/private/tmp/bodybuilder-go-cache go build -o /private/tmp/bodybuilder-admin ./cmd/admin
```

Start `python3 scripts/run_e2e_backend.py` from the root and leave it running. It creates a fresh E2E schema, synthetic administrator, and local failing provider stubs, then cleans its schema up when stopped. In `frontend`:

```sh
E2E_ADMIN_EMAIL=e2e-admin@bodybuilder.test E2E_ADMIN_PASSWORD='BodyBuilder-e2e-admin-42!' npm run test:live
E2E_ADMIN_EMAIL=e2e-admin@bodybuilder.test E2E_ADMIN_PASSWORD='BodyBuilder-e2e-admin-42!' npm run test:live:production -- tests/live/nutrition.spec.ts tests/live/offline.spec.ts
```

Install matching browsers with `npx playwright install chromium webkit` if needed. Run production suites/builds sequentially because they share SvelteKit output. See the [live verification report](docs/LIVE_VERIFICATION.md), [browser coverage](frontend/tests/README.md), and [historical mock verification](frontend/docs/VERIFICATION.md).

## GitHub Actions

[publish](.github/workflows/publish.yml) follows expense_tracker: pushes to `main` and manual runs publish `ghcr.io/<lowercase-owner>/bodybuilder-backend:latest` and `ghcr.io/<lowercase-owner>/bodybuilder-frontend:latest` with `GITHUB_TOKEN`. Publishing is limited to `main` and waits for all [CI checks](.github/workflows/ci.yml). Pull requests and other branch pushes run CI without publishing.

CI checks Go formatting/vet/race tests with real PostgreSQL, builds the API/admin CLI, checks Svelte/TypeScript and client unit tests, runs Chromium/WebKit UI and production/offline checks, and builds both production Docker images. Browser reports and failure traces/screenshots are retained for seven days. Test jobs use disposable databases, synthetic accounts, and local provider stubs; they need no production secrets or paid AI keys. See [CI setup and local reproduction](docs/CI.md). A hosted run and image publishing remain unverified until the workflows are committed and pushed to GitHub. Server deployment is not configured.

## Implementation references

- [Live API contract](docs/api/contract.md)
- [Backend execution plan](BACKEND_IMPLEMENTATION_PLAN.md)
- [Nutrition execution plan](NUTRITION_IMPLEMENTATION_PLAN.md)
- [CI execution plan](CI_IMPLEMENTATION_PLAN.md)
- [Original product plan](IMPLEMENTATION_PLAN.md)
- [Mock contract](frontend/docs/MOCK_API.md)
- [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node)
- [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
