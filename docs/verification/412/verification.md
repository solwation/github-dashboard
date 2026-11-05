# #412: compact repository actions

Verified on 2026-11-05 against base `e95f703` plus this issue's changes. Synthetic repositories only; no account or issue snapshots.

The menu keeps the complete owner/repository once in its heading. Swedish and English action text is short; menu and action accessible names retain the repository context. Existing link tooltips, destinations, new-tab behavior and keyboard handling remain intact. The visibility action now explicitly preserves its former full accessible name.

## Checks

- `npx vitest run tests/i18n.test.ts`: 4 passed.
- `npm run build`: passed (source integrity, TypeScript and production output).
- `npx playwright test e2e/sidebar-project-layout.spec.ts e2e/sidebar-visibility-pages.spec.ts -g 'concise project actions|repository context actions|sidebar shows visibility' --workers=1`: 12 passed.
- The focused before-capture test also passed with `PROJECT_ACTIONS_BEFORE=1` against the original component, then the final component was restored.

Browser verification used isolated ports 5412/4412. Explicitly started servers and `E2E_REUSE_SERVER=1` avoid this environment's slow connection probes to unopened ports. The dev response was checked against the intended source before capture; both servers were stopped afterward.

The focused test covers active, hidden, inactive and external repositories, with and without a website; both visibility labels; Swedish and English; light and dark; desktop 1600×1000, 950×900 rail, and genuine mobile/touch 390×844 and 320×568 contexts. The existing context-menu test additionally exercises landscape touch 844×390, arrow keys, Home/End, Escape, Tab, focus return, toggling and outside dismissal. The website regression scenarios retain configured-homepage priority over Pages, safe fallback and keyboard/click navigation.

## Design evidence

48 final menu measurements across repository groups/languages/themes: all action targets are at least 44×44px, action rows are exactly 44px high, common left/right edges align within 1px, and icon vertical-centre drift is 0px. No horizontal page overflow or menu escape from the viewport. Menu text contains the full repository identity exactly once. Long headings wrap without clipping.

| Long-name popup | Before | After |
| --- | ---: | ---: |
| Desktop 1600px, Swedish/English | 231px | 198px |
| Touch phone 390px, Swedish/English | 261px | 198px |
| Touch phone 320px, Swedish/English | 282px | 198px |

No style rules, icons, colour tokens, motion or row geometry changed. Existing light/dark tokens, focus treatment and reduced-motion behavior are preserved. The rail remains 70px with projects hidden. Cards/List are unaffected; their layout matrix is not triggered.

Visually inspected full-size screenshots show a complete header, compact aligned actions and no overlapping text. Representative evidence:

- Desktop Swedish [before](before-actions-1600-sv-light.png) / [after](after-actions-1600-sv-light.png).
- Mobile Swedish [before](before-actions-390-sv-light.png) / [after](after-actions-390-sv-light.png).
- English dark [desktop](after-actions-1600-en-dark.png) / [320px touch](after-actions-320-en-dark.png).
- 950px rail [light](after-actions-950-light.png) / [dark](after-actions-950-dark.png).

Raw screenshots, before/final geometry and run logs remain in the session's `/home/devcontainers/orkester-20261105/evidence-412/`. Integration, repository feature docs, release metadata and publication follow-up belong to the conductor.
