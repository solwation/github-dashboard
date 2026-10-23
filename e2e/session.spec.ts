import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { createHandoffUrl } from "../src/lib/handoff";
import { openSettings } from "./support/phone-menu";
import { devOrigin } from "./ports";
async function fixture(page: Page) {
  const repo = {
    id: 1,
    name: "test",
    full_name: "sample/test",
    private: true,
    description: "Fixture",
    html_url: "https://github.com/sample/test",
    owner: { login: "sample" },
  };
  await page.route("https://api.github.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json:
        path === "/user"
          ? {
              login: "session-test",
              avatar_url: "https://github.com/identicons/test.png",
            }
          : path === "/user/repos"
            ? [repo]
            : [],
    });
  });
}
test("encrypted session survives hard reload and canceled logout, and is erased by confirmed logout", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Anslut GitHub", exact: true })
    .click();
  await page
    .getByLabel("GitHub personal access token")
    .fill("fixture-persistent-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  const client = await page.context().newCDPSession(page);
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Öppna på mobilen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("tas bort");
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page
    .getByRole("button", { name: "Logga ut och ta bort token", exact: true })
    .click();
  await expect(page.locator(".repo-lane")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Anslut GitHub", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Logga ut", exact: true }),
  ).toHaveCount(0);
});
test("mobile handoff scrubs URL, imports repo selections and renders a local expiring QR", async ({
  page,
}) => {
  await fixture(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const { url } = createHandoffUrl(`${devOrigin}/`, {
    token: "fixture-handoff-token",
    selected: ["sample/test"],
    rules: { "sample/test": { progress: "Building" } },
  });
  await page.goto(url);
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  expect(page.url()).not.toContain("issueflow-handoff");
  expect(page.url()).not.toContain("fixture-handoff-token");
  expect(requests.some((url) => url.includes("fixture-handoff-token"))).toBe(
    false,
  );
  await page.getByRole("button", { name: "Öppna på mobilen" }).click();
  await expect(
    page.getByRole("img", { name: "QR-kod för konto och inställningar" }),
  ).toHaveAttribute("src", /^data:image\/png/);
  await expect(page.getByRole("dialog")).toContainText(
    "Koden innehåller din token",
  );
  await page.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QR-kod för konto och inställningar" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
});

for (const fragment of ["#statistics", "#statistics-repo-1"]) {
  test(`logout from ${fragment} keeps navigation and encrypted preferences consistent on sign-in`, async ({ page }) => {
    await fixture(page);
    await page.goto("/");
    const signIn = async () => {
      await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
      await page.getByLabel("GitHub personal access token").fill("fixture-persistent-token");
      await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    };
    await signIn();
    await page.getByRole("checkbox", { name: "sample/test" }).check();
    await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
    await expect(page.locator(".repo-lane")).toHaveCount(1);
    await openSettings(page);
    await page.getByLabel("Visa max work items per kolumn", { exact: true }).fill("6");
    await page.getByLabel("Visa max work items per kolumn", { exact: true }).press("Tab");
    await page.getByRole("button", { name: "Klart", exact: true }).click();
    await page.getByRole("link", { name: "Statistik", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
    if (fragment !== "#statistics") await page.locator(".sidebar-repository").click();
    await expect(page).toHaveURL(new RegExp(fragment + "$"));
    await expect.poll(() => readSettings(page, "session-test").then(saved => saved?.columnLimit)).toBe(6);
    await page.getByRole("button", { name: "Logga ut", exact: true }).click();
    await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
    await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#overview$/);
    const saved = await readSettings(page, "session-test");
    expect(saved.selected).toEqual(["sample/test"]);
    expect(saved.columnLimit).toBe(6);
    await signIn();
    await expect(page.locator(".repo-lane")).toHaveCount(1);
    await expect(page.locator("main#overview")).toBeVisible();
    await openSettings(page);
    await expect(page.getByLabel("Visa max work items per kolumn", { exact: true })).toHaveValue("6");
    await page.getByRole("button", { name: "Klart", exact: true }).click();
    await page.getByRole("link", { name: "Statistik", exact: true }).click();
    await expect(page).toHaveURL(/#statistics$/);
    await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
  });
}
