import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const repos = [
  { id: 911, name: "booster-ai", full_name: "sample/booster-ai", description: "Short name", private: false, html_url: "https://github.com/sample/booster-ai", owner: { login: "sample" } },
  { id: 912, name: "untappdbolaget", full_name: "sample/untappdbolaget", description: "Medium name", private: false, html_url: "https://github.com/sample/untappdbolaget", owner: { login: "sample" } },
  { id: 913, name: "github-dashboard", full_name: "sample/github-dashboard", description: "Standard name", private: false, html_url: "https://github.com/sample/github-dashboard", owner: { login: "sample" } },
  { id: 914, name: "lunden-3d-apartment-with-a-very-long-repository-name", full_name: "sample/lunden-3d-apartment-with-a-very-long-repository-name", description: "Long name", private: false, html_url: "https://github.com/sample/lunden-3d-apartment-with-a-very-long-repository-name", owner: { login: "sample" } },
];

const now = Date.now();
const created = new Date(now - 86_400_000 * 2).toISOString();
const recent = new Date(now - 3_600_000).toISOString();
const closed = new Date(now - 1_800_000).toISOString();

const issues = [
  { id: 1, number: 101, title: "Booster backlog task", state: "open", repo: repos[0]!, labels: ["sp-4", "a-very-long-label-that-must-share-space-with-the-more-control", "another-long-workflow-label", "third-workflow-label", "fourth-workflow-label"].map(name => ({ name, color: "a2eeef" })) },
  { id: 2, number: 201, title: "Untappd active progress task", state: "open", repo: repos[1]!, labels: [{ name: "in progress", color: "fbca04" }], startedAt: new Date(now - 1_800_000).toISOString() },
  { id: 3, number: 301, title: "Dashboard timeout overrun task", state: "open", repo: repos[2]!, labels: [{ name: "in progress", color: "fbca04" }], startedAt: new Date(now - 7_200_000).toISOString() },
  { id: 4, number: 401, title: "Lunden finished work task", state: "closed", repo: repos[3]!, labels: [{ name: "bug", color: "d73a4a" }], closed_at: closed, startedAt: new Date(now - 3_600_000).toISOString() },
  { id: 5, number: 302, title: "Dashboard second backlog task", state: "open", repo: repos[2]!, labels: [{ name: "priority: high", color: "b60205" }] },
].map(issue => ({
  id: issue.id,
  number: issue.number,
  title: issue.title,
  state: issue.state,
  body: "Layout fixture description for list chip alignment verification.",
  comments: 2,
  created_at: created,
  updated_at: recent,
  closed_at: issue.closed_at ?? null,
  startedAt: issue.startedAt,
  html_url: `${issue.repo.html_url}/issues/${issue.number}`,
  assignees: [],
  labels: issue.labels,
}));

async function mockApi(page: Page) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues")) {
      const pathRepo = repos.find(r => url.pathname.startsWith(`/repos/${r.full_name}/`));
      const state = url.searchParams.get("state");
      const list = pathRepo ? issues.filter(i => i.html_url.startsWith(pathRepo.html_url + "/issues/") && (state === "all" || (state === "closed") === (i.state === "closed"))) : [];
      return route.fulfill({ json: list });
    }
    if (/\/issues\/301\/events$/.test(url.pathname)) {
      return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in progress" }, created_at: new Date(now - 7_200_000).toISOString() }] });
    }
    if (/\/issues\/201\/events$/.test(url.pathname)) {
      return route.fulfill({ json: [{ id: 2, event: "labeled", label: { name: "in progress" }, created_at: new Date(now - 1_800_000).toISOString() }] });
    }
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
}

async function setupPage(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-chip-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) {
    await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  }
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(5);
}

const scenarios = [
  { name: "wide-desktop", width: 1600, height: 1000, mobile: false, theme: "light" as const },
  { name: "narrow-desktop", width: 1000, height: 900, mobile: false, theme: "dark" as const },
  { name: "portrait-phone", width: 390, height: 844, mobile: true, theme: "light" as const },
  { name: "landscape-phone", width: 844, height: 390, mobile: true, theme: "dark" as const },
  { name: "tiny-phone", width: 320, height: 568, mobile: true, theme: "light" as const },
];

