import type { Lane } from "./model";

/**
 * Board time that never runs behind GitHub's own timestamps (#375). A device clock that is slow
 * compared with GitHub put just-started work and new issues in the future, so their timers stood
 * at 0m 0s and their ages counted down. Browsers cannot read GitHub's Date header (it is not
 * CORS-exposed), so each received timestamp is a lower bound for the server time, advanced with
 * the monotonic clock. A correct or fast device clock is used unchanged.
 */
const MAX_SKEW_MS = 86400000;
let anchor: { server: number; monotonic: number } | null = null;
const monotonic = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function boardNow(): number {
  const local = Date.now();
  return anchor ? Math.max(local, anchor.server + monotonic() - anchor.monotonic) : local;
}

/** Records a GitHub timestamp; one beyond the board time moves the board time forward to it. */
export function observeServerTime(value: string | null | undefined): void {
  const time = value ? Date.parse(value) : NaN;
  // A day of skew is no clock difference but bad data; it must not move every timer.
  if (Number.isFinite(time) && time > boardNow() && time - Date.now() < MAX_SKEW_MS) anchor = { server: time, monotonic: monotonic() };
}

export function observeLaneTimes(lanes: readonly Lane[]): void {
  for (const lane of lanes) for (const issue of lane.issues) {
    observeServerTime(issue.created_at);
    observeServerTime(issue.updated_at);
    observeServerTime(issue.closed_at);
    observeServerTime(issue.startedAt);
  }
}

export function resetBoardClock(): void { anchor = null; }
