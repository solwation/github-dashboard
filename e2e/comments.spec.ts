import { expect, test, type Page, type Route } from "@playwright/test";

const repo = { id: 89, name: "comment-project", full_name: "sample/comment-project", description: "Comments fixture", private: true, html_url: "https://github.com/sample/comment-project", owner: { login: "sample" } };
const timestamp = "2026-10-15T12:00:00Z";
function comment(id: number, body: string) {
  return { id, body, html_url: `https://github.com/sample/comment-project/issues/1#issuecomment-${id}`, created_at: timestamp, user: { login: "fictional-author" } };
}
async function connect(page: Page, onComments: (route: Route, url: URL) => Promise<void>) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/comments")) return onComments(route, url);
    let result: unknown = [];
    if (url.pathname === "/user") result = { login: "sample", avatar_url: "https://github.com/identicons/sample.png" };
    else if (url.pathname === "/user/repos") result = [repo];
    else if (url.pathname.endsWith("/issues") && ["open", "all"].includes(url.searchParams.get("state") || "")) result = [{ id: 891, number: 1, title: "Commented task", comments: 102, html_url: "https://github.com/sample/comment-project/issues/1", state: "open", created_at: timestamp, updated_at: timestamp, closed_at: null, labels: [], assignees: [] }];
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-comments-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByLabel("sample/comment-project").check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.getByRole("button", { name: "102 kommentarer" })).toBeVisible();
}

