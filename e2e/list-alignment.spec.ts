import { expect, test, type Page } from "@playwright/test";

const repo = { id: 190, name: "list-align", full_name: "sample/list-align", description: "Fictional list alignment fixture", private: true, html_url: "https://github.com/sample/list-align", owner: { login: "sample" } };

async function fixture(page: Page, longTitle = false, outcomes: boolean | "interrupted" = false, longLabels = false, review = false, density = false) {
  const fixtureRepo = density ? { ...repo, name: "a-very-long-repository-name-for-narrow-list-rows", full_name: "sample/a-very-long-repository-name-for-narrow-list-rows", html_url: "https://github.com/sample/a-very-long-repository-name-for-narrow-list-rows" } : repo;
  const now = Date.now(), old = new Date(now - 86400000 * 3).toISOString(), recent = new Date(now - 3600000).toISOString();
  // [title, comments, section label, state, extra labels]
  const specs: [string, number, string | null, "open" | "closed", string[]][] = [
    ["Backlog one", 1, null, "open", ["bug"]],
    ["Backlog twelve", 12, null, "open", ["enhancement", "bug"]],
    ["Backlog many", 123, null, "open", ["bug"]],
    ["Backlog none", 0, null, "open", []],
    ["Progress one", 1, "in progress", "open", ["bug"]],
    ["Progress many", 123, "in progress", "open", ["enhancement"]],
    ["Closed twelve", 12, null, "closed", ["bug"]],
    ["Closed none", 0, null, "closed", ["enhancement"]],
    ["Closed third", 0, null, "closed", []],
  ];
  if (outcomes) specs.push(["Closed fourth", 0, null, "closed", []]);
  if (review) specs.push(["Closed unknown start", 0, null, "closed", []]);
  const closedMinutes = (index: number) => review && index === 8 ? 119 : outcomes === "interrupted" ? [900, 45, 60, 75][index - 6] ?? 30 : outcomes && index === 6 ? 60 : outcomes && index === 7 ? 15 : 30;
  const issues = specs.map(([title, comments, status, state, labels], index) => ({
    id: index === 0 && density ? 12345 : index + 1, number: index === 0 && density ? 12345 : index + 1, title: longTitle && index === 0 ? "A very long issue title that must remain on one compact line while the full title stays available in the card" : title, comments, body: "", state, created_at: old, updated_at: recent, closed_at: state === "closed" ? recent : null,
    html_url: `${fixtureRepo.html_url}/issues/${index === 0 && density ? 12345 : index + 1}`, assignees: [],
    startedAt: state === "closed" && title !== "Closed unknown start" ? new Date(now - 3600000 - closedMinutes(index) * 60000).toISOString() : undefined,
    labels: [...(status ? [{ name: status, color: "fbca04" }] : []), ...[...labels, ...(density && index === 0 ? ["story-points: 13"] : []), ...(longLabels ? ["a-very-long-workflow-label-that-must-not-wrap", "another-long-label-with-extra-context", "third-long-label-for-the-layout"] : ["ui"])].map(name => ({ name, color: "a2eeef" }))],
  }));
  if (review) {
    const older = issues[9]!;
    older.closed_at = new Date(now - 10 * 86400000).toISOString();
    older.startedAt = new Date(now - 10 * 86400000 - 30 * 60000).toISOString();
  }
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "list-align-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [fixtureRepo] });
    if (url.pathname.endsWith("/issues")) {
      const closed = url.searchParams.get("state") === "closed";
      return route.fulfill({ json: issues.filter(issue => (issue.state === "closed") === closed || url.searchParams.get("state") === "all") });
    }
    if (/\/issues\/(?:1|12345|5)\/events$/.test(url.pathname)) return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in progress" }, created_at: new Date(now - (longLabels ? (review ? 90 : 50) : 10) * 60000).toISOString() }] });
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-align-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: fixtureRepo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(specs.length);
  return {
    move() {
      const issue = issues[0]!;
      issue.labels = issue.labels.some(label => label.name === "in progress")
        ? issue.labels.filter(label => label.name !== "in progress")
        : [...issue.labels, { name: "in progress", color: "fbca04" }];
      issue.comments += 2;
      issue.updated_at = new Date().toISOString();
    },
    create() {
      const source = issues[3]!;
      issues.push({ ...source, id: 10, number: 10, title: "New observed work", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: `${repo.html_url}/issues/10` });
    },
  };
}

