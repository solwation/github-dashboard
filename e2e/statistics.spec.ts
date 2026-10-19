import { expect, test, type Page, type Locator } from "@playwright/test";
test.use({ timezoneId: "UTC" });
async function openStatistics(page: Page) {
  await page.getByRole('link', { name: /^(Statistics|Statistik)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
}
function metricButton(scope: Locator, name: string) { return scope.getByRole("group", { name: "Mätvärden i diagrammet" }).getByRole("button", { name }); }
function card(scope: Page | Locator, name: string) { return scope.locator(".statistics-total").filter({ hasText: name }); }
async function cardValue(scope: Locator, name: string) { return Number((await card(scope, name).locator("strong").innerText()).replace(/\D/g, "")); }
async function dailySum(scope: Locator) {
  const points = await scope.locator(".statistics-chart > svg > g").filter({ has: scope.page().locator("polyline") }).first().locator("circle title").allTextContents();
  return points.reduce((sum, text) => sum + Number(text.split(": ").at(-1)!.replace(/[^\d-]/g, "") || 0), 0);
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
  const rangeSelect = timeControls.getByRole("combobox", { name: "Tidsintervall", exact: true });
  const resolutionSelect = timeControls.getByRole("combobox", { name: "Upplösning", exact: true });
  await expect(rangeSelect.locator("option")).toHaveText(["8h", "12h", "24h", "3 dagar", "7 dagar", "3 veckor", "30 dagar", "Anpassat"]);
  await expect(rangeSelect).toHaveValue("3d");
  await expect(rangeSelect).not.toHaveValue("custom");
  // #169: pickers show the preset's exact UTC window and the subtitle/label describe it.
  const fromPicker = timeControls.getByLabel("Från (lokal tid)", { exact: true });
  const toPicker = timeControls.getByLabel("Till (lokal tid)", { exact: true });
  const periodLabel = timeControls.locator(".statistics-period-label");
  await expect(fromPicker).toHaveAttribute("type", "datetime-local");
  await expect(fromPicker).toBeHidden();
  await expect(toPicker).toBeHidden();
  const pickerMs = async (picker: Locator) => Date.parse(`${await picker.inputValue()}:00Z`);
  expect(await pickerMs(toPicker) - await pickerMs(fromPicker)).toBe(3 * 86_400_000);
  await expect(page.locator(".statistics-heading p")).toHaveCount(0);
  await expect(periodLabel).toHaveText(/^Visar .+ – .+$/);
  await expect(periodLabel).not.toContainText(/GMT|UTC|upplösning/);
  await expect(timeControls.locator('.statistics-range-presets button')).toHaveCount(0);
  const [summaryBox, rangeBox, resolutionBox, controlsBox] = await Promise.all([periodLabel, rangeSelect, resolutionSelect, timeControls].map(element => element.boundingBox()));
  expect(summaryBox!.x + summaryBox!.width).toBeLessThan(rangeBox!.x);
  expect(rangeBox!.x + rangeBox!.width).toBeLessThan(resolutionBox!.x);
  expect(Math.abs(summaryBox!.y + summaryBox!.height / 2 - (rangeBox!.y + rangeBox!.height / 2))).toBeLessThan(3);
  expect(controlsBox!.height).toBeLessThanOrEqual(70);
  await page.screenshot({ path: test.info().outputPath("statistics-time-row-desktop.png") });
  await expect(timeControls.getByRole("button", { name: "Återställ period", exact: true })).toHaveCount(0);
  // Per-graph time controls and resolution selects are removed in favor of the global controls (#164)
  await expect(design.locator(".statistics-range-select, .statistics-resolution-select")).toHaveCount(0);
  await expect(weekend.locator(".statistics-range-select, .statistics-resolution-select")).toHaveCount(0);
  // #171 / #173: heading follows resolution, legend names the metric and point values are available in a popover.
  await expect(design.locator(".statistics-panel-heading h3")).toHaveText("Aktivitet per dag");
  await expect(design.locator(".chart-legend span")).toHaveText(["Stängda issues"]);
  await expect(design.locator(".chart-legend .chart-swatch line")).toHaveCount(1);
  // #170: totals are grouped, the cards themselves select chart metrics and the old select/chips are gone.
  await expect(design.locator(".statistics-total-group h3")).toHaveText(["Issues", "Pull requests", "Kod"]);
  await expect(design.getByRole("combobox", { name: "Mätvärde", exact: true })).toHaveCount(0);
  await expect(design.locator(".statistics-metric-chips, .statistics-metric-chip")).toHaveCount(0);
  await expect(metricButton(design, "Stängda issues")).toHaveAttribute("aria-pressed", "true");
  await expect(metricButton(design, "Stängda issues")).toHaveAttribute("data-series-index", "0");
  await expect(metricButton(design, "Commits")).toHaveAttribute("aria-pressed", "false");
  await expect(design.getByRole("button", { name: /Medianålder/ })).toHaveCount(0);
  await expect(design.locator(".statistics-total-static")).toContainText("Medianålder vid stängning");
  // #172: breakdowns are collapsible <details> and open by default on desktop-sized viewports.
  const breakdowns = design.locator(".statistics-breakdowns > details");
  await expect(breakdowns.locator("summary")).toHaveText(["Bidragsgivare", "Labels på skapade issues"]);
  for (const element of await breakdowns.all()) await expect(element).toHaveJSProperty("open", true);
  await expect(design.getByRole("table")).toBeVisible();
  const yLabels = await design.locator(".statistics-chart > svg > g > text").count();
  expect(yLabels).toBeGreaterThanOrEqual(2);
  const day = design.getByRole("slider", { name: "Tidpunkt i diagrammet" });
  await day.focus(); await page.keyboard.press("End");
  await expect(day).toHaveValue("2");
  await expect(day).toHaveAttribute("aria-valuetext", /Stängda issues: \d/);
  await expect(design.getByRole("tooltip")).toContainText("Stängda issues");
  await expect(design.getByText("Visa värden", { exact: true })).toHaveCount(0);
  await expect(day).toHaveAttribute("max", "2");
  // #167: cards summarize the same three-day window as the chart, not the full 30 days.
  expect(await dailySum(design)).toBe(await cardValue(design, "Stängda issues"));
  await expect(card(design, "Commits").locator("strong")).toHaveText("6");
  await expect(card(design, "Skapade issues").locator("strong")).toHaveText("2");
  await rangeSelect.selectOption("30d");
  await expect(rangeSelect).toHaveValue("30d");
  await expect(resolutionSelect.locator('option[value="1m"]')).toHaveJSProperty("disabled", true);
  await expect(resolutionSelect.locator('option[value="1h"]')).toHaveJSProperty("disabled", false);
  await day.focus(); await page.keyboard.press("End");
  await expect(day).toHaveValue("29");
  await expect(day).toHaveAttribute("max", "29");
  await expect(card(design, "Commits").locator("strong")).toHaveText("42");
  expect(await dailySum(design)).toBe(await cardValue(design, "Stängda issues"));
  const xLabels = design.locator(".statistics-chart .chart-x-label");
  expect(await xLabels.count()).toBeGreaterThanOrEqual(3);
  expect(await xLabels.count()).toBeLessThanOrEqual(6);
  await rangeSelect.selectOption("24h");
  await expect(design.locator(".statistics-panel-heading h3")).toHaveText("Aktivitet per timme");
  // #169: the 24h preset fills both pickers; the chart's first point is Från and its last bucket ends at Till.
  expect(await pickerMs(toPicker) - await pickerMs(fromPicker)).toBe(86_400_000);
  const points = design.locator(".statistics-chart > svg > g").filter({ has: page.locator("polyline") }).first().locator("circle");
  await expect(points).toHaveCount(24);
  await day.focus(); await day.press("Home");
  const expectedTime = (ms: number) => page.evaluate(ms => new Date(ms).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) + " " + new Date(ms).toLocaleTimeString("sv-SE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), ms);
  await expect(design.locator(".chart-selection-time")).toHaveText(await expectedTime(await pickerMs(fromPicker)));
  await day.press("End");
  await expect(design.locator(".chart-selection-time")).toHaveText(await expectedTime(await pickerMs(toPicker) - 3_600_000));
  await expect(resolutionSelect).toHaveValue("1h");
  await rangeSelect.selectOption("7d");
  expect(await pickerMs(toPicker) - await pickerMs(fromPicker)).toBe(7 * 86_400_000);
  // A manual edit selects "Anpassat", deselects the preset and updates the label.
  const customFrom = new Date(await pickerMs(toPicker) - 2 * 86_400_000 + 6 * 3_600_000).toISOString().slice(0, 16);
  await rangeSelect.selectOption("custom");
  await expect(fromPicker).toBeVisible();
  await expect(fromPicker).toBeFocused();
  await fromPicker.fill(customFrom);
  await expect(rangeSelect).toHaveValue("custom");
  await expect(rangeSelect).not.toHaveValue("7d");
  await expect(periodLabel).toContainText(new RegExp(` ${String(new Date(`${customFrom}:00Z`).getUTCHours()).padStart(2, "0")}:00 – `));
  expect(await pickerMs(toPicker) - await pickerMs(fromPicker)).toBe(42 * 3_600_000);
  await fromPicker.fill(await toPicker.inputValue());
  await expect(page.getByText("Välj ett giltigt datumintervall inom de senaste 30 dagarna.", { exact: true })).toBeVisible();
  await expect(periodLabel).toHaveCount(0);
  await timeControls.getByRole("button", { name: "Återställ period", exact: true }).click();
  await expect(rangeSelect).toHaveValue("3d");
  expect(await pickerMs(toPicker) - await pickerMs(fromPicker)).toBe(3 * 86_400_000);
  await rangeSelect.selectOption("24h");
  await expect(xLabels.first()).toContainText(/\d{2}:\d{2}/);
  await day.focus();
  await expect(design.locator(".chart-selection-time")).toContainText(/\d{2}:\d{2}$/);
  await design.locator(".statistics-chart circle").first().click();
  await expect(day).toHaveValue("0");
  await rangeSelect.selectOption("8h");
  await expect(resolutionSelect.locator('option[value="1m"]')).toHaveJSProperty("disabled", false);
  await resolutionSelect.selectOption("30m");
  await expect(day).toHaveAttribute("max", "15");
  await metricButton(design, "Skapade issues").click();
  await expect(design.locator(".statistics-chart svg polyline")).toHaveCount(2);
  await expect(design.locator(".chart-legend span")).toHaveText(["Stängda issues", "Skapade issues"]);
  await expect(metricButton(design, "Skapade issues")).toHaveAttribute("aria-pressed", "true");
  await metricButton(design, "Commits").focus();
  await page.keyboard.press("Space");
  await expect(design.locator(".chart-legend span")).toHaveText(["Stängda issues", "Skapade issues", "Commits"]);
  // Each selected card carries its series position and the same colour as its legend entry.
  const legendColors = await design.locator(".chart-legend .chart-swatch line").evaluateAll(lines => lines.map(line => getComputedStyle(line).stroke));
  for (const [index, name] of ["Stängda issues", "Skapade issues", "Commits"].entries()) {
    const button = metricButton(design, name);
    await expect(button).toHaveAttribute("data-series-index", String(index));
    expect(await button.evaluate(element => getComputedStyle(element).borderLeftColor)).toBe(legendColors[index]);
  }
  await metricButton(design, "Stängda issues").press("Enter");
  await expect(design.locator(".chart-legend span")).toHaveText(["Skapade issues", "Commits"]);
  await expect(metricButton(design, "Stängda issues")).toHaveAttribute("aria-pressed", "false");
  await expect(metricButton(design, "Skapade issues")).toHaveAttribute("data-series-index", "0");
  await metricButton(design, "Commits").click();
  await metricButton(design, "Skapade issues").click(); // the last selected metric cannot be deselected
  await expect(design.locator(".chart-legend span")).toHaveText(["Skapade issues"]);
  await expect(metricButton(design, "Skapade issues")).toHaveAttribute("aria-pressed", "true");
  await metricButton(design, "Stängda issues").click();
  await expect(design.locator(".chart-legend span")).toHaveText(["Skapade issues", "Stängda issues"]);
  // #172: compact filters live in the repository heading; active filters appear as removable chips.
  await expect(page.locator(".statistics-filters")).toHaveCount(0);
  const designHeading = design.locator(".statistics-repository-heading");
  const designLabel = designHeading.getByRole("combobox", { name: "Nuvarande label", exact: true });
  const designContributor = designHeading.getByRole("combobox", { name: "Bidragsgivare", exact: true });
  await expect(design.locator(".statistics-filter-chip")).toHaveCount(0);
  await expect(design.getByRole("button", { name: "Rensa filter", exact: true })).toHaveCount(0);
  await designLabel.selectOption("bug");
  await expect(card(design, "Commits")).toHaveCount(0);
  await expect(card(weekend, "Commits")).toHaveCount(1);
  await expect(design.locator(".statistics-filter-chip")).toHaveText(["Label: bug"]);
  await design.getByRole("button", { name: "Ta bort filter Label: bug", exact: true }).click();
  await expect(designLabel).toHaveValue("");
  await expect(card(design, "Commits")).toHaveCount(1);
  await expect(design.locator(".statistics-filter-chip")).toHaveCount(0);
  await designLabel.selectOption("bug");
  await designContributor.selectOption("demo-alex");
  await expect(design.locator(".statistics-filter-chip")).toHaveText(["Label: bug", "Bidragsgivare: demo-alex"]);
  await expect(weekend.getByRole("combobox", { name: "Nuvarande label", exact: true })).toHaveValue("");
  await weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true }).selectOption("demo-alex");
  await design.getByRole("button", { name: "Rensa filter", exact: true }).click();
  await expect(designLabel).toHaveValue("");
  await expect(designContributor).toHaveValue("");
  await expect(design.locator(".statistics-filter-chip")).toHaveCount(0);
  // Clearing filters keeps the chosen chart metrics; they are not filters.
  await expect(design.locator(".chart-legend span")).toHaveText(["Skapade issues", "Stängda issues"]);
  await expect(weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true })).toHaveValue("demo-alex");
  await expect(weekend.locator(".statistics-filter-chip")).toHaveText(["Bidragsgivare: demo-alex"]);
  const reorder = page.locator(".sidebar-projects").getByRole("button", { name: /^Ordna weekend-project med/ });
  await reorder.focus(); await page.keyboard.press("ArrowUp");
  await expect(sections.locator(".statistics-repository-heading a")).toHaveText(["demo/design-system", "demo/weekend-project", "demo/personal-website"]);
  await expect(weekend.getByRole("combobox", { name: "Bidragsgivare", exact: true })).toHaveValue("demo-alex");
  for (const width of [320, 390, 650]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // #160, #164 & #169: datetime fields stay inside the global time controls on narrow portrait viewports.
    const controlsBox = await timeControls.boundingBox();
    await rangeSelect.selectOption("custom");
    const pickers = await timeControls.locator("input[type=datetime-local]").all();
    expect(pickers).toHaveLength(2);
    for (const input of pickers) {
      const box = await input.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(controlsBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(controlsBox!.x + controlsBox!.width);
    }
  }
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistics", exact: true })).toBeVisible();
  await expect(design.getByRole("slider", { name: "Chart time" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Statistics collapses per-repository breakdowns on phones and keeps heading filters reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await openStatistics(page);
  const design = page.locator(".statistics-repository").filter({ has: page.getByRole("heading", { name: "demo/design-system", exact: true }) });
  const breakdowns = design.locator(".statistics-breakdowns > details");
  await expect(breakdowns).toHaveCount(2);
  for (const element of await breakdowns.all()) await expect(element).toHaveJSProperty("open", false);
  await expect(design.getByRole("table")).toBeHidden();
  await breakdowns.locator("summary").filter({ hasText: "Bidragsgivare" }).click();
  await expect(breakdowns.first()).toHaveJSProperty("open", true);
  await expect(design.getByRole("table")).toBeVisible();
  const label = design.locator(".statistics-repository-heading").getByRole("combobox", { name: "Nuvarande label", exact: true });
  await expect(label).toBeVisible();
  await label.selectOption("bug");
  await expect(design.locator(".statistics-filter-chip")).toHaveText(["Label: bug"]);
  await design.getByRole("button", { name: "Ta bort filter Label: bug", exact: true }).click();
  // The user's own toggle survives the contributor table being hidden and shown again.
  await expect(breakdowns.first()).toHaveJSProperty("open", true);
  await expect(breakdowns.nth(1)).toHaveJSProperty("open", false);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
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
