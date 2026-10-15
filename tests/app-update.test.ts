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
    await vi.advanceTimersByTimeAsync(15_000);
    expect(app.applying.value).toBe(false);
    expect(app.error.value).not.toBe("");
    expect(app.reload).not.toHaveBeenCalled();
    app.reloadNow();
    expect(app.worker.postMessage).toHaveBeenCalledTimes(2);
    app.worker.state = "redundant";
    await vi.advanceTimersByTimeAsync(15_000);
    app.reloadNow();
    expect(app.reload).not.toHaveBeenCalled();
    expect(app.error.value).not.toBe("");
  });
});
