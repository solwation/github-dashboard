# Issueflow

Track your AI agents’ work through GitHub issues.

**[Open Issueflow →](https://solwation.github.io/github-dashboard/)**

One view of what your agents plan, work on and complete across your repositories. Follow AI agents that use GitHub issues as their work queue, or track issues you handle yourself. Backlog sorts by priority, active work shows elapsed time, and Closed keeps the last 30 days in view.

- **Find issues:** combine the global text filter with independent filters per repository; search titles, issue numbers and labels, and clear each repository filter separately.
- **Your layout:** reorder projects, collapse repositories and set how many cards each column shows.
- **Issue hierarchy:** parent cards show closed/total sub-issue progress; sub-issues link to their parent, including across repositories. Relations load for visible cards and stay hidden when unavailable. Counts come from GitHub and are independent of dashboard filters.
- **The context you need:** read issue descriptions, comments shown newest first with live relative timestamps for the first seven days (exact time on hover), and closing commit details, including embedded images linked to GitHub repository files.
- **Ready when you return:** encrypted local sign-in and content cache, with automatic GitHub updates.
- **Optical sync:** transfer account, chosen settings and view in either direction using a local QR code. Scan again from Settings while signed in; browser permissions and read/timeout acknowledgements stay on each device.
- **At your desk or on your phone:** responsive columns, keyboard controls, Swedish and English.
- **Explore activity:** Statistics stacks the repositories selected in the sidebar, in their board order, over the latest 30 UTC calendar days, with daily issue, commit, code-change and pull-request charts. Each repository has independent date, current-label and contributor filters. A clear initial loading view shows collection progress; refreshing keeps existing charts visible. Unavailable metrics stay hidden; bounded API collection is marked when incomplete.
- **Active projects:** the Repositories card shows how many selected projects have Backlog, In progress or issues closed in the last 30 days, independently of text filters.
- **New work:** issues created in Backlog after startup get a green “Created in backlog” marker until read or expired. Returning work keeps its separate movement marker.
- **See changes:** Overview counts briefly highlight increases and decreases, with a daily count of loaded issues closed today in your local timezone.
- **Spot stalled work:** Settings defaults to a 30-minute In progress timeout. Verified overdue work turns red and appears in a notice; ignore it for that work period. Acknowledgements stay in the encrypted cache on this device.
- **Hear progress:** enable a repository’s notifications for distinct sounds when work starts, closes, becomes blocked or returns to Backlog. Audio resumes after interacting with the dashboard; browsers may delay background updates.

Issueflow reads GitHub. Make issue changes on GitHub; private content stays in your browser's encrypted storage.

## Connect

Use a fine-grained GitHub token with **Issues: read** and **Metadata: read**. Add **Contents: read** and **Pull requests: read** for private closing commit details. Try the demo first—no account required.

Settings includes an Issue workflow instructions button that opens a separate, wide popup. Read the bundled ISSUEFLOW.md guide directly in the dashboard, or copy/download it.

Settings → GitHub permissions shows verified access and explains which features each read permission enables. A red Settings badge counts permissions with confirmed missing access.

The sidebar shows the running version (build date and short commit) above the footer, with Release notes. When a new version is published, a visible tab asks first and shows a short summary of what changed: **Update now**, or **Not now** to postpone the automatic prompt until the next calendar day in your time zone (remembered on this device, also for background checks). A background tab installs after a 10-second countdown unless postponed. Until the update is installed, a red (!) badge on the sidebar version opens the update view, also available from Settings → Automatic updates. Updates keep encrypted sign-in, settings and cached content; offline or failed activation keeps the current version running.

## Run locally

Requires Node 22.20+.

```sh
npm ci
npm run dev
```

Run affected tests locally before pushing; use `npm run build` for code changes. The build rejects unresolved merge markers, including those that would otherwise render as text in Vue templates. Browser tests need a one-time `npx playwright install chromium`. Actions only builds and publishes.

## Documentation

- [Setup, OAuth, security and board behavior](docs/guide.md)
- [Issue workflow instructions for AI assistants](public/ISSUEFLOW.md)
- [Repository development workflow](AI.md)

[MIT License](LICENSE) · © 2026 [Olof Wingren](https://github.com/solwation)
