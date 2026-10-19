import { expect, test, type Locator, type Page } from "@playwright/test";

async function openChart(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await page.getByRole("link", { name: /^(Statistics|Statistik)$/ }).click();
  const repository = page.locator(".statistics-repository").first();
  for (const name of ["Skapade issues", "Commits"]) {
    await repository.getByRole("group", { name: "Mätvärden i diagrammet" }).getByRole("button", { name }).click();
  }
  return repository.locator(".statistics-chart");
}

async function expectBounded(chart: Locator) {
  const frame = await chart.boundingBox();
  const popover = await chart.getByRole("tooltip").boundingBox();
  expect(popover!.x).toBeGreaterThanOrEqual(frame!.x);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
}

test("chart hover reads every series at the nearest point, includes zero, and stays inside both edges", async ({ page }) => {
  const chart = await openChart(page);
  const svg = chart.locator(":scope > svg");
  const slider = chart.getByRole("slider");
  const popover = chart.getByRole("tooltip");
  await expect(chart.locator("details, table, .chart-selection, [aria-live]")).toHaveCount(0);
  await expect(popover).toHaveCount(0);
  const series = chart.locator(":scope > svg > g").filter({ has: page.locator("polyline") });
  await expect(series).toHaveCount(3);
  await svg.scrollIntoViewIfNeeded();
  const points = series.first().locator("circle");
  const count = await points.count();
  for (const index of [0, Math.floor(count / 2), count - 1]) {
    const point = await points.nth(index).boundingBox();
    await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
    await expect(slider).toHaveValue(String(index));
    await expect(popover).toBeVisible();
    const expected = [];
    for (const line of await series.all()) {
      expected.push((await line.locator("circle title").nth(index).textContent())!.split(": ").at(-1)!);
    }
    await expect(popover.locator(".chart-selection-value > span")).toHaveText(["Stängda issues", "Skapade issues", "Commits"]);
    await expect(popover.locator("b")).toHaveText(expected);
    await expectBounded(chart);
  }
  // Crossing the midpoint snaps the cursor to the nearest day rather than requiring an exact point hit.
  const first = await points.nth(0).boundingBox();
  const second = await points.nth(1).boundingBox();
  const start = first!.x + first!.width / 2;
  const distance = second!.x + second!.width / 2 - start;
  await page.mouse.move(start + distance * 0.49, first!.y + first!.height / 2);
  await expect(slider).toHaveValue("0");
  await page.mouse.move(start + distance * 0.51, first!.y + first!.height / 2);
  await expect(slider).toHaveValue("1");
  // The demo's first selected series has measured zeroes: they remain explicit in the popover.
  const zero = await series.first().locator("circle title").allTextContents();
  const zeroIndex = zero.findIndex(title => title.endsWith(": 0"));
  expect(zeroIndex).toBeGreaterThanOrEqual(0);
  const point = await points.nth(zeroIndex).boundingBox();
  await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
  await expect(popover.locator("b").first()).toHaveText("0");
  await page.mouse.move(0, 0);
  await expect(popover).toHaveCount(0);
  await slider.focus();
  await slider.press("End");
  await expect(popover).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", /Stängda issues: \d.*Skapade issues: \d.*Commits: \d/);
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("Escape");
  await expect(popover).toHaveCount(0);
  await slider.press("ArrowRight");
  await expect(popover).toBeVisible();
});

test("a narrow touch screen can tap and read all series without hover", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true, locale: "sv-SE" });
  const page = await context.newPage();
  const chart = await openChart(page);
  const svg = chart.locator(":scope > svg");
  await svg.scrollIntoViewIfNeeded();
  const frame = await svg.boundingBox();
  await page.touchscreen.tap(frame!.x + frame!.width - 43, frame!.y + 130);
  await expect(chart.getByRole("tooltip")).toBeVisible();
  await expect(chart.getByRole("tooltip").locator(".chart-selection-value")).toHaveCount(3);
  await expectBounded(chart);
  // A second touch selects another point, preserving vertical scrolling behavior.
  await page.touchscreen.tap(frame!.x + 48, frame!.y + 130);
  await expect(chart.getByRole("slider")).toHaveValue("0");
  await expect(chart.getByRole("tooltip")).toBeVisible();
  await expectBounded(chart);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
