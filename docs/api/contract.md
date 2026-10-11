# BodyBuilder live API contract

Implementation contract for the real-backend milestone, updated 11 October 2026. The expense tracker is a read-only architecture reference: Go + Gorilla mux, controller/request/service/DAO layers, GORM/PostgreSQL, bcrypt/JWT, `{success,error,data}` responses, and a same-origin SvelteKit proxy. BodyBuilder owns its database and ports.

## Accounts and state

- `POST /api/v1/auth/register`: `{displayName,email,password}`; `POST /api/v1/auth/login`: `{email,password}`. Both return the existing `{token,expiresAt,user}` shape. Public registration creates a normal user, never an administrator. No personal preview fixtures are seeded.
- Authenticated calls use `Authorization: Bearer <token>`. `GET /api/v1/me` returns the authenticated account.
- `GET /api/v1/snapshot` returns the frontend `AppSnapshot`, plus integer `revision`. New accounts have empty programs, schedule, sessions, food entries, targets, check-ins, weights, and lessons; a default editable profile and public provider status are included.
- A user-scoped PostgreSQL JSONB training document is the transaction boundary for this small app. Its identity and revision are separate indexed columns. This keeps paired check-in/weight updates atomic and lets us reuse the existing frontend domain without serializing private records into public caches. Snapshot size is bounded.
- `POST /api/v1/mutations`: `{id,baseRevision,operation,payload}`. `id` is a client-generated retry key. Successful mutations return the new snapshot. A recorded retry is a no-op even after the revision advances. A stale base returns HTTP 409 with `{success:false,error,data:<current snapshot>,code:"revision_conflict"}` and makes no changes. A client must retain its draft/outbox and explicitly resolve conflicts; it must not silently replace another device's edit.
- Server locking, validation, and ownership apply to every operation. Never trust profile identity/role, session prescription/history, or references supplied by a client. Date-based records have one authoritative ID per account/date. Session completion is idempotent. Existing session prescriptions survive program edits.

| Operation | Payload |
| --- | --- |
| `updateProfile` | Allowed mutable profile fields; identity, email, and role are immutable |
| `saveProgram` | `Program` |
| `importProgram` | `{document: ProgramDocument}` |
| `useTemplate` | `{templateId}` |
| `assignWorkout` | `{date,workoutId}`; null means rest |
| `startWorkout` | `{date,workoutId}` |
| `saveSession` | `WorkoutSession`; immutable metadata/prescription checked |
| `finishSession` | `{sessionId,finishedAt?}`; optional RFC3339 stop time preserves offline duration, validated against start and server time |
| `saveFood` / `saveTargets` / `saveCheckIn` / `saveWeight` / `saveLesson` | Corresponding domain record |
| `deleteFood` / `deleteLesson` | `{id}` |
| `copyFoods` | `{fromDate,toDate}` |
| `createGoalPlan` | `{version:"goal-planner-v1",answers,targets,schedulePolicy:"keep-existing"\|"replace-upcoming"}` |
| `saveHealthEnergy` | `{energy:HealthEnergy\|null}`; null removes the current summary |

`Program` optionally carries `sourceName` (150 characters), `sourceReviewedAt` (YYYY-MM-DD), and `adaptationNote` (2,000 characters). `useTemplate` preserves these fields in a private copy, regenerates program/workout/prescription/superset IDs, and leaves the calendar unchanged. `saveProgram` validates and preserves provenance; older programs without these fields remain valid. A timed prescription (`seconds: true`) interprets logged `sets[].reps` as seconds and shows a seconds input in the frontend.

## Goal creation and health energy

`POST /api/v1/goals/preview` accepts authenticated `GoalAnswers` and returns `{version,program,targets,rationale}` without changing the snapshot, creating a receipt or calling AI. The versioned rules are bundled in the catalogue; the Go and TypeScript implementations share [golden cases](../fixtures/goal-plans.json).

Answers include goal/start date, training experience, exercise restrictions (`none` or `keep-current`), equipment (`full-gym` or `dumbbells`), 2–6 weekly days, 30/45/60-minute budget, balanced/glute focus, a compatible split, unique Monday-based weekday indices in workout order, nutrition familiarity, gentle/moderate pace, and the required nutrition inputs. Keeping current workouts requires an existing active program. The selected pace must match the calorie adjustment; recommendations and exact starting doses are disclosed app policy informed by linked primary research.

`createGoalPlan` verifies the answers and current preview provenance, including any manual override. It generates private program/workout/prescription IDs, selects the program, saves dated targets and starting goal metadata, fills 28 calendar days, and appends `goalPlans` in one revision/receipt transaction. Same-date nutrition targets retain their ID. Starts must be today through 28 days ahead in the account timezone. `keep-existing` preserves assigned dates; `replace-upcoming` replaces only unstarted dates. Dates with any session are protected. Previous programs, session prescriptions, food logs and earlier goal records remain unchanged. There is no automatic weekly adjustment.

