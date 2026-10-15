# github-dashboard
Github Dashboard · **Issueflow**

Vue 3 + TypeScript dashboard for GitHub Issues, hosted on GitHub Pages.

**Site:** https://solwation.github.io/github-dashboard/

## Run locally

```sh
npm ci
npm run dev
npm test
npx playwright install chromium # first time only
npm run test:e2e
npm run build
```

Node 22.20+ recommended. The frontend builds to `dist/`. Pushes to `main` test, build and deploy using `.github/workflows/pages.yml`. Pages must use **GitHub Actions** as its source (configured for this repository).

## Connect your account

The site supports a personal access token immediately, without any backend. Create a fine-grained token with **Issues: read** and **Metadata: read** for the repositories you want to follow. The token is held **only in browser memory**; reloading or leaving the page requires signing in again. Repository selections and custom label rules are saved locally per GitHub username; issues and tokens are never saved to local storage or published with the site. Organization restrictions and SSO can limit which repositories GitHub returns.

The dashboard only reads GitHub. Open an issue card to change its labels or state on GitHub. An unconnected demo contains fictional public examples, never a snapshot of private repositories.

## Enable GitHub OAuth sign-in

GitHub Pages cannot execute server code. GitHub's authorization code exchange requires a client secret, so `auth/worker.ts` is a small, separate Cloudflare Worker. The application remains on Pages. See [GitHub's OAuth documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

1. Register an [OAuth App](https://github.com/settings/applications/new). Use homepage and callback URL `https://solwation.github.io/github-dashboard/` (including the trailing slash).
2. Put the public client ID in `auth/wrangler.toml`. Verify `ALLOWED_ORIGIN` and `REDIRECT_URI`. For local OAuth, use a separate app and worker with the local origin and exact callback URL.
3. From `auth/`, run `npx wrangler secret put GITHUB_CLIENT_SECRET`, then `npx wrangler deploy`. Store the secret only with Cloudflare. Never add it to a `VITE_` variable, source file or GitHub Pages build.
4. Set repository **Actions variables** `VITE_GITHUB_CLIENT_ID` and `VITE_AUTH_URL` (the Worker's HTTPS origin, without `/exchange`), then rerun the Pages workflow. For development copy `.env.example` to `.env.local` and fill in these same public values.

The frontend verifies a random, expiring, single-use OAuth state and uses PKCE S256. The Worker accepts JSON requests only from the configured origin and exchanges codes using a fixed callback URL. Tokens are not logged or persisted; expiring tokens require signing in again. The OAuth app requests `repo read:user` to support private repositories. GitHub OAuth's `repo` scope is broader than this dashboard's read-only operations; use a fine-grained token if you prefer narrowly scoped read access.

OAuth is implemented but requires your OAuth App registration and Worker deployment before its sign-in button is enabled. No credentials are included in this repository.

## Board behavior

- Each selected repository has **Backlog**, **In progress**, and **Closed** columns.
- Backlog sorts high → medium → low, then oldest first within each level. Missing priority defaults to medium.
- Automatic priority detection accepts `priority:high`, `priority: high`, `high priority`, critical/urgent, `P0`/`P1` (high), `P2` (medium), and `P3`/`P4` (low). `reviewer-filed` falls below normal work unless an explicit higher priority is present. `sp-N` is effort, not priority.
- Work detection accepts `in-progress`, spacing/underscore variants, `status: in-progress`, `wip`, `doing`, `working` and `pågår`. A closed state always wins over a stale work label.
- Per-repository settings override exact work and priority label names. Unknown arbitrary conventions are not inferred from label color or issue text.
- Timers use the fully paginated issue event history. Removing and reapplying a work label starts a new interval. Closure/reopening clears the previous interval. No timer is fabricated from `updated_at`; unknown or inaccessible history is shown explicitly. Timers tick every second, and GitHub data refreshes every minute while the tab is visible or a selected project has notifications enabled.
- Closed shows issues **closed in the last 30 days**, newest closure first. Open issues and matching recent closed issues are fully paginated; pull requests are excluded. Counts represent this window, not lifetime completion. Six cards initially appear in each column; **Visa fler** reveals more.
- Newly closed issues slide into Closed and briefly glow green. Reduced-motion preferences use a static highlight instead. Initial loads and repeated refreshes do not replay old closures; reclosures are detected by their new closure timestamp. Each closed card shows the local date and time, with the full timestamp in its tooltip.
- The bell in each repository header toggles desktop notifications for that repository. Preferences are stored per GitHub account on this device. Permission is requested only when enabling notifications. Blocked/unsupported browsers get an explanation; notifications that cannot be delivered are disabled rather than silently failing. Background polling continues for selected subscribed repositories, but browsers may throttle it. Notifications require the dashboard to remain open; this is not server-side push. Coordination filtering applies, search filtering does not suppress notifications. See [Notifications API browser support](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).
- Coordination issues (`agent-coordination`, exactly `orkester`) are hidden by default. `orkester: …` is ownership metadata and does not hide active work. `blocked`, `awaiting-owner`, and `needs-deploy` stay visible as labels; they do not pretend to be active work.
- API errors are isolated per repository. On refresh failure, previously fetched lane data remains visible with a warning. Timer-history failures do not prevent the rest of the lane from loading. GitHub API rate limits still apply, particularly for large selections.

## Project research

Read-only inspection of the local CLAUDE.md files and live GitHub label definitions identified Lunden's `priority: high/medium/low` convention and Untappdbolaget's `high priority`, `reviewer-filed`, `in-progress`, coordination, waiting and deployment labels. Only those conventions inform the generic detection rules; no private issue titles, descriptions or account tokens are bundled into the frontend.
