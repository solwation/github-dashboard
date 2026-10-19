/** Ad-hoc refresh of a stale repository when the user shows interest in its sidebar entry (#187). */

/**
 * A repository is stale when its last successful refresh is at least this old. Chosen well above
 * the 15-second active-issue tick so only repositories without recent activity are touched.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** After an ad-hoc attempt (successful or not) the same repository is left alone for this long. */
export const COOLDOWN_MS = 60 * 1000;
/** Hovering must rest this long before refreshing, so passing the pointer over the list is free. */
export const HOVER_DELAY_MS = 300;
/** Do not spend quota on ad-hoc refreshes when this few core requests remain. */
export const MIN_REMAINING_QUOTA = 100;

export interface AdhocState {
  now: number;
  /** Start time of the last successful refresh; undefined when none happened this session. */
  lastSuccess: number | undefined;
  /** Start time of the last ad-hoc attempt for this repository. */
  lastAttempt: number | undefined;
  /** A refresh for this repository is already running or queued (dedupe). */
  inFlight: boolean;
  /** Milliseconds GitHub asked us to wait (rate limit / Retry-After); 0 when none. */
  retryAfterMs: number;
  /** Remaining core quota when known. */
  remainingQuota?: number | null;
}

export function isStale(now: number, lastSuccess: number | undefined, staleAfter = STALE_AFTER_MS): boolean {
  return lastSuccess === undefined || now - lastSuccess >= staleAfter;
}

export function inCooldown(now: number, lastAttempt: number | undefined, cooldown = COOLDOWN_MS): boolean {
  return lastAttempt !== undefined && now - lastAttempt < cooldown;
}

/** True when an ad-hoc refresh should start now; every other case skips silently. */
export function shouldAdhocRefresh(state: AdhocState): boolean {
  if (state.inFlight || state.retryAfterMs > 0) return false;
  if (state.remainingQuota != null && state.remainingQuota < MIN_REMAINING_QUOTA) return false;
  if (inCooldown(state.now, state.lastAttempt)) return false;
  return isStale(state.now, state.lastSuccess);
}