`healthEnergy` is an optional private snapshot summary: `{source:"apple-health",syncedAt,timezone,sources,days:[{date,restingCalories,activeCalories,coverageHours,dayHours}]}`. It contains 7–14 unique completed days within one 14-day window, with explicit energy fields, resting 300–5000 kcal, active 0–8000 kcal, day length 23–25 hours and at least 90% resting time coverage. New sync/goal usage requires a sync within 24 hours (up to five minutes clock skew) and a latest day within three days. The native reader unions coverage intervals and requests read-only HealthKit statistics; permission denial and absent samples both leave the equation path available.

With `nutrition.healthEnergy`, the calculator uses `apple-health-energy-v1`: resting is the average resting energy and maintenance is average resting + active energy. The activity factor is not applied again; the same goal adjustment, rounding and macro policy follow. Saved history retains that summary as provenance. Removing the current summary does not rewrite dated targets or goal history. The standard Calculate Targets form explicitly returns to the equation path when prefilled from a Health-based goal. Private summaries never go to food providers or the LLM. See the [iPhone wrapper](../../native/ios/README.md) and [goal implementation plan](../../GOAL_ONBOARDING_PLAN.md).

## Providers and calculator

- `GET /api/v1/foods/search?q=...`: `Food[]`, with genuine source and serving units. Bundled USDA FoodData Central SR Legacy April 2018 records supply common ingredients without an API key. Local matches avoid upstream requests; unmatched packaged-food searches use keyless Open Food Facts. Your saved foods remain searchable during upstream failures. Saved-food search returns one serving, rather than a previous entry's quantity, and keeps original database attribution. A `FoodEntry` may retain `databaseSource` (maximum 1000 characters); its nutrients are totals for the reviewed quantity. Search never saves a food or invokes AI. Manual entry remains available. See the [pinned dataset and importer](../../backend/providers/README.md).
- `PUT /api/v1/admin/provider`: `{provider,model,enabled,apiKey?,dailyRequestLimit?}`. Settings are global and admin-only. Keys are encrypted at rest with a dedicated server encryption secret; no key is returned, logged, included in snapshots, or synced to a browser. `POST /api/v1/admin/provider/test` tests the saved configuration. Admin assignment uses a local management command for an explicitly named account.
- `POST /api/v1/assistant/question`: explicit **Ask AI** action, `{question}`; response `{answer,preview:false}`. Missing/disabled providers return a clear error. Calls have timeouts, bounded inputs/output, and per-user daily limits. Only the submitted question is sent, not the user's whole snapshot.
- `POST /api/v1/assistant/meal`: explicit **Estimate from Photo** → **Estimate Nutrition** action, multipart field `image`; response `{items,assumptions,preview:false}`. Validate image bytes/types/size and provider output. Returned estimates require review and explicit saving. All three providers have local HTTP-stub tests; tests use no paid calls or real keys. Provider failures never trigger automatic AI fallback.
- `POST /api/v1/nutrition/calculate`: authenticated, read-only calculation preview. It creates no mutation receipt, changes no snapshot/profile/revision, and consumes no AI quota. Only **Apply Targets** sends the revisioned `saveTargets` mutation. Invalid inputs return HTTP 400; do not silently clamp the estimate.

Calculator inputs are all required, including explicit zero adjustment:

| Field | Accepted values |
| --- | --- |
| `age` | Integer 18–100 |
| `sex` | `female` or `male`, explicitly selected equation |
| `heightCm` / `weightKg` | 100–250 cm / 30–350 kg; display-unit conversion happens before the request |
| `activity` | `sedentary`, `light`, `moderate`, `active`, `very-active` |
| `goal` | `build-muscle`, `maintain`, `lose-fat` |
| `effectiveDate` | Valid `YYYY-MM-DD` calendar date |
| `calorieAdjustment` | −500 to +500 kcal/day |
| `proteinPerKg` / `fatPercent` | 0.8–3 g/kg / 15–40% |

The frozen `mifflin-st-jeor-v1` policy uses resting calories `10*weightKg + 6.25*heightCm - 5*age + (male ? 5 : -161)`, with activity factors 1.2, 1.375, 1.55, 1.725 and 1.9 in the enum order. Target calories use the unrounded resting estimate × factor plus adjustment, rounded to the nearest 10; results outside 1000–10000 are rejected. Protein is rounded weight × protein-per-kg. Fat is rounded target calories × fat percentage / 100 / 9. Carbohydrates are rounded remaining calories / 4; impossible allocations are rejected. Food labels keep their own calorie values.

The UI exposes editable app starting settings (+250 gain / 0 maintenance / −300 loss, 1.6 g/kg protein, 25% fat); they are not measured personal requirements. Age, equation sex, height and activity are never inferred. A previous acknowledged measurement/calculator input may prefill weight. Weigh-ins do not automatically recalculate targets.

