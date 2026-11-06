import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { setBoardGrouping, type BoardGrouping } from "./support/board-grouping";

/**
 * #426: List rows keep a fixed left block (id badge with type icon, SP under it, times beside it),
 * give the title the rest of line 1 and put metadata chips on line 2. Fictional data only.
 * LIST_ROW_EVIDENCE=<dir> also writes screenshots and measurements there.
 */
const evidence = process.env.LIST_ROW_EVIDENCE;
const names = ["alpha-service", "a-very-long-repository-name-for-row-layout", "gamma"];
const repos = names.map((name, index) => ({ id: 4260 + index, name, full_name: `sample/${name}`, description: "Fictional row layout fixture", private: false, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
const longTitle = "Kontrollera spelfångst och hörbart ljud med det riktiga spelet innan releasen, inklusive långa menyer och undertexter";
const label = (name: string, color = "a2eeef") => ({ name, color });

async function fixture(page: Page) {
  const now = Date.now(), iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const issues = repos.map((repo, r) => {
    const n = (k: number) => r === 0 && k === 1 ? 123456 : r * 100 + k;
    const plan = [
      { k: 1, title: longTitle, state: "open", labels: [label("bug", "d73a4a"), label("priority: high", "b60205"), label("orkester: olw-win10-opus-5.5-20261106", "5319e7")] },
      { k: 2, title: "Begränsa API-timeout genom hela svarskroppen", state: "open", labels: [label("enhancement")] },
      { k: 3, title: `${repo.name}: utan typ och utan prioritet`, state: "open", labels: [] },
      { k: 4, title: "Långsamt pågående arbete som har passerat estimatet och därför visar timeout i raden", state: "open", labels: [label("in-progress", "fbca04"), label("bug", "d73a4a"), label("priority: low", "0e8a16")], started: 70 },
      { k: 5, title: "Pågående utan känd start", state: "open", labels: [label("in-progress", "fbca04"), label("documentation", "0075ca")] },
      { k: 6, title: "Stängt arbete med faktisk arbetstid och en lång titel som annars trunkeras hårt i smala simbanor", state: "closed", labels: [label("enhancement")], started: 60 + 236 },
      { k: 7, title: "Stängt utan typ", state: "closed", labels: [], started: 64 },
    ];
    const history = [91, 92, 93].map(k => ({ k, title: "Historik", state: "closed", labels: [] as ReturnType<typeof label>[], started: 60 * 24 * 3 + 20, closedAgo: 60 * 24 * 3 }));
    return [...plan, ...history].map(item => ({
      id: repo.id * 1000 + item.k, number: n(item.k), title: item.title, body: "Fictional row layout fixture.", comments: item.k === 2 ? 3 : item.k === 1 ? 1234 : item.k === 4 ? 98765 : 0, state: item.state,
      created_at: iso(60 * 24 * (item.k + 1)), updated_at: iso(30), closed_at: item.state === "closed" ? iso("closedAgo" in item ? item.closedAgo as number : 60) : null,
      startedAt: item.state === "closed" && item.started ? iso(item.started) : undefined,
      html_url: `${repo.html_url}/issues/${n(item.k)}`, labels: item.labels, assignees: [], repoIndex: r, started: item.started,
    }));
  }).flat();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "row-layout-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    const events = url.pathname.match(/\/repos\/sample\/([^/]+)\/issues\/(\d+)\/events$/);
    if (events) {
      const issue = issues.find(item => item.html_url.endsWith(`/${events[1]}/issues/${events[2]}`));
      return route.fulfill({ json: issue?.state === "open" && issue.started ? [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: iso(issue.started) }] : [] });
    }
    const repo = repos.find(item => url.pathname === `/repos/${item.full_name}/issues`);
    if (repo) {
      const state = url.searchParams.get("state");
      return route.fulfill({ json: issues.filter(issue => issue.html_url.startsWith(repo.html_url + "/") && (state === "all" || issue.state === state)) });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-row-layout-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane, .swimlane-board").first()).toBeVisible();
}

async function open(browser: Browser, viewport: { width: number; height: number }, mobile: boolean) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
  const page = await context.newPage();
  await fixture(page);
  return { context, page };
}
async function theme(page: Page, value: "light" | "dark") {
  await page.evaluate(async value => { const path = "/src/lib/theme.ts"; (await import(/* @vite-ignore */ path)).setTheme(value); await document.fonts.ready; }, value);
}
async function mode(page: Page, name: "Kort" | "Lista") {
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name, exact: true }).click();
}

