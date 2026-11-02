import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";

// #381: an issue that drops out of a full load while in progress stays in Closed as a pending
// card until one single-issue request confirms its actual state. Synthetic fixture data only.
const evidence = process.env.PENDING_CLOSURE_EVIDENCE;
const progress = { name: "in progress", color: "fbca04" };
const NOW = Date.now();
const iso = (offset: number) => new Date(NOW + offset).toISOString();
type Fixture = { gone: boolean; release: (issue: Record<string, unknown> | null) => void; singleRequests: number };

function base(number: number, extra: Record<string, unknown>) {
  return {
    id: 100 + number, number, created_at: iso(-9 * 86400000), updated_at: iso(-3600000), closed_at: null, state: "open",
    html_url: "https://github.com/sample/alpha/issues/" + number, labels: [], assignees: [], comments: 0, ...extra,
  };
}
const working = base(1, {
  title: "Exportera rapporter till CSV med en mycket lång titel som måste kortas av snyggt i både kort och lista",
  labels: [progress, { name: "enhancement", color: "a2eeef" }, { name: "priority: high", color: "d73a4a" }],
});
const issues = [
  working,
  base(2, { title: "Fortsätt i backloggen", labels: [{ name: "documentation", color: "0075ca" }] }),
  base(3, { title: "Redan stängt ärende", labels: [{ name: "enhancement", color: "a2eeef" }], state: "closed", closed_at: iso(-2 * 3600000), updated_at: iso(-2 * 3600000) }),
];

async function setup(page: Page): Promise<Fixture> {
  const fixture: Fixture = { gone: false, release: () => {}, singleRequests: 0 };
  let answer: Promise<Record<string, unknown> | null> = new Promise(() => {});
  const repo = { id: 1, name: "alpha", full_name: "sample/alpha", private: false, html_url: "https://github.com/sample/alpha", owner: { login: "sample" }, description: "Fixture" };
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "pending-test", avatar_url: "https://github.com/identicons/pending-test.png" };
    else if (url.pathname === "/user/repos") data = [repo];
    else if (url.pathname === "/repos/sample/alpha/issues") {
      const state = url.searchParams.get("state");
      data = issues.filter((issue) => !(fixture.gone && issue.number === 1)).filter((issue) => state === "all" || issue.state === state);
    } else if (url.pathname === "/repos/sample/alpha/issues/1") {
      fixture.singleRequests++;
      const body = await answer;
      return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { message: "Not Found" } });
    } else if (/\/issues\/\d+\/events$/.test(url.pathname))
      data = [{ id: 1, event: "labeled", created_at: iso(-45 * 60000), label: { name: progress.name } }];
    await route.fulfill({ json: data });
  });
  answer = new Promise((resolve) => { fixture.release = resolve; });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page.getByLabel("GitHub personal access token").fill("test-only");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("checkbox", { name: "sample/alpha" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".board-column.progress .issue-card")).toHaveCount(1);
  return fixture;
}

async function leaveProgress(page: Page, fixture: Fixture) {
  await expect(page.locator(".board-toolbar").first()).toHaveAttribute("data-busy", "false");
  fixture.gone = true;
  // A full load (manual refresh) reads open and closed lists, where a fresh closing can lag behind.
  await page.keyboard.press("Control+r");
  const pending = page.locator(".board-column.closed .pending-closure");
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText("Verifierar stängning");
  await expect(page.locator(".board-column.progress .issue-card")).toHaveCount(0);
  await expect.poll(() => fixture.singleRequests).toBe(1);
  return pending;
}

test("a card that leaves In progress stays pending in Closed and becomes a normal closed card on confirmation", async ({ page }) => {
  const fixture = await setup(page);
  const pending = await leaveProgress(page, fixture);
  await expect(pending).toHaveAttribute("class", /closed/);
  await expect(pending.locator(".pending-closure-badge")).toHaveAttribute("title", "Väntar på att GitHub bekräftar att issuet är stängt");
  // The guessed state never reaches the encrypted cache: no plaintext issue data in storage either.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain("Exportera rapporter");
  const closedAt = iso(-5000);
  fixture.release({ ...working, labels: working.labels.slice(1), state: "closed", closed_at: closedAt, updated_at: closedAt });
  await expect(page.locator(".pending-closure")).toHaveCount(0);
  const card = page.locator(".board-column.closed .issue-card", { hasText: "Exportera rapporter" });
  await expect(card.locator(".closed-date")).toHaveAttribute("datetime", closedAt);
  expect(fixture.singleRequests).toBe(1);
});

