import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppUpdateController } from "../src/composables/useAppUpdate";
class Worker extends EventTarget {
  state = "installed";
  postMessage = vi.fn();
}
function fixture(initialController = true) {
  const worker = new Worker();
  const registration = Object.assign(new EventTarget(), {
    waiting: initialController ? (worker as Worker | null) : null,
    installing: null as Worker | null,
    active: null as Worker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: initialController
      ? Object.assign(new Worker(), { state: "activated" })
      : null,
    getRegistration: vi.fn().mockResolvedValue(registration),
    ready: new Promise(() => {}),
  });
  const events = new EventTarget();
  let online = true;
  const reload = vi.fn();
  const controller = createAppUpdateController({
    serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
    events: events as unknown as Window,
    appUrl: "https://example.test/app/",
    online: () => online,
    reload,
  });
  controller.start();
  return {
    ...controller,
    serviceWorker,
    registration,
    worker,
    reload,
    events,
    offline() {
      online = false;
    },
    online() {
      online = true;
      events.dispatchEvent(new Event("online"));
    },
  };
}
const controllers: ReturnType<typeof fixture>[] = [];
function setup(initialController = true) {
  const controller = fixture(initialController);
  controllers.push(controller);
  return controller;
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  vi.useRealTimers();
});
describe("app version updates", () => {
  it("offers a waiting update for ten seconds, activates it, then reloads exactly once", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.available.value).toBe(true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(app.seconds.value).toBe(1);
    expect(app.worker.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(app.worker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
    expect(app.reload).not.toHaveBeenCalled();
    app.registration.waiting = null;
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activating";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).not.toHaveBeenCalled();
    app.worker.state = "activated";
    app.worker.dispatchEvent(new Event("statechange"));
    app.registration.waiting = null;
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activated";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).toHaveBeenCalledTimes(1);
  });
  it("Reload now bypasses the countdown and waits for activation", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.reloadNow();
    expect(app.applying.value).toBe(true);
    expect(app.worker.postMessage).toHaveBeenCalledTimes(1);
    expect(app.reload).not.toHaveBeenCalled();
    app.registration.waiting = null;
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activated";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).toHaveBeenCalledTimes(1);
  });
  it("gives this tab a countdown when another tab activates an update", async () => {
    vi.useFakeTimers();
    const app = setup();
    app.registration.waiting = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(app.available.value).toBe(false);
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activated";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.available.value).toBe(true);
    expect(app.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.reload).toHaveBeenCalledTimes(1);
    expect(app.worker.postMessage).not.toHaveBeenCalled();
  });
  it("does not reload or offer a banner on first installation", async () => {
    vi.useFakeTimers();
    const app = setup(false);
    await vi.advanceTimersByTimeAsync(0);
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activated";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.available.value).toBe(false);
    expect(app.reload).not.toHaveBeenCalled();
  });
  it("discovers a waiting update after the first controller claim", async () => {
    vi.useFakeTimers();
    const app = setup(false);
    await vi.advanceTimersByTimeAsync(0);
    app.registration.waiting = app.worker;
    app.serviceWorker.controller = Object.assign(new Worker(), {
      state: "activated",
    });
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.available.value).toBe(true);
    expect(app.seconds.value).toBe(10);
    expect(app.reload).not.toHaveBeenCalled();
  });
  it("uses the deadline after a suspended tab and delays offline updates", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.offline();
    vi.setSystemTime(Date.now() + 30_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(app.error.value).toContain("offline");
    expect(app.worker.postMessage).not.toHaveBeenCalled();
    app.online();
    expect(app.seconds.value).toBe(10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.worker.postMessage).toHaveBeenCalledTimes(1);
  });
  it("discovers newly installed updates, polls, checks on focus, and cleans up", async () => {
    vi.useFakeTimers();
    const app = setup();
    app.registration.waiting = null;
    await vi.advanceTimersByTimeAsync(0);
    app.registration.installing = app.worker;
    app.worker.state = "installing";
    app.registration.dispatchEvent(new Event("updatefound"));
    expect(app.available.value).toBe(false);
    app.registration.waiting = app.worker;
    app.worker.state = "installed";
    app.worker.dispatchEvent(new Event("statechange"));
    expect(app.available.value).toBe(true);
    app.events.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(app.registration.update).toHaveBeenCalledTimes(2);
    // Keep this tab waiting while checking the polling interval.
    app.offline();
    await vi.advanceTimersByTimeAsync(60_000);
    app.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.registration.update).toHaveBeenCalledTimes(3);
    app.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    app.events.dispatchEvent(new Event("focus"));
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).not.toHaveBeenCalled();
    expect(app.registration.update).toHaveBeenCalledTimes(3);
  });
  it("reports activation failure and allows a retry without reloading the old app", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.applying.value).toBe(false);
    expect(app.error.value).not.toBe("");
    expect(app.reload).not.toHaveBeenCalled();
    app.reloadNow();
    expect(app.worker.postMessage).toHaveBeenCalledTimes(2);
    app.worker.state = "redundant";
    await vi.advanceTimersByTimeAsync(60_000);
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.reload).not.toHaveBeenCalled();
    expect(app.error.value).not.toBe("");
  });
  it("accepts a newer controller when another tab supersedes the offered worker", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.worker.state = "redundant";
    app.registration.waiting = null;
    const replacement = Object.assign(new Worker(), { state: "activated" });
    app.registration.active = replacement;
    app.serviceWorker.controller = replacement;
    app.reloadNow();
    expect(app.reload).toHaveBeenCalledOnce();
    expect(app.error.value).toBe("");
  });
  it("accepts a replacement controller arriving while the original activation is in progress", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.reloadNow();
    const replacement = Object.assign(new Worker(), { state: "activating" });
    app.worker.state = "redundant";
    app.registration.waiting = null;
    app.serviceWorker.controller = replacement;
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    replacement.state = "activated";
    replacement.dispatchEvent(new Event("statechange"));
    expect(app.reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.error.value).toBe("");
  });
  it("recovers an already active worker that has not claimed this tab", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.registration.waiting = null;
    app.worker.state = "activated";
    app.registration.active = app.worker;
    app.reloadNow();
    expect(app.worker.postMessage).toHaveBeenCalledWith({ type: "CLAIM_CLIENTS" });
    expect(app.reload).not.toHaveBeenCalled();
    app.serviceWorker.controller = app.worker;
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).toHaveBeenCalledOnce();
  });
  it("allows slow and even late activation after a timeout without a false retry loop", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(app.applying.value).toBe(true);
    expect(app.error.value).toBe("");
    app.serviceWorker.controller = app.worker;
    app.worker.state = "activating";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.applying.value).toBe(false);
    app.worker.state = "activated";
    app.worker.dispatchEvent(new Event("statechange"));
    expect(app.reload).toHaveBeenCalledOnce();
  });
  it("refreshes a stale redundant offer and retries a failed registration check", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.worker.state = "redundant";
    app.registration.waiting = null;
    app.registration.update.mockRejectedValueOnce(new Error("network failed"));
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.applying.value).toBe(false);
    expect(app.reload).not.toHaveBeenCalled();
    const replacement = new Worker();
    app.registration.update.mockImplementationOnce(async () => { app.registration.waiting = replacement; });
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(replacement.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    app.serviceWorker.controller = replacement;
    replacement.state = "activated";
    app.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(app.reload).toHaveBeenCalledOnce();
  });
  it("joins an in-flight version check when retrying an obsolete offer", async () => {
    vi.useFakeTimers();
    const app = setup();
    await vi.advanceTimersByTimeAsync(0);
    app.worker.state = "redundant";
    app.registration.waiting = null;
    const replacement = new Worker();
    let release!: () => void;
    app.registration.update.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      app.registration.waiting = replacement;
    });
    app.events.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    app.reloadNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.applying.value).toBe(true);
    expect(app.error.value).toBe("");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(replacement.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(app.error.value).toBe("");
  });
});
