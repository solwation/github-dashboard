# Issueflow

Your GitHub issues. One clear board.

**[Open Issueflow →](https://solwation.github.io/github-dashboard/)**

Follow work across repositories without switching tabs. Backlog sorts by priority, active work shows elapsed time, and Closed keeps the last 30 days in view.

- **Find issues:** combine the global text filter with independent filters per repository; search titles, issue numbers and labels, and clear each repository filter separately.
- **Your layout:** reorder projects, collapse repositories and set how many cards each column shows.
- **The context you need:** read issue descriptions, comments and closing commit details, including embedded images linked to GitHub repository files.
- **Ready when you return:** encrypted local sign-in and content cache, with automatic GitHub updates.
- **At your desk or on your phone:** responsive columns, keyboard controls, Swedish and English.
- **Explore activity:** Statistics compares repositories over the latest 30 UTC calendar days, with daily issue, commit, code-change and pull-request charts. Filter by date, current labels or contributor. Unavailable metrics stay hidden; bounded API collection is marked when incomplete.
- **See changes:** Overview counts briefly highlight increases and decreases, with a daily count of loaded issues closed today in your local timezone.
- **Hear progress:** enable a repository’s notifications for distinct sounds when work starts, closes, becomes blocked or returns to Backlog. Audio resumes after interacting with the dashboard; browsers may delay background updates.

Issueflow reads GitHub. Make issue changes on GitHub; private content stays in your browser's encrypted storage.

## Connect

Use a fine-grained GitHub token with **Issues: read** and **Metadata: read**. Add **Contents: read** and **Pull requests: read** for private closing commit details. Try the demo first—no account required.

Settings includes an expandable issue workflow guide, readable directly in the dashboard.

Settings → GitHub permissions shows verified access and explains which features each read permission enables. A red Settings badge counts permissions with confirmed missing access.

## Run locally

Requires Node 22.20+.

```sh
npm ci
npm run dev
```

Run affected tests locally before pushing; use `npm run build` for code changes. Browser tests need a one-time `npx playwright install chromium`. Actions only builds and publishes.

## Documentation

- [Setup, OAuth, security and board behavior](docs/guide.md)
- [Issue workflow instructions for AI assistants](public/ISSUEFLOW.md)
- [Repository development workflow](AI.md)

[MIT License](LICENSE) · © 2026 [Olof Wingren](https://github.com/solwation)