for (const scenario of scenarios) {
  test.describe(`list chip and column alignment (${scenario.name})`, () => {
    test.use({
      viewport: { width: scenario.width, height: scenario.height },
      isMobile: scenario.mobile,
      hasTouch: scenario.mobile,
    });

    for (const split of [false, true]) {
      test(`verifies chip bounds and column alignment (split: ${split}, theme: ${scenario.theme})`, async ({ page }) => {
        await mockApi(page);
        await setupPage(page);

        // Configure theme
        await page.emulateMedia({ colorScheme: scenario.theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", scenario.theme === "dark" ? "dark" : "light");

        // Set split checkbox
        const splitCheckbox = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
        if (split) await splitCheckbox.check();
        else await splitCheckbox.uncheck();

        // Switch to List mode
        const listBtn = page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true });
        await listBtn.click();
        await expect(page.locator(".issue-row")).toHaveCount(5);

        // Verify no horizontal overflow
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        const rows = page.locator(".issue-row");

        // Visible control bounds must survive every clipping ancestor, not merely
        // have a bounding box somewhere outside the metadata region (#342).
        const geometry = await rows.evaluateAll(elements => elements.map(row => {
          const bounds = row.getBoundingClientRect();
          const clipped = [...row.querySelectorAll<HTMLElement>(".issue-points,.row-status,.priority,.row-marker,.row-repository,.row-meta .label,.row-time,.row-outcome,.row-comments")].flatMap(item => {
            const box = item.getBoundingClientRect();
            if (!box.width || !box.height) return [];
            const failures = [];
            for (let ancestor = item.parentElement; ancestor && ancestor !== row.parentElement; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor), parent = ancestor.getBoundingClientRect();
              if ([style.overflowX, style.overflowY].some(value => /hidden|clip|auto|scroll/.test(value)) &&
                (box.left < parent.left - 1 || box.right > parent.right + 1 || box.top < parent.top - 1 || box.bottom > parent.bottom + 1)) {
                failures.push(`${item.className} outside ${ancestor.className}`);
              }
            }
            return failures;
          });
          const meta = row.querySelector(".row-meta")?.getBoundingClientRect();
          const points = row.querySelector(".issue-points")!.getBoundingClientRect();
          const chip = row.querySelector<HTMLElement>(".row-repository");
          const name = chip?.querySelector<HTMLElement>(".row-repository-name");
          const trailing = chip && name && name.getBoundingClientRect().width && name.scrollWidth <= name.clientWidth
            ? chip.getBoundingClientRect().right - name.getBoundingClientRect().right : null;
          return { trailing, height: bounds.height, meta: meta && { left: meta.left, right: meta.right }, points: { left: points.left, right: points.right }, clipped };
        }));
        for (const row of geometry) {
          expect(row.clipped).toEqual([]);
          if (row.trailing !== null) expect(row.trailing).toBeLessThanOrEqual(8);
        }
        if (process.env.EVIDENCE_DIR) {
          writeFileSync(`${process.env.EVIDENCE_DIR}/geometry-${scenario.name}-${split ? "split" : "combined"}.json`, JSON.stringify(geometry, null, 2));
          await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/alignment-${scenario.name}-${split ? "split" : "combined"}.png` });
        }

        if (!split && !scenario.mobile) {
          // Acceptance Criterion 1:
          // The chip's visible background and border end at most --space-2 (8px) after text for fitting names.
          // booster-ai:
          const boosterRow = rows.filter({ hasText: "Booster backlog task" }).first();
          const boosterChip = boosterRow.locator(".row-repository");
          const boosterSlot = boosterRow.locator(".row-slot-repository");
          await expect(boosterChip).toBeVisible();
          await expect(boosterSlot).toBeVisible();

          const boosterChipBox = (await boosterChip.boundingBox())!;
          const boosterSlotBox = (await boosterSlot.boundingBox())!;
          const boosterNameBox = (await boosterChip.locator(".row-repository-name").boundingBox())!;

          // Chip hugs text: chip width is text width + dot/padding + <= 8px (--space-2)
          // The slot container is fixed width (approx 136px / 8.5rem), while chip is ~80px.
          expect(boosterChipBox.width).toBeLessThan(boosterSlotBox.width - 20);
          expect(boosterChipBox.x + boosterChipBox.width - (boosterNameBox.x + boosterNameBox.width)).toBeLessThanOrEqual(8);

          // Long name: lunden-3d-... truncates with ellipsis, full text in title and sr-only
          const lundenRow = rows.filter({ hasText: "Lunden finished work task" }).first();
          const lundenChip = lundenRow.locator(".row-repository");
          await expect(lundenChip).toHaveAttribute("title", repos[3]!.full_name);
          await expect(lundenChip.locator(".sr-only")).toHaveText(repos[3]!.full_name);
          const lundenChipBox = (await lundenChip.boundingBox())!;
          expect(lundenChipBox.width).toBeLessThanOrEqual(boosterSlotBox.width + 1);

          // Acceptance Criterion 2:
          // Status, priority, SP, comments, and time line up ±1px between rows with different repository name lengths
          // and with/without Timeout.
          const untappdRow = rows.filter({ hasText: "Untappd active progress task" }).first();
          const timeoutRow = rows.filter({ hasText: "Dashboard timeout overrun task" }).first();
          const dashboardRow = rows.filter({ hasText: "Dashboard second backlog task" }).first();

          // Status alignment (Untappd, Timeout row, Dashboard row, Booster row)
          const statusXs = await Promise.all([
            boosterRow.locator(".row-status").boundingBox().then(b => Math.round(b!.x)),
            untappdRow.locator(".row-status").boundingBox().then(b => Math.round(b!.x)),
            timeoutRow.locator(".row-status").boundingBox().then(b => Math.round(b!.x)),
            dashboardRow.locator(".row-status").boundingBox().then(b => Math.round(b!.x)),
          ]);
          const uniqueStatusXs = new Set(statusXs);
          expect(uniqueStatusXs.size, `Status X positions: ${statusXs}`).toBe(1);

          // Priority alignment (across open rows)
          const priorityXs = await Promise.all([
            boosterRow.locator(".row-slot-priority").boundingBox().then(b => Math.round(b!.x)),
            untappdRow.locator(".row-slot-priority").boundingBox().then(b => Math.round(b!.x)),
            timeoutRow.locator(".row-slot-priority").boundingBox().then(b => Math.round(b!.x)),
            dashboardRow.locator(".row-slot-priority").boundingBox().then(b => Math.round(b!.x)),
          ]);
          const uniquePriorityXs = new Set(priorityXs);
          expect(uniquePriorityXs.size, `Priority X positions: ${priorityXs}`).toBe(1);

          // Story points alignment
          const spXs = await Promise.all([
            boosterRow.locator(".issue-points").boundingBox().then(b => Math.round(b!.x)),
            untappdRow.locator(".issue-points").boundingBox().then(b => Math.round(b!.x)),
            timeoutRow.locator(".issue-points").boundingBox().then(b => Math.round(b!.x)),
            dashboardRow.locator(".issue-points").boundingBox().then(b => Math.round(b!.x)),
          ]);
          const uniqueSpXs = new Set(spXs);
          expect(uniqueSpXs.size, `SP X positions: ${spXs}`).toBe(1);

          // Comments alignment (when comment column fits on desktop)
          if (await boosterRow.locator(".row-comments").isVisible()) {
            const commentXs = await Promise.all([
              boosterRow.locator(".row-comments .comment-count svg").boundingBox().then(b => Math.round(b!.x)),
              untappdRow.locator(".row-comments .comment-count svg").boundingBox().then(b => Math.round(b!.x)),
              timeoutRow.locator(".row-comments .comment-count svg").boundingBox().then(b => Math.round(b!.x)),
              dashboardRow.locator(".row-comments .comment-count svg").boundingBox().then(b => Math.round(b!.x)),
            ]);
            const uniqueCommentXs = new Set(commentXs);
            expect(uniqueCommentXs.size, `Comment X positions: ${commentXs}`).toBe(1);
          }

          // Time alignment
          const timeXs = await Promise.all([
            boosterRow.locator(".row-time").boundingBox().then(b => Math.round(b!.x)),
            untappdRow.locator(".row-time").boundingBox().then(b => Math.round(b!.x)),
            timeoutRow.locator(".row-time").boundingBox().then(b => Math.round(b!.x)),
            dashboardRow.locator(".row-time").boundingBox().then(b => Math.round(b!.x)),
          ]);
          const uniqueTimeXs = new Set(timeXs);
          expect(uniqueTimeXs.size, `Time X positions: ${timeXs}`).toBe(1);

          // Acceptance Criterion 3:
          // Row height does not increase
          const heights = await Promise.all([
            boosterRow.boundingBox().then(b => b!.height),
            untappdRow.boundingBox().then(b => b!.height),
            timeoutRow.boundingBox().then(b => b!.height),
            dashboardRow.boundingBox().then(b => b!.height),
            lundenRow.boundingBox().then(b => b!.height),
          ]);
          const maxHeight = scenario.name === "wide-desktop" ? 44 : 60;
          for (const h of heights) {
            expect(h).toBeLessThanOrEqual(maxHeight);
          }
        }

        // On mobile, verify rows remain dense (<= 60px) and no horizontal page scroll
        if (scenario.mobile) {
          for (let i = 0; i < 5; i++) {
            const h = (await rows.nth(i).boundingBox())!.height;
            expect(h).toBeLessThanOrEqual(60);
          }
        }
      });
    }
  });
}