test("an issue that was moved back instead of closed returns to its actual column", async ({ page }) => {
  const fixture = await setup(page);
  await leaveProgress(page, fixture);
  fixture.release({ ...working, labels: working.labels.slice(1), updated_at: iso(-1000) });
  await expect(page.locator(".pending-closure")).toHaveCount(0);
  await expect(page.locator(".board-column.backlog .issue-card", { hasText: "Exportera rapporter" })).toHaveCount(1);
});

test("a deleted issue is removed after verification", async ({ page }) => {
  const fixture = await setup(page);
  await leaveProgress(page, fixture);
  fixture.release(null);
  await expect(page.locator(".pending-closure")).toHaveCount(0);
  await expect(page.locator(".issue-card", { hasText: "Exportera rapporter" })).toHaveCount(0);
});

const sizes = [
  { width: 1600, height: 1000, mobile: false },
  { width: 1000, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
];
async function matrix(browser: Browser, size: (typeof sizes)[number], reducedMotion: boolean) {
  const context = await browser.newContext({ viewport: size, isMobile: size.mobile, hasTouch: size.mobile, locale: "sv-SE", reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  try {
    const fixture = await setup(page);
    await leaveProgress(page, fixture);
    const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
    for (const view of ["Kort", "Lista"] as const) {
      await mode.getByRole("button", { name: view, exact: true }).click();
      const pending = page.locator(view === "Kort" ? ".issue-card.pending-closure" : ".issue-row.pending-closure");
      const closed = page.locator(view === "Kort" ? ".board-column.closed .issue-card:not(.pending-closure)" : ".board-column.closed .issue-row:not(.pending-closure)");
      await pending.scrollIntoViewIfNeeded();
      await expect(pending).toBeVisible();
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        const badge = pending.locator(".pending-closure-badge");
        await expect(badge).toBeVisible();
        const [item, other, badgeBox] = await Promise.all([pending.boundingBox(), closed.first().boundingBox(), badge.boundingBox()]);
        // The badge stays inside its card/row; list rows keep the closed rows' height.
        expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(item!.x + item!.width + 1);
        if (view === "Lista") {
          expect(Math.abs(item!.height - other!.height)).toBeLessThanOrEqual(1);
          // Shared left edge for titles (phone rows size the number column to its digits, so compare the
          // title's offset from the number there) and a straight right edge for the time slot.
          const [titleA, titleB, timeA, timeB, idA, idB] = await Promise.all([pending.locator(".row-title"), closed.first().locator(".row-title"), pending.locator(".row-time"), closed.first().locator(".row-time"), pending.locator(".row-id"), closed.first().locator(".row-id")].map((part) => part.boundingBox()));
          const offset = (title: typeof titleA, id: typeof idA) => size.mobile ? title!.x - id!.x - id!.width : title!.x;
          expect(Math.abs(offset(titleA, idA) - offset(titleB, idB))).toBeLessThanOrEqual(1);
          expect(Math.abs(timeA!.x + timeA!.width - (timeB!.x + timeB!.width))).toBeLessThanOrEqual(1);
        }
        // Card text wraps instead of spilling out of its shrunken box; list text truncates in its slot.
        if (view === "Kort") expect(await badge.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
        // The badge never overlaps the card's own actions (seen at 1000x900 before the badge wrapped).
        for (const action of await pending.locator(".details-toggle, .comment-count").all()) {
          const box = await action.boundingBox();
          if (!box || !box.width) continue;
          const overlaps = badgeBox!.x < box.x + box.width && box.x < badgeBox!.x + badgeBox!.width && badgeBox!.y < box.y + box.height && box.y < badgeBox!.y + badgeBox!.height;
          expect(overlaps).toBe(false);
        }
        const icon = badge.locator("svg");
        expect(await icon.evaluate((node) => getComputedStyle(node).animationName)).toBe(reducedMotion ? "none" : "pending-closure-pulse");
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.screenshot({ path: `${evidence}/${size.width}x${size.height}-${view === "Kort" ? "cards" : "list"}-${theme}.png` });
          await pending.screenshot({ path: `${evidence}/${size.width}x${size.height}-${view === "Kort" ? "cards" : "list"}-${theme}-item.png` });
        }
      }
      await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    }
  } finally { await context.close(); }
}
for (const size of sizes) {
  test(`pending card and row ${size.width}x${size.height}`, async ({ browser }) => {
    await matrix(browser, size, size.width === 390);
  });
}
