import { expect, test } from "@playwright/test";
import { previewOrigin } from "./ports";
test.use({ baseURL: previewOrigin });
test("production app is installable and caches only public app shell for offline use", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  const manifestURL = await page
    .locator("link[rel=manifest]")
    .getAttribute("href");
  const manifestAddress = new URL(manifestURL!, page.url()).href;
  const manifest = await (await request.get(manifestAddress)).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("./");
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestAddress).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  const cached = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result.push(...(await cache.keys()).map((request) => request.url));
    }
    return result;
  });
  expect(cached.length).toBeGreaterThan(4);
  expect(
    cached.some(
      (url) =>
        url.includes("api.github.com") ||
        url.includes("token") ||
        url.includes("?"),
    ),
  ).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Utforska en demo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
});
test("installation button uses an offered browser prompt", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        Object.assign(window, { installPromptUsed: true });
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Installera app" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { installPromptUsed: boolean }).installPromptUsed,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Installera app" }),
  ).toHaveCount(0);
});
