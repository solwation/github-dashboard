import { expect, test, type Page } from "@playwright/test";
import { closePhoneMenu, openSettings } from "./support/phone-menu";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function connect(page: Page, names: string[]) {
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-statistics-loading-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const name of names) await page.getByRole("checkbox", { name: new RegExp(`sample/${name}`) }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("link", { name: "Statistik", exact: true }).click();
}

test("Statistics waits clearly, completes repositories independently and retains values while refreshing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const names = ["alpha", "bravo"];
  const repos = names.map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: null, private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const timestamp = new Date().toISOString();
  const issue = { id: 1, number: 1, title: "Loading fixture", state: "open", closed_at: null, assignees: [], html_url: "https://github.com/sample/alpha/issues/1", created_at: timestamp, updated_at: timestamp, labels: [], user: { login: "sample" } };
  let waits = { alpha: gate(), bravo: gate() };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "loading-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues/events") || (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "all")
      || ((url.pathname.includes("/commits") || url.pathname.endsWith("/pulls")) && url.searchParams.get("per_page") !== "1")) {
      await waits[url.pathname.includes("/alpha/") ? "alpha" : "bravo"].promise;
    }
    if (url.pathname.endsWith("/issues/events")) {
      return route.fulfill({ json: [{ id: 1, event: "closed", created_at: timestamp, issue, actor: { login: "sample" } }] });
    }
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "all") return route.fulfill({ json: [issue] });
    return route.fulfill({ json: [] });
  });
  await connect(page, names);
  await page.getByRole('button', { name: 'Expandera sample/bravo', exact: true }).click();
  const splash = page.locator(".statistics-loading-splash");
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute("role", "status");
  await expect(splash.getByRole("heading")).toHaveText("Hämtar och sammanställer statistik");
  await expect(splash).toContainText("Hämtning avslutad för 0 av 2 repositories.");
  await expect(page.locator(".statistics-total:visible, .statistics-empty:visible")).toHaveCount(0);
  expect(await splash.locator(".statistics-loading-spinner").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(await splash.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(splash.getByRole("heading")).toHaveText("Fetching and preparing statistics");
  await openSettings(page, "Settings");
  await page.getByLabel("Language", { exact: true }).selectOption("sv");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await closePhoneMenu(page);

  waits.alpha.resolve();
  const alpha = page.locator('.statistics-repository[data-repository="sample/alpha"]');
  const bravo = page.locator('.statistics-repository[data-repository="sample/bravo"]');
  await expect(splash).toHaveCount(0);
  await expect(alpha.locator(".statistics-total").filter({ hasText: "Stängda issues" }).locator("strong")).toHaveText("1");
  await expect(alpha.locator(".statistics-repository-content")).toHaveAttribute("aria-busy", "false");
  // The waiting repository shows its loading progress (#257/#263); reduced motion stops the spinner.
  const bravoProgress = bravo.getByRole("region", { name: "Statistikhämtning", exact: true });
  await expect(bravoProgress).toBeVisible();
  await expect(bravo.locator(".statistics-repository-content")).toHaveAttribute("aria-busy", "true");
  await expect(bravo.locator(".statistics-total, .statistics-empty")).toHaveCount(0);
  expect(await bravoProgress.locator(".statistics-load-spinner").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  waits.bravo.resolve();
  await expect(bravoProgress).toHaveCount(0);
  const refresh = page.getByRole("button", { name: "Uppdatera statistik", exact: true });
  await expect(refresh).toBeEnabled();

  waits = { alpha: gate(), bravo: gate() };
  await refresh.click();
  await expect(splash).toHaveCount(0);
  // A refresh keeps the values and shows the loading progress instead of a separate refreshing note (#263).
  await expect(alpha.getByRole("region", { name: "Statistikhämtning", exact: true })).toBeVisible();
  await expect(alpha.locator(".statistics-total").filter({ hasText: "Stängda issues" }).locator("strong")).toHaveText("1");
  await expect(bravo.locator(".statistics-total").filter({ hasText: "Stängda issues" }).locator("strong")).toHaveText("1");
  await expect(alpha.locator(".statistics-repository-content")).toHaveAttribute("aria-busy", "true");
  waits.alpha.resolve(); waits.bravo.resolve();
  await expect(refresh).toBeEnabled();
  await expect(page.locator(".statistics-load-progress")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Statistics distinguishes unavailable optional data from an initial temporary fetch failure", async ({ page }) => {
  const repo = { id: 1, name: "loading-outcomes", full_name: "sample/loading-outcomes", description: null, private: true, html_url: "https://github.com/sample/loading-outcomes", owner: { login: "sample" } };
  let failure = false;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "outcomes-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    const statisticsRequest = url.pathname.endsWith("/issues/events") || url.pathname.endsWith("/commits") || url.pathname.endsWith("/pulls") || (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "all");
    if (statisticsRequest) return route.fulfill({ status: failure ? 500 : 403, json: { message: failure ? "Temporary server error" : "Resource not accessible by personal access token" } });
    return route.fulfill({ json: [] });
  });
  await connect(page, [repo.name]);
  await expect(page.locator(".statistics-loading-splash")).toHaveCount(0);
  await expect(page.locator(".statistics-repository .statistics-empty")).toBeVisible();
  await expect(page.locator(".statistics-view .notice, .statistics-view .statistics-total")).toHaveCount(0);
  failure = true;
  await page.getByRole("button", { name: "Uppdatera statistik", exact: true }).click();
  await expect(page.getByText("Statistiken kunde inte hämtas just nu. Försök igen senare.", { exact: true })).toBeVisible();
  await expect(page.locator(".statistics-view .statistics-empty, .statistics-view .statistics-total")).toHaveCount(0);
  await expect(page.locator(".statistics-loading-splash")).toHaveCount(0);
});
