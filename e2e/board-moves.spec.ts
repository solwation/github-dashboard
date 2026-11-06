import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { setBoardGrouping, type BoardGrouping } from "./support/board-grouping";

// #419: a status change at sync moves the card/row from its old column to its new one.
// Synthetic fixture data only; evidence screenshots go to BOARD_MOVES_EVIDENCE when set.
const evidence = process.env.BOARD_MOVES_EVIDENCE;
const progress = { name: "in progress", color: "fbca04" };
const NOW = Date.now();
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: false, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" }, description: "Fixture" }));
type State = "backlog" | "progress" | "closed";
const domId = (repo: string, number: number) => `issue-${encodeURIComponent(`sample/${repo}`)}-${number}`;
const byId = (repo: string, number: number) => `[id="${domId(repo, number)}"]`;

function issue(repo: string, number: number, state: State, title: string) {
  return {
    id: (repo === "alpha" ? 100 : 200) + number, number, title, comments: 0, assignees: [], body: "Syntetisk beskrivning",
    created_at: iso(-(9 + number) * 86400000), updated_at: iso(-3600000), html_url: `https://github.com/sample/${repo}/issues/${number}`,
    state: state === "closed" ? "closed" : "open", closed_at: state === "closed" ? iso(-60000 * number) : null,
    labels: state === "progress" ? [progress] : [{ name: "enhancement", color: "a2eeef" }],
  };
}
const titles: Record<string, string> = {
  "alpha#1": "Flytta upp från backloggen till pågående arbete",
  "alpha#2": "Pågående arbete som blir klart och stängs",
  "alpha#3": "Backloggärende som stängs direkt utan att påbörjas",
  "alpha#4": "Stängt ärende som öppnas igen",
  "alpha#5": "Stannar kvar i backloggen",
  "beta#1": "Beta: påbörjas samtidigt",
  "beta#2": "Beta: stannar kvar",
};
const initial: Record<string, State> = { "alpha#1": "backlog", "alpha#2": "progress", "alpha#3": "backlog", "alpha#4": "closed", "alpha#5": "backlog", "beta#1": "backlog", "beta#2": "backlog" };
const moved: Record<string, State> = { ...initial, "alpha#1": "progress", "alpha#2": "closed", "alpha#3": "closed", "alpha#4": "backlog", "beta#1": "progress" };

async function setup(page: Page, grouping: BoardGrouping, view: "Kort" | "Lista") {
  const states = { ...initial };
  await page.addInitScript(() => {
    // Records every Web Animation so the spec can see the move animations the board starts.
    const log: Animation[] = ((window as unknown as { __animations: Animation[] }).__animations = []);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element["animate"]>) {
      const animation = animate.apply(this, args);
      log.push(animation);
      return animation;
    };
  });
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "moves-test", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repos;
    else if (/^\/repos\/sample\/(alpha|beta)\/issues$/.test(url.pathname)) {
      const repo = url.pathname.split("/")[3]!;
      const all = Object.entries(states).filter(([key]) => key.startsWith(`${repo}#`)).map(([key, state]) => issue(repo, Number(key.split("#")[1]), state, titles[key]!));
      const state = url.searchParams.get("state");
      data = all.filter((item) => state === "all" || item.state === state);
    } else if (/\/issues\/\d+\/events$/.test(url.pathname)) data = [{ id: 1, event: "labeled", created_at: iso(-45 * 60000), label: { name: progress.name } }];
    else if (url.pathname === "/graphql") data = { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } };
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page.getByLabel("GitHub personal access token").fill("test-only");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await setBoardGrouping(page, grouping);
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: view, exact: true }).click();
  await expect(page.locator(byId("alpha", 2))).toHaveCount(1);
  await expect(page.locator(".board-toolbar").first()).toHaveAttribute("data-busy", "false");
  // None of the setup steps (first load, grouping, Cards/List) started a move.
  expect(await moveAnimations(page)).toEqual([]);
  return { states };
}

function moveAnimations(page: Page) {
  return page.evaluate(() => (window as unknown as { __animations: Animation[] }).__animations
    .filter((animation) => animation.id === "board-move" || animation.id === "board-move-feedback")
    .map((animation) => ({ id: animation.id, target: ((animation.effect as KeyframeEffect).target as HTMLElement).id, state: animation.playState })));
}

async function sync(page: Page, states: Record<string, State>, pause = false) {
  Object.assign(states, moved);
  if (pause) {
    // Freeze each move halfway so the screenshot shows it in flight.
    await page.evaluate(() => {
      const log = (window as unknown as { __animations: Animation[] }).__animations;
      const push = log.push.bind(log);
      log.push = (...items: Animation[]) => {
        queueMicrotask(() => items.forEach((animation) => { if (animation.id === "board-move") { animation.pause(); animation.currentTime = 160; } }));
        return push(...items);
      };
    });
  }
  await page.keyboard.press("Control+r");
}
const columnOf = (page: Page, repo: string, number: number) =>
  page.locator(byId(repo, number)).evaluate((element) => [...(element.closest(".board-column")?.classList ?? [element.outerHTML.slice(0, 300), element.parentElement?.outerHTML.slice(0, 200) ?? ""])].find((name) => ["backlog", "progress", "closed"].includes(name) || name.length > 20));

