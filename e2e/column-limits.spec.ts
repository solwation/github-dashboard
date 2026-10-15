import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  let account = "limits-alpha";
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/user") body = { login: account, avatar_url: "" };
    else if (url.pathname === "/user/repos") body = ["alpha", "bravo"].map((name, id) => ({
      id: id + 1, name, full_name: `sample/${name}`, private: false, description: "Fictional limits fixture",
      html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
    }));
    else if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      const date = new Date().toISOString();
      body = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, number: index + 1,
        title: `Fixture task ${index + 1}`, state: "open", created_at: date, updated_at: date,
        closed_at: null, html_url: `https://github.com/sample/alpha/issues/${index + 1}`, labels: [], assignees: [],
      }));
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    for (const login of ["limits-alpha", "limits-beta"]) {
      const key = `issueflow:${login}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ selected: ["sample/alpha", "sample/bravo"] }));
    }
  });
  return { account: (value: string) => { account = value; } };
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-limits-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
}
const cards = (page: Page, id: number) => page.locator(`#repo-${id} .backlog .issue-card`);
async function globalLimit(page: Page, value: string) {
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.locator("#global-column-limit").fill(value);
  await page.getByRole("button", { name: "Klart", exact: true }).click();
}
async function override(page: Page, value: string) {
  await page.getByRole("button", { name: "Anpassa labels för alpha", exact: true }).click();
  await page.locator("#repository-column-limit").fill(value);
  await page.getByRole("button", { name: "Spara och hämta igen", exact: true }).click();
}

test("global batches, repository inheritance, validation, reload and account isolation", async ({ page }) => {
  const api = await fixture(page);
  await page.goto("/");
  await connect(page);
  await expect(cards(page, 1)).toHaveCount(6);
  await globalLimit(page, "2");
  await expect(cards(page, 1)).toHaveCount(2);
  await expect(cards(page, 2)).toHaveCount(2);
  await expect(page.locator("#repo-1 .backlog .column-count")).toHaveText("9");
  await page.locator("#repo-1 .backlog").getByRole("button", { name: "Visa fler" }).click();
  await expect(cards(page, 1)).toHaveCount(4);
  await override(page, "3");
  await globalLimit(page, "1");
  await expect(cards(page, 1)).toHaveCount(3);
  await expect(cards(page, 2)).toHaveCount(1);
  await page.reload();
  await expect(cards(page, 1)).toHaveCount(3);
  await expect(cards(page, 2)).toHaveCount(1);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  const input = page.locator("#global-column-limit");
  for (const value of ["0", "1.5", "101", ""]) {
    await input.fill(value);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toContainText("Ange ett heltal mellan 1 och 100.");
  }
  await input.fill("2");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await override(page, "");
  await expect(cards(page, 1)).toHaveCount(2);
  await page.locator("#repo-1 .backlog").getByRole("button", { name: "Visa fler" }).click();
  await globalLimit(page, "1");
  await expect(cards(page, 1)).toHaveCount(1);
  for (let i = 0; i < 8; i++) await page.locator("#repo-1 .backlog").getByRole("button", { name: "Visa fler" }).click();
  await expect(cards(page, 1)).toHaveCount(9);
  await expect(page.locator("#repo-1 .backlog .show-more")).toHaveCount(0);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  api.account("limits-beta");
  await connect(page);
  await expect(cards(page, 1)).toHaveCount(6);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("issueflow:limits-alpha")!).columnLimit)).toBe(1);
});

test("phone settings work with keyboard and translate to English", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await fixture(page);
  await page.goto("/");
  await connect(page);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  const input = page.getByRole("spinbutton", { name: "Maximum work items shown per column" });
  await input.fill("2");
  await input.focus();
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("3");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(cards(page, 1)).toHaveCount(3);
  await page.getByRole("button", { name: "Customize labels for alpha", exact: true }).click();
  const local = page.getByRole("spinbutton", { name: "Maximum work items shown per column" });
  await expect(local).toHaveAttribute("placeholder", "Inherit global setting (3)");
  await local.fill("2");
  await local.press("Enter");
  await expect(cards(page, 1)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
