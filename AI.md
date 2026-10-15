# AI workflow

This file applies to all work in this repository, regardless of which AI tool performs it. Read it before making changes. The user's current instructions take precedence.

## Issues and priority

- Every change needs a GitHub issue before implementation, including documentation, fixes, features and workflow changes. Reuse an existing issue when its scope already covers the work. Include concrete acceptance criteria.
- Every issue must carry exactly one of `priority: high`, `priority: medium`, or `priority: low`. Default to `priority: medium`; do not change an existing priority without user direction.
- Add `in-progress` immediately before actively working on an issue. Remove it when work is paused, handed back, finished, closed, or reopened. Closed issues must not retain `in-progress`.
- Work on one issue at a time. Take the highest-priority unclaimed issue, oldest first within a priority. Respect any explicit order or scope given by the user. Do not claim another contributor's active issue.
- When scope expands, create or update the relevant issues. Keep unfinished work tracked and explain any actual blocker on its issue.

## Implementation and Git

- Inspect `git status` and preserve work you do not own. Use `rg` to find relevant code and project instructions.
- The user has authorized committing and pushing directly to `main`; no PR or additional confirmation is required for this project's requested work.
- Keep commits scoped to an issue. Reference it with `Fixes #N` when acceptance criteria are satisfied. Remove `in-progress` when closing it. Do not close an issue merely because implementation has started.
- Before pushing, fetch `origin main`, inspect divergence, and rebase your own commits if necessary without overwriting someone else's changes. Never force-push `main`.
- Verify appropriate behavior locally, then verify the GitHub Actions / Pages deployment after pushing. Resolve failures before reporting completion.

## Project and verification

- Vue 3 + TypeScript; static frontend hosted at `https://solwation.github.io/github-dashboard/`.
- GitHub issue state and labels are authoritative. The dashboard reads GitHub; changing an issue requires an explicitly requested write feature.
- Follow the existing detection rules and per-repository overrides rather than hard-coding private issue contents or account credentials.
- Tokens stay in memory. Do not commit tokens, client secrets, private issue snapshots, or real credential-bearing QR codes. Public Pages assets, service worker caches and local storage must not contain them.
- Keep keyboard access, accessible names, mobile layouts and `prefers-reduced-motion` support when changing UI behavior.
- `npm test` checks pure logic and transport behavior. `npm run test:e2e` checks browser flows; run `npx playwright install chromium` once if needed. `npm run build` checks types and production output. Run the checks appropriate to the issue; avoid redundant tests that only mirror implementation.
- Update `README.md` when behavior or setup changes. Keep this file current when the project workflow changes.
