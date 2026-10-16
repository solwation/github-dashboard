import { expect, test, type Page } from "@playwright/test";
async function openStatistics(page: Page) {
  await page.getByRole('link', { name: /^(Statistics|Statistik)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
}
function card(page: Page, name: string) { return page.locator(".statistics-total").filter({ has: page.locator("span", { hasText: name }) }); }

test("Statistics compares repositories with keyboard-accessible graphs and filters on mobile", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await openStatistics(page);
  await expect(card(page, "Stängda issues").locator("strong")).toHaveText("4");
  await page.getByRole("checkbox", { name: "demo/weekend-project", exact: true }).check();
  await expect(card(page, "Stängda issues").locator("strong")).toHaveText("6");
  await expect(page.getByRole("img", { name: "Stängda issues", exact: true })).toBeVisible();
  await page.locator(".statistics-chart").screenshot({ path: "/tmp/issueflow-statistics-chart.png" });
  const day = page.getByRole("slider", { name: "Dag i diagrammet" });
  await day.focus(); await page.keyboard.press("End");
  await expect(day).toHaveValue("29");
  await expect(day).toHaveAttribute("aria-valuetext", /demo\/weekend-project/);
  await page.getByText("Visa dagliga värden", { exact: true }).click();
  await expect(page.locator(".daily-values tbody tr")).toHaveCount(30);
  await page.getByRole("combobox", { name: "Nuvarande label", exact: true }).selectOption("bug");
  await expect(card(page, "Commits")).toHaveCount(0);
  await expect(card(page, "Tillagda rader")).toHaveCount(0);
  await expect(card(page, "Stängda issues")).toHaveCount(1);
  await page.getByRole("button", { name: "Återställ filter" }).click();
  await expect(page.getByRole("combobox", { name: "Nuvarande label", exact: true })).toHaveValue("");
  await expect(card(page, "Commits")).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "demo/weekend-project", exact: true })).not.toBeChecked();
  for (const width of [320, 390, 650]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistics", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Chart day" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Statistics hides inaccessible metrics silently and retains issue values after rate limiting", async ({ page }) => {
  const now = new Date().toISOString();
  const repo = { id: 333, name: "statistics-example", full_name: "sample/statistics-example", description: null, private: true, html_url: "https://github.com/sample/statistics-example", owner: { login: "sample" } };
  const issue = { id: 1, number: 1, title: "Fictional statistics fixture", created_at: now, updated_at: now, closed_at: now, state: "closed", labels: [{ name: "bug", color: "f00" }], user: { login: "sample" }, assignees: [] };
  let fail = false;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "https://github.com/identicons/sample.png" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/commits") || url.pathname.endsWith("/pulls")) return route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } });
    if (url.pathname.endsWith("/issues/events")) {
      if (fail) return route.fulfill({ status: 429, headers: { "retry-after": "60" }, json: { message: "API rate limit exceeded" } });
      return route.fulfill({ json: [{ id: 1, event: "closed", created_at: now, issue, actor: { login: "sample" } }] });
    }
    if (url.pathname.endsWith("/labels")) return route.fulfill({ json: issue.labels });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "open" ? [] : [issue] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-statistics-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByLabel(repo.full_name).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await openStatistics(page);
  await expect(card(page, "Stängda issues").locator("strong")).toHaveText("1");
  await expect(card(page, "Återöppnade issues").locator("strong")).toHaveText("0");
  await expect(card(page, "Commits")).toHaveCount(0);
  await expect(card(page, "Tillagda rader")).toHaveCount(0);
  await expect(card(page, "Öppnade pull requests")).toHaveCount(0);
  await expect(page.locator(".statistics-view")).not.toContainText(/behörighet|permission|åtkomst nekad/i);
  fail = true;
  await page.getByRole("button", { name: "Uppdatera statistik", exact: true }).click();
  await expect(page.getByText("Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.", { exact: true })).toBeVisible();
  await expect(card(page, "Stängda issues").locator("strong")).toHaveText("1");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fictional-statistics-token");
});
