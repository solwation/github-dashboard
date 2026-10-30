import { expect, test, type Page } from "@playwright/test";

// #369: mobile text autosizing must not enlarge some issue titles. A mobile Chromium context
// runs Blink's text autosizer, which honours text-size-adjust like iOS WebKit does.
const sizes = [
  { width: 1600, height: 1000, mobile: false },
  { width: 1000, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 320, height: 568, mobile: true },
];
const repo = { id: 369, name: "title-sizes", full_name: "sample/title-sizes", private: false, html_url: "https://github.com/sample/title-sizes", description: "Fictional title size fixture", owner: { login: "sample" } };
const long = "Alternative leaderboards and a deliberately long fictional title that keeps going so that a text autosizer would treat this block as running prose worth enlarging";
const evidence = process.env.E2E_EVIDENCE_DIR;

async function fixture(page: Page) {
  const now = Date.now(), day = 86400000;
  const issues = Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    return { id: number, number, title: number % 2 ? `${long} ${number}` : `Short ${number}`, body: "", comments: 0, state: "open", labels: [], assignees: [],
      created_at: new Date(now - number * day).toISOString(), updated_at: new Date(now - day).toISOString(), closed_at: null, html_url: `${repo.html_url}/issues/${number}` };
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname === "/user" ? { login: "title-sizes-test", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : url.pathname.endsWith("/issues") ? issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-title-sizes-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(6);
}

const fontSizes = (page: Page, selector: string) => page.locator(selector).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize));

for (const size of sizes) test(`issue titles keep one font size at ${size.width}x${size.height}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, locale: "sv-SE", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await fixture(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("text-size-adjust"))).toBe("100%");
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /user-scalable|maximum-scale/);
    const cards = await fontSizes(page, ".issue-title");
    expect(cards).toHaveLength(6);
    expect(new Set(cards).size, `card title sizes ${cards.join(", ")}`).toBe(1);
    if (evidence) await page.screenshot({ path: `${evidence}/cards-${size.width}x${size.height}.png`, fullPage: true });
    await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
    await expect(page.locator(".issue-row")).toHaveCount(6);
    const rows = await fontSizes(page, ".row-title-text");
    expect(new Set(rows).size, `row title sizes ${rows.join(", ")}`).toBe(1);
    if (evidence) await page.screenshot({ path: `${evidence}/list-${size.width}x${size.height}.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
