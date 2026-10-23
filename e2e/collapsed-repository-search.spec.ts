import { expect, test } from "@playwright/test";

const phones = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }];
for (const viewport of phones) {
  test(`collapsed repositories hide their search on a ${viewport.width}×${viewport.height} phone and keep the query`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    const board = page.locator("#repo-1");
    const search = board.getByLabel("Filtrera issues i demo/design-system", { exact: true });
    await search.fill("zz-no-match");
    await board.getByRole("button", { name: "Kollapsa design-system", exact: true }).click();
    await expect(search).toBeHidden();
    await expect(board.locator(".lane-summary")).toBeVisible();
    if (process.env.EVIDENCE_DIR) await board.screenshot({ path: `${process.env.EVIDENCE_DIR}/collapsed-${viewport.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await board.getByRole("button", { name: "Expandera design-system", exact: true }).click();
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("zz-no-match");
    await context.close();
  });
}

test("desktop keeps the search field on collapsed repositories", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  const board = page.locator("#repo-1");
  await board.getByRole("button", { name: "Kollapsa design-system", exact: true }).click();
  await expect(board.getByLabel("Filtrera issues i demo/design-system", { exact: true })).toBeVisible();
});
