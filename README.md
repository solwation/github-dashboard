# Issueflow

**See what your AI agents are doing, right from your GitHub issues.**

Issueflow turns the issues your agents (and you) work on into one live board: what's planned,
what's running right now and what just shipped, across all your repositories. There is no
server and nothing to set up: it runs in your browser and talks to GitHub directly.

**[Open Issueflow →](https://solwation.github.io/github-dashboard/)** · try the demo, no account needed

![Issueflow board in Cards view, dark theme](docs/assets/board-cards-dark.png)

## Why Issueflow

- **One board for every repository.** Backlog by priority, In progress with live elapsed time,
  and the last 30 days of Closed work, split per repository or combined. Hide quiet projects
  from the board while keeping them in the menu.
- **Read details in place.** Click or tap a card surface to open or close its description, or focus its description action and press Enter or Space.
  Links and other controls keep their own actions; List view opens details as before.
- **Built for agent workflows.** See which session owns an issue, spot work that may have
  stalled, and follow new comments and moves as they happen.
- **Know how long things take.** Story-point estimates, remaining-time forecasts and actual
  durations, calibrated from your own history.
- **Statistics that answer real questions.** Issue flow, pull requests, code churn and estimate
  accuracy per repository, label or contributor.
- **Keep track of sync problems.** One project-error summary opens full details and retries.
  The header bell keeps the latest 100 info, warning and error events, with an unread badge;
  signed-in history stays encrypted per account, while public browsing history lasts for the session.
- **Recognize your projects.** Shared project-icon boxes use each repository’s own safe artwork,
  or initials when no icon is available, with your project color in the lower-right corner.
- **Private by design.** Your token and cached data stay on your device, encrypted with
  non-exportable AES-GCM keys. There is no backend.
- **Works everywhere.** Installable app with background notifications, phone layout, QR
  sign-in handoff, light and dark themes, Swedish and English.

| List view | Statistics | Phone |
| --- | --- | --- |
| ![List view, light theme](docs/assets/board-list-light.png) | ![Statistics view](docs/assets/statistics-light.png) | ![Phone layout, dark theme](docs/assets/phone-dark.png) |

*Screenshots use the built-in demo with fictional projects.*

## Get started

1. Open **[Issueflow](https://solwation.github.io/github-dashboard/)**.
2. Choose **Explore a demo**, **Follow public repositories** (no key needed), or connect your
   account with a fine-grained GitHub token (**Issues: read** and **Metadata: read**; add
   **Contents: read** and **Pull requests: read** for closing-commit details).
3. Pick your repositories. That's it.

Want your agents to keep the board accurate? Point them at the
[Issue workflow instructions](public/ISSUEFLOW.md): priorities, work labels and ownership
claims that Issueflow understands.

## Run locally

Requires Node 22.20+.

```sh
npm ci
npm run dev
```

`npm test` runs unit tests, `npm run test:e2e` runs browser tests and `npm run build` type-checks
and builds. See the [setup and technical guide](docs/guide.md) for OAuth sign-in, security and
deployment.

## Project icons

Issueflow looks for favicon/icon/logo, apple-touch-icon, icon-192/icon-512, rooticon and
repository-name artwork in the repository root and existing `public`, `assets`, `icons`,
`public/icons` and `public/assets` directories, in that order. Discovery uses at most six
GitHub Contents requests per selected project, with a quota reserve for core board data.
Results, including missing artwork, are cached for 24 hours; routine refreshes do not rescan.

PNG, JPEG, WebP and ICO files up to 64 KiB are decoded as images. SVG icons use a conservative
subset that rejects scripts, external references, CSS, animation and embedded documents;
accepted SVGs render through an inert image into a small PNG. Unavailable, unsupported or
broken images fall back to initials. No owner avatars or external download URLs are used.
Icon content follows the existing encrypted account/public content caches and is never stored
in plaintext browser preferences or shared through QR transfers.

## Learn more

- [Feature reference](docs/features.md): board, settings, notifications, release notes and contributor details
- [Setup, OAuth, security and board behavior](docs/guide.md)
- [Issue workflow instructions for AI assistants](public/ISSUEFLOW.md)
- [Repository development workflow](AI.md) and [design rules](DESIGN.md)
- [Orchestra policy](.orchestra/project.md): `/orkester` uses
  [dirigenten-och-orkestern](https://github.com/solwation/dirigenten-och-orkestern) **v0.7.1**,
  pinned as a squashed Git subtree in `.orchestra/shared`
  ([update policy](.orchestra/project.md#upstream-update-discovery),
  [installation guide](.orchestra/shared/INSTALL.md))

[MIT License](LICENSE) · © 2026 [Olof Wingren](https://github.com/solwation)
