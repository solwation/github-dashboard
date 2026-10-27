import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { openSettings } from "./support/phone-menu";
import { textAccessibility } from "./support/text-accessibility";

for (const width of [1366, 950, 390]) for (const theme of ["light", "dark"] as const) {
  test(`settings controls and grouped layout ${width} ${theme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 768 : width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390, colorScheme: theme, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    await openSettings(page);
    const dialog = page.getByRole("dialog", { name: "Inställningar", exact: true });
    await expect(dialog).toBeVisible();
    for (const name of ["Utseende", "Board", "Notiser", "Tidsestimat"]) await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
    const metrics = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>('select, input[type="number"]')].map(control => {
        const style = getComputedStyle(control), rect = control.getBoundingClientRect();
        return { id: control.id, height: rect.height, border: style.borderColor, background: style.backgroundColor, radius: style.borderRadius, font: style.fontSize };
      });
      const fields = [...element.querySelectorAll<HTMLElement>('.settings-section-fields > .settings-field')].slice(0, 2).map(control => control.getBoundingClientRect());
      return { width: box.width, height: box.height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflow: element.scrollWidth - element.clientWidth, controls, alignment: fields.map(field => field.top) };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.controls).toHaveLength(4);
    expect(Math.max(...metrics.controls.map(control => control.height)) - Math.min(...metrics.controls.map(control => control.height))).toBeLessThanOrEqual(1);
    expect(new Set(metrics.controls.map(control => control.border)).size).toBe(1);
    expect(new Set(metrics.controls.map(control => control.background)).size).toBe(1);
    expect(new Set(metrics.controls.map(control => control.radius)).size).toBe(1);
    if (width === 1366) {
      // Same demo and viewport as the measured pre-change client691/content1010px dialog.
      expect(metrics.clientHeight).toBeLessThan(691);
      expect(metrics.scrollHeight).toBeLessThan(1010);
      expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);
    }
    if (width !== 390) expect(Math.abs(metrics.alignment[0]! - metrics.alignment[1]!)).toBeLessThanOrEqual(1);
    else {
      for (const control of metrics.controls) expect(control.height).toBeGreaterThanOrEqual(44);
      for (const label of await dialog.locator(".settings-toggle").all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Tab");
    for (const control of await dialog.locator('select, input[type="number"]').all()) {
      await control.focus();
      await expect(control).toHaveCSS("outline-style", "solid");
      await expect(control).toHaveCSS("outline-width", "2px");
    }
    await writeFile(info.outputPath("geometry.json"), JSON.stringify(metrics, null, 2));
    await textAccessibility(page);
    const sounds = dialog.getByRole("checkbox", { name: "Notifikationsljud", exact: true });
    await expect(sounds).toBeChecked();
    await sounds.focus(); await page.keyboard.press("Space");
    await expect(sounds).not.toBeChecked();
    const timeout = dialog.getByRole("checkbox", { name: "Varna när pågående arbete överskrider estimatet", exact: true });
    await timeout.uncheck();
    await expect(dialog.getByLabel("Tillåten överskridning (%)", { exact: true })).toBeDisabled();
    await timeout.check();
    await expect(dialog.getByLabel("Tillåten överskridning (%)", { exact: true })).toBeEnabled();
    const close = dialog.getByRole("button", { name: "Stäng", exact: true });
    const done = dialog.getByRole("button", { name: "Klart", exact: true });
    // Native dialogs keep the page inert while allowing a browser-chrome focus stop.
    const tab = async (key: string) => {
      await page.keyboard.press(key);
      if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press(key);
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    };
    await done.focus(); await tab("Tab");
    if (width !== 390) await expect(close).toBeFocused();
    await tab("Shift+Tab");
    if (width !== 390) await expect(done).toBeFocused();
    await page.locator(width === 390 ? ".mobile-menu-button" : ".brand").evaluate((element: HTMLElement) => element.focus());
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await close.focus();
    await dialog.screenshot({ path: info.outputPath("settings.png") });
    if (width === 390) {
      await done.scrollIntoViewIfNeeded();
      await dialog.screenshot({ path: info.outputPath("settings-bottom.png") });
    }
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Inställningar", exact: true })).toBeFocused();
    await context.close();
  });
}

test("signed-out settings retain disabled account controls and English section names", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Inställningar", exact: true });
  await expect(dialog.getByLabel("Notifikationsljud", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Varna när pågående arbete överskrider estimatet", { exact: true })).toBeDisabled();
  await expect(dialog.locator("#global-column-limit")).toBeDisabled();
  await expect(dialog.locator(".repository-order-open")).toHaveCount(0);
  await dialog.getByLabel("Språk", { exact: true }).selectOption("en");
  for (const name of ["Appearance", "Board", "Notifications", "Time estimates"]) await expect(page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("checkbox", { name: "Notification sounds", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
});
