# Issueflow

Track your AI agents’ work through GitHub issues.

**[Open Issueflow →](https://solwation.github.io/github-dashboard/)**

One view of what your agents plan, work on and complete across your repositories. Follow AI agents that use GitHub issues as their work queue, or track issues you handle yourself. Backlog sorts by priority, active work shows elapsed time, and Closed keeps the last 30 days in view.

- **Find issues:** combine the global text filter with independent filters per repository; search titles, issue numbers and labels, and clear each repository filter separately.
- **Split or combine:** Split by repository is on by default; uncheck it for one board covering every selected project. Split lanes are headed by their repository; on the combined board each card shows a repository badge in a contrasting palette color matching the sidebar dot. The combined board is filtered by the main search alone; per-repository searches apply only in the split view and keep their values. Color assignments stay stable when sorting or changing the selection, are saved per account and follow QR sync alongside the view choice. Combined columns use the global card limit.
- **Cards or list:** A Cards/List switch shows a compact row per issue with number, title, status, priority, main labels and time. With Split by repository on, each repository header has its own switch; the combined board has one shared switch and adds a repository column with name and color. Filters, column limits, Show more, timeout and movement markers work in both modes. The choices switch instantly without refetching, are saved in the encrypted account settings and follow QR sync.
- **Your layout:** reorder projects, collapse repositories and set how many cards each column shows. Confirmed repository selections appear immediately; new projects show loading while existing data stays visible.
- **Issue hierarchy:** parent cards show closed/total sub-issue progress; sub-issues link to their parent, including across repositories. Relations load for visible cards and stay hidden when unavailable. Counts come from GitHub and are independent of dashboard filters.
- **The context you need:** read issue descriptions, comments shown newest first with live relative timestamps for the first seven days (exact time on hover), and closing commit details, including embedded images linked to GitHub repository files.
- **Ready when you return:** encrypted local sign-in and content cache, with automatic GitHub updates. Repositories with active work are checked every 15 seconds with one conditional request each, so unchanged checks do not use your GitHub rate limit and do not rewrite the encrypted cache; sub-issue relations reload when an issue changes, on a full refresh or after 10 minutes. Account settings are encrypted per account on this device and come back when you sign in again after logout.
- **Optical sync:** transfer account, chosen settings and view in either direction using a local QR code. Scan from the QR popup or Settings while signed in; browser permissions and read markers stay on each device. Codes carry a compact binary profile as QR numeric digits, keeping them small enough for laptop webcams; older base64 codes remain readable. A link or scanned code for a different account never replaces a saved sign-in without a confirmation naming both accounts; canceling keeps the saved session.
- **At your desk or on your phone:** responsive columns, keyboard controls, Swedish and English.
- **Light or dark:** Settings → Theme offers Auto (default), Light and Dark. Auto follows your device’s color scheme live; a manual choice overrides it. The choice is saved per browser, survives reload and logout/login, and applies before the first paint so dark mode never flashes light. Colors are CSS tokens redefined for dark mode, with readable text, charts and repository colors.
- **Explore activity:** Statistics stacks the repositories selected in the sidebar in board order, with daily issue, commit, code-change and pull-request charts over the latest 30 UTC calendar days. Clicking a sidebar repository scrolls to its statistics without leaving the page. Each repository has independent date, current-label and contributor filters. A clear initial loading view shows collection progress; refreshing keeps existing charts visible. Unavailable metrics stay hidden; bounded API collection is marked when incomplete. Charts fill their panels while keeping lines, points and labels at a consistent size. Encrypted statistics restore immediately on return (up to 10 repositories, 8 MiB, seven days). Complete commit history reuses historical days and overlaps the previous last UTC day; immutable SHA diffs are reused. Issues, events and PRs are revalidated, and full commit membership is checked every seven days or with Refresh. Issues reuse the board's lists when they were confirmed within the last five minutes, and other lists revalidate with ETags, so unchanged data costs no rate limit.
- **Active projects:** the Repositories card shows how many selected projects have Backlog, In progress or issues closed in the last 30 days, independently of text filters.
- **New work:** issues created in Backlog after startup get a green “Created in backlog” marker until read or expired. Returning work keeps its separate movement marker.
- **See changes:** Overview counts briefly highlight increases and decreases, with a daily count of loaded issues closed today in your local timezone.
- **Spot stalled work:** Settings defaults to a 30-minute In progress timeout. Verified overdue work turns red on its card for the rest of that work period, with a notification once per period when enabled. Time labels update on their own: seconds only while shown on screen, and not at all in hidden tabs or while Statistics is open, so large boards stay light.
- **Hear progress:** enable a repository’s notifications for distinct sounds when work starts, closes, becomes blocked or returns to Backlog. Audio resumes after interacting with the dashboard; browsers may delay background updates.
- **Notifications while closed:** the installed app in Chrome or Edge can notify you about closed, started, returned, reopened and timed-out issues in repositories that are selected with notifications on, even when no window is open. See [limitations](#background-notifications).

Issueflow reads GitHub. Make issue changes on GitHub; private content stays in your browser's encrypted storage.

## Background notifications

Background checks use Periodic Background Sync and work only in Chromium browsers (Chrome, Edge) with Issueflow installed as an app, signed in and with notification permission granted. Safari and iOS are not supported; other browsers notify only while the dashboard is open.

- **The browser decides when to check.** Issueflow asks for about one check per hour, but the browser chooses the interval from its own engagement and battery heuristics, often several hours apart and never guaranteed. Checks may stop entirely while the device sleeps or the app is rarely used.
- **The first check is silent.** It records a baseline; later checks notify only about changes since the previous check. Checks older than 24 hours start a new silent baseline, so stale changes are not announced. An open, visible app window announces changes itself and the background check only updates its baseline.
- **Everything stays on the device.** There is no server, webhook or push service: the browser wakes the service worker, which reads the token and settings from the encrypted local stores, asks GitHub directly and keeps the last seen state as AES-GCM ciphertext in IndexedDB. Logout clears it with the rest of the content cache.

## Connect

Use a fine-grained GitHub token with **Issues: read** and **Metadata: read**. Add **Contents: read** and **Pull requests: read** for private closing commit details. Try the demo first—no account required.

Settings groups permissions, workflow instructions, automatic updates and QR scanning in a consistent button list. Update prompts stack their action buttons vertically and show the ten-second countdown inside Update now (10); opening a dialog pauses the countdown, while Not now defers until tomorrow. The sidebar shows whether a version check confirmed the latest version, found an update, or has not completed. The Issue workflow instructions button opens a compact popup with the full bundled Markdown in a scrollable textarea and a Copy instructions button.

Settings → GitHub permissions shows verified access and explains which features each read permission enables. A red Settings badge counts permissions with confirmed missing access that you have not viewed. Viewed notices stay acknowledged per account on this device after reload or logout/login; the permission table keeps showing the actual access results.

The sidebar shows the running version (build date and short commit) above the footer, with Release notes. When a new version is published, every open tab, visible or in the background, shows a short summary of what changed and installs it after a 10-second countdown shown in **Update now (10)**. Open dialogs pause the countdown and closing them restarts the full ten seconds. **Not now** postpones the automatic prompt until the next calendar day in your time zone (remembered on this device, also for background checks). Until the update is installed, a red (!) badge on the sidebar version opens the update view, also available from Settings → Automatic updates. Updates keep encrypted sign-in, settings and cached content; offline or failed activation keeps the current version running.

## Release notes

What's new is written per day in Swedish and English in [`src/release-notes.json`](src/release-notes.json), newest day first. Each day has a short summary and a few readable sections about user benefit, each listing the related issue numbers. Only changes published on `main` are included; no secrets or private repository content.

The build bundles the notes and also publishes `release-notes.json` next to `index.html` with the build identity (`builtAt`, `commit`). An older installed version can fetch it without a token, sign-in or AI access to show what changed since it was built; the file is always fetched from the network, never from the app-shell cache.

Keeping notes current: every published user-facing change adds to or updates that day's entry (Europe/Stockholm date) in the same commit. Merge related work into the existing sections rather than adding one line per issue or commit, and do not describe unpublished or later-replaced behavior. `tests/release-notes.test.ts` validates the file.

## Run locally

Requires Node 22.20+.

```sh
npm ci
npm run dev
```

Use Node.js 22. `npm ci` applies the version-23 jsQR compatibility correction used by optical profile sync.

Run affected tests locally before pushing; use `npm run build` for code changes. Integration pushes are allowed while work remains; GitHub Actions decides publication through a fresh issue/delta gate before building and again before deployment. Unfinished or active issues block publication; locally verified, unclaimed `needs-deploy` issues must appear in the prepared delta. Manual deployment never bypasses the gate. Orkester watches for new issues every minute for 60 minutes after the last verified release; new completed work restarts that window. Generate the popup summary in `src/update-summary.json` from that publication’s delta against the previously deployed build (maximum 180 characters per language). Full daily notes remain available through Read more. The build rejects unresolved merge markers, including those that would otherwise render as text in Vue templates. Browser tests need a one-time `npx playwright install chromium`. Actions only builds and publishes.

## Documentation

- [Setup, OAuth, security and board behavior](docs/guide.md)
- [Issue workflow instructions for AI assistants](public/ISSUEFLOW.md)
- [Repository development workflow](AI.md)

[MIT License](LICENSE) · © 2026 [Olof Wingren](https://github.com/solwation)
