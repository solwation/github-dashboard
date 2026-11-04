# #405 — automatic updates after a hard reload

An uncontrolled page after Chromium's cache-bypassing reload ignored a newer waiting service worker. If an update did claim it, its first controller was mistaken for the page's own build, losing the update before the countdown completed.

The controller now recognizes installed/waiting updates even without a previous controller. A first claim following an offered update keeps that worker eligible for the countdown and activation, while an ordinary first installation stays silent.

## Regression evidence

Before the fix, both new unit cases failed because no update was offered. A browser test using two actual production builds also failed because no update prompt appeared. The initial correction exposed the second failure: the worker automatically activated on the uncontrolled page, but the countdown ended with an activation error. Both paths are covered now.

- `tests/app-update.test.ts`: already-waiting and newly-installed updates on an uncontrolled page, activation before/after the countdown, and exactly one reload. Existing first-install, deferral, offline, retry and dialog-pause cases remain covered.
- `tests/service-worker.test.ts`: existing shell freshness, takeover, offline fallback and private-request exclusions.
- `e2e/app-update.spec.ts`: actual old/new production bundles behind ten-minute HTTP caching, a CDP hard reload leaving no controller, and automatic countdown loading the new build and computed external CSS marker without another click or reload. Saved preferences survive. Existing multi-tab, deferral, first-install, failed-install, cleanup failure and dialog cases remain covered.
- The encrypted-PAT cache-bypassing reload case in `e2e/auth-vault.spec.ts` verifies existing credential persistence independently; no credential/storage code changed.

Publication identity and final check results are recorded on issue #405 after integration.