The response is `NutritionTargets` with a fresh ID, `mode:"calculated"`, `manuallyOverridden:false` and `calculation:{version,input,restingCalories,maintenanceCalories}`. The last two values are rounded to whole calories for display; intermediate math stays unrounded. The server validates new calculated saves against their provenance. A manual edit retains original calculation metadata with `mode:"manual"` and `manuallyOverridden:true`; for the same dated record the server preserves omitted provenance and rejects changed provenance. Explicit recalculation/apply can replace it. Earlier dates and legacy records without metadata remain readable. The identical browser calculator provides an offline preview only on transport failure; API validation/server errors remain visible. See the [execution policy](../../NUTRITION_IMPLEMENTATION_PLAN.md) and [shared golden fixtures](../fixtures/nutrition-calculation.json).

## Frontend modes and durability

The live HTTP adapter is the default. Explicit preview mode (`PUBLIC_API_MODE=mock`) retains the existing fixtures and tests; this is a build-time setting. Live mode has registration/password sign-in, a persisted authenticated session, per-user IndexedDB snapshot/outbox, offline edits to existing records, visible pending/conflict/error states, and refresh on focus/online. A queued operation's retry ID/base revision survive reload. New server-generated template/session/copied-food IDs require acknowledgement before dependent edits. Signing out clears visible private drafts; another account never receives the prior account's records. Private API responses remain excluded from service-worker caches.

Existing mock browser tests run on dedicated mock ports. Real end-to-end tests start a live frontend, real Go service, and an isolated PostgreSQL schema, then verify registration, persistence, device sync, conflicts, offline replay, and all five tabs. Production offline checks use the built production PWA. Report external-provider and physical-device checks separately.


## Structured program upserts and shared library

[Program documents and examples](../programs/README.md) use `bodybuilder.program.v1` with a stable key and increasing content version. The document carries description, audience/equipment/frequency/time, focus/purpose, progression and stall instructions, nutrition defaults, evidence, warmups, and keyed prescriptions using known exercise IDs. `importProgram` validates the entire document (128 KiB limit) before changing the account's snapshot. An equivalent import activates the existing record; changed content requires a larger version. Matching workout/prescription keys preserve record IDs. Assigned or actively running workouts cannot be removed. Historical session prescriptions, food logs, existing nutrition targets and calendar entries remain intact. The snapshot revision and mutation receipt provide account-level concurrency and transport retry protection.

`GET /api/v1/programs/templates` returns the bundled templates merged with database overrides and added publications. `GET /api/v1/catalogue` uses the same merged templates. Both require authentication. A chosen template gets private IDs and its own `details.key`, so shared updates cannot mutate existing copies.

`PUT /api/v1/admin/programs` accepts `{document,baseRevision}`. Server-side role checks require a current administrator. A new or bundled definition uses revision 0; the response returns a `ProgramTemplate` with its stored revision. Publications live in `program_templates` and survive restart. Identical retries return the existing revision. Different content requires both the latest stored revision and a larger document version; conflicts return HTTP 409 (`library_revision_conflict` or `program_version_conflict`). Creation/update and the 200-publication limit are serialized in a database transaction. Original source-based template keys are reserved; use a new key to publish their adaptation. The request neither changes the admin's private program nor any member's private copies.

`Program.details` stores document metadata; workout/prescription `key` fields are optional for legacy records. Existing programs without metadata remain compatible. Unknown fields, nulls, duplicate document keys, unsafe evidence links, unknown exercise IDs, invalid integer/range/date values and timed AMRAP prescriptions fail validation. There is no public registration privilege escalation, execution of imported text, automatic schedule assignment or automatic nutrition-target application.

## Library recommendations and progress review

Authenticated `POST /api/v1/programs/recommendations` accepts `{goal, experience, equipment, daysPerWeek, sessionMinutes, focus, trainingPriority}`. Priority is `hypertrophy | strength | general`. Reply: `program-expert-v1`, ordered matches with concrete programs, preference scores, reasons/differences and selections `{scope, id, version, revision, digest}`, excluded candidates and disclosed policy/sources. Scope is `shared | personal`. Only the current account's private programs are included; the endpoint writes nothing.

For `goal-library-v2`, answers additionally include `trainingPriority` and `programSelection`. `/goals/preview` returns `selection` and `expertVersion`. Creation revalidates current library content/account ownership inside its mutation transaction; changed selections return HTTP 409 `program_selection_changed` with no partial writes. An individually suitable retained active program uses scope `current`. The original v1 preview/create remains supported for existing clients/outbox entries; v1 payloads cannot include expert selection fields.

Authenticated `GET /api/v1/progress/review` returns `progress-review-v1`, account-timezone `asOf`, active program identity, training suggestions with actual evidence/dates/load, nutrition observations/coverage, scheduled-workout adherence and policy/sources. It never writes history, targets or prescriptions. All responses use `Cache-Control: no-store`. See [rules and limits](../EXPERT_SYSTEM.md).
