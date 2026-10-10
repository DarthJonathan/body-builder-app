# BodyBuilder — Agent Execution Plan

Updated: 10 October 2026 (Asia/Singapore)

Status: the frontend mock milestone and draggable-sheet polish are complete. The real Go/PostgreSQL backend is implemented and the frontend now uses it by default. See `BACKEND_IMPLEMENTATION_PLAN.md`, `docs/api/contract.md`, and `docs/LIVE_VERIFICATION.md` for the live implementation and checks. The user approved deterministic nutrition calculation, food database logging, and explicit optional AI on 10 October 2026; `NUTRITION_IMPLEMENTATION_PLAN.md` freezes that execution contract. Physical-device acceptance and external hosting remain separate from the local implementation.

## 1. Confirmed requirements

| Decision | Requirement |
| --- | --- |
| Audience | Anyone can create an account and sign in |
| Initial users | Nathan and Ivana; initially only they will use the app |
| Name | BodyBuilder |
| Accounts | Individual accounts; each person's data remains private, with no Nathan/Ivana allowlist |
| Persistence | Go backend with data synced across devices |
| Frontend | SvelteKit + TypeScript; the user permits either SvelteKit or React |
| Backend reference | Follow the architecture of `/Users/nathan/Development/expense_tracker` |
| First release | All five tabs: Lessons, Nutrition, Dashboard, Workout, Progress |
| Appearance | Follow the supplied screenshots as closely as possible, ideally exactly |
| Feel/devices | Installable PWA for both iPhone and Android; use the iPhone reference geometry and responsive layouts |
| Design framework | Bits UI accessible, unstyled primitives with custom screenshot-matched CSS; Lucide Svelte icons |
| Lessons | A personal library of lesson links and notes, plus researched free/open content sources |
| Starter programs | Find templates online; offer a template chooser instead of assigning the screenshot programs to accounts |
| Set effort | Self-selected Easy / Medium / Hard labels; independent of whether the set is complete |
| Nutrition targets | Calculate calories/macros and allow manual overrides |
| AI | Answer questions and estimate meal nutrition from photos |
| AI configuration | An admin can configure OpenAI, Anthropic, or OpenRouter API keys and models on the Go backend |
| Check-ins | Daily; weight and notes only |
| Excluded features | Step tracking and progress-photo uploads are outside this release |
| Header account control | Opens account information/settings, not a trainer chat |
| Quality | Backend tests and browser UI tests are explicitly required |
| Ambiguity | Ask the user when product behavior is unclear; do not invent requirements |
| Workflow | Create this Markdown plan before further feature implementation or agent execution |

Use **BodyBuilder** in the page title, account screen, PWA manifest, and installation metadata. Retain existing internal module/schema identifiers unless a technical migration requires changing them.

## 2. Current repository state

The original repository contained only `LICENSE`. The following foundation has now been created:

- `frontend/`: SvelteKit 5, TypeScript, Bits UI, custom screenshot-style CSS, all five tabs/details, live same-origin Go API client, account-specific IndexedDB snapshots/outbox, explicit conflict resolution, Node adapter, and PWA manifest/icons. Mock mode remains an explicit test/preview option.
- `backend/`: Gorilla mux/controller/service/DAO Go API with GORM/PostgreSQL, bcrypt/JWT authentication, fresh database role checks, validated account records, transactional revisions/retry receipts, food search, and encrypted administrator-controlled AI providers.
- `docker-compose.yml`: separate training database, backend, and frontend services. Defaults use ports 5433, 8081, and 3000.
- `README.md`: actual live capabilities, development/admin setup, isolated database/browser checks, and remaining limits.

Backend routes include health, registration/login, account identity, snapshots, mutations, catalogue/templates/readings, food search, provider administration, AI questions, and meal-photo drafts. The exact contract is in `docs/api/contract.md`. PostgreSQL runs locally on the dedicated BodyBuilder port/database; tests use disposable schemas in that database.

Verified on the foundation:

- `frontend`: `npm run check` and `npm run build` pass.
- `backend`: `go test ./...` and `go vet ./...` pass.
- Authentication tests cover malformed/expired tokens, signer/algorithm/audience restrictions, identity validation, password preservation, and invalid or oversized JSON requests.

Completed fixture frontend milestone (retained separately from real accounts):

