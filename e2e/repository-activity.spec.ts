import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

const now = Date.parse("2026-10-28T12:00:00Z"), minute = 60000;
const iso = (at: number) => new Date(at).toISOString();
const repo = { id: 888, name: "activity", full_name: "sample/activity", private: true, html_url: "https://github.com/sample/activity", owner: { login: "sample" } };
async function fixture(page: Page) {
  let fresh = false;
  const starts = [now - 90 * minute, now - 90 * minute, null, now - 90 * minute];
  const issues = () => Array.from({ length: 7 }, (_, i) => {
    const number = i + 1, closed = number >= 5 || (number === 2 && fresh);
    return { id: number, number, title: `${number === 1 ? "Suspect" : number === 2 ? "Active" : number === 3 ? "Unknown" : "Other"} work with a long title and several visible labels to check truncation`, body: "- Preserve keyboard access\n- Keep mobile layout usable", comments: 0, state: closed ? "closed" : "open",
      labels: [...(number <= 3 ? [{ name: "in-progress", color: "000000" }, { name: "orkester: sample", color: "567890" }] : []), ...(number === 4 ? [{ name: "orkester", color: "567890" }] : []), { name: "A long label to check layout", color: "567890" }], assignees: [],
      created_at: iso(now - 86400000), updated_at: iso(number !== 2 ? now - 90 * minute : now - 5 * minute),
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
  test(`repository activity evidence in Cards/List: ${scenario.name}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: {width:scenario.width,height:scenario.height}, isMobile:scenario.mobile, hasTouch:scenario.mobile, locale:"sv-SE", reducedMotion:"reduce" });
    const page = await context.newPage();
    try {
      const finish = await fixture(page);
      await expect(page.locator(".lane-header .repository-activity-trigger")).toHaveText("Orkesteraktivitet");
      await expect(page.locator('[data-stat="repositories"] .repository-activity-trigger')).toContainText("1 med arbetsaktivitet");
      await expect(page.locator(".issue-card").filter({hasText:"Other work"}).filter({hasText:"#4"})).toHaveCount(0);
      const trigger = page.locator(".lane-header .repository-activity-trigger");
      if (scenario.mobile) expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await trigger.focus(); await page.keyboard.press("Enter");
      const details = page.locator(".repository-activity-details:popover-open");
      await expect(details).toContainText("Senaste observerade ändring");
      await expect(details.getByRole("link",{name:/Öppna samordningsissue/})).toHaveAttribute("href", repo.html_url + "/issues/4");
      await expect(details).toContainText("Agentantal visas inte");
      expect(await details.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await details.screenshot({path:info.outputPath("evidence-popover.png")});
      await page.keyboard.press("Escape");
      for (const split of [true, false]) {
        if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
        for (const mode of ["Kort", "Lista"]) {
          await page.getByRole("group", {name:"Visningsläge för boarden",exact:true}).getByRole("button",{name:mode,exact:true}).click();
          const selector = mode === "Kort" ? ".issue-card" : ".issue-row";
          const active = page.locator(selector).filter({hasText:"Active work"});
          await expect(active).toBeVisible();
          expect(await active.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (mode === "Lista") {
            const rows = await page.locator(".issue-row").evaluateAll(elements => elements.map(el => ({x:el.getBoundingClientRect().x,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
            expect(Math.max(...rows.map(r=>r.w))-Math.min(...rows.map(r=>r.w))).toBeLessThanOrEqual(1);
          }
          for (const theme of ["light", "dark"]) {
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            await page.screenshot({path:info.outputPath(`${mode}-${split?"split":"combined"}-${theme}.png`),fullPage:true});
          }
        }
      }
      finish();
      await page.keyboard.press("Control+r");
      await expect(page.locator(".repository-activity-trigger")).toHaveCount(0);
    } finally { await context.close(); }
  });
}

test("activity expires without refresh and is translated in English", async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("issueflow-language")) localStorage.setItem("issueflow-language", "sv"); });
  await fixture(page);
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".lane-header .repository-activity-trigger")).toHaveText("Orchestra activity");
  await page.locator(".lane-header .repository-activity-trigger").click();
  await expect(page.locator(".repository-activity-details:popover-open")).toContainText("not certain real-time status");
  await page.keyboard.press("Escape");
  await page.locator('[data-stat="repositories"] .repository-activity-trigger').click();
  await expect(page.locator(".repository-activity-details:popover-open")).toContainText("Latest observed change");
  await page.keyboard.press("Escape");
  await page.clock.fastForward(61 * minute);
  await expect(page.locator(".repository-activity-trigger")).toHaveCount(0);
});
