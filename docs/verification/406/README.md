# #406 — quieter List swimlane cells

A List swimlane cell now shows its local count only when its filtered issue count exceeds the current display limit. Empty cells and fully displayed cells have no local counter. Shared status totals remain visible.

Verification:

- The existing swimlane matrix passes all 60 viewport/theme/grouping/view combinations: 1600×1000, 1000×900, touch/mobile 390×844 and 844×390, and touch/mobile 320×568; light/dark; None/Split/Swimlanes; Cards/List. All ten List-swimlane combinations assert there are no redundant local counts, aligned table cells within 1px, no issue-row/page overflow, and accessible unclipped shared sort menus.
- Screenshots visually inspected across desktop, portrait, landscape and narrow phones, both themes, Cards and List. Synthetic long issue/repository titles and timed in-progress rows remain legible; empty cells no longer show a zero counter.
- A focused browser flow sets the display limit to one: three backlog cells show two-item totals, populated one-item and empty progress cells show none. Keyboard activation of Show more hides that cell's counter when both issues appear. Search hides/reinstates the remaining counters; raising the display limit to two removes all local counters while the shared backlog total remains six.
- `npx vitest run tests/release-notes.test.ts tests/publication-gate.test.ts`: 54 passed.
- `npm run build` and `git diff --check`: passed.

Only the existing List-cell counter condition changed; no layout styles or persistence changed. Integration/publication identity and live confirmation are recorded on issue #406.