// Left edge of a column cell relative to its row, rounded to sub-pixel noise.
const left = async (row: ReturnType<Page["locator"]>, selector: string) => {
  const [cell, box] = await Promise.all([row.locator(selector).first().boundingBox(), row.boundingBox()]);
  return Math.round((cell!.x - box!.x) * 10) / 10;
};

for (const theme of ["light", "dark"]) {
  test(`list columns share left edges across rows, comment counts and sections (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await fixture(page);
    const rows = page.locator(".issue-row");
    await expect(page.locator(".issue-row.backlog")).toHaveCount(4);
    await expect(page.locator(".issue-row.progress")).toHaveCount(2);
    await expect(page.locator(".issue-row.closed")).toHaveCount(3);
    await expect(page.locator(".issue-row .issue-time-remaining")).toHaveCount(1);
    const columns: Record<string, string> = {
      number: ".row-number", title: ".row-title", meta: ".row-meta", commentSlot: ".row-slot-comment", status: ".row-status",
      priority: ".row-slot-priority", label: ".row-meta .label", commentIcon: ".row-comments .comment-count svg",
      commentCount: ".row-comments .comment-count-value", time: ".row-time",
    };
    for (const [name, selector] of Object.entries(columns)) {
      const edges = new Set<number>();
      for (let index = 0; index < await rows.count(); index++) {
        const row = rows.nth(index);
        if (name === "priority" && (await row.getAttribute("class"))!.includes("closed")) continue;
        edges.add(await left(row, selector));
      }
      expect(edges.size, `${name} left edges ${[...edges]}`).toBe(1);
    }
    // The new-comment marker icon also starts at one x position regardless of digit count.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Absolute x of the comment icon is identical in every section, not only relative to the row.
    const xs = await rows.evaluateAll(list => [...new Set(list.map(row => Math.round(row.querySelector(".row-comments .comment-count svg")!.getBoundingClientRect().x)))]);
    expect(xs).toHaveLength(1);
  });
}

test("compact layout keeps status flowing without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await fixture(page);
  const slot = page.locator(".issue-row").first().locator(".row-slot-status");
  expect(await slot.evaluate(node => getComputedStyle(node).display)).toBe("contents");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


for (const combined of [false, true]) {
  test(`activity occupies a stable slot before status in ${combined ? "combined" : "split"} rows`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    const api = await fixture(page);
    if (combined) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    const row = page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "Backlog one", exact: true }) });
    const geometry = () => row.evaluate(element => {
      const box = element.getBoundingClientRect();
      const cells = [".row-status", ".priority", ".row-time"].map(selector => {
        const cell = element.querySelector(selector)!.getBoundingClientRect();
        return { x: cell.x - box.x, y: cell.y - box.y, height: cell.height };
      });
      return { height: box.height, cells };
    });
    const before = await geometry();
    expect(before.height).toBe(44);
    api.move();
    await page.keyboard.press("Control+r");
    const moved = row.getByRole("button", { name: "Nyligen flyttad. Markera som läst", exact: true });
    const comments = row.getByRole("button", { name: "2 nya kommentarer. Markera som läst", exact: true });
    await expect(moved).toBeVisible();
    await expect(comments).toBeVisible();
    const active = await geometry();
    expect(active.height).toBeCloseTo(before.height, 0);
    for (let index = 0; index < before.cells.length; index++) expect(active.cells[index]!.x).toBeCloseTo(before.cells[index]!.x, 0);
    const marker = (await moved.boundingBox())!;
    const status = (await row.locator(".row-status").boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(marker.x + marker.width).toBeLessThanOrEqual(status.x);
    expect(marker.y + marker.height / 2).toBeCloseTo(status.y + status.height / 2, 0);
    expect(marker.y + marker.height / 2).toBeCloseTo(rowBox.y + rowBox.height / 2, 0);
    expect(await row.locator(".issue-points").count()).toBe(1);
    await expect(row.locator(".issue-time-remaining")).toBeVisible();
    await moved.focus(); await page.keyboard.press("Enter");
    await expect(moved).toHaveCount(0);
    await expect(comments).toHaveCount(0);
    const read = await geometry();
    expect(read.height).toBeCloseTo(active.height, 0);
    for (let index = 0; index < read.cells.length; index++) expect(read.cells[index]!.x).toBeCloseTo(active.cells[index]!.x, 0);
    api.create(); await page.keyboard.press("Control+r");
    const fresh = page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "New observed work", exact: true }) });
    const created = fresh.getByRole("button", { name: "Nyligen skapat i Backlog. Markera som läst", exact: true });
    await expect(created).toBeVisible();
    for (const width of [1600, 1450, 1380, 1100, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      const beforeRead = (await fresh.boundingBox())!;
      const badge = (await created.boundingBox())!;
      const status = (await fresh.locator(".row-status").boundingBox())!;
      expect(badge.x + badge.width).toBeLessThanOrEqual(status.x);
      expect(badge.y + badge.height / 2).toBeCloseTo(status.y + status.height / 2, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Reading leaves the reserved movement slot in place.
      if (width === 800) {
        await created.click();
        await expect(created).toHaveCount(0);
        expect((await fresh.boundingBox())!.height).toBeCloseTo(beforeRead.height, 0);
      }
    }
    // Activity also leaves geometry stable near the single-line container breakpoints.
    for (const width of [1600, 1450, 1380, 1100, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      api.move(); await page.keyboard.press("Control+r");
      await expect(moved).toBeVisible();
      await expect(comments).toBeVisible();
      const active = await geometry();
      const badge = (await moved.boundingBox())!;
      const status = (await row.locator(".row-status").boundingBox())!;
      const commentBox = (await comments.boundingBox())!;
      expect(badge.x + badge.width).toBeLessThanOrEqual(status.x);
      expect(badge.y + badge.height / 2).toBeCloseTo(status.y + status.height / 2, 0);
      expect(commentBox.x + commentBox.width <= badge.x || commentBox.y + commentBox.height <= badge.y || commentBox.y >= badge.y + badge.height).toBe(true);
      await comments.click();
      await expect(moved).toHaveCount(0);
      await expect(comments).toHaveCount(0);
      const read = await geometry();
      expect(read.height).toBeCloseTo(active.height, 0);
      for (let index = 0; index < read.cells.length; index++) {
        expect(read.cells[index]!.x).toBeCloseTo(active.cells[index]!.x, 0);
        expect(read.cells[index]!.y).toBeCloseTo(active.cells[index]!.y, 0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

for (const combined of [false, true]) {
  test(`phone rows stay dense and open full details in ${combined ? "combined" : "split"} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await fixture(page, true);
    if (combined) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    const row = page.locator('.issue-row').filter({ has: page.getByRole('button', { name: /^A very long issue title/ }) });
    for (const width of [320, 375, 430, 650]) {
      await page.setViewportSize({ width, height: 844 });
      for (const candidate of await page.locator('.issue-row').all()) expect((await candidate.boundingBox())!.height).toBeLessThanOrEqual(60);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(row.locator('.issue-points')).toBeVisible();
      await expect(row.locator('.row-time')).toBeVisible();
      await expect(row.locator('.row-meta')).toHaveCount(0);
      if (combined) await expect(row.locator('.row-repository')).toBeVisible();
    }
    await page.setViewportSize({ width: 320, height: 844 });
    const before = (await row.boundingBox())!.height;
    api.move(); await page.keyboard.press('Control+r');
    const moved = row.getByRole('button', { name: 'Nyligen flyttad. Markera som läst', exact: true });
    const comments = row.getByRole('button', { name: '2 nya kommentarer. Markera som läst', exact: true });
    await expect(moved).toBeVisible(); await expect(comments).toBeVisible();
    expect((await row.boundingBox())!.height).toBe(before);
    const moveBox = (await moved.boundingBox())!, commentBox = (await comments.boundingBox())!, timeBox = (await row.locator('.row-time').boundingBox())!;
    expect(moveBox.x + moveBox.width).toBeLessThanOrEqual(commentBox.x);
    expect(commentBox.x + commentBox.width).toBeLessThanOrEqual(timeBox.x);
    await page.screenshot({ path: test.info().outputPath('compact-phone-list.png'), fullPage: true });
    await row.locator('.row-title').click();
    const popup = page.locator('.row-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('ui');
    await expect(popup.locator('.issue-time-remaining')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(moved).toHaveCount(0); await expect(comments).toHaveCount(0);
    expect((await row.boundingBox())!.height).toBe(before);
  });
}

test("closed work duration and estimate arrows appear in rows and cards without growing phone rows", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page, false, true);
  const over = page.locator('.issue-row.closed').filter({ hasText: 'Closed twelve' });
  const under = page.locator('.issue-row.closed').filter({ hasText: 'Closed none' });
  await expect(over.locator('.implementation-time')).toContainText('↑');
  await expect(over.locator('.implementation-time')).toHaveAttribute('aria-label', /Faktisk arbetstid: 1 h.*Uppskattad tid: ≈ 30 min/);
  await expect(under.locator('.implementation-time')).toContainText('↓');
  await page.setViewportSize({ width: 320, height: 844 });
  expect((await over.boundingBox())!.height).toBeLessThanOrEqual(60);
  await expect(over.locator('.closed-date')).toBeVisible();
  await expect(over.locator('.row-outcome .implementation-time')).toBeVisible();
  await expect(over.locator('.implementation-time')).toBeVisible();
  await over.locator('.row-title').click();
  await expect(page.locator('.row-popup .implementation-time')).toContainText('↑');
  await expect(page.locator('.row-popup .closed-date')).toBeVisible();
});

