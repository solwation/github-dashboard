import { describe, expect, it, vi } from "vitest";
import { createSwipeHandler } from "../src/lib/touch-swipe";

function makeTouchEvent(type: string, touches: { clientX: number; clientY: number }[]): TouchEvent {
  return {
    type,
    touches: type === "touchend" ? [] : touches,
    changedTouches: touches,
  } as unknown as TouchEvent;
}

describe("touch swipe handler", () => {
  it("opens when swiping right from left edge", () => {
    let open = false;
    const onOpen = vi.fn(() => { open = true; });
    const onClose = vi.fn(() => { open = false; });
    const handler = createSwipeHandler({
      isOpen: () => open,
      onOpen,
      onClose,
      threshold: 50,
      edgeWidth: 40,
    });

    // Touch start near left edge (x=10, y=100)
    handler.onTouchStart(makeTouchEvent("touchstart", [{ clientX: 10, clientY: 100 }]));
    // Touch end at x=80, y=105 (deltaX = +70 > 50, deltaY = 5)
    handler.onTouchEnd(makeTouchEvent("touchend", [{ clientX: 80, clientY: 105 }]));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores swipe open when touchstart is not near the left edge", () => {
    let open = false;
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const handler = createSwipeHandler({
      isOpen: () => open,
      onOpen,
      onClose,
      threshold: 50,
      edgeWidth: 40,
    });

    // Touch start in middle of screen (x=100 > edgeWidth 40)
    handler.onTouchStart(makeTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
    handler.onTouchEnd(makeTouchEvent("touchend", [{ clientX: 200, clientY: 100 }]));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes when swiping left while open", () => {
    let open = true;
    const onOpen = vi.fn();
    const onClose = vi.fn(() => { open = false; });
    const handler = createSwipeHandler({
      isOpen: () => open,
      onOpen,
      onClose,
      threshold: 50,
      edgeWidth: 40,
    });

    // When open, touchstart can begin anywhere inside the drawer
    handler.onTouchStart(makeTouchEvent("touchstart", [{ clientX: 150, clientY: 100 }]));
    // Swipe left (deltaX = -70 < -50)
    handler.onTouchEnd(makeTouchEvent("touchend", [{ clientX: 80, clientY: 100 }]));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores predominantly vertical gestures (scrolling)", () => {
    let open = false;
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const handler = createSwipeHandler({
      isOpen: () => open,
      onOpen,
      onClose,
      threshold: 50,
      edgeWidth: 40,
    });

    handler.onTouchStart(makeTouchEvent("touchstart", [{ clientX: 10, clientY: 50 }]));
    // DeltaX = 60, but DeltaY = 150 (vertical scroll)
    handler.onTouchEnd(makeTouchEvent("touchend", [{ clientX: 70, clientY: 200 }]));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
