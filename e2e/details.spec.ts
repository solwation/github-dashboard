import { expect, test } from "@playwright/test";

for (const scenario of [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "narrow", width: 1000, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "landscape", width: 844, height: 390, mobile: true },
]) for (const mode of ["Kort", "Lista"]) {
  test(`safe descriptions and image links ${scenario.name} ${mode}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: scenario, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: "sv-SE" });
    const page = await context.newPage();
    const repo = { id: 88, name: "details-project", full_name: "sample/details-project", description: "Issue details fixture", private: true, html_url: "https://github.com/sample/details-project", owner: { login: "sample" } };
    const timestamp = new Date().toISOString();
    const body = [
      "<!-- hidden internal marker\n\nprivate automation marker -->", "", "## Implementation plan", "", "**Important** and [GitHub](https://github.com).", "",
      "- [x] Completed step", "- [ ] Remaining step", "", "```ts", `const longLine = '${"a".repeat(600)}';`, "```", "",
      '<script>window.issueScriptExecuted = true</script>',
      '<img src=x onerror="window.issueScriptExecuted = true">',
      "", "[Reference image](https://github.com/sample/details-project/blob/main/docs/reference.jpg)", "", "![Original report](https://github.com/sample/details-project/blob/main/docs/report.png)",
    ].join("\n");
    await page.route("https://github.com/sample/details-project/blob/main/docs/*", async route => {
      if (new URL(route.request().url()).searchParams.get("raw") !== "true") {
        await route.fulfill({ contentType: "text/html", body: "<html>File viewer</html>" });
        return;
      }
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#287f83"/><circle cx="320" cy="200" r="140" fill="#edbf58"/></svg>' });
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
    await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: mode, exact: true }).click();
    if (mode === "Lista") await page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "Detailed task", exact: true }) }).locator(".row-title").click();
    const card = mode === "Kort" ? page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Detailed task" }) }) : page.locator(".issue-card").filter({ visible: true }).first();
    await expect(card.getByRole("button", { name: "7 kommentarer" })).toBeVisible();
    if (mode === "Kort") {
      await expect(card.getByRole("heading", { name: "Implementation plan" })).toHaveCount(0);
      await card.getByRole("button", { name: "Läs mer", exact: true }).focus();
      await page.keyboard.press("Enter");
    }
    if (mode === "Kort") await expect(card.getByRole("button", { name: "Visa mindre", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByRole("heading", { name: "Implementation plan" })).toBeVisible();
    await expect(card.locator(".issue-markdown")).not.toContainText("internal marker");
    await expect(card.locator(".issue-markdown")).not.toContainText("automation marker");
    await expect(card.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(card.locator('input[type="checkbox"]').first()).toBeChecked();
    await expect(card.locator('input[type="checkbox"]').first()).toBeDisabled();
    await expect(card.locator("pre code")).toContainText("const longLine");
    await expect(card.locator(".issue-markdown a").first()).toHaveAttribute("rel", "noopener noreferrer");
    await expect(card.locator(".issue-markdown script, .issue-markdown img[onerror]")).toHaveCount(0);
    const reportImage = card.getByRole("button", { name: "Öppna bild: Original report" });
    await expect(reportImage).toHaveAttribute("src", "https://github.com/sample/details-project/blob/main/docs/report.png?raw=true");
    await expect.poll(() => reportImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(640);
    expect((await reportImage.boundingBox())!.width).toBeLessThanOrEqual(240);
    await expect(card.getByRole("heading", { name: "Implementation plan" })).toHaveCSS("font-size", "15.2px");
    expect(await page.evaluate(() => (window as Window & { issueScriptExecuted?: boolean }).issueScriptExecuted)).toBeUndefined();
    const reference = card.getByRole("link", { name: "Reference image", exact: true });
    await expect(reference).toHaveAttribute("href", "https://github.com/sample/details-project/blob/main/docs/reference.jpg");
    await reference.click();
    const viewer = page.getByRole("dialog", { name: "Bildvisare", exact: true });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("img")).toHaveAttribute("src", "https://github.com/sample/details-project/blob/main/docs/reference.jpg?raw=true");
    await expect(viewer.locator("img")).toHaveJSProperty("naturalWidth", 640);
    await page.screenshot({ path: testInfo.outputPath("reference-viewer.png") });
    await page.keyboard.press("Escape");
    await expect(reference).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "Stäng bild", exact: true }).click();
    await expect(card.getByRole("link", { name: "GitHub", exact: true })).not.toHaveAttribute("data-image-src");
    await page.screenshot({ path: testInfo.outputPath("description.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await card.locator("pre").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    if (mode === "Kort") {
      await card.getByRole("button", { name: "Visa mindre", exact: true }).click();
      await expect(card.getByRole("button", { name: "Läs mer", exact: true })).toHaveAttribute("aria-expanded", "false");
      await expect(card.locator(".details-panel")).toHaveCount(0);
    } else if (scenario.mobile) await page.keyboard.press("Escape");
    else await page.locator(".row-title").filter({ hasText: "Detailed task" }).click();
    if (mode === "Lista") await page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "Empty task", exact: true }) }).locator(".row-title").click();
    const empty = mode === "Kort" ? page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Empty task" }) }) : page.locator(".issue-card").filter({ visible: true }).first();
    await expect(empty.getByRole("button", { name: "0 kommentarer" })).toBeVisible();
    if (mode === "Kort") await empty.getByRole("button", { name: "Läs mer", exact: true }).click();
    await expect(empty.getByText("Ingen beskrivning har lagts till.")).toBeVisible();
    await context.close();
  });
}
