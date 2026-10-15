import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssueSync, type IssueSyncOptions } from "../src/lib/sync";
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
});
