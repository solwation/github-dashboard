import { GitHubApiError } from "./github";

/** A gap this long between heartbeats means the event loop was frozen (a sleeping phone or laptop). */
export const STALL_MS = 15_000;
const HEARTBEAT_MS = 2_000;

type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;
export interface PageSuspensionOptions {
  now?: () => number;
  hidden?: () => boolean;
  offline?: () => boolean;
  windowEvents?: Events;
  documentEvents?: Events;
  /** Tests disable the heartbeat timer and drive stalls through `now`. */
  heartbeat?: boolean;
}

/**
 * Remembers when the page was hidden, frozen, offline or stalled (#434). Requests and cache writes
 * that fail across such a window are expected browser interruptions, not dashboard failures.
 */
export function createPageSuspension(options: PageSuspensionOptions = {}) {
  const now = options.now || Date.now;
  const hidden = options.hidden || (() => typeof document !== "undefined" && document.visibilityState !== "visible");
  const offline = options.offline || (() => typeof navigator !== "undefined" && navigator.onLine === false);
  const windowEvents = options.windowEvents || (typeof window !== "undefined" ? window : undefined);
  const documentEvents = options.documentEvents || (typeof document !== "undefined" ? document : undefined);
  let interruptedAt = Number.NEGATIVE_INFINITY;
  let beat = now();
  // Both edges count: leaving marks the start, returning marks how long the interruption lasted.
  // An ordinary load also fires `pageshow`; only a back/forward cache restore was an interruption.
  const mark = (event: Event) => { if (event.type !== "pageshow" || (event as PageTransitionEvent).persisted) interruptedAt = now(); };
  const windowTypes = ["pagehide", "pageshow", "offline", "online"];
  const documentTypes = ["visibilitychange", "freeze", "resume"];
  for (const type of windowTypes) windowEvents?.addEventListener(type, mark);
  for (const type of documentTypes) documentEvents?.addEventListener(type, mark);
  function pulse() {
    const current = now();
    if (current - beat > STALL_MS) interruptedAt = current;
    beat = current;
  }
  const timer = options.heartbeat === false ? undefined : setInterval(pulse, HEARTBEAT_MS);
  /** Whether the page is or was hidden, frozen or offline at any time after `started`. A request
   * started in the same millisecond as a return event (which also wakes sync) is not interrupted. */
  function interruptedSince(started: number): boolean {
    pulse();
    return hidden() || offline() || interruptedAt > started;
  }
  function stop() {
    clearInterval(timer);
    for (const type of windowTypes) windowEvents?.removeEventListener(type, mark);
    for (const type of documentTypes) documentEvents?.removeEventListener(type, mark);
  }
  return { interruptedSince, stop };
}

/** Failures without an HTTP response: dropped connections, aborted requests and client timeouts. */
export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof GitHubApiError || !(error instanceof Error)) return false;
  return error instanceof TypeError || error.name === "AbortError" || error.name === "TimeoutError" || error.name === "NetworkError";
}
