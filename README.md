# Issueflow

Your GitHub issues. One clear board.

**[Open Issueflow →](https://solwation.github.io/github-dashboard/)**

Follow work across repositories without switching tabs. Backlog sorts by priority, active work shows elapsed time, and Closed keeps the last 30 days in view.

- **Your layout:** reorder projects, collapse repositories and set how many cards each column shows.
- **The context you need:** read issue descriptions, comments and closing commit details.
- **Ready when you return:** encrypted local sign-in and content cache, with automatic GitHub updates.
- **At your desk or on your phone:** responsive columns, keyboard controls, Swedish and English.

Issueflow reads GitHub. Make issue changes on GitHub; private content stays in your browser's encrypted storage.

## Connect

Use a fine-grained GitHub token with **Issues: read** and **Metadata: read**. Add **Contents: read** and **Pull requests: read** for private closing commit details. Try the demo first—no account required.

## Run locally

Requires Node 22.20+.

```sh
npm ci
npm run dev
```

Check changes with `npm test` and `npm run build`. For browser tests, install Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`.

## Documentation

- [Setup, OAuth, security and board behavior](docs/guide.md)
- [Issue workflow instructions for AI assistants](public/ISSUEFLOW.md)
- [Repository development workflow](AI.md)
