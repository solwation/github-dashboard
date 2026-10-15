export const ACTIVE_SYNC_MS = 15_000;
export const ACTIVE_RECONCILE_MS = 120_000;
export const IDLE_RECONCILE_MS = 300_000;
export const MAX_SYNC_BACKOFF_MS = 300_000;
export type SyncKind = "active" | "reconcile";
export interface IssueSyncOptions {
  /** Read live state: authenticated, not editing, online, and visible or notifications enabled. */
  canSync(): boolean;
  hasActiveIssues(): boolean;
  /** Refresh only currently active issue IDs, including their current state and labels. */
  refreshActive(): Promise<void>;
  /** Incremental repository reconciliation, or a safe full fallback. */
  reconcile(): Promise<void>;
  /** Report failures without clearing lane warnings or existing data. */
  onError?(error: unknown, kind: SyncKind): void;
  onSuccess?(kind: SyncKind): void;
  /** Optional server-provided delay (e.g. parsed Retry-After), in milliseconds. */
  retryAfterMs?(error: unknown): number | undefined;
  now?(): number;
  /** Tests can supply independent event targets; browser defaults listen on window/document. */
  windowEvents?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  documentEvents?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

/** A single-flight scheduler. All callbacks read current app state rather than captured refs. */
export function createIssueSync(options: IssueSyncOptions) {
  const now = options.now || Date.now;
  const windowEvents = options.windowEvents || (typeof window !== "undefined" ? window : undefined);
  const documentEvents = options.documentEvents || (typeof document !== "undefined" ? document : undefined);
  let started = false;
  let busy = false;
  let epoch = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let nextActive = 0;
  let lastReconcile = Number.NEGATIVE_INFINITY;
  let requestedReconcile = true;
  let retryAt = 0;
  let failures = 0;
  let previouslyAllowed = false;

  async function tick() {
    if (!started) return;
    const allowed = options.canSync();
    if (allowed && !previouslyAllowed) requestedReconcile = true;
    previouslyAllowed = allowed;
    if (!allowed || busy || now() < retryAt) return;
    const active = options.hasActiveIssues();
    const reconcileDue = requestedReconcile || now() >= lastReconcile + (active ? ACTIVE_RECONCILE_MS : IDLE_RECONCILE_MS);
    const kind: SyncKind | undefined = reconcileDue ? "reconcile" : active && now() >= nextActive ? "active" : undefined;
    if (!kind) return;
    const runEpoch = epoch;
    if (kind === "reconcile") requestedReconcile = false;
    busy = true;
    try {
      await (kind === "reconcile" ? options.reconcile() : options.refreshActive());
      if (!started || runEpoch !== epoch) return;
      failures = 0;
      retryAt = 0;
      nextActive = now() + ACTIVE_SYNC_MS;
      if (kind === "reconcile") lastReconcile = now();
      options.onSuccess?.(kind);
    } catch (error) {
      if (!started || runEpoch !== epoch) return;
      if (kind === "reconcile") requestedReconcile = true;
      failures++;
      const serverDelay = options.retryAfterMs?.(error);
      const backoff = Math.min(MAX_SYNC_BACKOFF_MS, ACTIVE_SYNC_MS * 2 ** Math.min(failures - 1, 5));
      // Never retry before a valid server-specified limit, even when it exceeds our own cap.
      retryAt = now() + Math.max(backoff, serverDelay !== undefined && Number.isFinite(serverDelay) ? Math.max(0, serverDelay) : 0);
      options.onError?.(error, kind);
    } finally {
      busy = false;
    }
  }
  function wake() {
    if (!started) return;
    requestedReconcile = true;
    // Waking never bypasses a rate-limit or failure backoff.
    void tick();
  }
  function start() {
    if (started) return;
    started = true;
    epoch++;
    requestedReconcile = true;
    previouslyAllowed = false;
    retryAt = 0;
    failures = 0;
    lastReconcile = Number.NEGATIVE_INFINITY;
    windowEvents?.addEventListener("focus", wake);
    windowEvents?.addEventListener("online", wake);
    documentEvents?.addEventListener("visibilitychange", wake);
    timer = setInterval(() => { void tick(); }, 1000);
    void tick();
  }
  function stop() {
    started = false;
    epoch++;
    clearInterval(timer);
    windowEvents?.removeEventListener("focus", wake);
    windowEvents?.removeEventListener("online", wake);
    documentEvents?.removeEventListener("visibilitychange", wake);
  }
  return { start, stop, wake };
}
