import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssueSync, RefreshQueue, RepositoryBackoff, syncBackoffMs, ACTIVE_SYNC_MS, MAX_SYNC_BACKOFF_MS, type IssueSyncOptions } from "../src/lib/sync";
const running: ReturnType<typeof createIssueSync>[] = [];
function setup(overrides: Partial<IssueSyncOptions> = {}) {
  let allowed = true;
  let active = true;
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const options = {
    canSync: () => allowed,
    hasActiveIssues: () => active,
    refreshActive: vi.fn().mockResolvedValue(undefined),
    reconcile: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    onSuccess: vi.fn(),
    windowEvents,
    documentEvents,
    ...overrides,
  };
  const controller = createIssueSync(options);
  running.push(controller);
  controller.start();
  return { ...controller, options, windowEvents, documentEvents, setAllowed(value: boolean) { allowed = value; }, setActive(value: boolean) { active = value; } };
}
afterEach(() => { for (const controller of running.splice(0)) controller.stop(); vi.useRealTimers(); });
describe("adaptive issue sync", () => {
  it("refreshes active issues every15seconds and reconciles repositories every2minutes", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.options.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(app.options.refreshActive).toHaveBeenCalledTimes(7);
    expect(app.options.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.options.reconcile).toHaveBeenCalledTimes(2);
  });
  it("uses5minute reconciliation when idle and adapts when active issues appear", async () => {
    vi.useFakeTimers();
    const app = setup();
    app.setActive(false);
    await vi.advanceTimersByTimeAsync(299_000);
    expect(app.options.reconcile).toHaveBeenCalledTimes(1);
    expect(app.options.refreshActive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.options.reconcile).toHaveBeenCalledTimes(2);
    app.setActive(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(app.options.refreshActive).toHaveBeenCalledTimes(1);
  });
  it("pauses when disallowed and reconciles immediately on focus, online and visibility wake", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.setAllowed(false);
    await vi.advanceTimersByTimeAsync(300_000);
    app.windowEvents.dispatchEvent(new Event("focus"));
    expect(app.options.reconcile).toHaveBeenCalledTimes(1);
    app.setAllowed(true);
    app.documentEvents.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(app.options.reconcile).toHaveBeenCalledTimes(2);
    app.windowEvents.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(app.options.reconcile).toHaveBeenCalledTimes(3);
  });
  it("serializes requests and preserves wake requests received during a refresh", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const reconcile = vi.fn().mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; })).mockResolvedValue(undefined);
    const app = setup({ reconcile });
    await vi.advanceTimersByTimeAsync(30_000);
    app.wake();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(app.options.refreshActive).not.toHaveBeenCalled();
    resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
  it("backs off exponentially, respects Retry-After and resets after recovery", async () => {
    vi.useFakeTimers();
    const error = new Error("limited");
    const reconcile = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const app = setup({ reconcile, retryAfterMs: () => 20_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(app.options.onError).toHaveBeenCalledWith(error, "reconcile");
    app.wake();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcile).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(app.options.refreshActive).toHaveBeenCalledTimes(1);
  });
  it("cleans up scheduling and ignores late completion callbacks after stop", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const app = setup({ reconcile: vi.fn(() => new Promise<void>((done) => { resolve = done; })) });
    app.stop();
    resolve();
    await vi.advanceTimersByTimeAsync(600_000);
    app.windowEvents.dispatchEvent(new Event("focus"));
    app.documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(app.options.onSuccess).not.toHaveBeenCalled();
    expect(app.options.reconcile).toHaveBeenCalledTimes(1);
    expect(app.options.refreshActive).not.toHaveBeenCalled();
  });
  it("skipped refresh because busy returns false and keeps requestedReconcile without onSuccess", async () => {
    vi.useFakeTimers();
    let busy = true;
    const reconcile = vi.fn().mockImplementation(async () => {
      if (busy) return false;
      return true;
    });
    const app = setup({ reconcile });
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(app.options.onSuccess).not.toHaveBeenCalled();
    expect(app.options.onError).not.toHaveBeenCalled();

    // 1 second tick while still busy: returns false again without reporting success
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(app.options.onSuccess).not.toHaveBeenCalled();

    // When no longer busy: reconcile runs and reports success
    busy = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(app.options.onSuccess).toHaveBeenCalledWith("reconcile");
  });
  it("applying rules during running sync triggers a full refresh after it completes", () => {
    const queue = new RefreshQueue();
    let syncRunning = true;
    const fullRefresh = vi.fn();
    const targetedRefresh = vi.fn();

    // While sync is running, applyRules is called
    const queued = queue.applyRules(syncRunning);
    expect(queued).toBe(true);
    expect(queue.isRefreshRequested()).toBe(true);
    expect(fullRefresh).not.toHaveBeenCalled();

    // When running sync completes, the queued full refresh is executed
    syncRunning = false;
    queue.onComplete({
      runFullRefresh: fullRefresh,
      runTargetedRefresh: targetedRefresh,
    });
    expect(fullRefresh).toHaveBeenCalledTimes(1);
    expect(queue.isRefreshRequested()).toBe(false);
  });
  it("reconcile requested during targeted refresh executes when targeted refresh finishes", async () => {
    vi.useFakeTimers();
    const queue = new RefreshQueue();
    let targetedRunning = true;

    const reconcile = vi.fn().mockImplementation(async () => {
      if (queue.checkBusy(targetedRunning, { replacePending: false })) return false;
      return true;
    });

    const app = setup({ reconcile });
    // Sync attempts reconcile while targeted refresh is running:
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(app.options.onSuccess).not.toHaveBeenCalled();

    // Targeted refresh completes before next scheduled timer tick:
    targetedRunning = false;
    queue.onComplete({
      runFullRefresh: () => {},
      runTargetedRefresh: () => {},
      onIdle: () => app.tick(),
    });

    // Reconcile executes immediately via tick() rather than waiting for timer
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(app.options.onSuccess).toHaveBeenCalledWith("reconcile");
  });
});

