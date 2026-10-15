import { expect, test } from "@playwright/test";
test("demo works at desktop and mobile widths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Alla dina projekt/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
  await expect(page.locator(".timer").first()).toContainText("h");
  await page.getByRole("textbox", { name: "Sök issues" }).fill("tangentbord");
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Sök issues" }).fill("");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".repo-lane").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("connect, select, fetch events, customize work label, preserve data on API failure, logout", async ({
  page,
}) => {
  const repo = {
    id: 55,
    name: "sample-project",
    full_name: "sample/sample-project",
    description: "Fictional API fixture",
    private: true,
    html_url: "https://github.com/sample/sample-project",
    owner: { login: "sample" },
  };
  const now = new Date().toISOString();
  let fail = false;
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/user")
      body = {
        login: "sample",
        avatar_url: "https://github.com/identicons/sample.png",
      };
    else if (url.pathname === "/user/repos") body = [repo];
    else if (fail) return route.fulfill({ status: 500, body: "{}" });
    else if (url.pathname.endsWith("/labels"))
      body = [{ name: "Building", color: "fbca04" }];
    else if (url.pathname.endsWith("/events"))
      body = [
        {
          id: 1,
          event: "labeled",
          created_at: new Date(Date.now() - 7200000).toISOString(),
          label: { name: "Building" },
        },
      ];
    else if (url.searchParams.get("state") === "open")
      body = [
        {
          id: 1,
          number: 1,
          title: "First task",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null,
          html_url: "https://github.com/sample/sample-project/issues/1",
          assignees: [],
          labels: [
            { name: "Building", color: "fbca04" },
            { name: "high priority", color: "f00" },
          ],
        },
      ];
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page
    .getByLabel("GitHub personal access token")
    .fill("fictional-test-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("sample/sample-project").check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".backlog .issue-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Anpassa labels för sample-project" })
    .click();
  await page.getByLabel("Pågående arbete").fill("Building");
  await page.getByRole("button", { name: "Spara och hämta igen" }).click();
  await expect(page.locator(".progress .issue-card")).toHaveCount(1);
  await expect(page.locator(".timer")).toContainText("2h");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fictional-test-token",
  );
  fail = true;
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("500");
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Anslut GitHub" }),
  ).toBeVisible();
});
