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
  let registration: ServiceWorkerRegistration | undefined;
  let waiting: ServiceWorker | null = null;
  let deadline: number | undefined;
  let activationTimeout: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let checkTimer: ReturnType<typeof setInterval> | undefined;
  let reloading = false;
  let checking = false;
  let activationTarget: ServiceWorker | null = null;
  function clearActivationTarget() {
    activationTarget?.removeEventListener("statechange", maybeFinish);
    activationTarget = null;
  }
  function maybeFinish() {
    if (
      state.applying &&
      activationTarget &&
      sw.controller === activationTarget &&
      activationTarget.state === "activated"
    )
      finish();
  }
  function waitForActivation(target: ServiceWorker) {
    clearActivationTarget();
    activationTarget = target;
    target.addEventListener("statechange", maybeFinish);
    clearTimeout(activationTimeout);
    activationTimeout = setTimeout(activationFailed, 15000);
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
    clearActivationTarget();
    state.applying = false;
    state.error = "Uppdateringen kunde inte aktiveras. Försök igen.";
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
    // Another tab may already have activated the latest worker.
    waiting = registration?.waiting || waiting;
    if (waiting?.state === "redundant") {
      activationFailed();
      return;
    }
    if (!waiting || waiting.state === "activated") {
      const current = waiting?.state === "activated" ? waiting : sw.controller;
      if (!current) {
        activationFailed();
        return;
      }
      waitForActivation(current);
      return;
    }
    waitForActivation(waiting);
    try {
      waiting.postMessage({ type: "SKIP_WAITING" });
    } catch {
      clearTimeout(activationTimeout);
      activationFailed();
    }
  }
  function controllerChanged() {
    if (!active) return;
    // A first installation may claim this tab, without representing a new app version.
    if (!hadController) {
      hadController = true;
      watchInstalling();
      if (registration?.waiting) offer(registration.waiting);
      void check();
      return;
    }
    waiting = null;
    if (state.applying) {
      maybeFinish();
    } else {
      offer(null);
    }
  }
  function watchInstalling() {
    const worker = registration?.installing;
    if (!worker || installationListeners.has(worker)) return;
    const changed = () => {
      if (worker.state === "installed" && hadController)
        offer(registration?.waiting || worker);
    };
    installationListeners.set(worker, changed);
    worker.addEventListener("statechange", changed);
    changed();
  }
  async function check() {
    if (!active || checking || !environment.online()) return;
    checking = true;
    hadController ||= Boolean(sw.controller);
    try {
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
    } finally {
      checking = false;
    }
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
    hadController ||= Boolean(sw.controller);
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
