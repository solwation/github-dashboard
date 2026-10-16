import { onMounted, onUnmounted, reactive, toRefs } from "vue";

type DeferralStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface UpdateEnvironment {
  serviceWorker: ServiceWorkerContainer;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  appUrl: string;
  online(): boolean;
  reload(): void;
  /** Injectable clock (epoch ms) for countdowns and the local-midnight deferral. */
  now?(): number;
  /** Whether the page is a background tab; only hidden pages install automatically. */
  hidden?(): boolean;
  /** Receives `visibilitychange` (the document in browsers). */
  visibility?: Pick<Document, "addEventListener" | "removeEventListener">;
  /** Non-private persistence for "Not now", shared by this origin's tabs. */
  storage?: DeferralStorage | null;
}
export const UPDATE_DEFERRAL_KEY = "issueflow-update-deferred";
const COUNTDOWN_SECONDS = 10;
/** Start of the next calendar day in the runtime's local time zone (DST-safe). */
export function nextLocalMidnight(now: number): number {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}
/** Exported separately so browser lifecycle and timing can be tested without a DOM. */
export function createAppUpdateController(environment: UpdateEnvironment) {
  const state = reactive({
    available: false,
    seconds: COUNTDOWN_SECONDS,
    applying: false,
    error: "",
    /** "Not now" was chosen today: no automatic prompt or installation until local midnight. */
    deferred: false,
    /** A background tab is counting down to an automatic installation. */
    counting: false,
  });
  const now = environment.now ?? (() => Date.now());
  const hidden = environment.hidden ?? (() => false);
  const storage = environment.storage ?? null;
  const sw = environment.serviceWorker;
  let active = false;
  let hadController = Boolean(sw.controller);
  let loadedController = sw.controller;
  let registration: ServiceWorkerRegistration | undefined;
  let waiting: ServiceWorker | null = null;
  let deadline: number | undefined;
  let deferredUntil: number | null = null;
  let installWhenOnline = false;
  let activationTimeout: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let checkTimer: ReturnType<typeof setInterval> | undefined;
  let reloading = false;
  let checking: Promise<void> | null = null;
  let activationTarget: ServiceWorker | null = null;
  let activationRequested = false;
  const claimRequested = new WeakSet<ServiceWorker>();
  function clearActivationTarget() {
    activationTarget?.removeEventListener("statechange", maybeFinish);
    activationTarget = null;
  }
  function maybeFinish() {
    if (
      activationRequested &&
      sw.controller && sw.controller !== loadedController &&
      sw.controller.state === "activated"
    )
      finish();
    else if (activationRequested && activationTarget?.state === "activated" && !claimRequested.has(activationTarget)) {
      // Recover an active worker whose initial clients.claim failed or was delayed.
      claimRequested.add(activationTarget);
      try { activationTarget.postMessage({ type: "CLAIM_CLIENTS" }); } catch { /* The bounded retry remains available. */ }
    } else if (state.applying && activationTarget?.state === "redundant") {
      const replacement = registration?.waiting || registration?.active;
      if (replacement && replacement !== loadedController && replacement !== activationTarget && replacement.state !== "redundant") activate(replacement);
    }
  }
  function waitForActivation(target: ServiceWorker) {
    clearActivationTarget();
    activationTarget = target;
    target.addEventListener("statechange", maybeFinish);
    clearTimeout(activationTimeout);
    activationTimeout = setTimeout(() => {
      maybeFinish();
      if (!reloading) activationFailed();
    }, 60000);
    maybeFinish();
  }
  const installationListeners = new Map<ServiceWorker, () => void>();

  function validDeferral(until: unknown): until is number {
    const current = now();
    // Never reaches past the next local midnight, even after the clock was set back.
    return typeof until === "number" && until > current && until <= nextLocalMidnight(current);
  }
  /** undefined: storage is unavailable, so the in-memory deferral stays authoritative. */
  function storedDeferral(): number | null | undefined {
    if (!storage) return undefined;
    let raw: string | null;
    try {
      raw = storage.getItem(UPDATE_DEFERRAL_KEY);
    } catch {
      return undefined;
    }
    if (!raw) return null;
    let record: { until?: unknown } | null = null;
    try { record = JSON.parse(raw); } catch { /* Corrupt records are discarded below. */ }
    if (validDeferral(record?.until)) return record.until;
    clearStoredDeferral();
    return null;
  }
  function clearStoredDeferral() {
    try { storage?.removeItem(UPDATE_DEFERRAL_KEY); } catch { /* Ignored like an absent record. */ }
  }
  function refreshDeferral() {
    const stored = storedDeferral();
    if (stored !== undefined) deferredUntil = stored;
    if (deferredUntil !== null && !validDeferral(deferredUntil)) deferredUntil = null;
    state.deferred = deferredUntil !== null;
  }
  /** Visible tabs wait for an explicit choice; background tabs install after a countdown. */
  function schedule() {
    if (state.available && !state.applying && !state.deferred && hidden()) {
      if (!deadline) {
        state.seconds = COUNTDOWN_SECONDS;
        deadline = now() + COUNTDOWN_SECONDS * 1000;
      }
    } else {
      deadline = undefined;
    }
    state.counting = Boolean(deadline);
  }
  /** "Not now": postpone the automatic prompt to the next local calendar day. */
  function defer() {
    if (!active || !state.available || state.applying) return;
    deferredUntil = nextLocalMidnight(now());
    try {
      storage?.setItem(UPDATE_DEFERRAL_KEY, JSON.stringify({ until: deferredUntil }));
    } catch { /* The in-memory deferral still covers this page. */ }
    state.deferred = true;
    state.error = "";
    installWhenOnline = false;
    schedule();
  }
  function offer(worker: ServiceWorker | null) {
    if (!active || !hadController || state.applying) return;
    if (worker) waiting = worker;
    if (state.available) return;
    state.available = true;
    refreshDeferral();
    schedule();
  }
  function finish() {
    if (!active || reloading) return;
    reloading = true;
    // Installed: an old "Not now" must not suppress the prompt for a later version.
    deferredUntil = null;
    clearStoredDeferral();
    clearTimeout(activationTimeout);
    clearActivationTarget();
    environment.reload();
  }
  function activationFailed() {
    clearTimeout(activationTimeout);
    // Keep observing late activation: a suspended tab may resume after the timeout.
    state.applying = false;
    state.error = "Uppdateringen kunde inte aktiveras. Försök igen.";
  }
  function activate(target: ServiceWorker) {
    waiting = target;
    waitForActivation(target);
    if (target.state === "installed") {
      try { target.postMessage({ type: "SKIP_WAITING" }); }
      catch { activationFailed(); }
    }
  }
  function activationCandidate() {
    return [registration?.waiting, sw.controller !== loadedController ? sw.controller : null,
      registration?.active !== loadedController ? registration?.active : null, waiting, registration?.installing]
      .find((worker): worker is ServiceWorker => Boolean(worker && worker !== loadedController && worker.state !== "redundant"));
  }
  /** Explicit installation; also allowed while the automatic prompt is deferred. */
  function reloadNow() {
    apply(true);
  }
  function apply(explicit: boolean) {
    if (!active || !state.available || state.applying || reloading) return;
    deadline = undefined;
    state.counting = false;
    state.seconds = 0;
    if (!environment.online()) {
      // An explicit request resumes on reconnection; an automatic one restarts its countdown.
      installWhenOnline ||= explicit;
      state.error =
        "Du är offline. Uppdateringen fortsätter när anslutningen är tillbaka.";
      return;
    }
    installWhenOnline = false;
    state.error = "";
    state.applying = true;
    activationRequested = true;
    if (activationTarget) claimRequested.delete(activationTarget);
    // Another tab may already have activated the latest worker.
    const candidate = activationCandidate();
    if (candidate) activate(candidate);
    else void check().then(() => {
      if (!active || !state.applying || reloading) return;
      const found = activationCandidate();
      if (found) activate(found);
      else activationFailed();
    });
  }
  function controllerChanged() {
    if (!active || reloading) return;
    // A first installation may claim this tab, without representing a new app version.
    if (!hadController) {
      hadController = true;
      loadedController = sw.controller;
      watchInstalling();
      if (registration?.waiting) offer(registration.waiting);
      void check();
      return;
    }
    if (sw.controller === loadedController) return;
    waiting = null;
    if (activationRequested) {
      if (sw.controller && sw.controller !== loadedController) waitForActivation(sw.controller);
      else maybeFinish();
    } else {
      offer(null);
    }
  }
  function watchInstalling() {
    const worker = registration?.installing;
    if (!worker || installationListeners.has(worker)) return;
    const changed = () => {
      if (worker.state === "installed" && hadController) {
        if (state.applying) activate(registration?.waiting || worker);
        else offer(registration?.waiting || worker);
      }
    };
    installationListeners.set(worker, changed);
    worker.addEventListener("statechange", changed);
    changed();
  }
  function check(): Promise<void> {
    if (checking) return checking;
    if (!active || !environment.online()) return Promise.resolve();
    if (!hadController && sw.controller) {
      hadController = true;
      loadedController = sw.controller;
    }
    checking = (async () => { try {
      const found = await sw.getRegistration(environment.appUrl);
      if (!active || !found) return;
      if (registration !== found) {
        registration?.removeEventListener("updatefound", watchInstalling);
        registration = found;
        registration.addEventListener("updatefound", watchInstalling);
      }
      watchInstalling();
      if (registration.waiting) offer(registration.waiting);
      await registration.update();
      if (active && registration.waiting) offer(registration.waiting);
    } catch {
      if (active && state.available && !state.applying) {
        state.error =
          "Det gick inte att kontrollera uppdateringen. Försök igen.";
      }
    } })().finally(() => { checking = null; });
    return checking;
  }
  function resumed() {
    refreshDeferral();
    if (state.available && !state.applying && !deadline && environment.online()) {
      state.error = "";
      if (installWhenOnline) apply(true);
    }
    schedule();
    void check();
  }
  function visibilityChanged() {
    refreshDeferral();
    schedule();
  }
  function storageChanged(event: Event) {
    const key = (event as StorageEvent).key;
    // A null key means another tab cleared all storage.
    if (key !== undefined && key !== null && key !== UPDATE_DEFERRAL_KEY) return;
    refreshDeferral();
    schedule();
  }
  function start() {
    if (active) return;
    active = true;
    if (!hadController && sw.controller) {
      hadController = true;
      loadedController = sw.controller;
    }
    sw.addEventListener("controllerchange", controllerChanged);
    environment.events.addEventListener("focus", resumed);
    environment.events.addEventListener("online", resumed);
    environment.events.addEventListener("storage", storageChanged);
    environment.visibility?.addEventListener("visibilitychange", visibilityChanged);
    refreshDeferral();
    tickTimer = setInterval(() => {
      if (state.deferred && (deferredUntil === null || now() >= deferredUntil)) {
        // Midnight passed: the deferred prompt returns without waiting for a check.
        refreshDeferral();
        schedule();
      }
      if (!deadline || !state.available || state.applying) return;
      state.seconds = Math.max(0, Math.ceil((deadline - now()) / 1000));
      if (state.seconds === 0) apply(false);
    }, 250);
    checkTimer = setInterval(() => {
      void check();
    }, 60_000);
    void check();
    // Registration is commonly created on window load, after the Vue app mounts.
    void sw.ready
      .then(() => {
        if (active) void check();
      })
      .catch(() => {});
  }
  function stop() {
    active = false;
    clearInterval(tickTimer);
    clearInterval(checkTimer);
    clearTimeout(activationTimeout);
    clearActivationTarget();
    sw.removeEventListener("controllerchange", controllerChanged);
    environment.events.removeEventListener("focus", resumed);
    environment.events.removeEventListener("online", resumed);
    environment.events.removeEventListener("storage", storageChanged);
    environment.visibility?.removeEventListener("visibilitychange", visibilityChanged);
    registration?.removeEventListener("updatefound", watchInstalling);
    for (const [worker, listener] of installationListeners)
      worker.removeEventListener("statechange", listener);
    installationListeners.clear();
  }
  return { ...toRefs(state), reloadNow, defer, check, start, stop };
}
export type AppUpdate = Pick<ReturnType<typeof createAppUpdateController>,
  "available" | "seconds" | "applying" | "error" | "deferred" | "counting" | "reloadNow" | "defer" | "check">;

function browserStorage(): DeferralStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
/** Call once (App.vue) and share the result: each call registers its own controller. */
export function useAppUpdate(): AppUpdate {
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const controller = supported
    ? createAppUpdateController({
        serviceWorker: navigator.serviceWorker,
        events: window,
        visibility: document,
        appUrl: new URL("./", document.baseURI).href,
        online: () => navigator.onLine,
        hidden: () => document.visibilityState === "hidden",
        reload: () => window.location.reload(),
        storage: browserStorage(),
      })
    : null;
  onMounted(() => controller?.start());
  onUnmounted(() => controller?.stop());
  return (
    controller || {
      ...toRefs(reactive({
        available: false, seconds: COUNTDOWN_SECONDS, applying: false, error: "", deferred: false, counting: false,
      })),
      reloadNow() {},
      defer() {},
      check: () => Promise.resolve(),
    }
  );
}
