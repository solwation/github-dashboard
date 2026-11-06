// Repository catalog revalidation (#421): a signed-in session looks for newly accessible
// repositories about once an hour while the app is in use. The caller drives `check()` from
// its existing clocks (paused in hidden tabs), so resuming catches up one overdue check and
// a hidden or offline app sends nothing. The list request is ETag-conditional.
import type { Repo } from "./model";

export const CATALOG_REVALIDATE_MS = 60 * 60 * 1000;
/** Opening the project picker revalidates a catalog older than this. */
export const CATALOG_PICKER_FRESH_MS = 5 * 60 * 1000;
/** A failed check waits at least this long (or the server's Retry-After) before retrying. */
export const CATALOG_RETRY_MS = 10 * 60 * 1000;

/** Identifies the account/client a check belongs to; any changed element invalidates it. */
export type CatalogScope = readonly unknown[];

export interface CatalogRevalidationOptions {
  /** Current account scope, or null when no signed-in catalog applies (demo, public, signed out). */
  scope(): CatalogScope | null;
  /** Online, not connecting/restoring and outside rate-limit backoff. */
  allowed(): boolean;
  fetch(): Promise<Repo[]>;
  /** Called only while `scope()` still equals the scope the fetch started in. */
  apply(repositories: Repo[]): void;
  /** Server-requested delay after a failure (e.g. Retry-After), in milliseconds. */
  retryAfterMs?(error: unknown): number | undefined;
  now?(): number;
}

function sameScope(a: CatalogScope | null, b: CatalogScope | null) {
  return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

export function createCatalogRevalidation(options: CatalogRevalidationOptions) {
  const now = options.now || Date.now;
  let state: { scope: CatalogScope; checkedAt: number; retryAt: number } | null = null;
  let inFlight: { scope: CatalogScope; promise: Promise<boolean> } | null = null;

  function current(scope: CatalogScope) {
    // A new account starts unchecked; nothing from the previous scope carries over.
    if (!state || !sameScope(state.scope, scope)) state = { scope, checkedAt: Number.NEGATIVE_INFINITY, retryAt: 0 };
    return state;
  }
  /** The caller just loaded the catalog itself (sign-in/connect); the next check is an hour away. */
  function markFresh() {
    const scope = options.scope();
    if (scope) Object.assign(current(scope), { checkedAt: now(), retryAt: 0 });
  }
  /** Runs one revalidation when due. Resolves true when a fresh catalog was applied. */
  function check(maxAge = CATALOG_REVALIDATE_MS): Promise<boolean> {
    const scope = options.scope();
    if (!scope) return Promise.resolve(false);
    if (inFlight && sameScope(inFlight.scope, scope)) return inFlight.promise;
    const entry = current(scope), time = now();
    if (time < entry.retryAt || time - entry.checkedAt < maxAge || !options.allowed()) return Promise.resolve(false);
    const flight: { scope: CatalogScope; promise: Promise<boolean> } = { scope, promise: Promise.resolve(false) };
    inFlight = flight;
    flight.promise = (async () => {
      try {
        const repositories = await options.fetch();
        if (!sameScope(options.scope(), scope)) return false;
        Object.assign(current(scope), { checkedAt: now(), retryAt: 0 });
        options.apply(repositories);
        return true;
      } catch (error) {
        // Keep the last usable list; retry later, never before a server-requested delay.
        if (sameScope(options.scope(), scope)) {
          const server = options.retryAfterMs?.(error);
          current(scope).retryAt = now() + Math.max(CATALOG_RETRY_MS, server !== undefined && Number.isFinite(server) ? server : 0);
        }
        return false;
      } finally {
        if (inFlight === flight) inFlight = null;
      }
    })();
    return flight.promise;
  }
  return { check, markFresh, reset: () => { state = null; inFlight = null; } };
}

/**
 * Next own-repository list after a revalidation: fetched entries in GitHub's order, carrying
 * over cached project icons, plus selected repositories GitHub no longer listed (the board
 * reports their errors; a catalog check never deselects anything).
 */
export function mergeRepositoryCatalog(previous: readonly Repo[], fetched: readonly Repo[], keep: readonly string[]): Repo[] {
  const known = new Map(previous.map(repo => [repo.full_name, repo]));
  const seen = new Set<string>();
  const next: Repo[] = [];
  for (const repo of fetched) {
    if (!repo || typeof repo.full_name !== "string" || seen.has(repo.full_name)) continue;
    seen.add(repo.full_name);
    const old = known.get(repo.full_name);
    next.push(old?.projectIcon && !repo.projectIcon ? { ...repo, projectIcon: old.projectIcon } : repo);
  }
  const kept = new Set(keep);
  for (const repo of previous) if (kept.has(repo.full_name) && !seen.has(repo.full_name)) next.push(repo);
  return next;
}
