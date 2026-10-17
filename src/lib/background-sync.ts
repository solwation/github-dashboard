// Periodic Background Sync registration for background notifications (#129).
// No server, webhooks or Web Push: the browser wakes the installed PWA's
// service worker with this tag, and the worker checks GitHub itself (#130).
// Browsers without Periodic Background Sync are left completely untouched.
import { notificationPermission } from "./notifications";

export const BACKGROUND_CHECK_TAG = "issueflow-check";
/** Requested minimum interval; browsers may run the check less often. */
export const BACKGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PeriodicSyncManagerLike {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

export interface BackgroundCheckState {
  /** `'periodicSync' in registration` */
  supported: boolean;
  /** Running as an installed PWA (standalone-like display mode). */
  installed: boolean;
  /** Result of permissions.query({ name: "periodic-background-sync" }). */
  periodicPermission: PermissionState | "unsupported";
  /** Notification.permission, or "unsupported". */
  notificationPermission: NotificationPermission | "unsupported";
  loggedIn: boolean;
  demo: boolean;
  /** Selected repositories with notifications switched on. */
  notificationRepos: readonly string[];
}

export type BackgroundCheckDecision = "register" | "unregister" | "skip";

/** Pure decision: "skip" means the browser lacks support, so nothing is touched. */
export function backgroundCheckDecision(
  state: BackgroundCheckState,
): BackgroundCheckDecision {
  if (!state.supported) return "skip";
  return state.installed &&
    state.periodicPermission === "granted" &&
    state.notificationPermission === "granted" &&
    state.loggedIn &&
    !state.demo &&
    state.notificationRepos.length > 0
    ? "register"
    : "unregister";
}

const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
];

export function isInstalledApp(
  matchMedia: ((query: string) => { matches: boolean }) | undefined =
    typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined,
  nav: unknown = typeof navigator !== "undefined" ? navigator : undefined,
): boolean {
  if ((nav as { standalone?: boolean } | undefined)?.standalone === true)
    return true;
  return Boolean(
    matchMedia &&
      INSTALLED_DISPLAY_MODES.some(
        (mode) => matchMedia(`(display-mode: ${mode})`).matches,
      ),
  );
}

export interface BackgroundCheckEnvironment {
  registration: () => Promise<
    (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManagerLike }) |
      undefined
  >;
  installed: () => boolean;
  periodicPermission: () => Promise<PermissionState | "unsupported">;
  notificationPermission: () => NotificationPermission | "unsupported";
}

export interface BackgroundCheckInput {
  loggedIn: boolean;
  demo: boolean;
  notificationRepos: readonly string[];
}

/**
 * Registers or unregisters the periodic check to match the current state.
 * Returns the action taken. Errors (e.g. the browser refusing registration)
 * are swallowed: background checks are an optional enhancement.
 */
export async function syncBackgroundCheck(
  input: BackgroundCheckInput,
  environment: BackgroundCheckEnvironment = browserEnvironment(),
): Promise<BackgroundCheckDecision> {
  try {
    const registration = await environment.registration();
    const manager =
      registration && "periodicSync" in registration
        ? registration.periodicSync
        : undefined;
    const base = {
      supported: Boolean(manager),
      installed: Boolean(manager) && environment.installed(),
      notificationPermission: environment.notificationPermission(),
      loggedIn: input.loggedIn,
      demo: input.demo,
      notificationRepos: input.notificationRepos,
    };
    // Query the periodic-sync permission only when it can change the outcome.
    const decision = backgroundCheckDecision({
      ...base,
      periodicPermission:
        backgroundCheckDecision({ ...base, periodicPermission: "granted" }) ===
        "register"
          ? await environment.periodicPermission()
          : "unsupported",
    });
    if (!manager || decision === "skip") return "skip";
    if (decision === "register")
      await manager.register(BACKGROUND_CHECK_TAG, {
        minInterval: BACKGROUND_CHECK_INTERVAL_MS,
      });
    else if ((await manager.getTags()).includes(BACKGROUND_CHECK_TAG))
      await manager.unregister(BACKGROUND_CHECK_TAG);
    return decision;
  } catch {
    return "skip";
  }
}

function browserEnvironment(): BackgroundCheckEnvironment {
  return {
    registration: async () =>
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.getRegistration(
            new URL("./", document.baseURI).href,
          )
        : undefined,
    installed: () => isInstalledApp(),
    periodicPermission: async () => {
      try {
        const status = await navigator.permissions.query({
          name: "periodic-background-sync" as PermissionName,
        });
        return status.state;
      } catch {
        return "unsupported";
      }
    },
    notificationPermission,
  };
}

/** Serializes calls so rapid state changes cannot reorder register/unregister. */
export function createBackgroundCheckScheduler(
  environment?: BackgroundCheckEnvironment,
) {
  let queue: Promise<unknown> = Promise.resolve();
  return (input: BackgroundCheckInput) => {
    const snapshot = { ...input, notificationRepos: [...input.notificationRepos] };
    const run = queue.then(() => syncBackgroundCheck(snapshot, environment));
    queue = run;
    return run;
  };
}