test("Overview sidebar counts unread events instead of repositories and clears on read", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const api = await fixture(page);
  const count = page.locator('#overview-unread-count');
  await expect(count).toHaveText('0');
  api.move(); await page.keyboard.press('Control+r');
  await expect(count).toHaveText('3');
  await expect(count).toHaveAttribute('aria-label', '3 olästa händelser');
  await page.getByRole('textbox', { name: 'Sök issues', exact: true }).fill('Closed');
  await expect(count).toHaveText('3');
  await page.getByRole('textbox', { name: 'Sök issues', exact: true }).fill('');
  await page.getByRole('button', { name: '2 nya kommentarer. Markera som läst', exact: true }).click();
  await expect(count).toHaveText('0');
  await page.reload();
  await expect(count).toHaveText('0');
});

test("interrupted work keeps its actual duration without inflating future issue estimates", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page, false, "interrupted");
  const progress = page.locator('.issue-row.progress').filter({ has: page.getByRole('button', { name: 'Progress one', exact: true }) });
  await expect(progress.locator('.issue-points')).toHaveAttribute('title', /Uppskattad tid: ≈ 1 h.*från 3 användbara stängningar/);
  await expect(progress.locator('.issue-time-remaining')).toContainText('≈ 50 min kvar');
  const closed = page.locator('.issue-row.closed').filter({ has: page.getByRole('button', { name: 'Closed twelve', exact: true }) });
  await expect(closed.locator('.implementation-time')).toHaveAttribute('aria-label', /Faktisk arbetstid: 15 h.*Uppskattad tid: ≈ 1 h.*Längre än uppskattat/);
  await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Kort', exact: true }).click();
  const card = page.locator('.issue-card.progress').filter({ hasText: 'Progress one' });
  await expect(card.locator('.issue-points')).toHaveAttribute('title', /Uppskattad tid: ≈ 1 h.*från 3 användbara stängningar/);
  await expect(card.locator('.issue-time-remaining')).toContainText('≈ 50 min kvar');
});

