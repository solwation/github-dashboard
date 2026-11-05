# Compact event history (#411)

Verified 2026-11-05 against baseline `e95f703`, using Chromium and synthetic account/events. The bell popup retains every message, repository, severity and timestamp. Message text stays 13px; repository text stays 12px and severity/time 11px. Desktop metadata shares a line; phone metadata wraps the repository onto its own line. Row padding drops from 16px to 8px per side, message spacing from 8px to 4px, and description margins from 16px to 8px.

Measured row heights (same synthetic content and viewport, identical in both themes):

| Viewport | Regular project error | Long repository + unbroken message | Simple information | Entire four-row timeline |
| --- | --- | --- | --- | --- |
| 1600×1000 desktop | 104.5 → 60.5px | 198.5 → 178.5px | 80.5 → 60.5px | 26% shorter |
| 950×900 rail | 104.5 → 60.5px | 198.5 → 178.5px | 80.5 → 60.5px | 26% shorter |
| 390×844 touch phone | 124 → 100px | 344 → 316.5px | 80.5 → 60.5px | 14% shorter |
| 844×390 touch landscape | 104.5 → 60.5px | 198.5 → 178.5px | 80.5 → 60.5px | 26% shorter |
| 320×568 touch phone | 124 → 100px | 418.5 → 414.5px | 80.5 → 60.5px | 10% shorter |

Long content remains fully readable and naturally needs more space. No row grew. Raw geometry: [before](before/geometry.json), [after](after/geometry.json).

Selected before/after screenshots, visually inspected for overlap, wrapping, focus and theme parity:

| Scenario | Before | After |
| --- | --- | --- |
| Desktop light | [Before](before/events-1600x1000-light-dialog.png) | [After](after/events-1600x1000-light-dialog.png) |
| Desktop dark | [Before](before/events-1600x1000-dark-dialog.png) | [After](after/events-1600x1000-dark-dialog.png) |
| Rail light | [Before](before/events-950x900-light-dialog.png) | [After](after/events-950x900-light-dialog.png) |
| Rail dark | [Before](before/events-950x900-dark-dialog.png) | [After](after/events-950x900-dark-dialog.png) |
| Phone light | [Before](before/events-390x844-light-dialog.png) | [After](after/events-390x844-light-dialog.png) |
| Phone dark | [Before](before/events-390x844-dark-dialog.png) | [After](after/events-390x844-dark-dialog.png) |

Checks passed:

- Existing diagnostics matrix captured before edits; all five `e2e/event-history.spec.ts` tests passed afterward (17.2s), including error/retry/recovery, stable snapshots/new arrivals, read badges, encrypted per-account isolation, keyboard focus trap, Escape and focus restoration.
- Geometry across five viewports and both themes: content left-edge drift 0px, severity/icon center drift 0px, horizontal page/dialog/row overflow 0px. Mobile/touch bell and dialog controls retain at least 44px targets.
- All spacing changes use existing 4px-grid tokens; colors and icons retain theme/semantic tokens. No animation was added; reduced-motion contexts passed. Existing accessible dialog and button names remain intact.
- `npm run build` and `git diff --check` passed. The targeted presentation change requires no new unit-logic tests or issue Cards/List matrix.

Servers were verified to serve this worktree on 5411/4411, reused explicitly for Playwright, and stopped after verification. EventHistory has no issue-navigation links in the baseline; this change preserves its existing interactions. Integration, release metadata and live publication checks belong to the conductor.
