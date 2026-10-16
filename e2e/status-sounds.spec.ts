import { expect, test } from "@playwright/test";

test("status sounds follow repository opt-in and live transitions without replay", async ({ page }) => {
  await page.addInitScript(() => {
    const frequencies: number[] = [];
    Object.assign(window, { soundFrequencies: frequencies });
    class FakeAudioContext {
      state = "running";
      get currentTime() { return performance.now() / 1000; }
      destination = {};
      async resume() { this.state = "running"; }
      createOscillator() {
        const frequency = { value: 0 };
        return { frequency, type: "sine", onended: null, connect() {}, disconnect() {},
          start() { frequencies.push(frequency.value); }, stop() {} };
      }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    }
    class FakeNotification {
      static permission = "granted";
      static async requestPermission() { return "granted"; }
      close() {}
    }
    Object.assign(window, { AudioContext: FakeAudioContext, Notification: FakeNotification });
  });
  const repositories = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: false, description: "Fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const states: Record<string, { state: string; labels: string[] }> = { alpha: { state: "open", labels: [] }, beta: { state: "open", labels: [] } };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "sound-test", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repositories;
    else if (url.pathname.endsWith("/issues")) {
      const repo = repositories.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      const state = states[repo.name]!;
      data = url.searchParams.get("state") === state.state || url.searchParams.get("state") === "all" ? [{ id: repo.id, number: 1, title: `${repo.name} task`, state: state.state, labels: state.labels.map(name => ({ name, color: "ffffff" })), assignees: [], created_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString(), closed_at: state.state === "closed" ? new Date().toISOString() : null, html_url: `${repo.html_url}/issues/1` }] : [];
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-sound-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repositories) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  const notes = () => page.evaluate(() => (window as Window & { soundFrequencies?: number[] }).soundFrequencies);
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  expect(await notes()).toEqual([]);
  await page.getByRole("switch", { name: "Notiser för alpha", exact: true }).click();
  states.alpha!.labels = ["in-progress"];
  states.beta!.labels = ["in-progress"];
  await page.keyboard.press("Control+r");
  await expect.poll(notes).toEqual([440, 554]);
  // A blocked label produces a negative sound even while remaining In progress.
  states.alpha!.labels = ["in-progress", "blocked"];
  await page.keyboard.press("Control+r");
  await expect.poll(notes).toEqual([440, 554, 330, 247, 196]);
  states.alpha!.labels = ["in-progress"];
  states.alpha!.state = "closed";
  await page.keyboard.press("Control+r");
  await expect.poll(notes).toEqual([440, 554, 330, 247, 196, 523, 659, 784]);
  await page.getByRole("switch", { name: "Notiser för alpha", exact: true }).click();
  states.alpha = { state: "open", labels: [] };
  await page.keyboard.press("Control+r");
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  expect(await notes()).toHaveLength(8);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  expect(await notes()).toEqual([]);
});
