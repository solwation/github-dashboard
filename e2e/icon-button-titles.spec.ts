import { expect, test } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

/** DESIGN.md §3: icon-only controls carry a title tooltip equal to their accessible name (#299). */
async function expectTitlesMatchLabels(dialog: ReturnType<import("@playwright/test").Page["locator"]>) {
  const pairs = await dialog.locator("button[aria-label], a[aria-label]").evaluateAll(nodes =>
    nodes.filter(node => !node.textContent?.trim()).map(node => ({ label: node.getAttribute("aria-label"), title: node.getAttribute("title") })));
  expect(pairs.length).toBeGreaterThan(0);
  for (const pair of pairs) {
    expect(pair.title, `title for ${pair.label}`).toBeTruthy();
    expect(pair.title).toBe(pair.label);
  }
}

test("dialog close buttons expose a title equal to their accessible name", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Inställningar", exact: true });
  await expect(settings).toBeVisible();
  const close = settings.getByRole("button", { name: "Stäng", exact: true });
  await expect(close).toHaveAttribute("title", "Stäng");
  await expectTitlesMatchLabels(settings);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  const version = page.locator(".sidebar").getByRole("region", { name: "Version", exact: true });
  await version.focus();
  await page.keyboard.press("Enter");
  const notes = page.getByRole("dialog", { name: "Versionsnyheter", exact: true });
  await expect(notes).toBeVisible();
  await expect(notes.getByRole("button", { name: "Stäng versionsnyheter" })).toHaveAttribute("title", "Stäng versionsnyheter");
});
