import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeActiveNotifications,
  notifyClosure,
  notifyTimeout,
  trackPageNotification,
  trackedPageNotificationCount,
  type ClosableNotification,
  type NotificationRegistrationLike,
} from "../src/lib/notifications";
import type { Issue, Repo } from "../src/lib/model";

class FakeNotification extends EventTarget implements ClosableNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn().mockResolvedValue("granted");

  close = vi.fn(() => {
    this.dispatchEvent(new Event("close"));
  });

  onclick: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public title: string, public options?: NotificationOptions) {
    super();
  }
}

const sampleRepo: Repo = {
  id: 101,
  name: "private-repo",
  full_name: "owner/private-repo",
  description: "Private project",
  private: true,
  html_url: "https://github.com/owner/private-repo",
  owner: { login: "owner" },
};

const sampleIssue: Issue = {
  id: 202,
  number: 42,
  title: "Super Secret Vulnerability",
  state: "closed",
  closed_at: "2026-10-26T10:00:00Z",
  created_at: "2026-10-25T10:00:00Z",
  updated_at: "2026-10-26T10:00:00Z",
  html_url: "https://github.com/owner/private-repo/issues/42",
  labels: [],
  assignees: [],
  comments: 0,
};

describe("closeActiveNotifications", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("document", { baseURI: "https://example.test/app/" });
    vi.stubGlobal("Notification", FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes tracked page-level notifications and clears them", async () => {
    const notice1 = new FakeNotification("Notice 1");
    const notice2 = new FakeNotification("Notice 2");
    trackPageNotification(notice1);
    trackPageNotification(notice2);

    expect(trackedPageNotificationCount()).toBe(2);

    await closeActiveNotifications();

    expect(notice1.close).toHaveBeenCalledTimes(1);
    expect(notice2.close).toHaveBeenCalledTimes(1);
    expect(trackedPageNotificationCount()).toBe(0);

    // Subsequent close does not re-close already cleared notifications
    await closeActiveNotifications();
    expect(notice1.close).toHaveBeenCalledTimes(1);
    expect(notice2.close).toHaveBeenCalledTimes(1);
  });

  it("automatically untracks notifications when closed or on error", async () => {
    const notice = new FakeNotification("Temporary");
    trackPageNotification(notice);
    expect(trackedPageNotificationCount()).toBe(1);

    notice.dispatchEvent(new Event("close"));
    expect(trackedPageNotificationCount()).toBe(0);

    const errorNotice = new FakeNotification("Error prone");
    trackPageNotification(errorNotice);
    expect(trackedPageNotificationCount()).toBe(1);

    errorNotice.dispatchEvent(new Event("error"));
    expect(trackedPageNotificationCount()).toBe(0);
  });

  it("swallows errors when a page-level notification close throws and continues", async () => {
    const badNotice = new FakeNotification("Bad");
    badNotice.close = vi.fn(() => {
      throw new Error("Close failed");
    });
    const goodNotice = new FakeNotification("Good");

    trackPageNotification(badNotice);
    trackPageNotification(goodNotice);

    await expect(closeActiveNotifications()).resolves.toBeUndefined();

    expect(badNotice.close).toHaveBeenCalledTimes(1);
    expect(goodNotice.close).toHaveBeenCalledTimes(1);
    expect(trackedPageNotificationCount()).toBe(0);
  });

  it("tracks notifications created by notifyClosure and notifyTimeout", async () => {
    await notifyClosure(sampleRepo, sampleIssue);
    expect(trackedPageNotificationCount()).toBe(1);

    await notifyTimeout(sampleRepo, sampleIssue, 3600000, 150);
    expect(trackedPageNotificationCount()).toBe(2);

    await closeActiveNotifications();
    expect(trackedPageNotificationCount()).toBe(0);
  });

  it("closes service-worker notifications from an explicitly passed registration", async () => {
    const swNotice1: ClosableNotification = { close: vi.fn() };
    const swNotice2: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([swNotice1, swNotice2]),
    };

    await closeActiveNotifications(stubRegistration);

    expect(stubRegistration.getNotifications).toHaveBeenCalled();
    expect(swNotice1.close).toHaveBeenCalledTimes(1);
    expect(swNotice2.close).toHaveBeenCalledTimes(1);
  });

  it("closes service-worker notifications via navigator.serviceWorker.ready", async () => {
    const swNotice: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([swNotice]),
    };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(stubRegistration),
      },
    });

    await closeActiveNotifications();

    expect(swNotice.close).toHaveBeenCalledTimes(1);
  });

  it("closes service-worker notifications via navigator.serviceWorker.getRegistration", async () => {
    const swNotice: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([swNotice]),
    };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(stubRegistration),
      },
    });

    await closeActiveNotifications();

    expect(swNotice.close).toHaveBeenCalledTimes(1);
  });

  it("closes service-worker notifications via navigator.serviceWorker.getRegistrations", async () => {
    const swNotice: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([swNotice]),
    };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([stubRegistration]),
      },
    });

    await closeActiveNotifications();

    expect(swNotice.close).toHaveBeenCalledTimes(1);
  });

  it("swallows errors if getNotifications throws or rejects", async () => {
    const failingRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockRejectedValue(new Error("SW unavailable")),
    };

    await expect(closeActiveNotifications(failingRegistration)).resolves.toBeUndefined();
  });

  it("swallows errors if service-worker notification close throws and closes others", async () => {
    const badSwNotice: ClosableNotification = {
      close: vi.fn(() => {
        throw new Error("Cannot close");
      }),
    };
    const goodSwNotice: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([badSwNotice, goodSwNotice]),
    };

    await expect(closeActiveNotifications(stubRegistration)).resolves.toBeUndefined();

    expect(badSwNotice.close).toHaveBeenCalledTimes(1);
    expect(goodSwNotice.close).toHaveBeenCalledTimes(1);
  });
});

