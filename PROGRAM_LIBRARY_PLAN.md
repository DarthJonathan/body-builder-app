# Expanded starter-program library

Requested on 10 October 2026. Add online-sourced options to Choose a Program, using the current private-copy and manual calendar workflow. Nathan confirmed that gym strength and muscle-building programs take priority. Preserve the two existing templates and all saved account programs.

## Source and content contract

| New option | Source | Representation |
| --- | --- | --- |
| 3-Day Dumbbell Full Body | [Muscle & Strength, Josh England](https://www.muscleandstrength.com/workouts/3-day-full-body-dumbbell-workout) | Three home/gym sessions. Clearly label a shorter adaptation and list substitutions; accurately disclose bench/step equipment. |
| 3-Day Glute Focus | [Muscle & Strength, Roger Lockridge](https://www.muscleandstrength.com/workouts/womens-3-day-glute-workout) | Three full-body sessions prioritizing glutes. Clearly disclose shortened accessory selections and substitutions. No gender restriction or automatic assignment. |
| 6-Day Push / Pull / Legs | [The Fitness Wiki, original PPL author](https://thefitness.wiki/reddit-archive/a-linear-progression-based-ppl-program-for-beginners/) | Preserve alternating heavy pulls/presses, final-set AMRAP, and supersets. Give repeat exercises distinct prescription IDs. Link progression rather than claim automatic load increases. |
| 3-Day Barbell 5×5 | [StrongLifts](https://stronglifts.com/stronglifts-5x5/workout-program/) | Two alternating sessions, five sets for the primary lifts and one deadlift set. Link original progression/deload guidance. |
| 4-Day PHUL Strength & Size | [Muscle & Strength, Brandon Campbell](https://www.muscleandstrength.com/workouts/phul-workout) | Four gym sessions: upper/lower power and upper/lower hypertrophy. Use the lower end of variable set counts and disclose chosen rest defaults. |

Review original pages before finalizing the numeric prescriptions. Store brief app-authored descriptions, source names, reviewed date, and visible adaptation notes. Do not copy source articles, proprietary imagery, or unsupported progression formulas. Public template choices do not imply a personalized recommendation. User selection creates a private editable copy and leaves dates unchanged.

## Implementation sequence

- [x] Freeze reviewed sources, prescription mappings, and any adaptations.
- [x] Add accurate exercise records/guides and locally available demonstration assets where new movements are needed; preserve source and license provenance. Use an explicit fallback for unavailable media.
- [x] Extend the shared frontend catalogue and regenerate the Go embedded catalogue with the existing export command.
- [x] Show source/adaptation information in the existing chooser while preserving its screenshot styling.
- [x] Verify all templates against Go domain validation, catalogue parity, and private-copy isolation. Check preserved AMRAP, supersets, timed holds, unilateral flags, and weightless movements.
- [x] Run focused backend/client and Chromium/WebKit checks for choosing, saving, scheduling, and reloading new programs, using isolated accounts/data for live checks.
- [x] Inspect the expanded chooser/workout preview, update source/coverage documentation, and remove owned test services/schemas.

No deployment, existing-account reassignment, or automatic progression is part of this change. Source imports and backend builds must be reproducible; saved private program and session IDs remain intact.

## Reviewed mapping decisions

The selection is five additions, giving seven starter choices, with PHUL, PPL and barbell strength listed before the dumbbell option. Dumbbell and glute templates use six movements per session. The dumbbell adaptation omits the lying triceps extension and Zottman curl, replaces the hamstring-curl/deadlift pairing with one dumbbell stiff-leg deadlift, and uses a standard bench press in place of a reverse-grip press. The glute adaptation excludes optional accessory days, uses RDLs for the stiff-leg deadlift, split squats for curtsy lunges, and standard dumbbell squats for jump squats. Keep the original 15–30 second bodyweight bridge holds and per-side lunge logging.

The PPL template has six named sessions (Pull A, Push A, Legs A, Pull B, Push B, Legs B), retaining the heavy-lift rotation and both lateral-raise supersets. Use supported rows, pulldowns, seated dumbbell extensions, and standing calf raises where the source offers variations. Rest defaults are 180 seconds for its first lift and 90 seconds for accessories, within the source's ranges. Barbell 5×5 uses 180-second rests, has no AMRAP flag, and excludes optional assistance work. All weight progression remains a user decision informed by the linked original source.

Preserve optional program provenance (`sourceName`, `sourceReviewedAt`, `adaptationNote`) in private copies so users do not lose the adaptation details after selection. Old saved programs remain valid without these fields.

PHUL preserves all four sessions and their exercise order. Choose three sets for source ranges starting at three, two for ranges starting at two, and four for Lower Power calf raises. Main strength lifts retain 3–5 reps; hypertrophy compounds retain 8–12. Use barbell curls, lying barbell triceps presses, incline barbell presses, incline dumbbell curls, front squats and barbell lunges with pinned demonstration assets. Rest defaults are app choices disclosed in the adaptation note.

Timed prescriptions display SEC in the session table and expose a seconds input. The existing numeric logged-set field stores the duration, interpreted by the frozen prescription.seconds flag. Test a bridge hold through mock and real PostgreSQL sessions, including second-device restoration.

## Verification completed

- `npm run check`: zero errors and warnings. `npm run test:mock`: all 12 client checks passed, including exported catalogue parity and local image SHA256 checks.
- `GOCACHE=/private/tmp/bodybuilder-go-cache go test -race ./catalogue ./domain ./service` and `go vet ./catalogue ./domain ./service`: passed. Catalogue checks validate all seven templates, source-sensitive prescriptions and backward compatibility; service checks copy every template twice with independent identities/superset groups.
- Mock `tests/programs.spec.ts tests/workouts.spec.ts`: 18 Chromium/WebKit checks passed with zero retries. Each new plan is chosen, scheduled, previewed, opened in its technique guide and restored. The timed bridge input saves seconds, omits weight and survives reload.
- Live `tests/live/workouts.spec.ts`: six Chromium/WebKit checks passed with zero retries. Five new plans retain their provenance and prescriptions through Go/PostgreSQL; edits/calendar choices sync to a separate device. A 20-second bridge hold retains its timed prescription and restores on both devices.
- Production `tests/pwa.spec.ts`: two checks passed with zero retries, including the production build and offline shell/local-record reload. Total targeted browser checks for this change: 26.
- All 25 new technique-source paths were verified against the complete tree of the pinned Free Exercise DB commit. Phone chooser, PHUL preview and glute-hold preview captures inspected. All 50 existing exercise guides were retained; 25 new locally served photographs/guides added, totaling 77 exercises (including the two existing explicit image fallbacks).
- Both owned live-test schemas were removed by the E2E helper; test API/preview listeners stopped. The existing development API on 8081 was reloaded from the newly built executable with its existing configuration/database. The user preview on 5174 remains available. Account programs/calendar records were not reassigned.

Local reports: `/private/tmp/bodybuilder-programs/final-mock/report`, `/private/tmp/bodybuilder-programs/final-live/report`, and `/private/tmp/bodybuilder-programs/production/report`. Normal development API remains running for the preview.

## Deployment packaging verified

On 10 October 2026, both existing production Dockerfiles built successfully from the updated source. The extracted Go executable contains all seven template IDs. The frontend image includes all 77 exercise asset references with bytes matching the checked-in source files, and its production Node server returns the homepage and new JPEGs successfully. Temporary verification containers were removed. Build logs and the packaging result are in `/private/tmp/bodybuilder-deploy-08234cf461`.

Commit the catalogue, domain/UI changes, guides, photographs and regression tests together. The existing `main` publish workflow builds both GHCR images from those files. Pull and redeploy both images after publication; no database migration or account-program reassignment is needed.
