# Goal onboarding, workout selection, nutrition and Apple Health

Current extension: [expert-system implementation](EXPERT_SYSTEM_PLAN.md) connects structured library plans to the questionnaire and adds read-only progress reviews. The original v1 generator described below remains available for queued-operation compatibility.

Requested 11 October 2026. Replace the short goal-edit form with the supplied full-screen question flow. Research first, preserve existing private programs/history, and verify the Go backend and mobile UI. Nathan selected a native iPhone wrapper for direct Apple Health sync. A Swift/WKWebView wrapper loads the deployed HTTPS app, exposing a restricted HealthKit bridge only to that origin. The existing PWA remains supported.

## Evidence and product rules

Reviewed primary sources:

- [ACSM 2026 resistance-training position-stand summary](https://www.acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf): train major muscle groups regularly, build volume gradually, and fit training to availability and experience. Higher weekly volume supports hypertrophy; failure and elaborate periodization are not mandatory. Scheduling and starting doses below are explicit app choices, not a clinically validated personalization algorithm.
- [Currier et al., 2023 network meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/pmid/37414459/): multiple resistance-training prescriptions improve strength and size; preference and adherence matter. Do not label one split universally superior.
- [Morton et al., 2018 protein meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/): supports the current 1.6 g/kg protein starting setting for healthy adults doing resistance training. Protein settings stay editable.
- [Mifflin et al., 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/): estimate resting energy from age, equation sex, height and weight. Activity factors and goal adjustments are separately disclosed app policy. Resting expenditure, maintenance intake, and a goal calorie target are distinct values.
- [Helms et al., 2023 surplus trial](https://pubmed.ncbi.nlm.nih.gov/37914977/): larger surpluses primarily increased fat gain in this small resistance-trained sample. Offer conservative starting adjustments; do not promise a specific muscle-gain rate or maximal-speed option.
- [Apple HealthKit](https://developer.apple.com/documentation/healthkit), [basal energy](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalenergyburned), [authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data): access requires a native platform integration and per-type user permission. A successful authorization request does not prove read access. Empty/partial data must not be treated as zero expenditure or measured BMR.

## Questions and review

1. Goal: build muscle, lose fat, or maintain. These retain the current supported goal values.
2. Training experience and current exercise restrictions. A standard generated routine is offered only when the user reports no restrictions; an existing individually approved program can be retained otherwise.
3. Equipment available, weekly days and minutes per session. Do not recommend unavailable equipment or silently increase the selected training days.
4. Preferred muscle focus, then explain the recommended split and allow another compatible split.
5. Preview the week with draggable days and accessible movement controls. No calendar changes before final confirmation.
6. Nutrition familiarity and body/activity inputs; reuse the existing versioned calculator and explicit manual override workflow.
7. Conservative goal pace, estimated resting/maintenance/goal calories, food-tracking guidance (database/manual first; optional reviewed AI photo estimates).
8. Review the workout, schedule, nutrition, rationale and sources together; explicitly create the goal plan.

## Implementation contract

- [x] Add typed, versioned goal answers and deterministic shared workout rules. Preserve existing templates; app-generated plans disclose their own basis.
- [x] Add an unsaved Go preview and one atomic revisioned create-goal mutation, retaining prior programs, session snapshots and nutrition history. Existing future calendar conflicts require explicit replacement; past/started sessions are protected.
- [x] Add the screenshot-styled full-screen Svelte flow, draft isolation, back/cancel, field validation, schedule dragging/keyboard alternatives, and reviewed creation.
- [x] Keep the existing food log and optional AI features functional with the new targets. Expose goal details/provenance after saving and on a second device.
- [x] Implement the selected Apple Health route honestly, with consent, data-source/time coverage, missing/revoked permission behavior, and an equation fallback. Do not claim direct browser HealthKit access.
- [x] Verify calculation/rule parity and backend validation, atomicity, retries, conflict handling and private account isolation. Add Chromium/WebKit goal-flow and live persistence checks.
- [x] Inspect phone layouts and run production/Docker checks appropriate to the final changes. Document what was verified and any physical-device/signing requirement.

Automatic weekly target changes and claims of guaranteed progress are not part of initial plan creation. Future adjustments remain reviewed decisions unless Nathan explicitly requests automation. Health energy must not be multiplied by an activity factor and then have the same activity added again.

## Verification, 11 October 2026

- Go formatting/vet and the full race-enabled suite passed, including PostgreSQL integration tests for atomic creation, rollback, request retries, calendar protection, account isolation and Health energy validation.
- Svelte/TypeScript passed with no errors or warnings. Mock-client (12), nutrition (12) and shared goal/calculation (9) unit cases passed.
- Chromium/WebKit passed 90 fixture development cases, 10 production goal/PWA cases, 32 live development cases and 16 production live cases (148 selected browser checks). A final eight-case goal-flow run also passed after correcting radio/checkbox geometry. Phone screenshots were inspected.
- The iPhone project compiled against the simulator SDK without signing. Four pure Swift coverage-policy tests passed. The built app URL and app-bound host were verified as `https://bodybuilder.lucasgrey.dev` and `bodybuilder.lucasgrey.dev`.
- Both production Docker images built successfully using the existing frontend/backend Dockerfiles. The native wrapper is a separate Xcode target, with its compile/policy checks included in CI.

Real HealthKit permission prompts and reads still require selecting an Apple development team and running the signed wrapper on a real iPhone, as described in [native/ios/README.md](native/ios/README.md). These local checks do not constitute deployment, hosted GitHub Actions verification, or App Store/TestFlight distribution.