describe("logout and session change closing behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("document", { baseURI: "https://example.test/app/" });
    vi.stubGlobal("Notification", FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("confirms logout closes notifications and succeeds even when closing throws", async () => {
    const swNotice: ClosableNotification = { close: vi.fn() };
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockResolvedValue([swNotice]),
    };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(stubRegistration),
      },
    });

    const pageNotice = new FakeNotification("Sample");
    trackPageNotification(pageNotice);

    // Simulate confirmed logout flow from App.vue:
    // clearToken() -> try { await closeActiveNotifications() } catch {} -> logout()
    let tokenCleared = false;
    let loggedOut = false;
    const clearToken = vi.fn(async () => {
      tokenCleared = true;
    });
    const logout = vi.fn(() => {
      loggedOut = true;
    });

    async function simulateConfirmLogout() {
      await clearToken();
      try {
        await closeActiveNotifications();
      } catch {
        // Best-effort
      }
      logout();
    }

    await simulateConfirmLogout();

    expect(tokenCleared).toBe(true);
    expect(pageNotice.close).toHaveBeenCalledTimes(1);
    expect(swNotice.close).toHaveBeenCalledTimes(1);
    expect(loggedOut).toBe(true);
  });

  it("ensures confirmed logout completes successfully when closing notifications throws", async () => {
    const stubRegistration: NotificationRegistrationLike = {
      getNotifications: vi.fn().mockImplementation(() => {
        throw new Error("Service worker died unexpectedly");
      }),
    };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(stubRegistration),
      },
    });

    let loggedOut = false;
    const clearToken = vi.fn(async () => {});
    const logout = vi.fn(() => {
      loggedOut = true;
    });

    async function simulateConfirmLogout() {
      await clearToken();
      try {
        await closeActiveNotifications();
      } catch {
        // Swallowed best-effort
      }
      logout();
    }

    await expect(simulateConfirmLogout()).resolves.toBeUndefined();
    expect(loggedOut).toBe(true);
  });
});
