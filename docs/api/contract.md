# BodyBuilder live API contract

Implementation contract for the real-backend milestone, updated 10 October 2026. The expense tracker is a read-only architecture reference: Go + Gorilla mux, controller/request/service/DAO layers, GORM/PostgreSQL, bcrypt/JWT, `{success,error,data}` responses, and a same-origin SvelteKit proxy. BodyBuilder owns its database and ports.

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
| `useTemplate` | `{templateId}` |
| `assignWorkout` | `{date,workoutId}`; null means rest |
| `startWorkout` | `{date,workoutId}` |
| `saveSession` | `WorkoutSession`; immutable metadata/prescription checked |
| `finishSession` | `{sessionId,finishedAt?}`; optional RFC3339 stop time preserves offline duration, validated against start and server time |
| `saveFood` / `saveTargets` / `saveCheckIn` / `saveWeight` / `saveLesson` | Corresponding domain record |
| `deleteFood` / `deleteLesson` | `{id}` |
| `copyFoods` | `{fromDate,toDate}` |

`Program` optionally carries `sourceName` (150 characters), `sourceReviewedAt` (YYYY-MM-DD), and `adaptationNote` (2,000 characters). `useTemplate` preserves these fields in a private copy, regenerates program/workout/prescription/superset IDs, and leaves the calendar unchanged. `saveProgram` validates and preserves provenance; older programs without these fields remain valid. A timed prescription (`seconds: true`) interprets logged `sets[].reps` as seconds and shows a seconds input in the frontend.

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