/** Per-row geometry relative to the row: left block cells, title and line-2 start. */
function measure(page: Page) {
  return page.locator(".issue-row").evaluateAll(rows => rows.map(row => {
    const r = row.getBoundingClientRect();
    const box = (selector: string) => { const e = row.querySelector(selector); if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? { x: +(b.x - r.x).toFixed(1), y: +(b.y - r.y).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } : null; };
    const title = row.querySelector(".row-title-text") as HTMLElement;
    const meta = row.querySelector(".row-meta, .row-mobile-summary");
    const firstChip = meta ? [...meta.querySelectorAll(".priority, .row-repository, .row-status, .row-timeout, .row-marker, .label, .row-mobile-priority, .issue-points")].map(e => e.getBoundingClientRect()).filter(b => b.width).sort((a, b) => a.x - b.x)[0] : undefined;
    return {
      cls: [...row.classList].filter(c => ["backlog", "progress", "closed", "issue-timeout"].includes(c)).join(" "), title: title.textContent!.slice(0, 24), height: +r.height.toFixed(1), width: +r.width.toFixed(1),
      badge: box(".row-number"), id: box(".row-id"), points: box(".issue-points"), time: box(".row-time"), outcome: box(".row-outcome > *"), titleBox: box(".row-title"), slot: box(".row-comments"), comment: box(".row-comments .comment-count"), metaBox: box(".row-meta, .row-mobile-summary"),
      titleTruncated: title.scrollWidth > title.clientWidth + 1, line2: firstChip ? { x: +(firstChip.x - r.x).toFixed(1), y: +(firstChip.y - r.y).toFixed(1) } : null,
      overflow: row.scrollWidth - row.clientWidth,
    };
  }));
}

type Rows = Awaited<ReturnType<typeof measure>>;
/** #429: the comment control is visible on every row, in one fixed slot at the end of line 2, clear of the metadata and times. */
function expectCommentSlot(rows: Rows, label: string) {
  const xs = rows.map(r => r.slot!.x + r.slot!.w);
  expect(Math.max(...xs) - Math.min(...xs), `${label} comment slot right edge spread`).toBeLessThanOrEqual(1);
  const icons = rows.map(r => r.comment!.x);
  expect(Math.max(...icons) - Math.min(...icons), `${label} comment x spread`).toBeLessThanOrEqual(1);
  for (const row of rows) {
    expect(row.comment, `${row.title} comment control`).not.toBeNull();
    expect(row.comment!.x, `${row.title} comment after metadata`).toBeGreaterThanOrEqual(row.metaBox!.x + row.metaBox!.w - 1);
    if (row.outcome && row.outcome.y > row.titleBox!.y + row.titleBox!.h - 2) expect(row.comment!.x, `${row.title} comment after outcome`).toBeGreaterThanOrEqual(row.outcome.x + row.outcome.w - 1);
    expect(row.comment!.x + row.comment!.w, `${row.title} comment inside row`).toBeLessThanOrEqual(row.width + 0.5);
    expect(row.comment!.y, `${row.title} comment on line 2`).toBeGreaterThanOrEqual(row.titleBox!.y + row.titleBox!.h - 4);
  }
}

/** Desktop/tablet rows: badge, SP, times, title and line 2 start at one x (±1px) with or without optional fields. */
function expectLeftBlock(rows: Rows, label: string) {
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  for (const [name, values] of Object.entries({
    badge: rows.map(r => r.id!.x), points: rows.map(r => r.points!.x), time: rows.map(r => r.time!.x),
    title: rows.map(r => r.titleBox!.x), line2: rows.filter(r => r.line2).map(r => r.line2!.x),
    outcome: rows.filter(r => r.outcome).map(r => r.outcome!.x), height: rows.map(r => r.height),
  })) expect(spread(values), `${label} ${name} spread`).toBeLessThanOrEqual(1);
  for (const row of rows) {
    expect(row.points!.y, `${row.title} SP under the badge`).toBeGreaterThanOrEqual(row.id!.y + row.id!.h - 1);
    expect(row.id!.x + row.id!.w, `${row.title} badge inside its column`).toBeLessThanOrEqual(row.time!.x);
    expect(row.time!.x + row.time!.w, `${row.title} times before title`).toBeLessThanOrEqual(row.titleBox!.x);
    expect(row.height, `${row.title} height`).toBeLessThanOrEqual(46);
  }
}

