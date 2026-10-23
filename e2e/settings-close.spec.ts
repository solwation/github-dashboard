import { expect, test } from "@playwright/test";

// The settings dialog lives inside the phone menu, whose full-width row styling must not reach its close button (#260).
for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`phone settings close button stays compact at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    await page.locator(".mobile-menu-button").click();
    await page.getByRole("button", { name: "Inställningar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Inställningar" });
    const heading = await dialog.getByRole("heading", { name: "Inställningar" }).boundingBox();
    const close = await dialog.getByRole("button", { name: "Stäng", exact: true }).boundingBox();
    const box = await dialog.boundingBox();
    expect(close!.width).toBe(44);
    expect(close!.height).toBe(44);
    expect(close!.x).toBeGreaterThan(heading!.x + heading!.width);
    expect(box!.x + box!.width - (close!.x + close!.width)).toBeLessThan(40);
    await context.close();
  });
}
