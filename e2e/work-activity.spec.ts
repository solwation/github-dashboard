import { expect, test, type Page } from "@playwright/test";

const now = Date.parse("2026-10-28T12:00:00Z"), minute = 60000;
const iso = (at: number) => new Date(at).toISOString();
const repo = { id: 888, name: "activity", full_name: "sample/activity", private: true, html_url: "https://github.com/sample/activity", owner: { login: "sample" } };
async function fixture(page: Page) {
  let fresh = false;
  const starts = [now - 90 * minute, now - 90 * minute, null, now - 90 * minute];
  const issues = () => Array.from({ length: 7 }, (_, i) => {
    const number = i + 1, closed = number >= 5;
    return { id: number, number, title: `${number === 1 ? "Suspect" : number === 2 ? "Active" : number === 3 ? "Unknown" : "Other"} work with a long title and several visible labels to check truncation`, body: "- Preserve keyboard access\n- Keep mobile layout usable", comments: 0, state: closed ? "closed" : "open",
      labels: [...(number <= 3 ? [{ name: "in-progress", color: "000000" }] : []), { name: "A long label to check layout", color: "567890" }], assignees: [],
      created_at: iso(now - 86400000), updated_at: iso((number === 1 && !fresh) || number >= 3 ? now - 90 * minute : now - 5 * minute),
      workStartedAt: closed ? iso(now - 120 * minute) : undefined,
      closed_at: closed ? iso(now - 100 * minute) : null, html_url: `${repo.html_url}/issues/${number}` };
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const event = /\/issues\/(\d+)\/events$/.exec(url.pathname), number = Number(event?.[1]);
    const start = starts[number - 1];
    await route.fulfill({ json: url.pathname === "/user" ? { login: "activity-test", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : event ? (start ? [{ id: number, event: "labeled", label: { name: "in-progress" }, created_at: iso(start) }] : [])
      : url.pathname.endsWith("/issues") ? issues().filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.clock.install({ time: now - minute });
  await page.clock.pauseAt(now);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-activity-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  return () => { fresh = true; };
}

for (const scenario of [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "narrow", width: 1000, height: 900, mobile: false },
  { name: "portrait", width: 390, height: 844, mobile: true },
  { name: "landscape", width: 844, height: 390, mobile: true },
  { name: "small", width: 320, height: 568, mobile: true },
]) {
  test(`work inactivity stays distinct from estimates in Cards/List: ${scenario.name}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: {width:scenario.width,height:scenario.height}, isMobile:scenario.mobile, hasTouch:scenario.mobile, locale:"sv-SE", reducedMotion:"reduce" });
    const page = await context.newPage();
    try {
      const fresh = await fixture(page);
      for (const split of [true, false]) {
        if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
        for (const mode of ["Kort", "Lista"]) {
          await page.getByRole("group", {name:"Visningsläge för boarden",exact:true}).getByRole("button",{name:mode,exact:true}).click();
          const selector = mode === "Kort" ? ".issue-card" : ".issue-row";
          const suspect = page.locator(selector).filter({hasText:"Suspect work"});
          const active = page.locator(selector).filter({hasText:"Active work"});
          const unknown = page.locator(selector).filter({hasText:"Unknown work"});
          await expect(suspect.locator(".work-inactivity")).toBeVisible();
          await expect(suspect.locator(".work-inactivity")).toHaveAttribute("aria-label", /Möjligen avstannat.*Arbete kan också pågå/);
          await expect(active.locator(".work-inactivity")).toHaveCount(0);
          await expect(unknown.locator(".work-inactivity")).toHaveCount(0);
          await expect(page.locator(`${selector}.closed .work-inactivity, ${selector}.backlog .work-inactivity`)).toHaveCount(0);
          await suspect.scrollIntoViewIfNeeded();
          expect(await suspect.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (mode === "Lista") {
            const height = await suspect.evaluate(el => el.getBoundingClientRect().height);
            const other = await active.evaluate(el => el.getBoundingClientRect().height);
            expect(Math.abs(height - other)).toBeLessThanOrEqual(1);
          }
          await suspect.screenshot({path:info.outputPath(`${mode}-${split?"split":"combined"}.png`)});
          if (mode === "Lista" && split) {
            await suspect.locator(".row-title").click();
            const detail = scenario.mobile ? page.getByRole("dialog") : suspect.locator(".row-card");
            await expect(detail.locator(".work-inactivity")).toContainText("utan synlig aktivitet");
            if (scenario.mobile) await page.keyboard.press("Escape");
            else await suspect.locator(".row-title").click();
          }
        }
      }
      // Real refresh replaces updated_at and removes the warning without resetting work start.
      fresh();
      await page.keyboard.press("Control+r");
      await expect(page.locator(".issue-row").filter({hasText:"Suspect work"}).locator(".work-inactivity")).toHaveCount(0);
      // Crossing the inactivity threshold updates without another fetch.
      await page.clock.fastForward(65 * minute);
      await expect(page.locator(".issue-row").filter({hasText:"Suspect work"}).locator(".work-inactivity")).toBeVisible();
      await page.evaluate(() => document.documentElement.dataset.theme = "dark");
      await page.locator(".issue-row").filter({hasText:"Suspect work"}).screenshot({path:info.outputPath("List-dark.png")});
    } finally { await context.close(); }
  });
}
