import { expect, test } from "@playwright/test";

const repo = { id: 290, name: "age-fixture", full_name: "sample/age-fixture", description: "Fictional age fixture", private: true, html_url: "https://github.com/sample/age-fixture", owner: { login: "sample" } };
const old = new Date(Date.now() - 3 * 86400000).toISOString();
const recent = new Date(Date.now() - 3600000).toISOString();
const issues = [
  { id: 1, number: 1, title: "Backlog age fixture", comments: 0, body: "", state: "open", labels: [], assignees: [], created_at: old, updated_at: old, closed_at: null, html_url: `${repo.html_url}/issues/1` },
  { id: 2, number: 2, title: "Closed age fixture", comments: 0, body: "", state: "closed", labels: [], assignees: [], created_at: old, updated_at: recent, closed_at: recent, html_url: `${repo.html_url}/issues/2` },
];

for (const language of [
  { locale: "en-US", age: /^3(?:d| days) ago$/, redundant: "Created ", connect: "Connect GitHub", account: "Connect account", overview: "Show overview", group: "Board view mode", list: "List" },
  { locale: "sv-SE", age: /−3 d$/, redundant: "Skapad ", connect: "Anslut GitHub", account: "Anslut konto", overview: "Visa översikt", group: "Visningsläge för boarden", list: "Lista" },
]) {
  test.describe(language.locale, () => {
    test.use({ locale: language.locale });

    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      test(`backlog age uses compact metadata at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route("https://api.github.com/**", async route => {
          const url = new URL(route.request().url());
          if (url.pathname === "/user") return route.fulfill({ json: { login: "age-fixture", avatar_url: "" } });
          if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
          if (url.pathname.endsWith("/issues")) {
            const state = url.searchParams.get("state");
            return route.fulfill({ json: issues.filter(issue => state === "all" || issue.state === state) });
          }
          return route.fulfill({ json: [] });
        });
        await page.goto("/");
        await page.getByRole("button", { name: language.connect, exact: true }).click();
        await page.getByLabel("GitHub personal access token").fill("fictional-age-token");
        await page.getByRole("button", { name: language.account, exact: true }).click();
        await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
        await page.getByRole("button", { name: language.overview, exact: true }).click();
        await page.getByRole("group", { name: language.group, exact: true })
          .getByRole("button", { name: language.list, exact: true }).click();
        const age = page.locator(".issue-row .backlog-age").first();
        await age.scrollIntoViewIfNeeded();
        await expect(age).toBeVisible();
        await expect(age).toHaveText(language.age);
        await expect(age).not.toContainText(language.redundant);
        await expect(age).toHaveJSProperty("tagName", "TIME");
        const timestamp = await age.getAttribute("datetime");
        expect(Number.isFinite(Date.parse(timestamp!))).toBe(true);
        expect(await age.getAttribute("title")).toBeTruthy();

        const metadataStyle = (element: Element) => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, color: style.color };
        };
        const ageStyle = await age.evaluate(metadataStyle);
        expect(ageStyle.color).toBe("rgb(89, 102, 107)");
        expect(parseFloat(ageStyle.fontSize)).toBeLessThanOrEqual(11);
        const titleSize = await page.locator(".issue-row.backlog .row-title").first()
          .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        expect(parseFloat(ageStyle.fontSize)).toBeLessThan(titleSize);
      });
    }
  });
}
