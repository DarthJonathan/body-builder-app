# Local API preview

`../client.ts` exports the `TrainingClient` mock adapter. Its methods behave like
asynchronous requests: they wait 100 ms, validate their input, save the account's
snapshot, and return a detached copy. Failed requests do not apply the proposed
edit. Writes from one client are serialized. This adapter makes no HTTP calls,
does not perform real authentication, and does not provide device synchronization.

On first open, the selected account is `nathan@preview.bodybuilder.app`, displayed
as Nathan with a preview admin role. All other valid emails create separate local
preview accounts with a user role. Signing in uses an email and optional display
name; passwords and real API keys are never requested or stored. Preview accounts
have screenshot fixtures. They are not future production registration defaults.

The initial schedule has Lower 2 today and Upper 1 tomorrow. Earlier Monday and
Wednesday workouts have matching completed sessions. Today's sample food log
totals 938 calories, 33 g protein, 79 g carbs, and 55 g fat. Daily check-ins upsert
by local calendar date and update that date's weight atomically. All stored
weights use kg; display-unit conversion belongs to the UI. Session prescriptions
are copied when the workout starts and keep their identity after program edits.
Rest timers store an absolute deadline. Finishing a partial workout is permitted.

Selecting an online-sourced template makes an editable private copy and activates
it. It does not silently change calendar assignments. Scheduled workout IDs can
refer to any retained program, so resolve them across the snapshot's `programs`.

Assistant replies and meal-photo estimates are clearly marked simulated. The
photo is validated and is neither analyzed nor persisted. Estimated items are
drafts; they become foods only through explicit `saveFood` calls. Provider
settings only accept provider/model/enabled/configured flags and are admin-only.
`configured` is a preview flag, not evidence of real credentials.

## Browser test hooks

The keys below are stable, local-only testing hooks; they have no corresponding
developer controls in the product UI.

| Key | Value |
| --- | --- |
| `bodybuilder.preview.active` | Normalized email, or `signed-out` |
| `bodybuilder.preview.account.v1:<encoded email>` | JSON `{ "version": 1, "snapshot": AppSnapshot }` |
| `bodybuilder.preview.fail-next` | TrainingClient method name, or `*` |
| `bodybuilder.preview.delay-ms` | Optional request delay from 0 to 2000 ms |

Example: `localStorage.setItem('bodybuilder.preview.fail-next', 'saveCheckIn')`
causes the next matching request to reject with `MockApiError`, HTTP-like status
503 and code `simulated_network_error`. The flag is consumed once before the
mutation. Nonmatching requests do not consume it. `failNextMockRequest()` exported
from `../client.ts` is an equivalent hook. Every method can be targeted, including
`getSnapshot`, `signIn`, `signOut`, `searchFoods`, `askQuestion`, and `estimateMeal`.

Schema errors use status 400; missing records use 404; signing out produces 401
for authenticated operations; forbidden identity/role changes use 403. Changes
that arrive after an account switch reject with 409. An unreadable saved snapshot
rejects with 409 and can be repaired through `resetPreview()`.

Run `node scripts/test-mock-api.mjs` from `frontend` for the reproducible mock API
suite. It uses the installed TypeScript compiler and Node 22, compiles into a
temporary directory, and removes the generated files after the run. This suite
verifies preview behavior only; it does not replace browser or Go backend tests.
