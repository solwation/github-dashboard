import { expect, test, type Page } from "@playwright/test";

async function connect(page: Page) {
  let version = 1;
  let openRequests = 0;
  const incrementalRequests: string[] = [];
  let gate: Promise<void> | undefined;
  let release = () => {};
  const repos = ["alpha", "beta"].map((name, index) => ({
    id: index + 1, name, full_name: `sample/${name}`, private: false,
    html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("state") === "all" && url.searchParams.has("since"))
      incrementalRequests.push(url.toString());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "refresh-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = repos;
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      openRequests++;
      await gate;
      const date = new Date().toISOString();
      data = [{ id: 1, number: 1, title: `Keep task version ${version}`, body: "Fixture",
        comments: 0, state: "open", labels: [], assignees: [], created_at: date,
        updated_at: date, closed_at: null, html_url: "https://github.com/sample/alpha/issues/1" }];
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-refresh-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".issue-title")).toHaveCount(2);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => Object.assign(window, { documentMarker: "same-document" }));
  return {
    next: () => { version++; },
    requests: () => openRequests,
    incrementalRequests,
    pause: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => { gate = undefined; release(); },
  };
}
async function expectSameDocument(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { documentMarker?: string }).documentMarker)).toBe("same-document");
}

test("refresh shortcuts fetch full data in place and preserve filters, order and collapsed lanes while busy", async ({ page }) => {
  const api = await connect(page);
  await expect(page.getByRole("button", { name: "Uppdatera", exact: true })).toHaveCount(0);
  await page.locator(".sidebar-projects").getByRole("button", { name: /^Ordna beta med/ }).focus();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "Kollapsa beta", exact: true }).click();
  await page.getByRole("textbox", { name: "Sök issues" }).fill("Keep");
  await page.getByRole("checkbox", { name: "Dölj koordinationsärenden" }).uncheck();
  const requests = api.requests();
  // The post-connect background reconcile may be incremental; only the shortcuts' fetches are checked.
  const incremental = api.incrementalRequests.length;
  api.next();
  api.pause();
  await page.keyboard.press("Control+r");
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "true");
  // Each repository header, collapsed or not, shows its own spinner while it is fetched (#146).
  await expect(page.locator("#repo-1 .lane-header").getByRole("img", { name: "Hämtar issues för sample/alpha…" })).toBeVisible();
  await expect(page.locator("#repo-2 .lane-header").getByRole("img", { name: "Hämtar issues för sample/beta…" })).toBeVisible();
  await expect(page.locator("#repo-1 .issue-title")).toHaveText("Keep task version 1");
  // Both selected repositories load concurrently while the gate holds them.
  await expect.poll(api.requests).toBe(requests + 2);
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Meta+r");
  await page.keyboard.press("F5");
  expect(api.requests()).toBe(requests + 2);
  await expectSameDocument(page);
  api.release();
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#repo-1 .issue-title")).toHaveText("Keep task version 2");
  expect(api.requests()).toBe(requests + 2);
  expect(api.incrementalRequests.slice(incremental)).toEqual([]);
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["beta", "alpha"]);
  await expect(page.getByRole("button", { name: "Expandera beta", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("textbox", { name: "Sök issues" })).toHaveValue("Keep");
  await expect(page.getByRole("checkbox", { name: "Dölj koordinationsärenden" })).not.toBeChecked();
  for (const [shortcut, version] of [["F5", 3], ["Meta+r", 4]] as const) {
    api.next();
    await page.keyboard.press(shortcut);
    await expect(page.locator("#repo-1 .issue-title")).toHaveText(`Keep task version ${version}`);
    // A shortcut during an in-flight full refresh is absorbed, so let this one finish first.
    await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
    await expectSameDocument(page);
  }
});

test("hard reload modifiers are not intercepted, and welcome/demo retain browser reload shortcuts", async ({ page }) => {
  await connect(page);
  // Synthetic events check cancellation without letting a hard reload destroy the fixture.
  const cancellations = await page.evaluate(() => [
    { key: "r", ctrlKey: true, shiftKey: true },
    { key: "r", metaKey: true, shiftKey: true },
    { key: "F5", ctrlKey: true },
    { key: "F5", shiftKey: true },
  ].map(gesture => {
    const event = new KeyboardEvent("keydown", { ...gesture, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  expect(cancellations).toEqual([false, false, false, false]);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Följ dina AI-agenter/ })).toBeVisible();
  for (const demo of [false, true]) {
    if (demo) await page.getByRole("button", { name: "Utforska en demo" }).click();
    expect(await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
  }
});

test("a refresh shortcut pressed during a background sync runs a full refresh once that sync finishes", async ({ page }) => {
  await page.clock.install();
  let version = 1;
  let openRequests = 0;
  let activeRequests = 0;
  let release = () => {};
  let gate: Promise<void> | undefined;
  const repo = { id: 1, name: "alpha", full_name: "sample/alpha", private: false, html_url: "https://github.com/sample/alpha", owner: { login: "sample" } };
  const task = () => {
    const date = new Date().toISOString();
    return { id: 1, number: 1, title: `Active task version ${version}`, body: "Fixture", comments: 0, state: "open",
      labels: [{ name: "in-progress", color: "123456" }], assignees: [], created_at: date, updated_at: date, closed_at: null,
      html_url: "https://github.com/sample/alpha/issues/1" };
  };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "background-refresh", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = [repo];
    else if (url.pathname === "/repos/sample/alpha/issues" && url.searchParams.get("state") === "all") {
      // The 15-second tick revalidates one list per repository with active issues (#123).
      activeRequests++;
      await gate;
      data = task();
    } else if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      openRequests++;
      data = [task()];
    }
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => localStorage.setItem("issueflow:background-refresh", JSON.stringify({ selected: ["sample/alpha"] })));
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-background-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".issue-title")).toHaveText("Active task version 1");
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");

  // Hold the 15-second active-issue sync open, then ask for a full refresh.
  gate = new Promise(resolve => { release = resolve; });
  const activeBefore = activeRequests;
  await page.clock.runFor(16_000);
  await expect.poll(() => activeRequests).toBeGreaterThan(activeBefore);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "true");
  const before = openRequests;
  version = 2;
  await page.keyboard.press("F5");
  expect(openRequests).toBe(before);
  gate = undefined;
  release();
  await expect.poll(() => openRequests).toBe(before + 1);
  await expect(page.locator(".issue-title")).toHaveText("Active task version 2");
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
});
