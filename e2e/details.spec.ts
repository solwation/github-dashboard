import { expect, test } from "@playwright/test";

test("shows comment counts and expands safe Markdown inside an issue card", async ({ page }) => {
  const repo = { id: 88, name: "details-project", full_name: "sample/details-project", description: "Issue details fixture", private: true, html_url: "https://github.com/sample/details-project", owner: { login: "sample" } };
  const timestamp = new Date().toISOString();
  const body = [
    "## Implementation plan", "", "**Important** and [GitHub](https://github.com).", "",
    "- [x] Completed step", "- [ ] Remaining step", "", "```ts", `const longLine = '${"a".repeat(600)}';`, "```", "",
    '<script>window.issueScriptExecuted = true</script>',
    '<img src=x onerror="window.issueScriptExecuted = true">',
    "", "![Original report](https://github.com/sample/details-project/blob/main/docs/report.png)",
  ].join("\n");
  await page.route("https://github.com/sample/details-project/blob/main/docs/report.png*", async route => {
    if (new URL(route.request().url()).searchParams.get("raw") !== "true") {
      await route.fulfill({ contentType: "text/html", body: "<html>File viewer</html>" });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") });
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let result: unknown = [];
    if (url.pathname === "/user") result = { login: "sample", avatar_url: "https://github.com/identicons/sample.png" };
    else if (url.pathname === "/user/repos") result = [repo];
    else if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") result = [
      { id: 881, number: 1, title: "Detailed task", body, comments: 7, html_url: "https://github.com/sample/details-project/issues/1", state: "open", created_at: timestamp, updated_at: timestamp, closed_at: null, labels: [], assignees: [] },
      { id: 882, number: 2, title: "Empty task", body: null, html_url: "https://github.com/sample/details-project/issues/2", state: "open", created_at: timestamp, updated_at: timestamp, closed_at: null, labels: [], assignees: [] },
    ];
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-details-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByLabel("sample/details-project").check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  const card = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Detailed task" }) });
  await expect(card.getByRole("button", { name: "7 kommentarer" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Implementation plan" })).toHaveCount(0);
  await card.getByRole("button", { name: "Läs mer", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Visa mindre", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByRole("heading", { name: "Implementation plan" })).toBeVisible();
  await expect(card.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(card.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(card.locator('input[type="checkbox"]').first()).toBeDisabled();
  await expect(card.locator("pre code")).toContainText("const longLine");
  await expect(card.locator(".issue-markdown a")).toHaveAttribute("rel", "noopener noreferrer");
  await expect(card.locator(".issue-markdown script, .issue-markdown img[onerror]")).toHaveCount(0);
  const reportImage = card.getByRole("img", { name: "Original report" });
  await expect(reportImage).toHaveAttribute("src", "https://github.com/sample/details-project/blob/main/docs/report.png?raw=true");
  await expect.poll(() => reportImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  expect(await page.evaluate(() => (window as Window & { issueScriptExecuted?: boolean }).issueScriptExecuted)).toBeUndefined();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await card.locator("pre").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await card.getByRole("button", { name: "Visa mindre", exact: true }).click();
  await expect(card.getByRole("button", { name: "Läs mer", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator(".details-panel")).toHaveCount(0);
  const empty = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Empty task" }) });
  await expect(empty.getByRole("button", { name: "0 kommentarer" })).toBeVisible();
  await empty.getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(empty.getByText("Ingen beskrivning har lagts till.")).toBeVisible();
});
