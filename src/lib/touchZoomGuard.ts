/**
 * Blocks touch pinch-zoom and two-finger page pan on touch devices. iOS Safari ignores
 * `user-scalable=no`, so WebKit gesture events and multi-finger touchmove are cancelled.
 * The image viewer handles its own pinch/pan via pointer events and is left alone.
 */
const OWN_GESTURE_SELECTOR = ".image-viewport";

function ownsGesture(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(OWN_GESTURE_SELECTOR) !== null;
}

function blockGesture(event: Event) {
  if (!ownsGesture(event) && event.cancelable) event.preventDefault();
}

function blockMultiTouch(event: TouchEvent) {
  if (event.touches.length > 1 && !ownsGesture(event) && event.cancelable) event.preventDefault();
}

/** Registers the guards once; returns a function that removes them. No-op without touch support. */
export function installTouchZoomGuard(target: Document = document): () => void {
  const touchCapable = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!touchCapable) return () => {};
  const options = { passive: false } as const;
  const gestures = ["gesturestart", "gesturechange", "gestureend"] as const;
  for (const name of gestures) target.addEventListener(name, blockGesture, options);
  target.addEventListener("touchmove", blockMultiTouch, options);
  return () => {
    for (const name of gestures) target.removeEventListener(name, blockGesture);
    target.removeEventListener("touchmove", blockMultiTouch);
  };
}
