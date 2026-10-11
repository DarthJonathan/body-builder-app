# Questionnaire and progress recommendation engine

Requested 11 October 2026: connect the questionnaire to the editable program library and provide explained training/nutrition recommendations, including reviews based on recorded progress.

## Acceptance

- Rank actual bundled, admin-published and the signed-in person's imported programs. Respect training days, available equipment, time budget, supported goals and training experience before scoring preferences. Never silently invent a replacement or truncate a plan to force a match.
- Ask training priority alongside the existing goal, experience, equipment, availability, focus and nutrition questions. Show ranked choices, match reasons, differences, concrete workout previews and excluded-plan explanations. If no plan fits, explain which answers can be changed or allow retaining a suitable personal program.
- Use structured metadata and versioned, deterministic rules, with equivalent Go/TypeScript results. The score expresses app preference matching, not probability of success or clinical suitability. Legacy templates without suitability metadata remain manually selectable; administrators can import a structured version to make them eligible.
- Save the selected plan as a private copy with provenance, including the rule version, source identity/content digest and recommendation reasons. Revalidate against the current account/library at creation; changed plans require another preview. Retain earlier programs, logged sessions, schedule protections and manual nutrition overrides. Continue accepting already queued v1 goal operations.
- Calculate personal calories/macros using the existing body/activity or Apple Health estimate. Combine those targets with the selected program's editable protein/fat guidance and nutrition-experience-specific food tracking instructions. Avoid claiming a template establishes someone's dietary needs.
- Add a progress review based on completed workout sets, recorded effort, daily weights and food logs. Show conservative progression/stall suggestions and weight-trend/food-log observations with the actual evidence window and uncertainty. Sparse, mixed-load, timed, bodyweight, incomplete or stale records must not produce confident load increases. No target, prescription or load changes happen without review.
- Expose review actions through the existing program editor and nutrition settings. All suggestions remain private to the signed-in account. Backend tests, parity fixtures, mobile UI and real Go/PostgreSQL tests cover matches, exclusions, stale selection, permissions, retention and progress rules.

## Architecture

Keep the existing v1 generator for compatibility. Introduce `goal-library-v2` creation and `program-expert-v1` matching, reading the same versioned policy JSON in both languages. Matching reads the live shared library plus the account's imported programs; it uses hard constraints followed by deterministic weighted preferences and stable tie-breaking. Program SHA-256 digests bind reviewed content to creation. The backend owns validation and account boundaries; the mock client follows the same rules.

Progress reviews are read-only, deterministic reports. They distinguish completed logged observations from prescribed work and estimated weight trends. Review cards link to the relevant editable program or target controls; they do not overwrite history, manually set targets or apply AI-generated decisions.

## Evidence and product policy

Primary references: [ACSM 2026 position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/), [ACSM progression guidance](https://pubmed.ncbi.nlm.nih.gov/19204579/), [Morton et al. protein meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/), [Helms et al. energy surplus study](https://pubmed.ncbi.nlm.nih.gov/37914977/). Research supports progressive resistance training, adequate volume, protein and conservative energy adjustments. Exact match weights, equipment/time exclusions, repeat-performance thresholds and trend windows are disclosed app policies; the complete engine is not clinically validated.

## Execution

- [x] Implement shared policy, matching/report types, metadata compatibility and parity tests.
- [x] Add authoritative recommendation/creation and progress-review APIs with stale-content checks.
- [x] Integrate mock/live clients, offline behavior and questionnaire ranked previews.
- [x] Add progress-review UI and links to editable program/nutrition controls.
- [x] Test Go/PostgreSQL, frontend helpers, mobile Chromium/WebKit and production builds.
- [x] Document rules, provenance, limits and deployment; record verified results.

## Verification

Verified 11 October 2026:

- Full backend `go test -race -count=1 ./...` against local PostgreSQL, `go vet ./...`, and API/admin binary builds passed. Integration tests cover current published revisions, stale-selection rollback, private imports, account boundaries, preserved prescriptions, manual nutrition targets, idempotent goal creation and read-only progress reviews.
- Frontend checks passed: Svelte reports zero errors and warnings; expert rules 19 checks, goal rules 9, mock API 16 and nutrition calculations 12. Shared fixtures include independently calculated content hashes and recorded progression cases.
- Mobile Chromium and WebKit: 14 development UI checks passed for goal setup and expert recommendations; 22 production checks passed for goal setup, expert recommendations, program imports and the PWA. Ranked program screenshots were visually inspected.
- Real Go/PostgreSQL browser checks: 6 development and 12 production checks passed for goal creation, second-device sync, personal imports, administrator publishing and durable offline replay. A fresh recommendation requires a connection; after reviewing the authoritative plan, an offline final save queues one operation and creates its records only on acknowledgement.
- Both backend and frontend production Docker images built successfully using the existing Dockerfiles. No new environment variables or migration are needed; deploy both rebuilt images together.

Rules, user controls and limits are described in [docs/EXPERT_SYSTEM.md](docs/EXPERT_SYSTEM.md). Verification covers local builds and browser simulation; it does not establish clinical validation or physical-device Apple Health testing.