const matrix = [
  { name: "wide", viewport: { width: 1600, height: 1000 }, mobile: false },
  { name: "narrow", viewport: { width: 1000, height: 900 }, mobile: false },
  { name: "portrait", viewport: { width: 390, height: 844 }, mobile: true },
  { name: "landscape", viewport: { width: 844, height: 390 }, mobile: true },
  { name: "tiny", viewport: { width: 320, height: 568 }, mobile: true },
];
const phase = process.env.LIST_ROW_PHASE ?? "after";

for (const scenario of matrix) test(`list rows and cards in the ${scenario.name} matrix scenario`, async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await open(browser, scenario.viewport, scenario.mobile);
  const out: Record<string, unknown> = {};
  for (const grouping of ["none", "split"] as BoardGrouping[]) {
    await setBoardGrouping(page, grouping);
    for (const view of ["Lista", "Kort"] as const) {
      await mode(page, view);
      for (const scheme of ["light", "dark"] as const) {
        await theme(page, scheme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario.name} ${grouping} ${view} overflow`).toBe(true);
        if (view === "Lista") {
          const rows = await measure(page);
          for (const row of rows) expect(row.overflow, `${row.title} overflow`).toBeLessThanOrEqual(1);
          await expect(page.locator(".issue-row .row-comments .comment-count:visible")).toHaveCount(rows.length);
          expectCommentSlot(rows, `${scenario.name} ${grouping} ${scheme}`);
          if (!scenario.mobile) expectLeftBlock(rows, `${scenario.name} ${grouping} ${scheme}`);
          else for (const row of rows) expect(row.height, `${row.title} phone height`).toBeLessThanOrEqual(60);
          if (scheme === "light") out[`${grouping}-${view}`] = rows;
        }
        if (evidence && grouping === "split") {
          await page.locator(view === "Lista" ? ".issue-row" : ".issue-card").first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${evidence}/${phase}-${view === "Lista" ? "list" : "cards"}-${scenario.name}-${scheme}.png` });
        }
      }
    }
  }
  if (evidence) await writeFile(`${evidence}/${phase}-measure-${scenario.name}.json`, JSON.stringify(out, null, 1));
  await context.close();
});

