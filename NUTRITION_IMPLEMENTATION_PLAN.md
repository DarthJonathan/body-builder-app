# Nutrition calculator, food database, and optional AI

Approved by the user on 10 October 2026: regular calculation and food-database logging are the default; AI is an explicit “Ask AI” / “Estimate from Photo” action. Update this plan before agent execution. Keep the existing screenshot styling, private-account sync, manual overrides, and review-before-save behavior. Do not deploy or modify the expense app.

## Frozen calculation contract

`POST /api/v1/nutrition/calculate` is authenticated and read-only. It does not save targets, change the profile, call an AI provider, or consume AI quota. Return `{success:true,data:<NutritionTargets>}` with a fresh target ID, `mode:"calculated"`, `manuallyOverridden:false`, and `calculation` provenance. Applying uses the existing revisioned `saveTargets` mutation; cancel/recalculate must never overwrite saved targets.

Request `TargetCalculation`: `age` (integer 18–100), `sex` (`female|male`, the equation selection, chosen explicitly), `heightCm` (100–250), `weightKg` (30–350), `activity` (`sedentary|light|moderate|active|very-active`), `goal` (`build-muscle|maintain|lose-fat`), `effectiveDate` (ISO calendar date), `calorieAdjustment` (−500 to +500 kcal/day), `proteinPerKg` (0.8–3 g/kg/day), and `fatPercent` (15–40). All inputs are required; never infer personal age, equation sex, height, or activity from names/programs/screenshots. Weight may be prefilled from an acknowledged dated measurement or a previously saved calculator input.

Version `mifflin-st-jeor-v1`: resting calories = `10*weightKg + 6.25*heightCm - 5*age + (male ? 5 : -161)`. Activity factors = 1.2, 1.375, 1.55, 1.725, 1.9 in enum order. Daily target = unrounded resting calories × factor + adjustment, rounded to nearest 10 kcal; reject results outside 1000–10000 instead of silently clamping. Protein grams = rounded `weightKg*proteinPerKg`; fat grams = rounded `calories*fatPercent/100/9`; carbohydrate grams = rounded `(calories - protein*4 - fat*9)/4`. Reject impossible allocations. Do not replace food-label calories with this macro formula.

Visible, editable starting settings: goal adjustment +250 for build muscle, 0 for maintenance, −300 for fat loss; protein 1.6 g/kg; fat 25%. These are app starting settings, not measured personal requirements. Show the equation, selected activity multiplier, calorie adjustment, estimated maintenance, effective date, and editable macro settings in the preview. No auto-adjustment from a daily weigh-in and no silent overwrite of manual targets.

`NutritionTargets.calculation?`: `{version:"mifflin-st-jeor-v1",input:TargetCalculation,restingCalories:number,maintenanceCalories:number}`. Resting and maintenance outputs are rounded to whole kcal; target allocation uses unrounded intermediate math. New calculated records require this metadata; validate it and reproduce the result on the server. Manual edits retain original provenance with `mode:"manual"` and `manuallyOverridden:true`. For an existing dated calculation, omitted manual-save provenance is preserved and differing supplied provenance is rejected; explicit calculated Apply is required to replace it. Legacy records without calculation metadata remain readable. The frontend may calculate an offline preview using the identical version; common golden fixtures verify parity.

Sources: [original Mifflin–St Jeor paper](https://ajcn.nutrition.org/article/S0002-9165(23)16698-6/abstract), [ISSN protein position stand](https://link.springer.com/article/10.1186/s12970-017-0177-8). Activity mapping, offsets, allocation, rounding, and software bounds above are explicit app policy, separate from the published resting-energy equation. The simple estimator is not the NIDDK dynamic weight planner.

## Food database and AI contract

- Bundle genuine USDA FoodData Central ingredient records from an official, pinned downloadable release. Preserve FDC IDs, release name, source URL, CC0 attribution, per-100g units, archive checksum, and reproducible importer. Skip records missing any of calories/protein/carbohydrate/fat; never turn unknown values into zero or substitute preview fixtures.
- Search bundled USDA ingredients first, retain own saved-food matches, and use the existing Open Food Facts adapter for packaged queries that have no local match. Local matching must survive provider errors/rate limits with its original attribution. If no genuine match exists, show the error/no-results state and permit manual entry. No AI call is triggered by search, calculation, or a provider failure.
- Preserve selected database attribution on saved foods as optional `FoodEntry.databaseSource` (string, max 1000 characters). Existing entries remain compatible. Food-entry nutrients continue to describe the chosen quantity; source search results describe one serving. Review the serving and quantity before saving.
- Label explicit actions “Ask AI” and “Estimate from Photo”; photo submission uses an additional explicit “Estimate Nutrition” action. Keep no-key/disabled/error feedback, provider-admin restrictions, and draft review before saving. Do not change provider credentials or make paid test calls.

## Disjoint agent ownership

1. **Coordinator:** this plan/API docs, Go domain types/validation/calculator and route/service integration, shared fixture file, shared scripts/dependencies, backend/browser execution and runtimes, final review/docs. No competing servers/builds.
2. **Frontend worker:** frontend domain/calculator module/live+mock adapters/validators, page/styles, including calculation preview/apply/manual override, unit conversion, source display, explicit AI labels, account/draft cleanup, and offline preview. Do not edit tests/config/scripts or backend files.
3. **Food-data worker:** `backend/providers/**` and `scripts/import_usda_foods.py` only. Download/extract genuine pinned source data, embed loader/search, provider tests/docs. Export `BundledFoods() ([]domain.Food,error)`; coordinator passes it into provider options. Use local stub tests and report source/download/checksum/count. Do not edit domain/server/shared docs or dependency files.
4. **Test worker:** new Go calculator tests under `backend/domain/`, new integration nutrition tests, frontend nutrition-calculation/browser checks and updates to existing affected nutrition/provider label tests, test coverage docs. Read this contract and coordinate labels with frontend worker. Do not run checks or change app/config/dependency files; coordinator executes.

## Completion

- [x] Record approved default calculation/database and explicit optional AI behavior; freeze contract.
- [x] Implement/validate Go calculation and durable calculation provenance/manual overrides.
- [x] Import genuine USDA data, preserve attribution, and integrate keyless search.
- [x] Implement calculator preview/apply/override, optional AI labels, and database source UI.
- [x] Pass calculator parity/unit/boundary checks, PostgreSQL integration/race/vet, Svelte checks, mock/live browser regressions, and relevant production offline checks.
- [x] Inspect the running app, save a review capture, update setup/status/verification docs, and clean isolated test data.

Completed locally on 10 October 2026. The final browser suites passed 110 checks; all twelve PostgreSQL integration cases passed under the Go race detector. The USDA import reproduces 7,793 genuine records from the pinned archive. The isolated E2E service and its schema were removed; the normal app remains available. Exact evidence and external/device limits are in [the verification report](docs/LIVE_VERIFICATION.md).
