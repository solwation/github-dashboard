import { onScopeDispose, readonly, ref, shallowRef, watchEffect } from "vue";

// Clocks pause in hidden tabs and, for board labels, while the overview is not shown (#120).
const hidden = ref(typeof document !== "undefined" && document.hidden);
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { hidden.value = document.hidden; });
const boardVisible = ref(true);
export function setBoardVisible(visible: boolean) { boardVisible.value = visible; }

// Labels that show seconds share one ticker so they update in the same frame.
const secondListeners = new Set<() => void>();
let secondTimer: ReturnType<typeof setInterval> | undefined;
function everySecond(listener: () => void) {
  secondListeners.add(listener);
  secondTimer ??= setInterval(() => { for (const update of secondListeners) update(); }, 1000);
  return () => {
    secondListeners.delete(listener);
    if (!secondListeners.size) { clearInterval(secondTimer); secondTimer = undefined; }
  };
}
export const untilNext = (elapsed: number, unit: number) => unit - (elapsed % unit);

/**
 * A component-local clock that only updates when its own label can change. `delay(now)` returns
 * the milliseconds until then (Infinity for never); one second or less joins the shared ticker.
 * `active` pauses it further, e.g. for offscreen cards.
 */
export function useNow(delay: (now: number) => number, options: { board?: boolean; active?: () => boolean } = {}) {
  const now = shallowRef(Date.now());
  let stopSeconds: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, paused = false, seen: number | undefined;
  const update = () => { now.value = Date.now(); };
  const halt = () => { stopSeconds?.(); stopSeconds = undefined; clearTimeout(timer); timer = undefined; };
  watchEffect(() => {
    if (hidden.value || (options.board && !boardVisible.value) || options.active?.() === false) { halt(); paused = true; return; }
    // Runs not caused by this clock (resuming, or new data read by `delay`) start from the current time.
    if (paused || now.value === seen) { paused = false; update(); }
    const wait = delay(seen = now.value);
    clearTimeout(timer); timer = undefined;
    if (wait <= 1000) stopSeconds ??= everySecond(update);
    else {
      stopSeconds?.(); stopSeconds = undefined;
      if (Number.isFinite(wait)) timer = setTimeout(update, wait + 10);
    }
  });
  onScopeDispose(halt);
  return readonly(now);
}