test("swimlanes with three repositories at 2560px keep long titles readable", async ({ browser }) => {
  test.setTimeout(120_000);
  if (evidence) await mkdir(evidence, { recursive: true });
  const { context, page } = await open(browser, { width: 2560, height: 1400 }, false);
  await setBoardGrouping(page, "swimlanes");
  await mode(page, "Lista");
  await expect(page.locator(".swimlane-board .issue-row")).toHaveCount(30);
  const out: Record<string, unknown> = {};
  for (const scheme of ["dark", "light"] as const) {
    await theme(page, scheme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const rows = await measure(page);
    for (const row of rows) expect(row.overflow, `${row.title} overflow`).toBeLessThanOrEqual(1);
    expectLeftBlock(rows, `swimlanes ${scheme}`);
    expectCommentSlot(rows, `swimlanes ${scheme}`);
    // Before #426 a 1/3 lane gave the title 382px of 747px; the left block now leaves it over 520px.
    for (const row of rows) expect(row.titleBox!.w / row.width, `${row.title} title share`).toBeGreaterThan(0.7);
    out[scheme] = rows;
    if (evidence) {
      await page.locator(".swimlane-board").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/${phase}-swimlanes-2560-${scheme}.png` });
      await page.locator(".swimlane-table-status-cells").first().screenshot({ path: `${evidence}/${phase}-swimlanes-2560-${scheme}-lane.png` });
    }
  }
  if (evidence) await writeFile(`${evidence}/${phase}-measure-swimlanes-2560.json`, JSON.stringify(out, null, 1));
  await context.close();
});

test("the list id badge keeps its link name, focus ring and type icon name", async ({ browser }) => {
  const { context, page } = await open(browser, { width: 1600, height: 1000 }, false);
  await mode(page, "Lista");
  const row = page.locator(".issue-row").filter({ hasText: "Begränsa API-timeout" }).first();
  const link = row.locator(".row-number");
  await expect(link).toHaveAttribute("aria-label", /^Öppna #\d+ på GitHub$/);
  await expect(row.locator(".row-id .type-circle")).toHaveAttribute("aria-label", /^Typ: /);
  await row.locator(".row-title").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  expect(await row.locator(".row-id").evaluate(node => getComputedStyle(node).outlineStyle + getComputedStyle(node).outlineWidth)).toBe("solid2px");
  if (evidence) await row.screenshot({ path: `${evidence}/after-list-badge-focus.png` });
  await context.close();
});

/** #429: the comment control opens the comments straight from the row, by pointer and keyboard, without expanding the row. */
// Split lanes show every backlog row of the fixture; Joined would hide the 3-comment rows behind Show more.
const commentViews = [
  { name: "swimlanes 2560", viewport: { width: 2560, height: 1400 }, mobile: false, grouping: "swimlanes" as BoardGrouping },
  { name: "list 1000", viewport: { width: 1000, height: 900 }, mobile: false, grouping: "split" as BoardGrouping },
  { name: "portrait", viewport: { width: 390, height: 844 }, mobile: true, grouping: "split" as BoardGrouping },
  { name: "landscape", viewport: { width: 844, height: 390 }, mobile: true, grouping: "split" as BoardGrouping },
  { name: "tiny", viewport: { width: 320, height: 568 }, mobile: true, grouping: "split" as BoardGrouping },
];
for (const view of commentViews) test(`list comment control opens comments in place: ${view.name}`, async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await open(browser, view.viewport, view.mobile);
  await setBoardGrouping(page, view.grouping);
  await mode(page, "Lista");
  const rows = page.locator(".issue-row");
  // Large (1234), abbreviated (98765 → 99 tn), few (3) and zero comments are all reachable without expanding.
  for (const name of ["1234 kommentarer", "98765 kommentarer", "3 kommentarer", "0 kommentarer"]) {
    const control = rows.filter({ has: page.locator(`.row-comments .comment-count[aria-label="${name}"]`) }).first().locator(".row-comments .comment-count");
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    await expect(control).toHaveAccessibleName(name);
    const value = control.locator(".comment-count-value");
    const m = await value.evaluate(el => ({ s: el.scrollWidth, c: el.clientWidth }));
    expect(m.s <= m.c, `${name} count not clipped ${JSON.stringify(m)}`).toBe(true);
    if (name.startsWith("98765")) await expect(value).toHaveText(/^99\s?tn$/);
  }
  const row = rows.filter({ has: page.locator('.row-comments .comment-count[aria-label="1234 kommentarer"]') }).first(), control = row.locator(".row-comments .comment-count");
  await control.scrollIntoViewIfNeeded();
  const before = await row.boundingBox();
  if (view.mobile) {
    // 44px hit area from a pseudo-element: the row stays as tall as before and the box edges still hit the button.
    const hit = await control.evaluate(el => { const a = getComputedStyle(el, "::after"); return { w: parseFloat(a.width), h: parseFloat(a.height), height: el.getBoundingClientRect().height }; });
    expect(hit.w).toBeGreaterThanOrEqual(44); expect(hit.h).toBeGreaterThanOrEqual(44); expect(hit.height).toBeLessThan(30);
    expect(before!.height).toBeLessThanOrEqual(60);
    const box = (await control.boundingBox())!;
    const hits = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(".comment-count") !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 + 18 });
    expect(hits, "point 18px below centre still hits the control").toBe(true);
  }
  await control.click();
  const dialog = page.getByRole("dialog", { name: /^Kommentarer för #\d+$/ });
  await expect(dialog).toBeVisible();
  await expect(row.locator(".row-title")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".row-card, .row-popup-backdrop")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Stäng kommentarer", exact: true }).click();
  await expect(control).toBeFocused();
  expect((await row.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  // Keyboard: Enter and Space on the focused control open the same dialog; the row stays collapsed.
  for (const key of ["Enter", "Space"]) {
    await control.focus(); await page.keyboard.press(key);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(control).toBeFocused();
    await expect(row.locator(".row-title")).toHaveAttribute("aria-expanded", "false");
  }
  await context.close();
});
