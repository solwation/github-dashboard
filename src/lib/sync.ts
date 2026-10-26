export const ACTIVE_SYNC_MS = 15_000;
export const ACTIVE_RECONCILE_MS = 120_000;
export const IDLE_RECONCILE_MS = 300_000;
export const MAX_SYNC_BACKOFF_MS = 300_000;
export type SyncKind = "active" | "reconcile";

export function syncBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_SYNC_BACKOFF_MS, ACTIVE_SYNC_MS * 2 ** Math.min(failures - 1, 5));
}

export class RepositoryBackoff {
  private readonly failures = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly backoffMs: (failures: number) => number = syncBackoffMs,
    private readonly now: () => number = Date.now,
  ) {}

  isBackingOff(name: string, now = this.now()): boolean {
    const at = this.retryAt.get(name);
    return at !== undefined && now < at;
  }

  isDue(name: string, now = this.now()): boolean {
    const at = this.retryAt.get(name);
    return at !== undefined && now >= at;
  }

  recordFailure(name: string, now = this.now()): number {
    const count = (this.failures.get(name) || 0) + 1;
    this.failures.set(name, count);
    const delay = this.backoffMs(count);
    const until = now + delay;
    this.retryAt.set(name, until);
    return until;
  }

  recordSuccess(name: string): void {
    this.failures.delete(name);
    this.retryAt.delete(name);
  }

  retryTime(name: string): number | undefined {
    return this.retryAt.get(name);
  }

  failureCount(name: string): number {
    return this.failures.get(name) || 0;
  }

  shouldSync(name: string, options: { hasActive: boolean; reconcile: boolean; manual?: boolean }, now = this.now()): boolean {
    if (options.manual) return true;
    if (this.isBackingOff(name, now)) return false;
    if (options.reconcile) return true;
    if (options.hasActive) return true;
    if (this.isDue(name, now)) return true;
    return false;
  }

  retain(names: readonly string[]): void {
    const keep = new Set(names);
    for (const key of this.failures.keys()) {
      if (!keep.has(key)) {
        this.failures.delete(key);
        this.retryAt.delete(key);
      }
    }
  }

  clear(): void {
    this.failures.clear();
    this.retryAt.clear();
  }
}

export interface IssueSyncOptions {
  /** Read live state: authenticated, not editing, online, and visible or notifications enabled. */
  canSync(): boolean;
  hasActiveIssues(): boolean;
  /** Refresh only currently active issue IDs, including their current state and labels. */
  refreshActive(): Promise<boolean | void> | boolean | void;
  /** Incremental repository reconciliation, or a safe full fallback. */
  reconcile(): Promise<boolean | void> | boolean | void;
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
      const result = await (kind === "reconcile" ? options.reconcile() : options.refreshActive());
      if (!started || runEpoch !== epoch) return;
      if (result === false) {
        if (kind === "reconcile") requestedReconcile = true;
        return;
      }
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
      const backoff = syncBackoffMs(failures);
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
  return { start, stop, wake, tick: () => tick() };
}

export class RefreshQueue {
  private refreshRequested = false;
  private fullRefreshRunning = false;
  private readonly requestedRepos = new Set<string>();

  isRefreshRequested(): boolean {
    return this.refreshRequested;
  }

  isFullRefreshRunning(): boolean {
    return this.fullRefreshRunning;
  }

  getRequestedRepos(): readonly string[] {
    return [...this.requestedRepos];
  }

  requestFullRefresh(): void {
    this.refreshRequested = true;
  }

  setRunning(options: { incremental?: boolean; only?: readonly string[] }): void {
    this.refreshRequested = false;
    if (!options.only && !options.incremental) {
      this.requestedRepos.clear();
    }
    this.fullRefreshRunning = !options.incremental && !options.only;
  }

  checkBusy(busy: boolean, options: { replacePending?: boolean; manual?: boolean; only?: readonly string[] }): boolean {
    if (!busy || options.replacePending) {
      return false;
    }
    if (options.manual && options.only) {
      if (!this.fullRefreshRunning) options.only.forEach(name => this.requestedRepos.add(name));
    } else if (options.manual && !this.fullRefreshRunning) {
      this.refreshRequested = true;
    }
    return true;
  }

  applyRules(busy: boolean): boolean {
    if (busy) {
      this.refreshRequested = true;
      return true;
    }
    return false;
  }

  onComplete(options: {
    runFullRefresh: () => void | Promise<unknown>;
    runTargetedRefresh: (repos: readonly string[]) => void | Promise<unknown>;
    onIdle?: () => void | Promise<unknown>;
  }): void {
    this.fullRefreshRunning = false;
    if (this.refreshRequested) {
      this.refreshRequested = false;
      this.requestedRepos.clear();
      void options.runFullRefresh();
    } else if (this.requestedRepos.size > 0) {
      const only = [...this.requestedRepos];
      this.requestedRepos.clear();
      void options.runTargetedRefresh(only);
    } else {
      void options.onIdle?.();
    }
  }

  clear(): void {
    this.refreshRequested = false;
    this.fullRefreshRunning = false;
    this.requestedRepos.clear();
  }
}
