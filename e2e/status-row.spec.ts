import { expect, test, type Page } from "@playwright/test";

const copy = {
  sv: { connect: "Anslut GitHub", account: "Anslut konto", overview: "Visa översikt", busy: "Hämtar…", updated: /^Uppdaterad \d/ },
  en: { connect: "Connect GitHub", account: "Connect account", overview: "Show overview", busy: "Loading…", updated: /^Updated \d/ },
};

async function connect(page: Page, text: (typeof copy)["sv"]) {
  let gate: Promise<void> | undefined;
  let release = () => {};
  const repos = ["alpha", "beta"].map((name, index) => ({
    id: index + 1, name, full_name: `sample/${name}`, private: false,
    html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "status-row-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = repos;
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      await gate;
      const date = new Date().toISOString();
      data = [{ id: 1, number: 1, title: "Stable status row", body: "Fixture", comments: 0, state: "open",
        labels: [], assignees: [], created_at: date, updated_at: date, closed_at: null,
        html_url: "https://github.com/sample/alpha/issues/1" }];
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: text.connect, exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-status-token");
  await page.getByRole("button", { name: text.account, exact: true }).click();
  for (const repo of repos) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: text.overview }).click();
  await expect(page.locator(".issue-title")).toHaveCount(2);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  return {
    pause: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => { gate = undefined; release(); },
  };
}

// Document-relative layout of the status and the first repository board.
const measure = (page: Page) => page.evaluate(() => {
  const box = (selector: string) => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return { top: Math.round(rect.top + scrollY), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) };
  };
  return {
    board: box(".repo-lane").top,
    status: box(".updated"),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    toolbarOverflow: document.querySelector(".board-toolbar")!.scrollWidth - document.querySelector(".board-toolbar")!.clientWidth,
  };
});

for (const [language, text] of Object.entries(copy)) {
  test.describe(language, () => {
    test.use({ locale: language === "sv" ? "sv-SE" : "en-US" });
    test(`refresh status keeps the boards in place while it changes (${language})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 800 });
      const api = await connect(page, text);
      const status = page.getByRole("status").filter({ hasText: text.updated });
      for (const width of [375, 320, 360, 390, 412, 500, 650, 840, 1000, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(status).toBeVisible();
        const idle = await measure(page);
        api.pause();
        await page.keyboard.press("Control+r");
        await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "true");
        await expect(page.getByRole("status").filter({ hasText: text.busy })).toBeVisible();
        const busy = await measure(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`status-${language}-busy.png`) });
        api.release();
        await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
        await expect(status).toBeVisible();
        const after = await measure(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`status-${language}-updated.png`) });
        expect.soft(busy.board, `board at ${width}px while loading`).toBe(idle.board);
        expect.soft(after.board, `board at ${width}px after refresh`).toBe(idle.board);
        expect.soft(busy.status.top, `status row at ${width}px`).toBe(idle.status.top);
        expect.soft(busy.status.height, `status height at ${width}px`).toBe(idle.status.height);
        expect.soft(busy.status.right - busy.status.left, `reserved status width at ${width}px`).toBe(idle.status.right - idle.status.left);
        for (const sample of [idle, busy]) {
          // Phone widths; the logged-in top bar between 651 and ~780 px overflows independently of this row.
          if (width <= 650) expect.soft(sample.overflow, `horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);
          expect.soft(sample.toolbarOverflow, `toolbar overflow at ${width}px`).toBeLessThanOrEqual(0);
          expect.soft(sample.status.right, `status inside viewport at ${width}px`).toBeLessThanOrEqual(width);
        }
      }
      // Accessible names and status semantics are unchanged.
      const live = page.locator(".updated");
      await expect(live).toHaveAttribute("role", "status");
      await expect(live).toHaveAttribute("aria-live", "polite");
      await expect(page.getByRole("checkbox", { name: language === "sv" ? "Dölj koordinationsärenden" : "Hide coordination issues" })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: language === "sv" ? "Dela upp per repository" : "Split by repository" })).toBeVisible();
    });
  });
}
