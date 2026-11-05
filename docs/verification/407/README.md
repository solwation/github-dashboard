# #407 — Joined / Samlad board grouping

The combined-board option is labelled **Joined** in English and **Samlad** in Swedish. Split and Swimlanes retain their labels; the tooltip continues to explain the shared board. The stored/QR value remains `none`, retaining existing settings and transfer compatibility.

Checks on the delivered implementation:

- 29 existing unit tests: board grouping, localization and release notes.
- Four existing grouping browser flows: counts, filters, Cards/List, keyboard selection, persistence, QR/legacy transfers, and mobile/touch 390×844, 844×390 and 320×568.
- 24 additional toolbar checks: Swedish/English × light/dark × Cards/List at desktop1600×1000, rail950×900 and mobile/touch390×844. Exact labels and combined-board selection are correct, saved choice remains `none`, no page/button overflow, button tops align within1px and touch targets remain at least44px. Screenshots inspected.
- `npm run build` and `git diff --check` pass.

No card/list-row layout or storage behavior changes; the focused toolbar checks complement the retained grouping flows. Reviewed screenshots and actual publication verification are linked on issue #407.