describe("RepositoryBackoff", () => {
  it("computes capped exponential backoff durations", () => {
    expect(syncBackoffMs(0)).toBe(0);
    expect(syncBackoffMs(1)).toBe(15_000);
    expect(syncBackoffMs(2)).toBe(30_000);
    expect(syncBackoffMs(3)).toBe(60_000);
    expect(syncBackoffMs(4)).toBe(120_000);
    expect(syncBackoffMs(5)).toBe(240_000);
    expect(syncBackoffMs(6)).toBe(300_000);
    expect(syncBackoffMs(10)).toBe(MAX_SYNC_BACKOFF_MS);
  });
  it("tracks individual repository failures and backoff status", () => {
    let now = 1_000_000;
    const tracker = new RepositoryBackoff(syncBackoffMs, () => now);
    expect(tracker.isBackingOff("sample/repo")).toBe(false);
    expect(tracker.isDue("sample/repo")).toBe(false);

    tracker.recordFailure("sample/repo");
    expect(tracker.failureCount("sample/repo")).toBe(1);
    expect(tracker.isBackingOff("sample/repo")).toBe(true);
    expect(tracker.isDue("sample/repo")).toBe(false);
    expect(tracker.shouldSync("sample/repo", { hasActive: true, reconcile: true })).toBe(false);
    expect(tracker.shouldSync("sample/repo", { hasActive: false, reconcile: false, manual: true })).toBe(true);

    now += 15_000;
    expect(tracker.isBackingOff("sample/repo")).toBe(false);
    expect(tracker.isDue("sample/repo")).toBe(true);
    expect(tracker.shouldSync("sample/repo", { hasActive: false, reconcile: false })).toBe(true);

    tracker.recordFailure("sample/repo");
    expect(tracker.failureCount("sample/repo")).toBe(2);
    expect(tracker.retryTime("sample/repo")).toBe(now + 30_000);

    tracker.recordSuccess("sample/repo");
    expect(tracker.failureCount("sample/repo")).toBe(0);
    expect(tracker.isBackingOff("sample/repo")).toBe(false);
    expect(tracker.isDue("sample/repo")).toBe(false);
  });
  it("cleans up untracked repositories on retain and clear", () => {
    const tracker = new RepositoryBackoff();
    tracker.recordFailure("repo1");
    tracker.recordFailure("repo2");
    tracker.retain(["repo2", "repo3"]);
    expect(tracker.failureCount("repo1")).toBe(0);
    expect(tracker.failureCount("repo2")).toBe(1);
    tracker.clear();
    expect(tracker.failureCount("repo2")).toBe(0);
  });
});
