import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.use({ baseURL: "http://127.0.0.1:4173", locale: "sv-SE" });

test("production settings identify the running build without sign-in, in both languages on mobile", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/github-dashboard/");
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  const build = page.getByRole("region", { name: "Bygginformation", exact: true });
  await expect(build).toBeVisible();

  const time = build.locator("time");
  const timestamp = await time.getAttribute("datetime");
  expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const builtAt = Date.parse(timestamp!);
  expect(Number.isFinite(builtAt)).toBe(true);
  expect(builtAt).toBeLessThanOrEqual(Date.now());
  await expect(time).toHaveAttribute("title", timestamp!);

  const commit = process.env.GITHUB_ACTIONS && process.env.GITHUB_SHA
    ? process.env.GITHUB_SHA
    : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await expect(build.locator("code")).toHaveText(commit.slice(0, 7));
  await expect(build.locator("code")).toHaveAttribute("title", commit);

  const expectedDate = (language: string) => page.evaluate(({ language, timestamp }) =>
    new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(timestamp!)), { language, timestamp });
  await expect(time).toHaveText(await expectedDate("sv-SE"));
  const dialog = page.getByRole("dialog", { name: "Inställningar", exact: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  const englishBuild = page.getByRole("region", { name: "Build information", exact: true });
  await expect(englishBuild).toBeVisible();
  await expect(englishBuild).toContainText("Built");
  await expect(englishBuild.locator("time")).toHaveText(await expectedDate("en-GB"));

  // A cached shell must keep its own build identity rather than fetching metadata.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const cachedBuild = page.getByRole("region", { name: "Build information", exact: true });
  await expect(cachedBuild.locator("time")).toHaveAttribute("datetime", timestamp!);
  await expect(cachedBuild.locator("code")).toHaveAttribute("title", commit);
});
