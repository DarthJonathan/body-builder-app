# Frontend milestone verification

Verified on 9 October 2026 on the local macOS host. This milestone uses the asynchronous, browser-local mock adapter; no training-domain Go service or external AI/food provider is involved.

| Check | Result |
| --- | --- |
| `npm run check` | Passed: zero errors and warnings |
| `npm run test:mock` | Passed: 10 tests |
| `npx playwright test --reporter=list --max-failures=3` | Passed after the draggable-sheet change: 60 cases, 30 scenarios each in mobile Chromium and WebKit, in 40.5 seconds |
| `npm run build` | Passed after the draggable-sheet change |
| `npm run test:ui:production -- tests/pwa.spec.ts --reporter=list --max-failures=2` | Passed earlier in this milestone: two production PWA cases, one per browser engine; not rerun for the sheet-only change |

The browser cases cover all five tabs, responsive navigation, account isolation, unsaved draft cleanup, sign-out/reload, program template copies and scheduling, workout sets/effort/completion, rest deadlines, history navigation, food totals and CRUD/copy/search, dated manual targets, daily weight-and-notes check-ins, lesson CRUD/discovery, and simulated AI/photo draft review. Date tests cover midnight while following Today and while intentionally browsing an earlier day. Tests collect uncaught page errors.

The production PWA cases load through a separate HTTP proxy origin for each test, wait for an active controlling service worker, then drop all proxy connections. A random uncached fetch must reject before the cached app is reloaded. Both engines then decode a bundled exercise photograph, save check-in and workout edits, and preserve those edits across further reloads. The manifest/icons are checked, and API routes must be absent from caches. The tests use actual disconnected transport because WebKit's browser-level offline flag produced an internal navigation error and browser request routing did not block service-worker-owned traffic on this host.

## Local preview origin fix

The user's in-app browser rendered an empty page at `http://localhost:5173/`. Its console reported a failed import of `expense_tracker/frontend/.svelte-kit/generated/client/app.js`, and its page bootstrap still referenced that sibling project. Those references were absent from BodyBuilder's source and generated files.

BodyBuilder now uses its own strict ports: development at `http://localhost:5174/` and production preview at `http://localhost:4174/`. Both existing preview tabs were navigated to the new development origin and visibly rendered the Dashboard. No other application's browser storage was cleared. After the fix, `npm run check` passed with zero errors/warnings and `npx playwright test tests/navigation.spec.ts --reporter=list --max-failures=1` passed all four Chromium/WebKit navigation/date cases in 4.2 seconds.

[Verified in-app preview](screenshots/preview-fixed-local-origin.jpg)

The original 56-case milestone and production PWA run preceded the port change. The latest 60-case development run covers the dedicated port and draggable-sheet follow-up.

## Draggable sheets

The shared sheet handle now captures mouse and touch pointers. Dragging up expands the panel, dragging down collapses it to its content height, and pulling farther down dismisses it. Short and cancelled drags restore the panel. The handle and heading stay fixed while the form scrolls; arrow keys and Enter resize it, and Escape, the close button, and focus restoration remain available. Resizing retains unsaved form fields. Dismissal does not save them. Reduced-motion preferences disable sheet animations.

The four new browser cases verify movement while the pointer is still held, expansion, collapse, dismissal, small-drag snap-back, reopening, draft retention, form scrolling, keyboard controls, and focus restoration. Chromium also verifies native touch expansion and pointer cancellation. WebKit uses real mouse pointer input and scrolls a lower control into view, since its mobile automation API has no mouse wheel. These checks do not claim physical-device touch verification.

The Lesson Notes handle was also dragged up and down in the user's in-app preview at `http://localhost:5174/`. Its expanded/collapsed accessibility state changed, and the existing notes remained intact. No lesson edits were saved.

[Verified draggable Lesson Notes panel](screenshots/draggable-lesson-sheet.jpg)

## Visual review captures

Captured in WebKit at 393 × 852, with a fixed calendar, dark appearance, and reduced motion. These are review captures, not approved golden baselines.

- [Dashboard](screenshots/dashboard-393x852.png)
- [Nutrition](screenshots/nutrition-393x852.png)
- [Workout schedule](screenshots/workout-393x852.png)
- [Workout preview](screenshots/workout-preview-393x852.png)
- [Active workout](screenshots/active-workout-393x852.png)
- [Progress](screenshots/progress-393x852.png)
- [Lessons](screenshots/lessons-393x852.png)

## Boundaries for this preview

- Saved edits are private to the chosen preview email in this browser's local storage. This is neither production authentication nor cross-device synchronization.
- AI answers and photo estimates are simulated. Food search uses a small preview catalogue. Provider settings never accept real credentials.
- Manual nutrition overrides work. The calculated-target policy is awaiting the user's decision, so the calculator is not implemented yet.
- Hero and muscle artwork are temporary original vectors. Bundled exercise photographs can depict related variations; the guide identifies the source variation and provenance.
- Real Go/PostgreSQL integration, provider calls, synchronization/conflict tests, and physical iPhone/Android installation, camera, keyboard, and suspension checks belong to the subsequent milestones.