for (const combined of [false, true]) test(`timeout keeps its own slot with long labels in ${combined ? 'combined' : 'split'} rows`, async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  const api = await fixture(page, false, false, true);
  if (combined) await page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true }).uncheck();
  const row = page.locator('.issue-row').filter({ has: page.getByRole('button', { name: 'Backlog one', exact: true }) });
  const snapshot = () => row.evaluate(element => {
    const row = element.getBoundingClientRect();
    return { height: row.height, slots: ['.row-slot-timeout', '.row-status', '.row-slot-priority', '.row-labels'].map(selector => {
      const box = element.querySelector(selector)!.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }) };
  });
  const empty = await snapshot();
  api.move(); await page.keyboard.press('Control+r');
  await expect(row.locator('.row-timeout')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Nyligen flyttad. Markera som läst', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '2 nya kommentarer. Markera som läst', exact: true })).toBeVisible();
  const active = await snapshot();
  expect(active.height).toBe(empty.height);
  for (let index = 0; index < active.slots.length; index++) expect(active.slots[index]!.x).toBeCloseTo(empty.slots[index]!.x, 0);
  for (const width of [1800, 1600, 1450, 1380, 1100, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await snapshot();
    const timeout = (await row.locator('.row-timeout').boundingBox())!;
    const status = (await row.locator('.row-status').boundingBox())!;
    const moved = (await row.locator('.row-movement-marker').boundingBox())!;
    expect(timeout.x + timeout.width).toBeLessThanOrEqual(status.x);
    expect(moved.x + moved.width).toBeLessThanOrEqual(timeout.x);
    expect(timeout.y + timeout.height / 2).toBeCloseTo(status.y + status.height / 2, 0);
    const labels = await row.locator('.row-labels .label').all();
    for (const label of labels) expect((await label.boundingBox())!.y).toBeCloseTo(geometry.slots[3]!.y, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.getByLabel('Varna när pågående arbete överskrider estimatet', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(row.locator('.row-timeout')).toHaveCount(0);
  const cleared = await snapshot();
  expect(cleared.height).toBe(active.height);
  for (let index = 0; index < active.slots.length; index++) expect(cleared.slots[index]!.x).toBeCloseTo(active.slots[index]!.x, 0);
});


const outcomeScenarios = [
  { name: 'wide-desktop', width: 1600, height: 1000, mobile: false },
  { name: 'narrow-desktop', width: 1000, height: 900, mobile: false },
  { name: 'portrait-phone', width: 390, height: 844, mobile: true },
  { name: 'landscape-phone', width: 844, height: 390, mobile: true },
  { name: 'narrow-phone', width: 320, height: 568, mobile: true },
  { name: 'short-desktop', width: 844, height: 390, mobile: false },
  { name: 'portrait-tablet', width: 768, height: 1024, mobile: true },
];
for (const scenario of outcomeScenarios) test.describe(`actual time layout ${scenario.name}`, () => {
  test.use({ viewport: { width: scenario.width, height: scenario.height }, isMobile: scenario.mobile, hasTouch: scenario.mobile });
  for (const combined of [false, true]) test(`${combined ? 'combined' : 'split'} cards and list keep actual time in its own rightmost column`, async ({ page }, info) => {
    const api = await fixture(page, true, true, true, true, true);
    if (combined) await page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true }).uncheck();
    api.move(); await page.keyboard.press('Control+r');
    const unread = page.locator('.issue-row').filter({ has: page.getByRole('button', { name: /^A very long issue title/ }) });
    await expect(unread.locator('.row-number')).toHaveText('#12345');
    await expect(unread.locator('.issue-points')).toContainText('13 SP');
    if (combined) await expect(unread.locator('.row-repository').first()).toHaveAttribute('title', /a-very-long-repository-name/);
    await expect(unread.locator('.row-movement-marker')).toBeVisible();
    await expect(unread.locator('.row-comment-marker')).toBeVisible();
    await expect(page.locator('.issue-row.issue-timeout').first()).toBeVisible();
    const compact = scenario.width <= 650 || (scenario.mobile && scenario.width <= 950 && scenario.height <= 500);
    if (compact) {
      for (const row of await page.locator('.issue-row').all()) {
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(60);
        await expect(row.locator('.issue-points')).toBeVisible();
        await expect(row.locator('.row-time')).toBeVisible();
        await expect(row.locator('.row-meta')).toHaveCount(0);
        const overlapping = await row.evaluate(element => {
          const boxes = [...element.querySelectorAll('.row-number,.row-title,.issue-points,.row-mobile-priority,.row-mobile-summary > .row-repository,.row-movement-marker,.row-comment-marker,.row-time,.row-outcome > *')]
            .map(item => ({ name: item.className, box: item.getBoundingClientRect() })).filter(item => item.box.width && item.box.height);
          return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1).map(b => `${a.name}/${b.name}`));
        });
        expect(overlapping).toEqual([]);
      }
    } else await expect(unread.locator('.row-meta')).toBeVisible();
    const backlog = page.locator('.issue-row.backlog').first();
    await expect(backlog.locator('.row-outcome .issue-time-estimate')).toContainText(/^≈ /);
    await expect(backlog.locator('.row-outcome .issue-time-estimate')).toHaveAttribute('aria-label', /^Uppskattad tid: ≈ [^≈]+$/);
    await expect(backlog.locator('.issue-time-estimate')).toHaveAttribute('title', /Baserat på median tid per poäng/);
    expect(await backlog.locator('.issue-time-estimate').evaluate(element => getComputedStyle(element).fontStyle)).toBe('italic');
    await expect(unread.locator('.row-outcome .issue-time-remaining')).toBeVisible();
    const unknown = page.locator('.issue-row.progress').filter({ has: page.getByRole('button', { name: 'Progress many', exact: true }) });
    await expect(unknown.locator('.row-time')).toContainText('Starttid okänd');
    await expect(unknown.locator('.row-outcome .issue-time-remaining')).toHaveCount(0);
    for (const row of await page.locator('.issue-row').all()) {
      const geometry = await row.evaluate(element => {
        const time = element.querySelector('.row-time')!.getBoundingClientRect(), forecast = element.querySelector('.row-outcome')!.getBoundingClientRect();
        return { timeRight: time.right, forecastX: forecast.x, forecastRight: forecast.right, rowRight: element.getBoundingClientRect().right,
          clipped: [...element.querySelectorAll('.row-outcome > *')].some(item => item.scrollWidth > item.clientWidth + 1),
          forecastClashes: [...element.querySelectorAll('.row-outcome > *')].some(item => item.getBoundingClientRect().left < time.right - 1 || item.getBoundingClientRect().right > element.getBoundingClientRect().right + 1) };
      });
      expect(geometry.timeRight).toBeLessThanOrEqual(geometry.forecastX);
      expect(geometry.forecastRight).toBeLessThanOrEqual(geometry.rowRight);
      expect(geometry.clipped).toBe(false);
      expect(geometry.forecastClashes).toBe(false);
    }
    const closed = page.locator('.issue-row.closed');
    const rightEdges: number[] = [];
    for (const row of await closed.all()) {
      const actual = row.locator('.row-outcome');
      await expect(row.locator('.closed-date')).toBeVisible();
      const geometry = await row.evaluate(element => {
        const bounds = element.getBoundingClientRect(), date = element.querySelector('.row-time')!.getBoundingClientRect(), actual = element.querySelector('.row-outcome')!.getBoundingClientRect();
        return { row: { x: bounds.x, right: bounds.right, height: bounds.height }, date: { right: date.right, y: date.y, height: date.height }, actual: { x: actual.x, right: actual.right, y: actual.y, height: actual.height } };
      });
      expect(geometry.date.right).toBeLessThanOrEqual(geometry.actual.x);
      expect(geometry.actual.right).toBeLessThanOrEqual(geometry.row.right);
      expect(geometry.date.y + geometry.date.height / 2).toBeCloseTo(geometry.actual.y + geometry.actual.height / 2, 0);
      if (compact) expect(geometry.row.height).toBeLessThanOrEqual(60);
      rightEdges.push(Math.round(geometry.actual.right));
      if ((await row.locator('.row-title').innerText()).includes('unknown')) await expect(actual.locator('.implementation-time')).toHaveCount(0);
      else await expect(actual.locator('.implementation-time')).toHaveAttribute('aria-label', /Faktisk arbetstid:/);
    }
    expect(new Set(rightEdges).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Full-page capture changes the height media query; keep landscape snapshots at the real viewport.
    if (scenario.name === 'landscape-phone') await unread.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${scenario.name}-${combined ? 'combined' : 'split'}-list.png`), fullPage: scenario.name !== 'landscape-phone' });
    await closed.first().locator('..').screenshot({ path: info.outputPath(`${scenario.name}-${combined ? 'combined' : 'split'}-closed.png`) });
    if (compact) {
      await unread.locator('.row-title').tap();
      const popup = page.locator('.row-popup');
      await expect(popup).toBeVisible();
      await expect(popup.locator('.issue-time-remaining')).toBeVisible();
      await expect(popup).toContainText('a-very-long-workflow-label-that-must-not-wrap');
      const bounds = (await popup.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(scenario.height);
      await page.screenshot({ path: info.outputPath(`${scenario.name}-${combined ? 'combined' : 'split'}-popup.png`) });
      await page.locator('.row-popup-close').tap();
      await expect(popup).toHaveCount(0);
      expect((await unread.boundingBox())!.height).toBeLessThanOrEqual(60);
    } else {
      await unread.locator('.row-title').click();
      await expect(unread.locator('.row-card')).toBeVisible();
      await expect(page.locator('.row-popup')).toHaveCount(0);
      await unread.locator('.row-title').click();
    }
    await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Kort', exact: true }).click();
    await expect(page.locator('.issue-card.closed .implementation-time')).toHaveCount(4);
    await expect(page.locator('.issue-card.closed').filter({ hasText: 'Closed twelve' }).locator('.implementation-time')).toContainText('↑');
    await expect(page.locator('.issue-card.closed').filter({ hasText: 'Closed none' }).locator('.implementation-time')).toContainText('↓');
    await expect(page.locator('.issue-card.closed').filter({ hasText: 'Closed unknown start' }).locator('.implementation-time')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (scenario.name === 'landscape-phone') await page.locator('.issue-card.closed').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${scenario.name}-${combined ? 'combined' : 'split'}-cards.png`), fullPage: scenario.name !== 'landscape-phone' });
  });
});


test('shared time column stays empty when repository history is insufficient', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.getByRole('textbox', { name: `Filtrera issues i ${repo.full_name}`, exact: true }).fill('Backlog');
  const rows = page.locator('.issue-row');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('.issue-time-estimate,.issue-time-remaining')).toHaveCount(0);
  await expect(rows.first().locator('.row-time')).toContainText(/−3 d/);
  expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(60);
});
