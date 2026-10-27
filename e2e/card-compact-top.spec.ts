import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { textAccessibility } from "./support/text-accessibility";

const sizes = [
  { width: 1600, height: 1000, mobile: false },
  { width: 1366, height: 768, mobile: false },
  { width: 1000, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 320, height: 568, mobile: true },
];
const repo = { id: 333, name: "compact-cards", full_name: "sample/compact-cards", private: false, html_url: "https://github.com/sample/compact-cards", description: "Fictional compact card fixture", owner: { login: "sample" } };
const labels = ["A deliberately long label that must truncate instead of growing the card", "accessibility", "responsive", "documentation", "ready for review", "additional context", "follow-up discussion", "cross-browser verification", "keyboard support", "touch target audit"];

async function fixture(page: Page) {
  const now = Date.now(), minute = 60000, day = 86400000;
  const iso = (at: number) => new Date(at).toISOString();
  let refreshed = false;
  const issues = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1, closed = number >= 6;
    return { id: number, number, title: number <= 2 ? `Plain task ${number}` : number === 3 ? "A long issue title that remains the first readable content before labels and still wraps safely on a narrow phone" : number === 4 ? "Running task" : number === 5 ? "Overdue task" : `Completed task ${number}`,
      body: "## Task details\n\nFictional issue description for keyboard and responsive checks.", comments: number === 3 ? (refreshed ? 3 : 2) : 0,
      state: closed ? "closed" : "open", labels: number === 3 ? labels.map(name => ({ name, color: "aabbcc" })) : number === 4 || number === 5 ? [{ name: "in-progress", color: "147d69" }] : [], assignees: [],
      created_at: iso(now - 10 * day), updated_at: iso(refreshed ? now : now - day), closed_at: closed ? iso(now - day) : null,
      workStartedAt: closed ? iso(now - day - 30 * minute) : undefined, html_url: `${repo.html_url}/issues/${number}` };
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    const number = Number(event?.[1]);
    const current = issues.map(issue => ({ ...issue, comments: issue.number === 3 ? (refreshed ? 3 : 2) : 0,
      labels: refreshed && issue.number === 2 ? [{ name: "in-progress", color: "147d69" }] : issue.labels,
      updated_at: refreshed ? iso(now) : issue.updated_at }));
    await route.fulfill({ json: url.pathname === "/user" ? { login: "compact-cards-test", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : event ? [{ id: number, event: "labeled", label: { name: "in-progress" }, created_at: iso(now - (number === 5 ? 40 : 10) * minute) }]
      : url.pathname.endsWith("/issues") ? current.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-compact-cards-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(8);
  // Preserve unread movement/comment states through every layout in this context.
  refreshed = true;
  await page.keyboard.press("Control+r");
  await expect(page.locator(".issue-card.unread-move")).toHaveCount(1);
  await expect(page.locator(".new-comments-badge")).toHaveCount(1);
}

for (const size of sizes) for (const theme of ["light", "dark"]) {
  test(`compact cards and list ${size.width}x${size.height} ${theme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: size, isMobile: size.mobile, hasTouch: size.mobile, locale: "sv-SE" });
    const page = await context.newPage();
    await fixture(page);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.evaluate(() => document.fonts.ready);
    // Theme surfaces transition for 250ms; measure the settled theme, not the blend.
    await expect(page.locator(".stat").first()).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 33, 36)" : "rgb(255, 255, 255)");
    const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
    for (const split of [true, false]) {
      if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
      for (const view of ["Kort", "Lista"]) {
        await mode.getByRole("button", { name: view, exact: true }).click();
        const item = page.locator(view === "Kort" ? ".issue-card" : ".issue-row").first();
        await item.scrollIntoViewIfNeeded();
        await expect(item).toBeVisible();
        const text = await textAccessibility(page);
        await writeFile(info.outputPath(`${split ? "split" : "combined"}-${view}-text.json`), JSON.stringify(text, null, 2));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        if (view === "Kort") {
          const plain = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Plain task 1", exact: true }) });
          if (size.width >= 1366) expect((await plain.boundingBox())!.height).toBeLessThanOrEqual(100);
          const labeled = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: /^A long issue title/ }) });
          const title = await labeled.locator(".issue-title").boundingBox();
          const line = await labeled.locator(".card-label-line").boundingBox();
          expect(line!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
          await expect(labeled.locator(".label-more")).toBeVisible();
          expect(await labeled.locator(".label-more").getAttribute("title")).toContain("touch target audit");
          const geometry = await page.locator(".issue-card").evaluateAll(cards => cards.map(card => {
            const box = card.getBoundingClientRect();
            const title = card.querySelector(".issue-title")!.getBoundingClientRect();
            const footer = card.querySelector(".details-toolbar")!.getBoundingClientRect();
            const controls = [...card.querySelectorAll<HTMLElement>(".details-toolbar > *, .card-labels > *")].map(element => element.getBoundingClientRect()).filter(box => box.width && box.height);
            return { height: box.height, inset: title.left - box.left, overflow: card.scrollWidth - card.clientWidth,
              outside: controls.some(control => control.left < box.left - 1 || control.right > box.right + 1), footerInside: footer.right <= box.right + 1 };
          }));
          expect(geometry.every(item => item.overflow <= 1 && !item.outside && item.footerInside)).toBe(true);
          expect(Math.max(...geometry.map(item => item.inset)) - Math.min(...geometry.map(item => item.inset))).toBeLessThanOrEqual(1);
          await info.attach(`${split ? "split" : "combined"}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
          await expect(page.locator(".issue-card.issue-timeout .timeout-warning")).toContainText("över estimatet");
          await expect(page.locator(".issue-card .issue-time-remaining-label").first()).toBeVisible();
          await expect(page.locator(".issue-card .implementation-time").first()).toBeVisible();
          if (size.mobile) {
            for (const selector of [".details-toggle", ".comment-count", ".label-more", ".movement-marker"]) {
              const bounds = (await page.locator(`.issue-card ${selector}`).first().boundingBox())!;
              expect(Math.round(bounds.width)).toBeGreaterThanOrEqual(44); expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(44);
            }
          }
          await labeled.screenshot({ path: info.outputPath(`${split ? "split" : "combined"}-labels.png`) });
          await page.locator(".issue-card.issue-timeout").screenshot({ path: info.outputPath(`${split ? "split" : "combined"}-timeout.png`) });
        }
        await item.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${split ? "split" : "combined"}-${view === "Kort" ? "cards" : "list"}.png`) });
      }
    }
    await mode.getByRole("button", { name: "Kort", exact: true }).click();
    const labeled = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: /^A long issue title/ }) });
    const more = labeled.locator(".label-more");
    await more.focus(); await page.keyboard.press("Enter");
    await expect(labeled.getByRole("tooltip")).toContainText("touch target audit");
    await page.keyboard.press("Escape");
    await expect(labeled.getByRole("tooltip")).toHaveCount(0);
    const toggle = labeled.getByRole("button", { name: "Läs mer", exact: true });
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(labeled.getByRole("heading", { name: "Task details", exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await labeled.locator(".comment-count").focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Kommentarer för #3", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(labeled.locator(".comment-count")).toBeFocused();
    await context.close();
  });
}
