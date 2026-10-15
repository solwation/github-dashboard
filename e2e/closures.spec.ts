import { expect, test, type Page } from "@playwright/test";

async function notifications(
  page: Page,
  permission: "default" | "denied" | "granted" = "default",
) {
  await page.addInitScript((initialPermission) => {
    const state = {
      permission: initialPermission,
      requests: 0,
      sent: [] as { title: string; body: string; tag: string }[],
    };
    Object.assign(window, { notificationTest: state });
    class FakeNotification {
      static get permission() {
        return state.permission;
      }
      static async requestPermission() {
        state.requests++;
        return (state.permission =
          state.permission === "denied" ? "denied" : "granted");
      }
      onclick: unknown = null;
      constructor(title: string, options: { body: string; tag: string }) {
        state.sent.push({ title, ...options });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", {
      value: FakeNotification,
      configurable: true,
    });
  }, permission);
}
async function setup(page: Page) {
  const repos = ["alpha", "beta"].map((name, i) => ({
    id: i + 1,
    name,
    full_name: "sample/" + name,
    private: false,
    html_url: "https://github.com/sample/" + name,
    owner: { login: "sample" },
    description: "Fixture",
  }));
  const states: Record<string, { state: string; closed_at: string | null }> = {
    alpha: { state: "open", closed_at: null },
    beta: { state: "open", closed_at: null },
  };
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user")
      data = {
        login: "closure-test",
        avatar_url: "https://github.com/identicons/closure-test.png",
      };
    else if (url.pathname === "/user/repos") data = repos;
    else if (url.pathname.endsWith("/issues")) {
      const repo = repos.find((repo) =>
        url.pathname.includes("/" + repo.name + "/"),
      )!;
      const current = states[repo.name]!;
      data = [
        { id: repo.id, number: 1, title: repo.name + " current", ...current },
        {
          id: repo.id + 10,
          number: 2,
          title: "Historic closure",
          state: "closed",
          closed_at: "2026-01-01T12:00:00Z",
        },
      ]
        .filter(
          (issue) =>
            url.searchParams.get("state") === "all" ||
            issue.state === url.searchParams.get("state"),
        )
        .map((issue) => ({
          ...issue,
          created_at: "2026-01-01",
          updated_at: new Date().toISOString(),
          html_url: repo.html_url + "/issues/" + issue.number,
          labels: [],
          assignees: [],
        }));
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page.getByLabel("GitHub personal access token").fill("test-only");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  if (
    await page
      .getByRole("dialog")
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole("checkbox", { name: "sample/alpha" }).check();
    await page.getByRole("checkbox", { name: "sample/beta" }).check();
    await page.getByRole("button", { name: "Visa översikt" }).click();
  } else {
    // Wait for either saved selections or the repository picker after sign-in.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("checkbox", { name: "sample/alpha" }).check();
    await page.getByRole("checkbox", { name: "sample/beta" }).check();
    await page.getByRole("button", { name: "Visa översikt" }).click();
  }
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  return states;
}
async function count(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { notificationTest: { sent: unknown[] } })
        .notificationTest.sent.length,
  );
}

test("animates newly closed cards, shows time, notifies only subscribed repositories and remembers the choice", async ({
  page,
}) => {
  await page.clock.install();
  await notifications(page);
  const states = await setup(page);
  expect(await count(page)).toBe(0);
  await expect(page.locator(".just-closed")).toHaveCount(0);
  const alpha = page.getByRole("switch", { name: "Notiser för alpha" }),
    beta = page.getByRole("switch", { name: "Notiser för beta" });
  await expect(alpha).not.toBeChecked();
  await alpha.click();
  await expect(alpha).toBeChecked();
  await expect(beta).not.toBeChecked();
  const closedAt = new Date(Date.now() - 5000).toISOString();
  states.alpha = { state: "closed", closed_at: closedAt };
  states.beta = { state: "closed", closed_at: closedAt };
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(page.locator(".just-closed")).toHaveCount(2);
  await expect(page.locator(".closed-date").first()).toHaveAttribute(
    "datetime",
    closedAt,
  );
  await expect(page.locator(".closed-date").first()).toContainText(
    /sekund.*sedan| min sedan/,
  );
  await expect.poll(() => count(page)).toBe(1);
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Uppdatera", exact: true }),
  ).toBeEnabled();
  expect(await count(page)).toBe(1);
  // Poll even when hidden if a selected project has notifications enabled.
  await page.evaluate(() =>
    Object.defineProperty(document, "hidden", {
      get: () => true,
      configurable: true,
    }),
  );
  states.alpha = { state: "closed", closed_at: "2026-10-15T13:45:56Z" };
  await page.clock.fastForward(301000);
  await expect.poll(() => count(page)).toBe(2);
  await alpha.click();
  await expect(alpha).not.toBeChecked();
  states.alpha = { state: "closed", closed_at: "2026-10-15T14:45:56Z" };
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(page.locator(".closed-date").first()).toHaveAttribute(
    "datetime",
    states.alpha.closed_at!,
  );
  expect(await count(page)).toBe(2);
  await beta.click();
  await expect(beta).toBeChecked();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page
    .getByRole("button", { name: "Logga ut och ta bort token", exact: true })
    .click();
  await page.getByRole("button", { name: "Anslut GitHub" }).click();
  await page.getByLabel("GitHub personal access token").fill("test-only");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Notiser för beta" }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Notiser för alpha" }),
  ).not.toBeChecked();
  expect(await count(page)).toBe(2);
});

test("denied notification permission leaves project disabled and explains how to enable it", async ({
  page,
}) => {
  await notifications(page, "denied");
  await setup(page);
  const toggle = page.getByRole("switch", { name: "Notiser för alpha" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("status")).toContainText("Notiser är blockerade");
  expect(await count(page)).toBe(0);
});
