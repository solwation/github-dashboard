import { expect, test, type Page, type Locator } from "@playwright/test";
async function openStatistics(page: Page) {
  await page.getByRole('link', { name: /^(Statistics|Statistik)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
}
function card(scope: Page | Locator, name: string) { return scope.locator(".statistics-total").filter({ hasText: name }); }
async function cardValue(scope: Locator, name: string) { return Number((await card(scope, name).locator("strong").innerText()).replace(/\D/g, "")); }
async function dailySum(scope: Locator) {
  const cells = await scope.locator(".daily-values tbody td").allInnerTexts();
  return cells.reduce((sum, text) => sum + Number(text.replace(/[^\d-]/g, "") || 0), 0);
}

test("Statistics stacks sidebar repositories in order with independent filters and accessible mobile graphs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await openStatistics(page);
  const sections = page.locator(".statistics-repository");
  await expect(sections).toHaveCount(3);
  await expect(sections.locator(".statistics-repository-heading a")).toHaveText(["demo/design-system", "demo/personal-website", "demo/weekend-project"]);
  await expect(page.locator(".statistics-view input[type=checkbox], .statistics-view .repository-selection, .statistics-active-filters")).toHaveCount(0);
  const design = sections.filter({ has: page.getByRole("heading", { name: "demo/design-system", exact: true }) });
  const weekend = sections.filter({ has: page.getByRole("heading", { name: "demo/weekend-project", exact: true }) });
  await expect(card(design, "Stängda issues").locator("strong")).toHaveText("4");
  await expect(card(weekend, "Stängda issues").locator("strong")).toHaveText("2");
  const timeControls = page.locator(".statistics-time-controls");
  const rangeGroup = timeControls.getByRole("group", { name: "Tidsintervall" });
  await expect(rangeGroup.locator("button")).toHaveText(["8h", "12h", "24h", "3 dagar", "7 dagar", "3 veckor", "30 dagar"]);
  await expect(rangeGroup.getByRole("button", { name: "3 dagar", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Per-graph time controls and resolution selects are removed in favor of the global controls (#164)
  await expect(design.locator(".statistics-range-presets, .statistics-resolution-select")).toHaveCount(0);
  await expect(weekend.locator(".statistics-range-presets, .statistics-resolution-select")).toHaveCount(0);
  const day = design.getByRole("slider", { name: "Dag i diagrammet" });
  await day.focus(); await page.keyboard.press("End");
  await expect(day).toHaveValue("2");
  await expect(day).toHaveAttribute("aria-valuetext", /demo\/design-system/);
  await design.getByText("Visa dagliga värden", { exact: true }).click();
  await expect(design.locator(".daily-values tbody tr")).toHaveCount(3);
  // #167: cards summarize the same three-day window as the chart, not the full 30 days.
  expect(await dailySum(design)).toBe(await cardValue(design, "Stängda issues"));
  await expect(card(design, "Commits").locator("strong")).toHaveText("6");
  await expect(card(design, "Skapade issues").locator("strong")).toHaveText("2");
  await rangeGroup.getByRole("button", { name: "30 dagar", exact: true }).click();
  await expect(rangeGroup.getByRole("button", { name: "30 dagar", exact: true })).toHaveAttribute("aria-pressed", "true");
  const resolutionSelect = timeControls.getByRole("combobox", { name: "Upplösning", exact: true });
  await expect(resolutionSelect.locator('option[value="1m"]')).toHaveJSProperty("disabled", true);
  await expect(resolutionSelect.locator('option[value="1h"]')).toHaveJSProperty("disabled", false);
  await day.focus(); await page.keyboard.press("End");
  await expect(day).toHaveValue("29");
  await expect(design.locator(".daily-values tbody tr")).toHaveCount(30);
  await expect(card(design, "Commits").locator("strong")).toHaveText("42");
  expect(await dailySum(design)).toBe(await cardValue(design, "Stängda issues"));
  await rangeGroup.getByRole("button", { name: "8h", exact: true }).click();
  await expect(resolutionSelect.locator('option[value="1m"]')).toHaveJSProperty("disabled", false);
  await resolutionSelect.selectOption("30m");
  await expect(design.locator(".daily-values tbody tr")).toHaveCount(16);
  const metricChips = design.getByRole("group", { name: "Mätvärden i diagrammet" });
  await metricChips.getByRole("button", { name: "Skapade issues", exact: true }).click();
  await expect(design.locator(".statistics-chart svg polyline")).toHaveCount(2);
  await expect(design.locator(".chart-legend span")).toHaveText(["Stängda issues", "Skapade issues"]);
  await design.getByRole("combobox", { name: "Nuvarande label", exact: true }).selectOption("bug");
  await expect(card(design, "Commits")).toHaveCount(0);
  await expect(card(weekend, "Commits")).toHaveCount(1);
  await expect(weekend.getByRole("combobox", { name: "Nuvarande label", exact: true })).toHaveValue("");
  await weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true }).selectOption("demo-alex");
  await design.getByRole("button", { name: "Återställ filter" }).click();
  await expect(design.getByRole("combobox", { name: "Nuvarande label", exact: true })).toHaveValue("");
  await expect(design.locator(".statistics-chart svg polyline")).toHaveCount(1);
  await expect(weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true })).toHaveValue("demo-alex");
  const reorder = page.locator(".sidebar-projects").getByRole("button", { name: /^Ordna weekend-project med/ });
  await reorder.focus(); await page.keyboard.press("ArrowUp");
  await expect(sections.locator(".statistics-repository-heading a")).toHaveText(["demo/design-system", "demo/weekend-project", "demo/personal-website"]);
  await expect(weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true })).toHaveValue("demo-alex");
  for (const width of [320, 390, 650]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // #160 & #164: date fields stay inside the global time controls on narrow portrait viewports.
    const controlsBox = await timeControls.boundingBox();
    for (const input of await timeControls.locator("input[type=date]").all()) {
      const box = await input.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(controlsBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(controlsBox!.x + controlsBox!.width);
    }
  }
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistics", exact: true })).toBeVisible();
  await expect(design.getByRole("slider", { name: "Chart day" })).toBeVisible();
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
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo, { ...repo, id: 334, name: "unselected", full_name: "sample/unselected" }] });
    if (url.pathname.endsWith("/commits") || url.pathname.endsWith("/pulls")) return route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } });
    if (url.pathname.endsWith("/issues/events")) {
      if (fail) return route.fulfill({ status: 429, headers: { "retry-after": "60" }, json: { message: "API rate limit exceeded" } });
      return route.fulfill({ headers: { "Access-Control-Expose-Headers": "Link", Link: `<https://api.github.com${url.pathname}?per_page=100&page=${Number(url.searchParams.get("page") || 1) + 1}>; rel="next"` }, json: [{ id: 1, event: "closed", created_at: now, issue, actor: { login: "sample" } }] });
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
  await expect(page.locator(".statistics-repository .statistics-repository-heading a")).toHaveText([repo.full_name]);
  const footnote = page.locator(".statistics-view > footer > .statistics-coverage");
  await expect(footnote).toContainText("Delvis data:");
  expect(await footnote.evaluate(element => element.parentElement?.lastElementChild === element)).toBe(true);
  expect(await footnote.evaluate(element => !!(document.querySelector(".statistics-repositories")!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
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