test("loads comments only on click, retries errors, paginates and renders safe Markdown on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await connect(page, async (route, url) => {
    requests++;
    expect(route.request().headers().authorization).toBe("Bearer fictional-comments-token");
    if (requests === 1) {
      await pending;
      await route.fulfill({ status: 403, json: {} });
    } else if (url.searchParams.get("page") === "2") {
      await route.fulfill({ json: [comment(102, "Last paginated comment")] });
    } else {
      await route.fulfill({ json: [comment(1, ['## Comment plan', '**Readable** [link](https://github.com)', '```ts', `const long = '${"a".repeat(600)}';`, '```', '<img src=x onerror="window.commentsUnsafe=true">', '<script>window.commentsUnsafe=true</script>', '[unsafe](javascript:alert(1))'].join('\n\n'))], headers: { Link: '<https://api.github.com/repos/sample/comment-project/issues/1/comments?per_page=100&page=2>; rel="next"', 'Access-Control-Expose-Headers': 'Link' } });
    }
  });
  expect(requests).toBe(0);
  const trigger = page.getByRole("button", { name: "102 kommentarer" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Kommentarer för #1" });
  await expect(dialog.getByText("Hämtar kommentarer…")).toBeVisible();
  release();
  await expect(dialog.getByRole("alert")).toContainText("Kommentarerna kunde inte hämtas");
  await dialog.getByRole("button", { name: "Försök igen" }).click();
  await expect(dialog.getByRole("heading", { name: "Comment plan" })).toBeVisible();
  await expect(dialog.getByText("Last paginated comment")).toBeVisible();
  expect(requests).toBe(3);
  await expect(dialog.getByText("fictional-author", { exact: true })).toHaveCount(2);
  await expect(dialog.locator("time").first()).toHaveAttribute("datetime", timestamp);
  await expect(dialog.getByRole("link", { name: "Visa på GitHub" }).first()).toHaveAttribute("href", /#issuecomment-1$/);
  await expect(dialog.locator("script, img, a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { commentsUnsafe?: boolean }).commentsUnsafe)).toBeUndefined();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await dialog.locator("pre").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("Last paginated comment");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("closing discards in-flight comments and a later open loads fresh results, including empty state", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await connect(page, async route => {
    requests++;
    if (requests === 1) {
      await pending;
      await route.fulfill({ json: [comment(1, "Stale private comment")] });
    } else await route.fulfill({ json: [] });
  });
  const trigger = page.getByRole("button", { name: "102 kommentarer" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Hämtar kommentarer…")).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await dialog.getByRole("button", { name: "Stäng kommentarer" }).click();
  await trigger.click();
  await expect(dialog.getByText("Inga kommentarer ännu.")).toBeVisible();
  const staleResponse = page.waitForResponse(response => response.url().includes("/comments"));
  release();
  await (await staleResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(dialog.getByText("Stale private comment")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Stäng kommentarer" }).click();
  await expect(page.getByText("Stale private comment")).toHaveCount(0);
});

test("demo explains comments in English without making GitHub requests", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("issueflow-language", "en"));
  let requests = 0;
  await page.route("https://api.github.com/**", async route => { requests++; await route.fulfill({ json: [] }); });
  await page.goto("/");
  await page.getByRole("button", { name: /demo/i }).click();
  await page.getByRole("button", { name: /\d+ comments$/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Comments are not shown in the demo. Connect GitHub to read your issue discussions.");
  await dialog.getByRole("button", { name: "Close comments" }).click();
  expect(requests).toBe(0);
});

test("a pending private comment response cannot appear after logout and switching to demo", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await connect(page, async route => {
    requested = true;
    await pending;
    await route.fulfill({ json: [comment(1, "Previous account private comment")] });
  });
  await page.getByRole("button", { name: "102 kommentarer" }).click();
  await expect.poll(() => requested).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await page.getByRole("button", { name: /Utforska en demo/ }).click();
  await page.getByRole("button", { name: /\d+ kommentarer$/ }).first().click();
  const response = page.waitForResponse(result => result.url().includes("/comments"));
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole("dialog")).toContainText("Kommentarer visas inte i demon.");
  await expect(page.getByText("Previous account private comment")).toHaveCount(0);
});

test("an open discussion survives background synchronization of the same issue", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await connect(page, async route => {
    requests++;
    await route.fulfill({ json: [comment(1, "Keep reading this discussion")] });
  });
  await page.getByRole("button", { name: "102 kommentarer" }).click();
  const dialog = page.getByRole("dialog", { name: "Kommentarer för #1" });
  await expect(dialog.getByText("Keep reading this discussion")).toBeVisible();
  const original = await dialog.locator(".issue-comment").elementHandle();
  const synced = page.waitForResponse(response => response.url().includes("/issues?") && response.url().includes("state=all"));
  await page.clock.fastForward(301000);
  await synced;
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Keep reading this discussion")).toBeVisible();
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  expect(requests).toBe(1);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
  test(`many comments scroll inside the rounded dialog at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('https://example.test/wide.png', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="300"><rect width="2400" height="300" fill="blue"/></svg>',
    }));
    await connect(page, async route => {
      const body = [
        'Long discussion text '.repeat(12),
        '```ts\nconst long = "' + 'code'.repeat(200) + '";\n```',
        '![Wide fixture](https://example.test/wide.png)',
        '[Long link](https://example.test/' + 'long'.repeat(100) + ')',
        'https://example.test/' + 'unbroken'.repeat(100),
      ].join('\n\n');
      await route.fulfill({ json: Array.from({ length: 30 }, (_, index) => comment(index + 1, index === 29 ? 'Final discussion comment' : body)) });
    });
    const trigger = page.getByRole('button', { name: '102 kommentarer' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Kommentarer för #1' });
    const body = dialog.locator('.comments-body');
    const close = dialog.getByRole('button', { name: 'Stäng kommentarer' });
    await expect(dialog.locator('.issue-comment')).toHaveCount(30);
    await expect.poll(() => dialog.locator('img').first().evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth === 2400)).toBe(true);
    await expect(close).toBeVisible();
    await expect(close).toBeFocused();
    expect(await dialog.evaluate(element => ({
      width: element.scrollWidth <= element.clientWidth,
      height: element.scrollHeight <= element.clientHeight,
      overflow: getComputedStyle(element).overflow,
    }))).toEqual({ width: true, height: true, overflow: 'hidden' });
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const dialogBox = (await dialog.boundingBox())!;
    const bodyBox = (await body.boundingBox())!;
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
    expect(bodyBox.x).toBeGreaterThan(dialogBox.x);
    expect(bodyBox.x + bodyBox.width).toBeLessThan(dialogBox.x + dialogBox.width);
    expect(bodyBox.y + bodyBox.height).toBeLessThan(dialogBox.y + dialogBox.height);
    const initialCloseBox = await close.boundingBox();
    await body.focus();
    await page.keyboard.press('Control+End');
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(dialog.getByText('Final discussion comment')).toBeInViewport();
    await expect(close).toBeInViewport();
    expect(await close.boundingBox()).toEqual(initialCloseBox);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
}

test("comment times update relatively without refetching or moving the discussion, with exact timestamps retained", async ({ page }) => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  await page.clock.install({ time: new Date(now) });
  let requests = 0;
  const recent = new Date(now - 70000).toISOString();
  const old = new Date(now - 8 * 86400000).toISOString();
  await connect(page, async route => {
    requests++;
    await route.fulfill({ json: Array.from({ length: 12 }, (_, index) => ({
      ...comment(index + 1, "A comment with enough discussion to scroll.\n\n".repeat(6)),
      created_at: index === 11 ? old : recent,
    })) });
  });
  await page.getByRole("button", { name: "102 kommentarer" }).click();
  const dialog = page.getByRole("dialog", { name: "Kommentarer för #1" });
  const time = dialog.locator("time").first();
  await expect(time).toContainText("1 min");
  await expect(time).toHaveAttribute("datetime", recent);
  const exact = await page.evaluate(value => new Date(value).toLocaleString("sv-SE"), recent);
  await expect(time).toHaveAttribute("title", exact);
  await expect(time).toHaveAttribute("aria-label", exact);
  await expect(dialog.locator("time").last()).toHaveText(await page.evaluate(value => new Date(value).toLocaleString("sv-SE"), old));
  const scroll = dialog.locator(".comments-body");
  const before = await scroll.evaluate(element => { element.scrollTop = 150; return element.scrollTop; });
  await page.clock.fastForward(60000);
  await expect(time).toContainText("2 min");
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(before);
  expect(requests).toBe(1);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng kommentarer" }).click();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "102 comments", exact: true }).click();
  await expect(page.locator(".comments-dialog time").first()).toHaveText(/^2\s+min\.? ago$/);
  expect(requests).toBe(2);
});

test("newest comments lead across API pages with stable ties and invalid timestamps last", async ({ page }) => {
  const dated = (id: number, created_at: string) => ({ ...comment(id, `Message ${id}`), created_at });
  await connect(page, async (route, url) => {
    if (url.searchParams.get("page") === "2") return route.fulfill({ json: [
      dated(4, "2026-10-16T12:00:00Z"), dated(5, "2026-10-16T12:00:00Z"), dated(6, "invalid"),
    ] });
    await route.fulfill({ json: [dated(1, "2026-10-14T12:00:00Z"), dated(2, "2026-10-15T12:00:00Z"), dated(3, "invalid")],
      headers: { Link: '<https://api.github.com/repos/sample/comment-project/issues/1/comments?per_page=100&page=2>; rel="next"', 'Access-Control-Expose-Headers': 'Link' } });
  });
  await page.getByRole("button", { name: "102 kommentarer" }).click();
  const discussion = page.locator(".comments-dialog");
  await expect(discussion.locator(".comment-markdown")).toHaveText(["Message 4", "Message 5", "Message 2", "Message 1", "Message 3", "Message 6"]);
  await expect(discussion.locator(".comments-body")).toHaveJSProperty("scrollTop", 0);
  await expect(discussion.locator("time").first()).toHaveAttribute("datetime", "2026-10-16T12:00:00Z");
});
