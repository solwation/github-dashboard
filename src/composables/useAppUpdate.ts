import { onMounted, onUnmounted, reactive, toRefs } from "vue";

interface UpdateEnvironment {
  serviceWorker: ServiceWorkerContainer;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  appUrl: string;
  online(): boolean;
  reload(): void;
}
/** Exported separately so browser lifecycle and timing can be tested without a DOM. */
export function createAppUpdateController(environment: UpdateEnvironment) {
  const state = reactive({
    available: false,
    seconds: 10,
    applying: false,
    error: "",
  });
  const sw = environment.serviceWorker;
  let active = false;
  let hadController = Boolean(sw.controller);
  let loadedController = sw.controller;
  let registration: ServiceWorkerRegistration | undefined;
  let waiting: ServiceWorker | null = null;
  let deadline: number | undefined;
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

  function offer(worker: ServiceWorker | null) {
    if (!active || !hadController || state.applying) return;
    if (worker) waiting = worker;
    if (state.available) return;
    state.available = true;
    state.seconds = 10;
    deadline = Date.now() + 10_000;
  }
  function finish() {
    if (!active || reloading) return;
    reloading = true;
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
  function reloadNow() {
    if (!active || !state.available || state.applying || reloading) return;
    deadline = undefined;
    state.seconds = 0;
    if (!environment.online()) {
      state.error =
        "Du är offline. Uppdateringen fortsätter när anslutningen är tillbaka.";
      return;
    }
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
    if (
      state.available &&
      !state.applying &&
      !deadline &&
      environment.online()
    ) {
      state.error = "";
      state.seconds = 10;
      deadline = Date.now() + 10_000;
    }
    void check();
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
    tickTimer = setInterval(() => {
      if (!deadline || !state.available || state.applying) return;
      state.seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (state.seconds === 0) reloadNow();
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
    registration?.removeEventListener("updatefound", watchInstalling);
    for (const [worker, listener] of installationListeners)
      worker.removeEventListener("statechange", listener);
    installationListeners.clear();
  }
  return { ...toRefs(state), reloadNow, start, stop };
}

export function useAppUpdate() {
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const controller = supported
    ? createAppUpdateController({
        serviceWorker: navigator.serviceWorker,
        events: window,
        appUrl: new URL("./", document.baseURI).href,
        online: () => navigator.onLine,
        reload: () => window.location.reload(),
      })
    : null;
  onMounted(() => controller?.start());
  onUnmounted(() => controller?.stop());
  return (
    controller || {
      ...toRefs(
        reactive({ available: false, seconds: 10, applying: false, error: "" }),
      ),
      reloadNow() {},
    }
  );
}
