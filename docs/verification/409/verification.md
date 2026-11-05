# Sidebar website and hover verification (#409)

Verified 2026-11-05 using Chromium and synthetic repositories. No account or issue responses are included in these artifacts.

- `npx vitest run tests/sidebar.test.ts tests/public-workspace.test.ts`: 27 tests passed.
- `npx playwright test e2e/sidebar-project-layout.spec.ts e2e/sidebar-visibility-pages.spec.ts --workers=1`: 15 tests passed.
- `npm run build` and `git diff --check`: passed.
- Configured HTTP(S) websites take precedence; absent, malformed, non-web and credential-bearing URLs fall back to Pages or hide the website action. Public repository metadata retains homepage.
- Full-name hover, accessible status descriptions, separate GitHub/website actions, keyboard navigation and Swedish/English labels pass across active, inactive and external groups, including a mobile touch context.

Inspected the screenshots linked below. Long names truncate without overlap; context-menu names wrap within the viewport. Light/dark themes preserve existing tokens, icon sizes, focus and reduced-motion behavior. No layout/style rules changed. Touch controls retain 44px targets.

The layout check covers 1600×1000, 1000×900, touch 1000×1100, 950×900 rail, touch 390×844, 844×390 and 320×568, each in both themes and three owner-name modes (42 combinations). Maximum repeated-row label, label/count and icon/row-height drift: **0px**. Maximum horizontal page/sidebar overflow: **0px**. The 950px rail correctly hides repository rows. Cards/List content is unaffected; no issue-card matrix is required.

Selected screenshots:

- Desktop: [light](after-1600x1000-light.png), [dark](after-1600x1000-dark.png).
- 950px rail: [light](after-950x900-light.png), [dark](after-950x900-dark.png).
- Mobile drawer: [light](after-390x844-light.png), [dark](after-390x844-dark.png).
- Website and separate GitHub actions: [long-name desktop](actions-long-1600x1000-light.png), [narrow touch dark](actions-320x568-dark.png).

Runner note: this environment times out connections to unopened localhost ports. Both worktree servers were therefore started explicitly on 5409/4409, the served component was checked for this change, and Playwright used `E2E_REUSE_SERVER=1` for these own servers only. All owned servers were stopped after verification. Integration/release metadata and live Pages checks belong to the conductor.
