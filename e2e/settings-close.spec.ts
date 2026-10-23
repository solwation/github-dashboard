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

// Settings opened in a wide landscape layout lives inside the phone menu; rotating to portrait must not hide the open modal (#269).
test("open Settings stays visible after rotating a large phone to portrait", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 956, height: 440 }, isMobile: true, hasTouch: true, locale: "sv-SE" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Inställningar" });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 440, height: 956 });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Stäng", exact: true })).toBeInViewport();
  await dialog.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(dialog).toBeHidden();
  await context.close();
});
