# BodyBuilder fixture-mode contract

This document describes the completed fixture frontend milestone. Live mode is now the default; see the [live API contract](../../docs/api/contract.md) and [live verification](../../docs/LIVE_VERIFICATION.md). Select fixture mode explicitly with `PUBLIC_API_MODE=mock` when starting Vite or building the frontend; the setting is fixed at build time.

The UI uses `TrainingClient` from `src/lib/domain.ts` and the exported `client` in `src/lib/client.ts`. In fixture mode, each mutation is an async mock request returning the updated `AppSnapshot`; the UI must await it and handle failures. `catalogue.ts` exports `exercises`, `muscles`, `templates`, `readings`, and `foods`. Mock handlers under `src/lib/mock/` persist preview records per email on this device and simulate a short request delay.

The preview opens on Dashboard using seeded Nathan preview data. Account settings clearly identify this as local preview data. Changing mock accounts switches the storage partition. Signing out opens a preview sign-in screen. Reset preview restores fixtures. Passwords and real provider keys are neither needed nor stored.

Dates follow the local calendar. Seed recent history relative to today; completed sessions and selected-day records must agree. The initial preview schedule offers Lower 2 today and Upper 1 tomorrow regardless of weekday, so reference screens can be reviewed. A chosen online-sourced template creates an editable private preview copy. Keep screenshot-specific programs in preview fixtures, not future real registration defaults.

Set effort is `easy | medium | hard | null`, independent of completion. Session prescriptions are snapshots. Set edits/notes/rest deadlines survive reload. Check-ins contain weight/notes, unique per day; they upsert the same dated weight entry so Progress has no duplicates. Target overrides are dated. The preview calculator follows the same approved `mifflin-st-jeor-v1` policy and shared golden fixtures as the Go API. Calculation returns an unsaved preview; Apply saves it, and manual edits preserve the original inputs/version. The mock adapter never calls real AI/food providers; food results remain visibly identified fixtures. See [the frozen policy](../../NUTRITION_IMPLEMENTATION_PLAN.md).

AI Q&A and photo estimation return clearly labelled simulated results and require no actual API keys. Meal estimates are drafts, never food entries until explicit save. Admin provider settings configure only provider/model/enabled flags in preview, with no real key input. Live mode uses the implemented Go provider adapters and encrypted settings; fixture behavior remains separate.

Browser tests must exercise the UI, asynchronous errors, persistence, account isolation, both mobile Chromium/WebKit, and responsive geometry. Mock behavior is not verification of real authentication, backend sync, LLM calls, or food-provider availability.

Goal onboarding uses the same `program-expert-v1` ranking and `goal-library-v2` preview/create contract as Go, including shared and private imports, no-match explanations and content-digest validation. Earlier `goal-planner-v1` operations remain supported. Draft questions never save; final creation adds a private program, dated targets, goal history and four-week schedule together. Existing/started days and earlier logs remain protected. Synthetic Apple Health bridges are injected only by browser tests to exercise consent, complete-day validation, activity accounting and equation fallback. They are not real HealthKit reads. See [goal rules and research](../../GOAL_ONBOARDING_PLAN.md).

## Program import and publication

The preview implements the same `importProgram`, `listProgramTemplates`, and admin-only `publishProgram` contract. Imports upsert private keyed records and retain history/calendar references. Shared preview templates persist in `bodybuilder.preview.shared-programs.v1` across preview emails on the same browser; they are distinct from each email's private snapshot. The real implementation persists them in PostgreSQL. Generated examples and Go/TS validators are checked against the catalogue by `npm run test:mock`. See [app import instructions](../../docs/programs/README.md).

`recommendPrograms` and `reviewProgress` are read-only. Mock mode follows the shared policy and account boundaries; see [expert rules](../../docs/EXPERT_SYSTEM.md). Progress suggestions never modify prescriptions or targets.
