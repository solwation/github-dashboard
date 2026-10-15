import { expect, test } from "@playwright/test";

test("sidebar credits link to the author and license with keyboard access", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  const author = sidebar.getByRole("link", { name: "Olof Wingren", exact: true });
  const license = sidebar.getByRole("link", { name: "MIT License", exact: true });
  await expect(author).toBeVisible();
  await expect(author).toHaveAttribute("href", "https://github.com/solwation");
  await expect(license).toHaveAttribute("href", "https://github.com/solwation/github-dashboard/blob/main/LICENSE");
  await expect(author).toHaveAttribute("rel", "noopener noreferrer");

  // Reach the author using the keyboard, then follow the natural tab order.
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press("Tab");
    if (await author.evaluate(element => element === document.activeElement)) break;
  }
  await expect(author).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(license).toBeFocused();
  expect(await license.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");

  // The existing compact navigation hides its footer; credits must not widen it.
  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(author).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
