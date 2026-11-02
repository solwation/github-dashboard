export interface SwipeConfig {
  /** Minimum horizontal delta in pixels to trigger swipe open/close (default 50) */
  threshold?: number;
  /** Maximum touchstart X position from left screen edge to consider an open swipe (default 40) */
  edgeWidth?: number;
  isOpen(): boolean;
  onOpen(): void;
  onClose(): void;
}

export function createSwipeHandler(config: SwipeConfig) {
  const threshold = config.threshold ?? 50;
  const edgeWidth = config.edgeWidth ?? 40;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      tracking = false;
      return;
    }
    const touch = e.touches[0]!;
    const open = config.isOpen();
    // When closed, only track touches that start near the left screen edge
    if (!open && touch.clientX > edgeWidth) {
      tracking = false;
      return;
    }
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  }

  function onTouchEnd(e: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    if (!e.changedTouches.length) return;
    const touch = e.changedTouches[0]!;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    // Gesture must be predominantly horizontal
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (!config.isOpen() && deltaX > threshold) {
        config.onOpen();
      } else if (config.isOpen() && deltaX < -threshold) {
        config.onClose();
      }
    }
  }

  return {
    onTouchStart,
    onTouchEnd,
  };
}
