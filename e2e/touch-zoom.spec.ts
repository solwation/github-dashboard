import { expect, test } from "@playwright/test";

const sizes = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 320, height: 568 },
] as const;

for (const size of sizes) {
  test(`touch zoom is blocked outside the image viewer at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    const warnings: string[] = [];
    page.on("console", message => { if (["warning", "error"].includes(message.type())) warnings.push(message.text()); });
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    await expect(page.locator(".repo-lane")).toHaveCount(3);

    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /maximum-scale=1.*user-scalable=no/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("pan-x pan-y");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("text-size-adjust") || "100%")).toContain("100%");

    const result = await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<div class="image-viewport" id="fake-viewer"><span id="fake-inner">x</span></div>');
      const touch = (target: Element, count: number) => {
        const touches = Array.from({ length: count }, (_, i) => new Touch({ identifier: i, target, clientX: 20 + i * 30, clientY: 20 }));
        const event = new TouchEvent("touchmove", { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const gesture = (target: Element) => {
        const event = new Event("gesturestart", { bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const board = document.querySelector(".repo-lane")!, inner = document.getElementById("fake-inner")!;
      const out = {
        twoFingerBoard: touch(board, 2), oneFingerBoard: touch(board, 1), gestureBoard: gesture(board),
        twoFingerViewer: touch(inner, 2), gestureViewer: gesture(inner),
      };
      document.getElementById("fake-viewer")!.remove();
      return out;
    });
    expect(result).toEqual({ twoFingerBoard: true, oneFingerBoard: false, gestureBoard: true, twoFingerViewer: false, gestureViewer: false });
    expect(warnings.filter(w => /passive|touch|gesture/i.test(w))).toEqual([]);
    await context.close();
  });
}
