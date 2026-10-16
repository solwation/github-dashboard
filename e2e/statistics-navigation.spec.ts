import { expect, test, type Page } from "@playwright/test";

test("sidebar project links stay on Statistics and preserve charts and filters through history", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  const section = page.locator('#statistics-repo-2');
  await expect(section).toBeVisible();
  await section.getByRole("combobox", { name: "Mätvärde", exact: true }).selectOption("commits");
  await section.evaluate(element => element.setAttribute("data-retained", "yes"));
  const link = page.locator('.sidebar-repository-row[data-repository="demo/weekend-project"] .sidebar-repository');
  await expect(link).toHaveAttribute("href", "#statistics-repo-2"); await link.click();
  await expect(page).toHaveURL(/#statistics-repo-2$/);
  await expect(page.getByRole("link", { name: "Statistik", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(section.locator("h2")).toBeInViewport();
  await expect(section).toHaveAttribute("data-retained", "yes");
  await page.goBack(); await expect(page).toHaveURL(/#statistics$/);
  await page.goForward(); await expect(section.locator("h2")).toBeInViewport();
  await expect(section.getByRole("combobox", { name: "Mätvärde", exact: true })).toHaveValue("commits");
  await page.getByRole("link", { name: "Översikt", exact: true }).click();
  await expect(link).toHaveAttribute("href", "#repo-2"); await link.click();
  await expect(page.locator("#repo-2 h2")).toBeInViewport();
});

async function fixture(page: Page) {
  const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, description: null, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  let blocked = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const statistics = url.pathname.endsWith("/issues/events") || (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "all") || ((url.pathname.endsWith("/commits") || url.pathname.endsWith("/pulls")) && url.searchParams.get("per_page") !== "1");
    if (statistics) { requests++; if (blocked) await gate; }
    await route.fulfill({ json: url.pathname === "/user" ? { login: "statistics-navigation", avatar_url: "" } : url.pathname === "/user/repos" ? repos : [] });
  });
  return { hold() { blocked = true; }, release() { blocked = false; release(); }, count() { return requests; } };
}

test("direct statistics project links override saved Overview and wait for loading without refetching on navigation", async ({ page }) => {
  const api = await fixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-navigation-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const name of ["sample/alpha", "sample/beta"]) await page.getByRole("checkbox", { name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  api.hold(); await page.goto("/#statistics-repo-2");
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
  await expect(page.locator(".statistics-loading-splash")).toBeVisible();
  await page.locator('.sidebar-repository-row[data-repository="sample/beta"] .sidebar-repository').click();
  await expect(page).toHaveURL(/#statistics-repo-2$/);
  api.release();
  await expect(page.locator('.statistics-loading-splash, .statistics-repository-content[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator("#statistics-repo-2 h2")).toBeInViewport();
  const count = api.count();
  await page.locator('.sidebar-repository-row[data-repository="sample/alpha"] .sidebar-repository').click();
  await expect(page.locator("#statistics-repo-1 h2")).toBeInViewport();
  expect(api.count()).toBe(count);
  await page.reload();
  await expect(page).toHaveURL(/#statistics-repo-1$/);
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
  await expect(page.locator("#statistics-repo-1 h2")).toBeInViewport();
});
