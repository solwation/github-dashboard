import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_CHECK_INTERVAL_MS,
  BACKGROUND_CHECK_TAG,
  backgroundCheckDecision,
  createBackgroundCheckScheduler,
  isInstalledApp,
  syncBackgroundCheck,
  type BackgroundCheckEnvironment,
  type BackgroundCheckState,
} from "../src/lib/background-sync";

const ready: BackgroundCheckState = {
  supported: true,
  installed: true,
  periodicPermission: "granted",
  notificationPermission: "granted",
  loggedIn: true,
  demo: false,
  notificationRepos: ["o/r"],
};

describe("backgroundCheckDecision", () => {
  it("registers when supported, installed, permitted and a repo notifies", () => {
    expect(backgroundCheckDecision(ready)).toBe("register");
  });
  it("never touches browsers without Periodic Background Sync", () => {
    expect(backgroundCheckDecision({ ...ready, supported: false })).toBe("skip");
    expect(backgroundCheckDecision({ ...ready, supported: false, loggedIn: false })).toBe("skip");
  });
  it.each<[string, Partial<BackgroundCheckState>]>([
    ["not installed", { installed: false }],
    ["periodic sync prompt", { periodicPermission: "prompt" }],
    ["periodic sync denied", { periodicPermission: "denied" }],
    ["periodic sync permission unknown", { periodicPermission: "unsupported" }],
    ["notifications default", { notificationPermission: "default" }],
    ["notifications denied", { notificationPermission: "denied" }],
    ["notifications unsupported", { notificationPermission: "unsupported" }],
    ["no notification repos", { notificationRepos: [] }],
    ["logged out", { loggedIn: false }],
    ["demo", { demo: true }],
  ])("unregisters when %s", (_, change) => {
    expect(backgroundCheckDecision({ ...ready, ...change })).toBe("unregister");
  });
});

function environment(options: {
  periodicSync?: boolean;
  tags?: string[];
  installed?: boolean;
  periodic?: PermissionState | "unsupported";
  notification?: NotificationPermission | "unsupported";
  registration?: boolean;
} = {}) {
  const tags = new Set(options.tags ?? []);
  const manager = {
    register: vi.fn(async (tag: string) => { tags.add(tag); }),
    unregister: vi.fn(async (tag: string) => { tags.delete(tag); }),
    getTags: vi.fn(async () => [...tags]),
  };
  const registration = options.periodicSync === false ? {} : { periodicSync: manager };
  const periodicPermission = vi.fn(async () => options.periodic ?? "granted");
  const env: BackgroundCheckEnvironment = {
    registration: async () =>
      options.registration === false
        ? undefined
        : (registration as unknown as ServiceWorkerRegistration),
    installed: () => options.installed ?? true,
    periodicPermission,
    notificationPermission: () => options.notification ?? "granted",
  };
  return { env, manager, tags, periodicPermission };
}
const active = { loggedIn: true, demo: false, notificationRepos: ["o/r"] };

describe("syncBackgroundCheck", () => {
  it("registers the check tag with a one-hour minimum interval", async () => {
    const { env, manager, tags } = environment();
    await expect(syncBackgroundCheck(active, env)).resolves.toBe("register");
    expect(manager.register).toHaveBeenCalledWith(BACKGROUND_CHECK_TAG, {
      minInterval: BACKGROUND_CHECK_INTERVAL_MS,
    });
    expect(BACKGROUND_CHECK_TAG).toBe("issueflow-check");
    expect(BACKGROUND_CHECK_INTERVAL_MS).toBe(3_600_000);
    expect(tags.has(BACKGROUND_CHECK_TAG)).toBe(true);
  });
  it("unregisters on logout", async () => {
    const { env, manager, tags } = environment({ tags: [BACKGROUND_CHECK_TAG] });
    await expect(syncBackgroundCheck({ ...active, loggedIn: false, notificationRepos: [] }, env)).resolves.toBe("unregister");
    expect(manager.unregister).toHaveBeenCalledWith(BACKGROUND_CHECK_TAG);
    expect(tags.size).toBe(0);
  });
  it("unregisters when notifications are off for all repos", async () => {
    const { env, manager } = environment({ tags: [BACKGROUND_CHECK_TAG] });
    await syncBackgroundCheck({ ...active, notificationRepos: [] }, env);
    expect(manager.unregister).toHaveBeenCalledWith(BACKGROUND_CHECK_TAG);
    expect(manager.register).not.toHaveBeenCalled();
  });
  it("unregisters when notification or periodic-sync permission is missing", async () => {
    for (const options of [{ notification: "denied" as const }, { periodic: "prompt" as const }, { installed: false }]) {
      const { env, manager } = environment({ ...options, tags: [BACKGROUND_CHECK_TAG] });
      await expect(syncBackgroundCheck(active, env)).resolves.toBe("unregister");
      expect(manager.unregister).toHaveBeenCalledWith(BACKGROUND_CHECK_TAG);
      expect(manager.register).not.toHaveBeenCalled();
    }
  });
  it("does not call unregister for a tag that is not registered", async () => {
    const { env, manager } = environment({ tags: ["other"] });
    await syncBackgroundCheck({ ...active, loggedIn: false }, env);
    expect(manager.unregister).not.toHaveBeenCalled();
  });
  it("queries the periodic-sync permission only when it can matter", async () => {
    const { env, periodicPermission } = environment({ notification: "default" });
    await syncBackgroundCheck(active, env);
    expect(periodicPermission).not.toHaveBeenCalled();
  });
  it("changes nothing without Periodic Background Sync or a registration", async () => {
    const unsupported = environment({ periodicSync: false });
    await expect(syncBackgroundCheck(active, unsupported.env)).resolves.toBe("skip");
    expect(unsupported.periodicPermission).not.toHaveBeenCalled();
    const missing = environment({ registration: false });
    await expect(syncBackgroundCheck(active, missing.env)).resolves.toBe("skip");
    expect(missing.manager.register).not.toHaveBeenCalled();
  });
  it("swallows browser registration failures", async () => {
    const { env, manager } = environment();
    manager.register.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await expect(syncBackgroundCheck(active, env)).resolves.toBe("skip");
  });
});

describe("createBackgroundCheckScheduler", () => {
  it("applies changes in order using a snapshot of the input", async () => {
    const { env, tags } = environment();
    const schedule = createBackgroundCheckScheduler(env);
    const repos = ["o/r"];
    const first = schedule({ ...active, notificationRepos: repos });
    repos.length = 0;
    const second = schedule({ ...active, loggedIn: false });
    await expect(first).resolves.toBe("register");
    await expect(second).resolves.toBe("unregister");
    expect(tags.size).toBe(0);
  });
});

describe("isInstalledApp", () => {
  it("detects standalone-like display modes", () => {
    const media = (mode: string) => (query: string) => ({ matches: query === `(display-mode: ${mode})` });
    expect(isInstalledApp(media("standalone"), {})).toBe(true);
    expect(isInstalledApp(media("window-controls-overlay"), {})).toBe(true);
    expect(isInstalledApp(media("browser"), {})).toBe(false);
    expect(isInstalledApp(undefined, { standalone: true })).toBe(true);
    expect(isInstalledApp(undefined, undefined)).toBe(false);
  });
});
