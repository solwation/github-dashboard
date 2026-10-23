import { expect, test } from "@playwright/test";

test("repository filters stay independent and combine with the global filter in every column", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  const design = page.locator("#repo-1");
  const weekend = page.locator("#repo-2");
  const personal = page.locator("#repo-3");
  const designFilter = page.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true });
  const weekendFilter = page.getByRole("textbox", { name: "Filtrera issues i demo/weekend-project", exact: true });
  const globalFilter = page.getByRole("textbox", { name: "Sök issues", exact: true });

  await expect(design.locator('.lane-header').getByRole('textbox', { name: 'Filtrera issues i demo/design-system', exact: true })).toBeVisible();
  await expect(weekend.locator('.lane-header').getByRole('textbox', { name: 'Filtrera issues i demo/weekend-project', exact: true })).toBeVisible();
  await designFilter.fill("BUG");
  await expect(design.locator(".backlog .issue-card")).toHaveCount(2);
  await expect(design.locator(".progress .issue-card")).toHaveCount(0);
  await expect(design.locator(".closed .issue-card")).toHaveCount(2);
  await expect(weekend.locator(".issue-card")).toHaveCount(5);
  await expect(personal.locator(".issue-card")).toHaveCount(4);

  await weekendFilter.fill("#99");
  await expect(weekend.locator(".issue-card")).toHaveCount(1);
  await expect(weekend.locator(".progress .issue-card")).toHaveCount(1);
  await globalFilter.fill("priority: high");
  await expect(design.locator(".issue-card")).toHaveCount(1);
  await expect(weekend.locator(".issue-card")).toHaveCount(0);
  await expect(weekend.getByRole("status")).toHaveText("Inga issues i demo/weekend-project matchar filtren.");
  await expect(personal.locator(".issue-card")).toHaveCount(1);

  await page.getByRole("button", { name: "Rensa filtret för demo/design-system" }).click();
  await expect(designFilter).toHaveValue("");
  await expect(weekendFilter).toHaveValue("#99");
  await expect(globalFilter).toHaveValue("priority: high");
  await globalFilter.fill("");
  await expect(design.locator(".issue-card")).toHaveCount(8);
  await expect(weekend.locator(".issue-card")).toHaveCount(1);
  await designFilter.fill("TANGENTBORD");
  await expect(design.locator(".issue-card")).toHaveCount(1);
});

test("repository controls work with keyboard on mobile and translate into English", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  const filter = page.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true });
  const header = page.locator('#repo-1 .lane-header');
  await expect(header.getByRole('textbox', { name: 'Filtrera issues i demo/design-system', exact: true })).toBeVisible();
  await header.getByRole('button', { name: 'Kollapsa design-system', exact: true }).click();
  // Collapsed repositories show no issues on phones, so their search is hidden (#265).
  await expect(filter).toBeHidden();
  await expect(header.getByRole('button', { name: 'Expandera design-system', exact: true })).toBeVisible();
  await header.getByRole('button', { name: 'Expandera design-system', exact: true }).click();
  await filter.focus();
  await page.keyboard.type("absent-result");
  await page.keyboard.press("Tab");
  const clear = page.getByRole("button", { name: "Rensa filtret för demo/design-system" });
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(filter).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const headerBox = await header.boundingBox();
  const filterBox = await filter.boundingBox();
  expect(filterBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);
  expect(filterBox!.y + filterBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Filter issues in demo/design-system", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filter for demo/design-system" })).toBeVisible();
});
