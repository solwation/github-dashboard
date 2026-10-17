/**
 * Service-worker entry for Periodic Background Sync (#130). Bundled by vite.config.ts and
 * prepended to the public app-shell worker (scripts/service-worker.js) as sw.js.
 * Uses the app's own encrypted vault and settings stores; never caches responses.
 */
import { BACKGROUND_CHECK_TAG, appVisible, runBackgroundCheck } from "./background-check";
import { loadBackgroundState, loadToken, saveBackgroundState } from "./vault";
import { loadSettings } from "./settings-store";
import { GitHub } from "./github";

interface PeriodicSyncEvent { tag?: string; waitUntil(work: Promise<unknown>): void }
interface WorkerScope {
  location: { href: string };
  registration: {
    showNotification(title: string, options: object): Promise<void>;
    getNotifications(filter: { tag: string }): Promise<ReadonlyArray<unknown>>;
  };
  clients: Parameters<typeof appVisible>[0];
  addEventListener(type: "periodicsync", listener: (event: PeriodicSyncEvent) => void): void;
}
const scope = self as unknown as WorkerScope;
const root = new URL("./", scope.location.href).href;
let running: Promise<unknown> | null = null;

scope.addEventListener("periodicsync", (event) => {
  if (event.tag !== BACKGROUND_CHECK_TAG) return;
  // Overlapping fires share one check, so a slow run is never doubled.
  running ??= runBackgroundCheck({
    permission: () => typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    loadToken,
    loadState: loadBackgroundState,
    saveState: saveBackgroundState,
    loadSettings,
    api: token => new GitHub(token),
    appVisible: () => appVisible(scope.clients),
    existing: async tag => (await scope.registration.getNotifications({ tag })).length > 0,
    show: ({ title, options }) => scope.registration.showNotification(title, options),
    root,
    now: Date.now,
  }).catch(() => 0).finally(() => { running = null; });
  event.waitUntil(running);
});
