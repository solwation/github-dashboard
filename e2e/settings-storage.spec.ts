import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";

async function fixture(page: Page) {
  const repos = ["alpha", "beta", "gamma"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional settings fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  let login = "settings-alpha";
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      const now = new Date().toISOString();
      return route.fulfill({ json: [{ id: 7000 + repo.id, number: 41, title: `Fictional ${repo.name} task`, state: "open", created_at: now, updated_at: now, closed_at: null, labels: [], assignees: [], html_url: `${repo.html_url}/issues/41` }] });
    }
    return route.fulfill({ json: [] });
  });
  return { account(value: string) { login = value; } };
}
async function signIn(page: Page) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-settings-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toBeVisible();
}
const plaintextStorage = (page: Page) => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

test("account settings migrate to encrypted storage, survive confirmed logout and never mix accounts", async ({ page }) => {
  const api = await fixture(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("issueflow:settings-alpha", JSON.stringify({
    selected: ["sample/alpha", "sample/beta"], projectOrder: ["sample/beta", "sample/alpha", "sample/gamma"], collapsedRepos: ["sample/beta"],
    rules: { "sample/alpha": { progress: "fictional-progress-label" } }, notificationRepos: ["sample/alpha"],
    activityRead: { [JSON.stringify(["sample/alpha", 7001])]: "2026-01-01T00:00:00Z" },
    preferences: { query: "fictional-filter-text", statistics: { "sample/alpha": { from: "2026-01-01", to: "2026-01-02", label: "", contributor: "fictional-contributor", metric: "closed" } } },
  })));
  await page.reload();
  await signIn(page);
  // Migrated settings restore the saved board directly, without the repository picker.
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["beta", "alpha"]);
  await expect(page.getByRole("button", { name: "Expandera beta", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => readSettings(page, "settings-alpha").then(saved => saved?.selected)).toEqual(["sample/alpha", "sample/beta"]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("issueflow:")))).toEqual([]);
  const migrated = await readSettings(page, "settings-alpha");
  expect(migrated.rules).toEqual({ "sample/alpha": { progress: "fictional-progress-label" } });
  expect(migrated.preferences.query).toBe("fictional-filter-text");

  await page.getByRole("button", { name: "Expandera beta", exact: true }).click();
  await expect.poll(() => readSettings(page, "settings-alpha").then(saved => saved?.collapsedRepos)).toEqual([]);
  await page.reload();
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["beta", "alpha"]);
  await expect(page.getByRole("button", { name: "Kollapsa beta", exact: true })).toHaveAttribute("aria-expanded", "true");

  await signOut(page);
  const afterLogout = await plaintextStorage(page);
  for (const secret of ["sample/", "7001", "fictional-contributor", "fictional-filter-text", "fictional-progress-label", "settings-alpha"])
    expect(afterLogout).not.toContain(secret);

  // A different account starts from its own empty settings.
  api.account("settings-other");
  await signIn(page);
  const picker = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  await expect(picker.getByRole("checkbox", { name: "sample/alpha" })).not.toBeChecked();
  await expect(picker.getByRole("checkbox", { name: "sample/beta" })).not.toBeChecked();
  await picker.getByRole("checkbox", { name: "sample/gamma" }).check();
  await picker.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["gamma"]);
  await expect.poll(() => readSettings(page, "settings-other").then(saved => saved?.selected)).toEqual(["sample/gamma"]);
  await signOut(page);
  expect(await plaintextStorage(page)).not.toContain("sample/");

  // The first account gets its settings back after signing in again.
  api.account("settings-alpha");
  await signIn(page);
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["beta", "alpha"]);
  await expect(picker).toHaveCount(0);
  expect((await readSettings(page, "settings-alpha")).rules).toEqual({ "sample/alpha": { progress: "fictional-progress-label" } });
  expect(await plaintextStorage(page)).not.toContain("sample/");
});
