import { expect, test } from "@playwright/test";

test("the whole sidebar license badge opens LICENSE, while the version badge keeps its dialog action", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  const license = sidebar.getByRole("link", { name: "Olof Wingren MIT License", exact: true });
  const version = sidebar.getByRole("region", { name: "Version", exact: true });
  await expect(license).toBeVisible();
  await expect(license).toHaveClass("sidebar-footer");
  await expect(license).toHaveAttribute("href", "https://github.com/solwation/github-dashboard/blob/main/LICENSE");
  await expect(license).toHaveAttribute("target", "_blank");
  await expect(license).toHaveAttribute("rel", "noopener noreferrer");
  await expect(license.locator("a, button")).toHaveCount(0);
  await expect(license).toContainText("Olof Wingren");
  const iconRights: number[] = [];
  for (const [badge, iconName] of [[license, ".sidebar-footer-open"], [version, ".sidebar-version-open"]] as const) {
    const icon = badge.locator(iconName);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    const [badgeBox, iconBox] = await Promise.all([badge.boundingBox(), icon.boundingBox()]);
    // The icon sits in the badge's --space-2 end padding (#304).
    expect(badgeBox!.x + badgeBox!.width - iconBox!.x - iconBox!.width).toBeLessThanOrEqual(8.5);
    iconRights.push(iconBox!.x + iconBox!.width);
  }
  // Both stacked badges' open icons share one right edge (DESIGN.md alignment).
  expect(Math.abs(iconRights[0] - iconRights[1])).toBeLessThanOrEqual(1);
  await expect(version).toHaveAttribute("title", /Klicka för att visa versionsnyheter/);
  await expect(license).toHaveAttribute("title", "Olof Wingren · MIT License");
  // The new version icon remains decorative: the existing keyboard action opens a local dialog.
  await version.focus();
  await page.keyboard.press("Enter");
  const notes = page.getByRole("dialog", { name: "Versionsnyheter", exact: true });
  await expect(notes).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notes).toBeHidden();
  await expect(version).toBeFocused();
  // An available-update badge may add one legitimate tab stop inside the version region.
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press("Tab");
    if (await license.evaluate(element => element === document.activeElement)) break;
  }
  await expect(license).toBeFocused();
  expect(await license.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");

  // Clicking padding outside both text and icons still follows the LICENSE link.
  await context.route("https://github.com/solwation/github-dashboard/blob/main/LICENSE", route => route.fulfill({ contentType: "text/html", body: "MIT License fixture" }));
  const opened = context.waitForEvent("page");
  await license.click({ position: { x: 12, y: 8 } });
  const popup = await opened;
  await expect(popup).toHaveURL("https://github.com/solwation/github-dashboard/blob/main/LICENSE");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();

  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await expect(license).toBeVisible();
  await expect(version.locator(".sidebar-version-open")).toBeVisible();
  // The existing compact navigation hides its footer; credits must not widen it.
  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(license).toBeHidden();
    await expect(version.locator(".sidebar-version-open")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("the version update badge keeps its own Enter and Space action", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const vuePath = "/node_modules/.vite/deps/vue.js";
    const componentPath = "/src/components/SidebarVersion.vue";
    const [{ createApp, h }, { default: SidebarVersion }] = await Promise.all([import(/* @vite-ignore */ vuePath), import(/* @vite-ignore */ componentPath)]);
    const fixture = document.createElement("div");
    fixture.id = "version-badge-fixture";
    fixture.dataset.notes = "0";
    fixture.dataset.updates = "0";
    document.body.append(fixture);
    createApp({ render: () => h(SidebarVersion, {
      available: true,
      onReleaseNotes: () => fixture.dataset.notes = String(Number(fixture.dataset.notes) + 1),
      onOpenUpdate: () => fixture.dataset.updates = String(Number(fixture.dataset.updates) + 1),
    }) }).mount(fixture);
  });
  const fixture = page.locator("#version-badge-fixture");
  const badge = fixture.getByRole("button", { name: "Ny uppdatering tillgänglig", exact: true });
  await badge.focus();
  await badge.press("Enter");
  await expect(fixture).toHaveAttribute("data-updates", "1");
  await badge.press("Space");
  await expect(fixture).toHaveAttribute("data-updates", "2");
  await expect(fixture).toHaveAttribute("data-notes", "0");
});
