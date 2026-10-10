# BodyBuilder backend and live frontend execution plan

The user approved beginning the real backend on 9 October 2026 after the frontend mock/polish milestone. Keep the dark screenshot styling and shared draggable sheets. Do not modify `expense_tracker` or deploy externally.

## Contract and ownership

Read `docs/api/contract.md` and the existing `IMPLEMENTATION_PLAN.md`. The latest live-milestone contract governs the execution details. One coordinator and three existing worker agents have disjoint ownership:

1. **Coordinator:** Go domain records, embedded catalogue/templates, training document/retry DAO and migrations, training service/controller/routes, auth/role hardening, configuration, admin command, local PostgreSQL/server lifecycle, shared scripts/lockfiles/Docker, integration, final tests, docs, and actual preview verification.
2. **Frontend worker:** `frontend/src/lib/domain.ts`, live HTTP client and IndexedDB/outbox modules, `frontend/src/lib/client.ts`/`api.ts`, and `frontend/src/routes/+page.svelte`/styles. Default live mode; explicit fixture preview mode. Registration/sign-in, empty accounts, all existing CRUD flows, sync status/conflict resolution, provider key form restricted to admins, real AI/photo drafts, and calculator UI under the approved nutrition plan. Keep offline edits durable and avoid replacing an active form/session with refresh data.
3. **Provider worker:** `backend/providers/**` only, including provider storage/migration and tests. Export a service accepting GORM DB, encryption key, HTTP client, and configurable upstream URLs for stub tests. Implement encrypted global admin settings, all three real AI adapters, validated meal drafts, bounded usage, and Open Food Facts/USDA search. Deterministic calculation belongs to the coordinator's domain service under `NUTRITION_IMPLEMENTATION_PLAN.md`. Coordinator integrates routes/migrations/config; worker does not edit those files.
4. **Test worker:** new backend integration tests and frontend live E2E tests/config, plus adjustments to existing mock browser helpers/config so mock verification stays explicit. Coordinator owns package scripts/lockfiles. Exercise real PostgreSQL/Go through the frontend; check independent browser contexts, registration/login/logout, private data, check-in/weight atomicity, lessons/nutrition/program/workout persistence, stale writes, durable offline replay, and provider errors. Use local provider stubs, no external paid calls.

## Execution order

- [x] Inspect expense tracker and current scaffold; freeze the live API contract before delegating.
- [x] Start the local PostgreSQL runtime with a dedicated BodyBuilder database/schema and isolated test schemas.
- [x] Implement backend data validation, transactional mutation/retry handling, safe auth/roles, and admin management.
- [x] Implement providers and real food search; verify official API formats and retain source attribution.
- [x] Implement the live frontend adapter and durable per-user pending edits. Keep test preview mode available separately.
- [x] Finish the approved calculator preview, retained dated/manual provenance and bundled USDA search under `NUTRITION_IMPLEMENTATION_PLAN.md`.
- [x] Run Go tests, race tests, vet, frontend type check, mock tests, mock UI suite, real E2E suite, and production PWA checks. No skipped database suite counts as passed.
- [x] Inspect the running live preview, save screenshots, and document startup/configuration and remaining external/device limits.

## Handoff status — 10 October 2026

The live backend/frontend and approved nutrition extension are implemented and verified. See `docs/LIVE_VERIFICATION.md` for 110 passing browser checks, twelve real PostgreSQL integration cases, and their limits, and `README.md` for startup/admin instructions. Regular calculation/food data use no AI key; AI remains behind explicit actions. The disjoint nutrition contract is in `NUTRITION_IMPLEMENTATION_PLAN.md`. Actual external AI credentials, physical-device acceptance, and hosting are separate follow-up checks.

Workers must report their changed files, exact checks, contract deviations, and remaining limitations. Do not independently alter shared dependencies or run competing build/test servers. Backend integration tests must use an isolated schema and delete only their own test data. Preserve existing browser preview records; never migrate the screenshot fixture into a real account automatically.
