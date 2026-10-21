import { expect, test, type Page } from "@playwright/test";

const repo = { id: 190, name: "list-align", full_name: "sample/list-align", description: "Fictional list alignment fixture", private: true, html_url: "https://github.com/sample/list-align", owner: { login: "sample" } };

async function fixture(page: Page, longTitle = false, outcomes: boolean | "interrupted" = false) {
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
  const closedMinutes = (index: number) => outcomes === "interrupted" ? [900, 45, 60, 75][index - 6] ?? 30 : outcomes && index === 6 ? 60 : outcomes && index === 7 ? 15 : 30;
  const issues = specs.map(([title, comments, status, state, labels], index) => ({
    id: index + 1, number: index + 1, title: longTitle && index === 0 ? "A very long issue title that must remain on one compact line while the full title stays available in the card" : title, comments, body: "", state, created_at: old, updated_at: recent, closed_at: state === "closed" ? recent : null,
    html_url: `${repo.html_url}/issues/${index + 1}`, assignees: [],
    startedAt: state === "closed" ? new Date(now - 3600000 - closedMinutes(index) * 60000).toISOString() : undefined,
    labels: [...(status ? [{ name: status, color: "fbca04" }] : []), ...[...labels, "ui"].map(name => ({ name, color: "a2eeef" }))],
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "list-align-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) {
      const closed = url.searchParams.get("state") === "closed";
      return route.fulfill({ json: issues.filter(issue => (issue.state === "closed") === closed || url.searchParams.get("state") === "all") });
    }
    if (/\/issues\/(?:1|5)\/events$/.test(url.pathname)) return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in progress" }, created_at: new Date(now - 10 * 60000).toISOString() }] });
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-align-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
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
  await expect(over.locator('.closed-date')).toBeHidden();
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
