# Program library and JSON imports

BodyBuilder includes ten original, evidence-informed starting programs in addition to the seven existing source-based templates. Each is a complete, downloadable JSON document. These recipes are app-authored choices informed by research; the complete matching engine and its exact combinations are not clinically validated. See [questionnaire and progress rules](../EXPERT_SYSTEM.md).

| Program | Days/week | Experience | Equipment | Approximate session |
|---|---:|---|---|---:|
| [Full Body Foundation](bb-foundation-2.json) | 2 | Beginner | Full gym | 45 min |
| [Full Body Foundation](bb-foundation-3.json) | 3 | Beginner | Full gym | 45 min |
| [Full Body Muscle](bb-full-body-3.json) | 3 | Intermediate | Full gym | 60 min |
| [Upper / Lower Muscle](bb-upper-lower-4.json) | 4 | Intermediate/advanced | Full gym | 60 min |
| [Strength & Muscle](bb-upper-lower-strength-4.json) | 4 | Intermediate/advanced | Full gym | 60 min |
| [Upper / Lower + PPL](bb-hybrid-5.json) | 5 | Intermediate/advanced | Full gym | 60 min |
| [Push / Pull / Legs](bb-ppl-6.json) | 6 | Intermediate/advanced | Full gym | 60 min |
| [Dumbbell Muscle](bb-dumbbell-3.json) | 3 | Beginner/intermediate | Dumbbells + bench | 60 min |
| [Glute Priority](bb-glute-3.json) | 3 | Intermediate | Full gym | 60 min |
| [Quick Dumbbell Foundation](bb-quick-dumbbell-2.json) | 2 | Beginner | Dumbbells + bench | 30 min |

## Use the app

1. Open **Workout → Import / Export**, or **Choose a Program → Import / Export Programs**. An administrator also has **Account → Manage Program Library**.
2. Load one of the generated examples, export a saved program from the dropdown, upload a `.json` file, or paste one complete JSON document. Fenced `json` text is accepted too.
3. Choose **My personal programs** or, for administrators, **Shared starter library**. Members have personal imports only.
4. Select **Validate & Preview**. Inspect exercises, working sets, repetitions, rest, warmups, progression, nutrition guidance, and evidence links.
5. Select **Import My Program / Update My Program** or **Publish Shared Plan**. Personal imports become active; select dates in the Workout schedule to assign sessions. Published templates appear in everyone's chooser; choosing one makes a separate editable private copy.

Use **Copy JSON** or **Download JSON** to transfer the complete editable document. **Edit Program → Export Program JSON** exports the current editor draft. Upload/export never includes account details, food logs or workout history.

Importing a program does not assign calendar dates, create food entries, or set personal calorie/macro targets. **Progress → Change** or **Nutrition → Food Log settings → Calculate Targets** calculates individual targets; manual overrides remain available. The questionnaire now ranks structured shared and private programs using `program-expert-v1`, then saves the selected plan with `goal-library-v2`. Read-only progress reviews offer explained adjustments through the existing editors; nothing adapts without review. Legacy v1 queued operations remain supported.

## Upsert rules

- `schemaVersion` must be `bodybuilder.program.v1`. Use one document per import, under 128 KiB.
- Keep the program's stable `key` to update it. Increase its integer `version` when changing content. An identical re-import retains IDs and creates no duplicate. Choose a new key to create a separate program.
- Preserve workout `key`s and exercise prescription `key`s while editing. These map to existing private IDs; `exerciseId` refers to a movement in the app's **Exercise ID reference**. A prescription key identifies that slot in that workout, even if you change its exercise.
- The document needs one distinct workout per weekly training day. Repeat a session by giving its copy a different workout key. Workout keys are unique in the document; prescription keys are unique within each workout.
- Keys contain 2–80 lowercase letters, digits or hyphens and start with a letter. Optional booleans can be omitted; null values, unrecognized fields and empty superset keys are rejected. Use `seconds: true` for timed holds; durations occupy the rep fields. `perSide` and `amrapLast` are supported.
- Working sets are 1–10, repetitions/seconds 1–600, and rest 0–600 seconds. Minimum must not exceed maximum. This importer has tighter bounds than the legacy freeform editor; adjust exports that exceed them before importing.
- Removing an assigned workout is rejected. Remove its calendar assignments and finish any active session first. Completed sessions retain their original prescriptions even after the workout changes or is removed.
- Admin publication checks both the content version and the latest database revision. Reload the library after a conflict. Identical retries are harmless. Shared publication never changes anyone's existing private copy.
- Personal imports use the existing durable outbox during an outage and appear after the server acknowledges them. Shared publication requires a live connection and a successfully loaded library.

The [JSON Schema](program.schema.json) describes structural bounds. Go and TypeScript also validate exercise IDs, references, exact dates, cross-field constraints and updates. All examples are selectable and downloadable inside the app; `frontend/src/lib/program-library.json` is the canonical bundled source, exported to the backend by `npm run export:catalogue`.

## Research and policy

The [2026 ACSM position stand](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/) synthesizes resistance-training evidence for healthy adults. Its principles support progressive resistance training, heavier loading for strength, and adequate weekly volume for hypertrophy. Our beginner recipes start with fewer working sets; intermediate recipes distribute more work across the week. Full body versus split choice, exact movement selection, session estimates, progression after two exposures and a temporary 5–10% load reduction are disclosed product policies rather than a claim that one split or formula is proven best.

[Morton et al.'s meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/) informs the editable protein starting point of 1.6 g/kg/day for resistance training. Fat at 25% and remaining calories from carbohydrate are app defaults. Personal calorie needs come from the existing body/activity calculator or available Apple Health energy summaries, with an editable goal adjustment. A reusable training template cannot establish someone's personal dietary needs.

These sources support general training/nutrition principles. They do not certify this catalogue, establish an individual's suitability, or validate automatic coaching. No automatic load or calorie changes are applied by importing these plans.

## Deployment

Redeploy both images to include the new UI, bundled plans and API methods. Backend startup automatically creates the `program_templates` table with its existing migration mechanism. This table holds shared definitions, versions, revisions, timestamps and the publishing admin ID. Private programs remain in the account's training document. No new API key or environment variable is required; existing admin roles control publishing. A JSON plan is data, not instructions to an LLM or executable code.
