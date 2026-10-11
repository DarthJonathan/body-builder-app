# Questionnaire and progress rules

Use **Progress → Change** to create a goal. The questionnaire asks goal, recent training experience, exercise restrictions, training days, time, equipment, training priority (muscle growth, strength or general fitness), muscle focus, weekday placement, nutrition familiarity, body/activity inputs, energy source and starting calorie adjustment. **Recommended Programs** compares actual library plans; the highest score is selected initially and you can choose another eligible plan. Expand the matching rules to see why plans were excluded. If nothing fits, change your constraints or import a suitable structured plan through **Workout → Import / Export**.

## Where plans come from

The engine reads bundled structured programs, current administrator-published starter plans and your own imported programs. Seven legacy source-based templates remain available for manual selection; they do not have the suitability metadata required by the expert engine. Admins can publish a structured version under a new key. An imported program is only available to its owner until an administrator explicitly publishes a shared definition.

The engine checks exact weekly workout count, declared session duration, supported goal, starting experience and equipment before ranking. For dumbbells, every exercise must also fit the available dumbbell/bodyweight/bench equipment list. A full gym permits both gym and dumbbell plans. More experienced users can choose lower starting doses, with a stated difference. Session duration is the author's estimate; the engine does not truncate exercises to make a plan fit.

Preference score: exact experience support **40**, muscle focus **25**, training priority **25**, exact time fit **10** (a shorter eligible plan gets 5). Stable ordering resolves ties by program name, scope and ID. This is a 0–100 preference score, not probability of success or a clinically validated assessment. The selected plan retains its exact exercises, sets, rep ranges, rest, supersets, progression guidance, nutrition guidance and evidence.

## Saving and sync

Go owns eligibility and authorization. Goal creation rechecks the selected scope, ID, document version, shared revision and SHA-256 content digest inside the same transaction that saves the goal, private program, targets and calendar. A changed or unavailable plan returns `program_selection_changed` and needs a fresh recommendation/preview. IDs and import keys are generated for the private copy; earlier programs and logged sessions remain intact. Retaining an individually suitable current program also binds its content digest, without claiming the questionnaire establishes injury suitability.

New creation uses `goal-library-v2` and matching uses `program-expert-v1`. Existing queued `goal-planner-v1` operations remain supported. New recommendations and authoritative previews require a connection in live mode. After preview, an offline final creation can queue one durable operation; the server revalidates it on replay. A read-only progress review also requires the live API. Mock mode uses equivalent local rules and never calls providers.

## Nutrition

The selected program supplies editable protein/fat defaults and tracking guidance. Calories/macros use your own body/activity input through the existing Mifflin–St Jeor calculator, or recent complete Apple Health resting + active energy summaries in the iPhone wrapper. Health energy receives no additional activity multiplier. These are estimates, not a measured laboratory BMR. Your goal adjustment and nutrition familiarity determine the starting guidance; you can override the calculated targets manually before saving.

## Review recorded progress

**Progress → Review My Progress** is a private, read-only report:

- Training window: 28 days; latest observation must be within 14 days. Only completed sessions and unchanged, weighted prescriptions qualify. Timed, bodyweight and AMRAP prescriptions are excluded from load suggestions. Extra/missing sets, mixed loads, absent effort, partial sets or changed prescriptions prevent a recommendation based on those exposures. Only one exposure per date counts.
- Increase prompt: all prescribed sets reach the upper range at the same positive load on two distinct sessions, each marked easy or medium. Consider the smallest available increase, around 2.5%, rounded to your equipment. The displayed load retains your own logging convention (for example per dumbbell versus total).
- Difficulty prompt: all sets remain below the lower range at the same load, marked hard, on three distinct sessions. Review technique, rest and recovery; consider a load you can control within the range. This does not diagnose a plateau.
- Nutrition window: 14 completed days, excluding today; at least three weights in each week, ten days with entries in two or more meal groups, and the same target record throughout. Weekly average weight is compared, never a single day's fluctuation. Meal entries cannot establish whether all food was logged.
- Review bands are disclosed app thresholds: muscle gain above 0% through 0.5% per week; fat loss below 0% through −1%; maintenance within ±0.5%. Outside these bands, review portions, recovery and targets. Consider small 100 kcal changes only after verifying logs and reassess after two weeks. Changes above 3% prompt data verification first. These bands are review prompts, not outcome predictions.
- Manual targets stay manual. Sparse or recent target changes produce an insufficient-data explanation. Suggestions never write a target, prescription, historical set or weight.

Buttons open the relevant workout (with its existing edit control) or nutrition target editor. The report exposes its evidence dates, observed load, weight counts and logging coverage. Exact thresholds and preference weights are BodyBuilder policy informed by research, not externally validated expert judgments.

## Evidence and implementation

Primary sources: [ACSM 2026 resistance training](https://pubmed.ncbi.nlm.nih.gov/41843416/), [ACSM progression](https://pubmed.ncbi.nlm.nih.gov/19204579/), [Morton et al. protein meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/), [Helms et al. energy surpluses](https://pubmed.ncbi.nlm.nih.gov/37914977/). These support the general training/nutrition principles; no paper validates this complete recommendation engine or its exact combinations.

Shared policy: `frontend/src/lib/expert-rules.json`, exported into the embedded Go catalogue. Go matching/progress functions are in `backend/domain/expert.go` and `backend/domain/progress.go`; mock counterparts are in `frontend/src/lib/expert.ts` and `frontend/src/lib/progress-review.ts`. Independent content hashes and recorded observation fixtures in `docs/fixtures` verify both languages. Run `npm run export:catalogue` after changing policy or programs, then backend and frontend checks. Change rule versions and fixtures deliberately when changing behavior.

No new environment variables or database migration are required for this feature. Rebuild and deploy both images to use the new UI and Go endpoints. Existing Apple Health wrapper requirements and database persistence remain applicable.
