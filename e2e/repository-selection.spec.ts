import { expect, test, type Page } from "@playwright/test";
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(page: Page) {
  const repos = ["alpha", "beta", "gamma"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional selection fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const waits = new Map<string, ReturnType<typeof gate>>();
  const failures = new Set<string>();
  const finished: string[] = [];
  let login = "selection-fixture";
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      const wait = waits.get(repo.name);
      if (wait) await wait.promise;
      if (failures.has(repo.name)) { await route.fulfill({ status: 500, json: { message: "Temporary fixture failure" } }); finished.push(repo.name); return; }
      const now = new Date().toISOString();
      await route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : [{ id: repo.id, number: 1, title: `${login} ${repo.name} retained task`, state: "open", created_at: now, updated_at: now, closed_at: null, labels: [], assignees: [], html_url: `${repo.html_url}/issues/1` }] });
      finished.push(repo.name); return;
    }
    return route.fulfill({ json: [] });
  });
  return {
    hold(name: string) { const wait = gate(); waits.set(name, wait); return () => { waits.delete(name); wait.resolve(); }; },
    fail(name: string) { failures.add(name); },
    account(value: string) { login = value; }, finished,
  };
}
async function choose(page: Page, added: string[], removed: string[] = []) {
  await page.locator(".sidebar-add").click();
  const dialog = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  for (const name of removed) await dialog.getByRole("checkbox", { name: `sample/${name}` }).uncheck();
  for (const name of added) await dialog.getByRole("checkbox", { name: `sample/${name}` }).check();
  await dialog.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function connect(page: Page, names: string[]) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-repository-selection-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  for (const name of names) await dialog.getByRole("checkbox", { name: `sample/${name}` }).check();
  await dialog.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(names.length);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
}
async function order(page: Page, names: string[]) {
  await expect(page.locator(".repo-lane h2 a")).toHaveText(names);
  await expect(page.locator(".sidebar-repository .repository-label")).toHaveText(names);
}

test("selection updates every view immediately, keeps retained layout, publishes independent results and can clear during a refresh", async ({ page }) => {
  const api = await fixture(page); await page.goto("/"); await connect(page, ["alpha", "gamma"]);
  const alpha = page.locator("#repo-1");
  await alpha.locator(".issue-card").evaluate(element => element.setAttribute("data-selection-retained", "yes"));
  await page.getByRole("button", { name: "Kollapsa alpha", exact: true }).click();
  const releaseAlpha = api.hold("alpha"), releaseBeta = api.hold("beta");
  await choose(page, ["beta"], ["gamma"]);
  await order(page, ["alpha", "beta"]);
  await expect(alpha.locator('[data-selection-retained="yes"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Expandera alpha", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#repo-2 .repository-loading")).toContainText("Hämtar issues för sample/beta…");
  await expect(page.locator("#repo-2 .swimlane, #repo-2 .column-empty")).toHaveCount(0);
  await expect(page.locator('.sidebar-repository-row[data-repository="sample/beta"] .repository-counts')).toHaveText("Hämtar…");
  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  await expect(page.locator(".statistics-repository-heading a")).toHaveText(["sample/alpha", "sample/beta"]);
  releaseBeta();
  await expect(page.locator("#repo-2 .issue-card")).toHaveCount(1);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await choose(page, [], ["alpha", "beta"]);
  await order(page, []);
  await expect(page.locator(".statistics-repository")).toHaveCount(0);
  releaseAlpha();
  await expect.poll(() => api.finished.filter(name => name === "alpha").length).toBeGreaterThan(2);
  await order(page, []);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("issueflow:selection-fixture") || "{}").selected)).toEqual([]);
});

test("a failed newly selected repository leaves existing content visible without a fabricated empty board", async ({ page }) => {
  const api = await fixture(page); await page.goto("/"); await connect(page, ["alpha"]);
  const release = api.hold("beta"); api.fail("beta");
  await choose(page, ["beta"]);
  await order(page, ["alpha", "beta"]);
  await expect(page.locator("#repo-1 .issue-card")).toHaveCount(1);
  await expect(page.locator("#repo-2 .repository-loading")).toBeVisible();
  release();
  await expect(page.locator("#repo-2 [role=alert]")).toContainText("500");
  await expect(page.locator("#repo-2 .repository-loading, #repo-2 .swimlane, #repo-2 .column-empty")).toHaveCount(0);
  await expect(page.locator("#repo-1 .issue-card")).toHaveCount(1);
  await order(page, ["alpha", "beta"]);
});

test("late responses after logout never populate another account's selection", async ({ page }) => {
  const api = await fixture(page); await page.goto("/"); await connect(page, ["alpha"]);
  const releaseBeta = api.hold("beta");
  await choose(page, ["beta"]);
  await expect(page.locator("#repo-2 .repository-loading")).toBeVisible();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  api.account("other-selection-fixture");
  await connect(page, ["gamma"]);
  releaseBeta();
  await expect.poll(() => api.finished.includes("beta")).toBe(true);
  await order(page, ["gamma"]);
  await expect(page.locator(".issue-card")).toContainText("other-selection-fixture gamma retained task");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("issueflow:other-selection-fixture") || "{}").selected)).toEqual(["sample/gamma"]);
});