async function expectFinalBoard(page: Page) {
  await expect.poll(() => columnOf(page, "alpha", 1)).toBe("progress");
  for (const [repo, number, column] of [["alpha", 2, "closed"], ["alpha", 3, "closed"], ["alpha", 4, "backlog"], ["alpha", 5, "backlog"], ["beta", 1, "progress"]] as const) {
    expect(await columnOf(page, repo, number)).toBe(column);
  }
  // Exactly one card/row per issue: no duplicates and no lost items.
  for (const key of Object.keys(moved)) {
    const [repo, number] = key.split("#");
    await expect(page.locator(byId(repo!, Number(number)))).toHaveCount(1);
  }
}

for (const grouping of ["split", "none"] as const) {
  for (const view of ["Kort", "Lista"] as const) {
    test(`status changes move ${view} on the ${grouping === "split" ? "split" : "joined"} board, several at once, keeping focus`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      const { states } = await setup(page, grouping, view);
      // Focus the control inside the card/row that is about to move.
      const opener = page.locator(byId("alpha", 1)).locator(view === "Kort" ? ".card-open" : ".row-title").first();
      await opener.focus();
      const startY = await page.evaluate(() => window.scrollY);
      await sync(page, states, !!evidence);
      await expect.poll(async () => (await moveAnimations(page)).filter((item) => item.id === "board-move").length).toBeGreaterThanOrEqual(3);
      const label = `${grouping === "split" ? "split" : "joined"}-${view === "Kort" ? "cards" : "list"}`;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/during-${label}-1600x1000.png` });
        await page.evaluate(() => (window as unknown as { __animations: Animation[] }).__animations.forEach((animation) => animation.play()));
      }
      await expectFinalBoard(page);
      const flights = (await moveAnimations(page)).filter((item) => item.id === "board-move").map((item) => item.target);
      expect(flights).toEqual(expect.arrayContaining([domId("alpha", 1), domId("alpha", 2), domId("alpha", 4), domId("beta", 1)]));
      // Unmoved items never animate.
      expect(flights).not.toContain(domId("alpha", 5));
      // All animations finish and nothing is left behind.
      await expect.poll(async () => (await moveAnimations(page)).filter((item) => item.state === "running" || item.state === "paused").length).toBe(0);
      expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.id.startsWith("board-move")).length)).toBe(0);
      // Focus stays on the same control of the moved issue, without scrolling the page.
      expect(await page.evaluate((id) => !!document.activeElement?.closest(`#${CSS.escape(id)}`), domId("alpha", 1))).toBe(true);
      expect(Math.abs(await page.evaluate(() => window.scrollY) - startY)).toBeLessThanOrEqual(1);
      // The existing unread-move marker still marks the moved card.
      if (view === "Kort") await expect(page.locator(`${byId("alpha", 1)} .movement-marker`)).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/after-${label}-1600x1000.png` });

      // A later filter, sort, Cards/List switch or limit change starts no move.
      const before = (await moveAnimations(page)).length;
      await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("Beta");
      await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: view === "Kort" ? "Lista" : "Kort", exact: true }).click();
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: view, exact: true }).click();
      await page.waitForTimeout(300);
      expect((await moveAnimations(page)).length).toBe(before);
    });
  }
}

test("reduced motion shows the final state at once without any move animation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "sv-SE", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const { states } = await setup(page, "split", "Kort");
    await page.locator(`${byId("alpha", 1)} .card-open`).focus();
    await sync(page, states);
    await expectFinalBoard(page);
    await page.waitForTimeout(600);
    expect(await moveAnimations(page)).toEqual([]);
    expect(await page.evaluate((id) => !!document.activeElement?.closest(`#${CSS.escape(id)}`), domId("alpha", 1))).toBe(true);
  } finally { await context.close(); }
});

test("an off-screen end gives a short pulse instead of a flight, without scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "sv-SE" });
  const page = await context.newPage();
  try {
    const { states } = await setup(page, "split", "Kort");
    const startY = await page.evaluate(() => window.scrollY);
    await sync(page, states);
    await expectFinalBoard(page);
    await expect.poll(async () => (await moveAnimations(page)).length).toBeGreaterThan(0);
    const all = await moveAnimations(page);
    // Stacked phone columns: #3 leaves the visible Backlog for Closed below the fold, so it pulses
    // where it landed instead of flying across the page; nothing flies with an off-screen end.
    expect(all.find((item) => item.target === domId("alpha", 3))?.id).toBe("board-move-feedback");
    expect(all.filter((item) => item.id === "board-move")).toEqual([]);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - startY)).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await moveAnimations(page)).filter((item) => item.state === "running").length, { timeout: 5000 }).toBe(0);
  } finally { await context.close(); }
});

const sizes = [
  { width: 1600, height: 1000, mobile: false },
  { width: 1000, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 320, height: 568, mobile: true },
];
async function finalState(browser: Browser, size: (typeof sizes)[number], view: "Kort" | "Lista") {
  const context = await browser.newContext({ viewport: size, isMobile: size.mobile, hasTouch: size.mobile, locale: "sv-SE" });
  const page = await context.newPage();
  try {
    const { states } = await setup(page, "split", view);
    await sync(page, states);
    await expectFinalBoard(page);
    await expect.poll(async () => (await moveAnimations(page)).filter((item) => item.state === "running").length, { timeout: 5000 }).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.locator(byId("alpha", 1)).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/final-${view === "Kort" ? "cards" : "list"}-${size.width}x${size.height}.png` });
    }
  } finally { await context.close(); }
}
for (const size of sizes) {
  test(`final state after moves at ${size.width}x${size.height}${size.mobile ? " (touch)" : ""}`, async ({ browser }) => {
    await finalState(browser, size, "Kort");
    await finalState(browser, size, "Lista");
  });
}