- Five tabs plus workout preview, active-session logging/restoration/history, program editing and template selection/scheduling, food CRUD/copy/search, dated manual target overrides, daily weight-and-notes check-ins, progress summaries, lesson link/notes CRUD/discovery, and account preferences/switching.
- The async `TrainingClient` contract in `frontend/src/lib/domain.ts` and mock adapter in `frontend/src/lib/mock/`. Saved local records are isolated by preview email. No real passwords, provider keys, provider requests, or backend calls are used by this preview.
- Ten passing reproducible mock-client tests in `frontend/scripts/test-mock-api.mjs`, including persistence, rejected mutations, account isolation, session snapshots, date uniqueness, template copies, and AI drafts that do not auto-save food.
- All 60 mobile Chromium/WebKit Playwright cases pass, including account switching, private draft cleanup, midnight date rollover, persistence, responsive navigation, draggable sheets, and deterministic screenshot captures. Seven WebKit captures and the verified in-app sheet capture are saved under `frontend/docs/screenshots/`; these are review artifacts, not approved visual golden baselines.
- Both production PWA checks pass with a dedicated proxy origin dropping all network connections. Each engine proves an uncached fetch fails before cached shell/image reloads and local workout/check-in edits. These tests verify local preview persistence, not real backend synchronization or physical-device installation.
- Live development/preview origins are `http://localhost:5174` and `http://localhost:4174`; fixture tests use 5175/4175 and live tests use 5176/4176. The in-app browser had an expense-tracker shell cached on the default Vite origin, causing the original blank page. Keep local app origins separate instead of clearing another application's storage.
- Locally bundled exercise photographs/source guides with provenance, plus temporary original vector hero/anatomy art. Some exercise demonstrations show related variations; their source names are shown in the guide.

Remaining boundaries:

- The approved calculator and keyless USDA extension follow `NUTRITION_IMPLEMENTATION_PLAN.md`; keep dated/manual overrides and review before applying.
- Actual paid AI responses and external food-provider availability are not claimed by local stub tests. The administrator must configure a valid key and compatible model to use AI.
- Physical-device installation/camera/keyboard/background behavior. Desktop browser emulation and a successful PWA build do not verify these.

Continue from this implementation. Do not rebuild the project or modify `expense_tracker`.

## 3. Confirmed nutrition decision and implementation boundaries

The user approved regular calculation and food-database tracking with AI behind explicit actions on 10 October 2026.

| Decision | Affected work | Execution rule |
| --- | --- | --- |
| Use the proposed Mifflin–St Jeor calculator with adjustable activity/goal settings and weight-based protein; make AI optional | Nutrition calculation and food logging | Follow `NUTRITION_IMPLEMENTATION_PLAN.md`; request personal inputs explicitly, preview before Apply, keep manual provenance, and never invoke AI from a failed food search |

The user delegated research/selection of workout templates, lessons, and food data sources. Use the recommendations below and retain provenance; do not ask them to select an undocumented API. Camera meal estimation is confirmed. Barcode scanning has not been requested as a release requirement; it is a possible later use of the food adapter.

Weight and notes are the only check-in fields. Do not add energy/recovery questionnaires. Do not add steps or progress-photo controls just because they appear in a reference. Meal-photo input belongs to Nutrition and remains in scope.

The screenshots contain historical dates, body weight, calorie goals, streaks, and completed workouts. Use these only in clearly identified visual test fixtures until the user confirms personal defaults. Application dates must follow the selected date and user's timezone rather than the screenshots' fixed dates.

## 4. Reference screens and visual acceptance

Original reference directory: `/Users/nathan/Desktop/Ivana's Training app/`.

| Screen | Main references |
| --- | --- |
| Dashboard: week strip, checklist, insight, check-in, tabs | `IMG_5282.PNG` |
| Nutrition: empty/populated day, calorie/macro bars, meals | `IMG_5283.PNG`, `IMG_5284.PNG` |
| Workout: program header, hero, weekly schedule | `IMG_5285.PNG`, `IMG_5286.PNG`, `IMG_5287.PNG` |
| Workout preview: muscle cards, exercises, supersets, actions | `IMG_5281.PNG`, `IMG_5288.PNG`, `IMG_5289.PNG` |
| Active workout: sets, previous results, kg/reps, effort, notes, rest | `IMG_5295.PNG`, `IMG_5296.PNG` |
| Program creation/review and exercise grouping | `IMG_5291.PNG`, `IMG_5292.PNG`, `IMG_5294.PNG`, `IMG_5297.PNG`, `IMG_5299.PNG`, `IMG_5301.PNG`, `IMG_5302.PNG`, `IMG_5303.PNG` |
| Progress: goal, weight, nutrition, consistency | `IMG_5290.PNG`; omit the excluded steps and progress-photo cards |
| Lessons | No screenshot supplied; use the same visual language for the confirmed library |

Implementation requirements:

- Build live components, not screens made from whole screenshot images.
- Match dark backgrounds, blue actions, card radii, typography, spacing, icon weight, borders, macro colors, and the five-tab order.
- Keep tab navigation and relevant workout actions anchored above the device safe area.
- Preserve the reference's horizontal muscle-card scrolling, meal expansion, grouped supersets, and hierarchical headers.
- Match the reference with deterministic test data at a 393 × 852 viewport, correcting for device status-bar space. Do not imitate the phone's system clock, battery, or network indicators in the web page.
- Inspect small phones, larger phones, landscape, and desktop for clipping and overlap. Desktop adaptation must retain the app's visual language.
- Use accessible dialog/sheet primitives from [Bits UI](https://bits-ui.com/docs/introduction) where they help. Its unstyled components permit the reference styling; do not adopt a framework's default visual theme.
- Preserve supplied originals. Resolve the exercise/muscle/hero asset approach before declaring visual parity; report any asset differences explicitly.

## 5. Functional work packages

### Dashboard

- Select a day from the week strip; move between weeks and return to today.
- Show checklist state from actual weight entries, food logs, and completed scheduled sessions for the selected day.
- Open the corresponding weight, food, or workout flow from each checklist row.
- Show actual streak/checklist counts; define and test their calculation.
- Use real user goals and records for insights. No fabricated coaching messages or metrics.
- Show the daily check-in for the selected calendar date. Create/edit weight and notes, persist completion, and expose past check-ins.
- Link the check-in weight to the day's weight record so the same measurement does not create duplicate Progress entries. Define one check-in per user/calendar date and make repeated saves idempotent.

### Workout and program management

- Create/edit a program and workout days; assign workouts to calendar dates and handle rest days.
- Offer the online-sourced starter templates in Section 6, with source, equipment, frequency, and a preview. Copy a chosen template into the user's editable program only after the user selects it and training dates.
- Add, remove, replace, and reorder exercises. Configure set count, rep/time ranges, rest duration, and superset groups.
- Provide program review, workout preview, muscle targets, exercise details, and warm-up views matching the supplied layouts.
- Obtain muscle percentages from an explicit data model/source. Do not invent an undocumented percentage algorithm.
- Start a session from a snapshot of the workout prescription so later program edits do not rewrite workout history.
- Log weight, repetitions or hold duration, completion, exercise notes, and optional `easy`, `medium`, or `hard` effort. Show a small choice sheet from the Effort control. Do not translate these labels into RPE/RIR numbers.
- Show previous results from the user's actual session history.
- Add/remove sets, expand/collapse exercises, and finish or resume a workout without duplicating its completion.
- Persist every edit locally. Restore the active session after navigation, refresh, offline use, or browser suspension.
- Calculate elapsed/rest times from timestamps and deadlines, rather than counting interval callbacks.

### Nutrition

- Keep the selected date consistent with Dashboard.
- Show consumed/remaining calories, macro bars, full breakdown, and Breakfast/Lunch/Dinner/Snacks totals.
- Add/edit/delete food entries and quantities; persist explicit nutrient values and compute daily totals consistently.
- Support copying entries to another date with confirmation of the target date.
- Search must return genuine catalogue/custom-food data and support empty/error states.
- Keep food-provider credentials on the backend. Document provider units, missing nutrient fields, request limits, and source attribution.
- Show a calculation preview from entered profile/goal inputs; save dated targets and permit individual calorie/macro overrides. Recalculation must not silently overwrite manual values or historical targets.
- Implement the reference camera action as capture/file upload → AI estimate → editable portions and nutrients → explicit save to a selected meal/date. An AI response alone must never create a food entry.

### Progress

- Record/edit dated body-weight entries; show history, trend, and changes for the chosen interval.
- Set/edit the user's goal and its start date without seeding personal measurements from the screenshots.
- Derive nutrition adherence and workout consistency from records and scheduled past workouts. Exclude future dates/rest days from workout consistency and avoid double-counting repeated completions.
- Support expandable cards/charts with clear empty states.
- Show daily check-in history, weight and notes only. Keep its measurement consistent with weight history.
- Omit step tracking and progress-photo upload cards. Do not build those models, upload galleries, or wearable integrations for this release.

### Lessons

- Create, edit, delete, search, and organize personal lesson links and notes.
- Store title, URL, notes, category/tags, source, and saved/completed state as private user data.
- Support text-only lessons and external article/video links.
- Display external content provenance and source links. Escape/sanitize imported descriptions.
- Keep saved notes and permitted imported text usable offline; indicate when external videos/articles require a connection.
- Include the exercise-guide catalogue and curated article links selected in Section 6. Keep a clear distinction between shared discoverable guides and a user's private saved lessons/notes.
- Import through a separate adapter. Provider outages must not block the user's library or workout logging.

### Account and admin settings

- Both top-right account controls in the reference open account information/settings. Use the user's avatar/initials; do not display an invented trainer or online-status signal.
- Edit display name, timezone, units, nutrition profile, and user goals; show session/sync status and sign out.
- Add an admin-only provider-settings screen for API keys, enabled provider, model, connection test, and usage limits. Ordinary users must never read or change provider credentials.
- Keep public registration available. Grant administrator status through a documented server-side management command to an explicitly selected account; do not make the first public registrant an admin.

### AI assistance and meal estimation

- Support an authenticated question/answer flow using the configured provider. Do not repurpose the account button as this entry point; preserve five navigation tabs.
- Send only the user's submitted question and explicitly selected context. Render answers safely, and label provider failures/unsupported capabilities accurately.
- For meals, return typed draft items with food name, quantity/unit, calories, protein/carbs/fat, assumptions, and estimate status. Validate values server-side and allow corrections before saving.
- Where possible, let users replace estimated nutrients with a selected food-database match. Preserve whether saved nutrient values came from a database, a manual entry, or an AI estimate.
- Bound image bytes/dimensions and request durations. Use authenticated uploads; do not expose meal photos as public static files or send them to Open Food Facts' public contribution endpoints.
- Offline users can continue logging foods/workouts; online AI calls need a connection. Do not claim a local photo upload has been analyzed while offline.

## 6. Selected research and integration recommendations

Research date: 9 October 2026. The user asked us to find sources. These are implementation recommendations based on the cited primary sources, not claims that integrations already work.

### Workout templates

| Starter option | Primary source | Implementation |
| --- | --- | --- |
| Four-day upper/lower | [Muscle & Strength: Upper/Lower 4 Day Bodybuilding Workout](https://www.muscleandstrength.com/workouts/upper-lower-4-day-gym-bodybuilding-workout), by Steve Shaw | A gym routine using upper/lower days and common gym equipment. This matches the reference's broad program structure. Keep source attribution and offer editable prescriptions rather than adopting screenshot account data |
| Three-day beginner full body | [The Fitness Wiki: Basic Beginner Routine](https://thefitness.wiki/routines/r-fitness-basic-beginner-routine/) | Two alternating full-body workouts, typically three lifting days each week. Preserve the source's final-set AMRAP flag in template metadata rather than pretending it is a fixed rep range |

Bundle small versioned template records with source URL, reviewed date, exercises, prescriptions, required equipment, and progression notes/links. The sources are free to read; do not label them open-source APIs or redistribute their complete articles/images. Users must preview/select a template before it becomes a private program. Screenshot programs remain deterministic visual fixtures, not account defaults.

### Lessons and exercise guides

Use **Free Exercise DB** for a version-pinned exercise-guide catalogue and **curated external lesson links** for training concepts. Start the link collection with [ACE's beginner resistance-training guide](https://www.acefitness.org/resources/everyone/blog/8650/resistance-training-workouts-for-beginners/) and [ACE's exercise library](https://www.acefitness.org/resources/everyone/exercise-library/), together with the original routine explanations above. Store short app-authored descriptions and source links; personal notes remain editable/private. These article sources are free to read, not a verified curriculum API.

| Candidate | Verified offering | Access/terms and fit |
| --- | --- | --- |
| [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) | 800+ exercises with instructions, muscles/equipment, and start/end images; JSON can be used locally | Repository marked [Unlicense](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md). A bundled, version-pinned catalogue suits offline exercise guides. This is a dataset, not a managed course API |
| [wger](https://github.com/wger-project/wger) | Open-source workout system with a JSON API and exercise content | [Official API docs](https://wger.readthedocs.io/en/latest/api/api.html) say public exercise/ingredient endpoints need no authentication. Application code is AGPL; content has per-entry Creative Commons terms. Keep content-license/source metadata. Live endpoint accessibility was not verified in this session |
| [ExerciseDB free API](https://oss.exercisedb.dev/docs) | 1,500 exercises, instructions, metadata, and 180p GIF demonstrations | Documentation permits personal/non-commercial use, requires attribution, and specifies strict rate limits. Commercial use needs a paid plan. Confirm suitability for the intended app usage before adoption; initial use by two people does not define the app's audience |
| [YouTube embeds](https://developers.google.com/youtube/player_parameters) | Playback of selected videos/playlists through an iframe | Useful for user-added lesson links. Basic iframe playback does not require using the separate Data API. Automated video search is a separate [API integration](https://developers.google.com/youtube/v3/getting-started) with setup and quota requirements |

Adopt Free Exercise DB plus the linked reading collection for this release. Keep wger and ExerciseDB as researched alternatives, not required runtime dependencies. Do not make Lessons depend on an LLM or a paid video-search API.

Provider implementation tasks:

1. Verify the current schema and availability with a small live request before coding against it.
2. Pin imported dataset versions and preserve the original source/license metadata.
3. Normalize provider IDs into internal catalogue IDs; keep user exercises and custom notes separate.
4. Make imports repeatable and idempotent. Do not overwrite user edits when updating a catalogue.
5. Test missing media, unavailable providers, malformed records, filtering, and cached/offline behavior.
6. Do not download external videos or assume every source permits offline redistribution of its media.

### Food search

| Source | Verified offering and access | Integration choice |
| --- | --- | --- |
| [USDA FoodData Central](https://fdc.nal.usda.gov/download-datasets/) | Downloadable public-domain/CC0 datasets; API access separately requires a data.gov key | Bundle the pinned SR Legacy April 2018 ingredient release with source IDs, checksum and reproducible importer. Search it locally without a key. The online USDA API is not required by this release |
| [Open Food Facts](https://openfoodfacts.github.io/openfoodfacts-server/api/) | Product nutrients and packaged-food search; reads require a custom app User-Agent, no API key. Database is ODbL with separate content/image terms | Use for packaged foods, with source/license metadata and a separately identified cache. Current docs recommend v3 and limit search to 10 requests/minute/IP and product reads to 15/minute/IP; recheck before implementation |

Submit searches explicitly, share a bounded backend cache, and enforce a provider request budget because backend users share the outgoing IP. Do not call Open Food Facts on every keystroke. Normalize per-100g/per-serving values and known units, retain missing values as unknown, and preserve provider IDs. Keep custom food entry available when providers are unavailable. Test the documented schema with a small real request before fixing adapter types. Provider databases supply nutrients; meal-photo recognition uses the configured LLM.

### Approved nutrition calculation policy

Use the deterministic, versioned calculator approved on 10 October 2026. The [original Mifflin–St Jeor study](https://ajcn.nutrition.org/article/S0002-9165(23)16698-6/abstract) gives the simplified adult resting-energy equations: `10 × weightKg + 6.25 × heightCm − 5 × ageYears + sexConstant`, with `+5` for the male formula and `−161` for the female formula.

- Ask for formula inputs explicitly; do not infer formula sex, age, activity, or body measurements from names or screenshots. Store formula choice separately from display identity.
- Compute estimated maintenance as resting energy × a user-selected activity factor. The [NIDDK planner](https://www.niddk.nih.gov/bwp) describes physical-activity levels around 1.4–2.5; BodyBuilder's simple estimator is not the NIDDK dynamic model.
- Show an adjustable calorie goal offset for gain/maintain/loss. Do not invent a fixed weekly gain rate or auto-adjust targets based on a single daily check-in.
- Use editable protein-per-kg and fat-share settings, and calculate carbohydrates from remaining calories. The [ISSN protein position stand](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/) supports a 1.4–2.0 g/kg/day range for most exercising people; any chosen default inside that range is an app policy, not an individually measured need.
- The default activity mapping, goal offsets, protein setting, fat share, rounding, bounds, and effective dates are frozen in `NUTRITION_IMPLEMENTATION_PLAN.md` and `docs/api/contract.md`. Make the starting settings visible/editable in the calculator preview. The shared JSON fixtures must reproduce the same numbers in Go and TypeScript.
- Use 4 kcal/g for protein/carbohydrates and 9 kcal/g for fat in target allocation; preserve provider-labelled calories in actual food logs, since food labels may differ. Reject impossible allocations instead of returning negative carbohydrate targets.
- Manual overrides are durable and dated. Keep calculation inputs/version/result for reproducibility; applying a new estimate changes future selected targets, not historical records.

### AI providers

| Provider | Verified integration surface | Adapter requirement |
| --- | --- | --- |
| OpenAI | [Images and vision](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Use Responses API with an admin-selected vision-capable model for meal photos; validate a constrained draft-nutrition schema, refusals, incomplete responses, and numeric bounds |
| Anthropic | [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) | Use Messages API image content blocks and its provider-specific request/response shape; do not send an OpenAI request format unchanged |
| OpenRouter | [Official image-input guide](https://openrouter.ai/blog/tutorials/send-image-to-llm/) | Select a model whose advertised input modalities include images. Capability-check structured output/image support; validate returned JSON regardless of model support |

Keep API keys encrypted at rest using a server-managed encryption key, masked in settings, absent from API read responses/logs/client bundles, and out of IndexedDB and the user-record sync feed. Restrict outgoing provider base URLs to supported services; configure models server-side. Test enable/disable/rotation, missing or rejected keys, exhausted usage budgets, timeouts, malformed results, unsupported vision, and provider failures. Do not silently switch providers and incur charges on a different configured key.

## 7. Architecture and data contract

Follow the useful structure of `expense_tracker`: SvelteKit same-origin proxy → Go controllers/services → GORM/PostgreSQL, with an IndexedDB client layer. Reuse patterns, not the expense application's business tables, credentials, database state, or user accounts.

Before parallel feature work, the coordinator must write the shared TypeScript domain types and a versioned API/sync contract. Proposed resource groups:

- Account/profile/settings and explicit user goals.
- Exercise catalogue and private custom exercises.
- Programs, workout prescriptions, superset groups, and schedule entries.
- Workout sessions, exercise snapshots, and logged sets.
- Foods, meal entries, dated nutrition targets, and reproducible calculation inputs/overrides.
- Weight entries.
- Personal lessons and lesson progress.
- Daily weight-and-notes check-ins, linked to dated weight records.
- Administrator roles and encrypted provider settings, outside personal-record sync.
- Bounded AI requests/draft meal estimates and authenticated temporary meal-image handling. Progress-photo galleries and steps are excluded.

Registration and login must work for any valid user, without hardcoded accounts or an email allowlist for Nathan and Ivana. Keep user identity server-derived. Require authentication on private reads and writes, and verify ownership of referenced resources. Catalogue content may be shared read-only; personal logs/programs/notes must be scoped to the authenticated user.

Document date-only fields separately from timestamps. Store timestamps consistently; use the user's timezone for calendar days and display. Use explicit units for weight, nutrition, durations, and effort.

Use explicit typed domain records and validations rather than an unrestricted JSON document store. The initial contract must describe effort as `easy | medium | hard | null`, template-to-private-program copying, check-in/weight linkage, target effective dates and manual overrides, and AI drafts that have no effect on logs until the user saves them. Include a route/error table, pagination, examples, enum/number/date validation, and revision/conflict semantics.

### Offline storage and device sync

- Save edits to IndexedDB and a durable outbox in one transaction. Wait for transaction completion before reporting “saved.”
- Partition records and checkpoints by authenticated user. Account switches must not display or upload another person's data.
- Use client-generated IDs for offline creation, server-issued record versions, and soft-deletion tombstones.
- Upload bounded batches with the base version last acknowledged by the device. The backend must check this version transactionally.
- Detect simultaneous device edits; expose a real conflict choice rather than silently selecting by device clocks.
- Make retries idempotent, preserve edits made while a request is in flight, and only remove acknowledged outbox changes.
- Download updates with a paginated server cursor. Persist received records and checkpoints atomically.
- Show saved/pending/sync-failed/conflict/session-expired states without interrupting offline workout entry.
- Handle connectivity changes, backend failures, token expiry, refresh, and storage failures explicitly.

### Native web behavior

- Installable standalone manifest, correct app icons, HTTPS in hosted environments, and iOS safe-area handling.
- Treat iPhone Safari/installed mode and Android Chrome/installed mode as equal release targets. Installation flows differ: iPhone uses the browser Share menu; show platform-appropriate guidance rather than relying on an iOS install-prompt API.
- Production service-worker tests for the shell and required static assets. Exclude private API responses from public caches.
- Defer service-worker activation while a workout is active or local changes are unsaved; provide an update action when safe.
- Fast tab changes, preserved scroll/state, predictable back navigation, touch-sized controls, and accessible numeric inputs.
- Request/reacquire a screen wake lock during an active workout where supported; show its actual state and allow disabling it.
- Respect reduced-motion settings and keyboard/focus behavior.
- Verify rest timer recovery after suspension. Do not promise native background alarms, HealthKit, or wearable integration without a separate implementation decision.

Relevant platform references: [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [screen wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), and [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node).

## 8. Agent ownership and execution order

Use one coordinator plus up to three worker agents. The agents share a filesystem: disjoint ownership is required, and dependent work must wait for its contract.

### Completed milestone — frontend with mocked API calls

The user requested the frontend first, then approved the backend after polish. The following steps describe the completed frontend milestone; current live work follows `BACKEND_IMPLEMENTATION_PLAN.md`.

1. Freeze typed frontend domain records and async API adapter shapes. Mock fixtures are clearly identified preview data and are never assigned to a real account.
2. Implement mock request/response behavior, local preview persistence, all five screens/details, and edit/error/loading flows without requiring PostgreSQL or real API keys.
3. Include working preview interactions for workouts, daily weight/notes check-ins, foods/targets, lessons, account settings, and AI draft review. Mark simulated AI results as preview estimates. Never capture/store a real provider key in the mock app.
4. Add and run Playwright UI/persistence/responsive tests for mobile Chromium and WebKit. Inspect rendered screens against the attached references.
5. Deliver a runnable local frontend for polish. Production accounts, sync, provider calls, and real database/backend tests are the subsequent milestone; do not report mock tests as verifying them.

For that milestone, worker A owned mock API/state integration, worker B owned mobile screens/styles, and worker C owned browser tests/configuration. The current live ownership is recorded in `BACKEND_IMPLEMENTATION_PLAN.md`; it supersedes the proposed assignments below.

### Phase 0 — Coordinator: settle contracts and unblock work

- Follow the approved nutrition-calculator policy in `NUTRITION_IMPLEMENTATION_PLAN.md`. The questions listed in the earlier plan have been answered or delegated to source research; do not ask them again.
- Freeze the first domain/API/sync contract in `docs/api/contract.md`, shared types in `frontend/src/lib/domain.ts`, and the application-state interface before screens/backend/state agents implement against it. Provide deterministic screenshot fixtures separate from real account defaults.
- Pin the selected exercise catalogue/templates/reading links, check source schemas, and document reference asset mappings. Report any image-style differences before claiming exact visual parity.
- Add shared dependencies and test scripts; own package/lockfile changes and root Docker configuration.
- Establish a working isolated PostgreSQL test service. Never run integration tests against the expense tracker database.
- Update this plan with answers and implementation status.

### Agent A — Go backend and backend tests

Ownership: `backend/**`, plus its API contract documentation under `docs/api/**`.

Tasks:

1. Extend authentication with persistent-session support as agreed with the coordinator, appropriate auth rate limits, and tested error behavior.
2. Implement typed resource validation, ownership, migrations, and services for the confirmed resource groups.
3. Implement the versioned sync protocol, conflict responses, pagination, tombstones, and retry behavior.
4. Implement the selected exercise/lesson/template and food-provider adapters, daily check-in linkage, and the agreed nutrition calculator with durable overrides.
5. Implement admin-only encrypted AI-provider configuration, role management, Q&A/meal-estimate adapters, bounded temporary image handling, and provider budget/error behavior.
6. Add real PostgreSQL integration tests in isolated temporary schemas alongside unit/controller tests; use local stub HTTP servers for external provider tests.
7. Publish example requests/responses and report required configuration/migrations to the coordinator.

Acceptance: backend test matrix passes, migrations are repeatable, user isolation is demonstrated, and sync cannot silently overwrite a concurrent edit.

### Agent B — Mobile screens and reference styling

Ownership: `frontend/src/lib/components/**`, `frontend/src/routes/+page.svelte`, `frontend/src/styles.css`, and approved static visual assets.

Tasks:

1. Build reusable headers, tabs, cards, buttons, macro bars, exercise rows, sets, and Bits UI sheets/dialogs.
2. Implement all five tabs and their confirmed flows against the frozen state interface, including the template chooser and daily weight/notes check-in.
3. Match the provided screenshot layouts, including workout preview, program review, and active-session screens.
4. Implement empty/loading/error states, accessibility, touch/keyboard behavior, and responsive layouts.
5. Inspect screenshots at the reference viewport and correct material visual differences.
6. Build account/admin settings, AI Q&A, and editable meal-estimate review using the same visual system. Preserve the account button's purpose and omit excluded steps/progress-photo controls.

Acceptance: confirmed controls have working outcomes, all five tabs are coherent, reference fixtures match closely, and no content is hidden under persistent controls.

### Agent C — Offline state, PWA behavior, and UI tests

Ownership: `frontend/src/lib/**` excluding `components/**`, `frontend/tests/**`, `frontend/src/routes/+layout.svelte`, `frontend/vite.config.ts`, and frontend test configuration. Coordinate changes to existing `api.ts`.

Tasks:

1. Implement durable user sessions, IndexedDB records/outbox/checkpoints, application state, and sync lifecycle.
2. Implement timestamps/deadlines for workout and rest timers, session restoration, and account isolation.
3. Implement service-worker update handling, offline availability, install guidance, and supported wake-lock behavior.
4. Add Playwright functional, persistence, offline, accessibility, and visual-regression tests.
5. Connect at least one full browser test path to the real Go API and isolated PostgreSQL service.

Acceptance: locally acknowledged data survives reload/offline use, conflicts and failures remain visible, account data stays isolated, and production-build browser tests pass.

### Coordinator integration

- Resolve contract changes before multiple agents edit dependent code.
- Agents request dependency/root-config changes from the coordinator instead of independently rewriting shared lockfiles.
- Integrate completed work, inspect real browser behavior, run the required checks, and resolve failures.
- Require each agent to report changed files, commands/results, unresolved decisions, and material limitations.
- Keep `expense_tracker` unchanged. Do not publish or deploy as part of implementing this plan unless deployment is requested.

## 9. Mandatory verification matrix

### Backend

- Registration/login for arbitrary valid users, duplicate email, invalid JSON/input, expiry, incorrect signer/algorithm/audience, and auth rate limiting. Nathan and Ivana are initial users/test fixtures, not an access restriction.
- Cross-user reads/writes, nested-reference ownership, and private-media access if included.
- Program edits, schedule changes, session snapshot preservation, completion idempotence, and numeric/unit validation.
- Nutrition totals/quantities, dated weight records, and lesson-link validation.
- Daily check-in uniqueness, edits, user/timezone/date isolation, and consistent linked weight history without duplicate measurements.
- Calculator formula/units/rounding, missing inputs, impossible macro allocations, effective dates, and manual overrides that survive recalculation and device sync.
- Template copy isolation and repeat imports without modifying an existing user's program or notes.
- Sync retries, duplicate requests, concurrent writers, stale base versions, deletions, cursor pagination, transaction rollback, and isolation between accounts.
- Additive/idempotent migrations against a fresh isolated PostgreSQL schema.
- Provider errors/timeouts, malformed content, source metadata, and cache fallback.
- Admin authorization, explicit role assignment, encrypted key storage/rotation, no credentials in response/log/sync payloads, and bounded provider usage by arbitrary registered users.
- All three AI adapters using local HTTP stubs; image limits/type validation, unsupported vision, partial/refused/malformed/invalid results, and no automatic food-log writes from an estimate.

### Browser UI (Playwright)

- Register/sign in/sign out; session restoration and switching accounts without data crossover.
- Navigate all five tabs, navigate back from details, choose dates, and return to today.
- Preview/select/copy a starter template; create/edit/schedule a workout; start a session; log/add/remove sets; write notes; choose Easy/Medium/Hard effort separately from completion; finish; inspect history/progress.
- Reload during a workout and after food/weight/lesson edits; verify durable state rather than only rendered labels.
- Advance a controlled clock to test rest/elapsed timers and recovery from an expired persisted deadline.
- Add/edit/delete/copy food entries and verify calories/macros/date isolation.
- Add weight records and verify trends/empty states.
- Submit/edit a daily check-in containing weight and notes only; verify Dashboard completion and a single consistent Progress weight entry.
- Enter nutrition-calculator inputs, inspect/save its preview, override targets, then recalculate/reload/sync and verify historical/manual values survive.
- Add/edit/delete/search lesson links and notes; verify cached content and provider-failure behavior.
- Open account information from the header; verify ordinary users cannot open/use admin configuration routes or read provider credentials.
- Admin configures a provider with stubbed keys; a user asks a question, uploads/captures a meal image, edits an estimate, and explicitly saves it to the selected meal/date. Test missing-key, offline, invalid-image, unsupported-model, and provider-error states. Deterministic automated tests must not need real paid API calls.
- Load the production build online, then offline, reload, record edits, reconnect, and verify server persistence. Do not count Vite dev-server behavior as an offline PWA test.
- Use two browser contexts to verify device sync and conflict resolution with the real backend.
- Check keyboard/focus handling, labelled controls, dialogs, and no page errors.
- Capture deterministic visual screenshots for each reference screen at 393 × 852; inspect 320px, larger phones, landscape, and desktop for overflow/overlap.
- Run both mobile WebKit and mobile Chromium browser projects for the iPhone/Android targets. Emulation supplements real-device checks; it does not prove installation, native camera, keyboard, or operating-system suspension behavior.

Mocked API fixtures are suitable for deterministic UI and visual tests. They do not replace the real Go/PostgreSQL integration path. No skipped database/browser suite may be reported as passed.

Required completion commands, to be added as runnable scripts where needed:

```sh
cd backend
go test ./...
go test -race ./...
go vet ./...
```

```sh
cd frontend
npm run check
npm run build
npm run test:ui
npm run test:live
```

Integration test configuration must point only at a dedicated test database/schema. Browser tests should provide failure traces/screenshots and deterministic timezone/date fixtures.

## 10. Completion checklist

### Frontend with mocked API calls

- [x] Freeze the frontend `TrainingClient` contract and document local mock behavior.
- [x] Implement all five tabs and the confirmed detail/edit flows with async mock calls.
- [x] Keep simulated AI answers and photo estimates labelled, editable, and separate from saved food entries.
- [x] Implement per-email preview persistence, rejected-mutation behavior, and account-scoped navigation/draft cleanup.
- [x] Pass the ten mock-client tests, frontend type checks, and 60 mobile Chromium/WebKit checks.
- [x] Inspect the reference-sized screens and preserve seven WebKit review captures.
- [x] Complete production PWA offline verification and save the final verification report.
- [x] Deliver the local preview for visual polish; start Go training-domain work afterward.

### Live implementation after frontend polish

- [x] Inspect `expense_tracker` and choose a compatible stack.
- [x] Create account/API/PWA scaffold and initial backend tests.
- [x] Record confirmed requirements and unresolved decisions in this plan.
- [x] Research candidate free/open lesson-content sources.
- [x] Record BodyBuilder branding, daily weight/notes check-ins, labelled effort, AI Q&A/meal-photo estimation, account controls, and explicit feature exclusions.
- [x] Research online starter programs, lesson links, food APIs, and provider vision capabilities.
- [x] Freeze shared live contracts.
- [x] Resolve the nutrition-calculation policy.
- [x] Implement and verify all five tabs and confirmed detail flows; nutrition extension results are recorded in its execution plan.
- [x] Implement durable offline records and private device sync.
- [x] Integrate the selected lesson/exercise source.
- [x] Implement online-sourced templates, manual nutrition overrides, daily check-ins, food search, and admin-configured AI features.
- [x] Implement and verify the approved nutrition calculation, retained dated/manual provenance, keyless USDA search and explicit optional AI actions.
- [x] Complete backend, real database, and browser UI tests for implemented behavior.
- [x] Inspect rendered screens and save review captures; temporary artwork differences remain documented.
- [ ] Verify physical-device native behavior.
- [x] Update README with actual capabilities, setup, tests, and remaining limitations.
- [x] Deliver a working local preview and an accurate verification report.
