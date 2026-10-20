import { repositoryNotification } from "./support/repository-properties";
import { expect, test } from "@playwright/test";
import { readSettings } from "./support/settings";

test("status sounds follow repository opt-in and live transitions without replay", async ({ page }) => {
  await page.addInitScript(() => {
    const frequencies: number[] = [];
    const notices: string[] = [];
    Object.assign(window, { soundFrequencies: frequencies, soundNotices: notices });
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
      constructor(title: string) { notices.push(title); }
      close() {}
    }
    Object.assign(window, { AudioContext: FakeAudioContext, Notification: FakeNotification });
  });
  const repositories = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: false, description: "Fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const states: Record<string, { state: string; labels: string[] }> = { alpha: { state: "open", labels: [] }, beta: { state: "open", labels: [] } };
  let login = "sound-test";
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login, avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repositories;
    else if (url.pathname.endsWith("/issues")) {
      const repo = repositories.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      const state = states[repo.name]!;
      data = url.searchParams.get("state") === state.state || url.searchParams.get("state") === "all" ? [{ id: repo.id, number: 1, title: `${repo.name} task`, state: state.state, labels: state.labels.map(name => ({ name, color: "ffffff" })), assignees: [], created_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString(), closed_at: state.state === "closed" ? new Date().toISOString() : null, html_url: `${repo.html_url}/issues/1` }] : [];
    }
    await route.fulfill({ json: data });
  });
  // Background ticks now carry live data (#123); a shortcut during an in-flight full refresh is
  // satisfied by it, so wait for idle before asking for a refresh of the changed fixture state.
  const refreshWhenIdle = async () => {
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await page.keyboard.press("Control+r");
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-sound-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repositories) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  const notes = () => page.evaluate(() => (window as Window & { soundFrequencies?: number[] }).soundFrequencies);
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  expect(await notes()).toEqual([]);
  await repositoryNotification(page, "alpha", toggle => toggle.click());
  states.alpha!.labels = ["in-progress"];
  states.beta!.labels = ["in-progress"];
  await refreshWhenIdle();
  await expect.poll(notes).toEqual([440, 554]);
  // A blocked label produces a negative sound even while remaining In progress.
  states.alpha!.labels = ["in-progress", "blocked"];
  await refreshWhenIdle();
  await expect.poll(notes).toEqual([440, 554, 330, 247, 196]);
  states.alpha!.labels = ["in-progress"];
  states.alpha!.state = "closed";
  await refreshWhenIdle();
  await expect.poll(notes).toEqual([440, 554, 330, 247, 196, 523, 659, 784]);
  // Global mute preserves subscriptions, browser notices and live visual feedback.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  const soundChoice = page.getByLabel("Notification sounds", { exact: true });
  await expect(soundChoice).toHaveValue("true");
  await soundChoice.focus(); await page.keyboard.press("End"); await page.keyboard.press("Tab");
  await expect(soundChoice).toHaveValue("false");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await repositoryNotification(page, "alpha", async toggle => { await expect(toggle).toBeChecked(); });
  await expect.poll(() => readSettings(page, "sound-test").then(saved => saved?.preferences?.notificationSounds)).toBe(false);
  states.alpha = { state: "open", labels: [] };
  await refreshWhenIdle();
  await expect(page.locator("#repo-1 .backlog .issue-card")).toHaveCount(1);
  states.alpha!.state = "closed";
  await refreshWhenIdle();
  await expect.poll(() => page.evaluate(() => (window as unknown as { soundNotices: string[] }).soundNotices.length)).toBe(2);
  await expect(page.locator("#repo-1 .closed .issue-card.just-closed")).toHaveCount(1);
  expect(await notes()).toHaveLength(8);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(soundChoice).toHaveValue("false");
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain("notificationSounds");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  states.alpha = { state: "open", labels: [] };
  await refreshWhenIdle();
  await expect(page.locator("#repo-1 .backlog .issue-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await soundChoice.focus(); await page.keyboard.press("Home"); await page.keyboard.press("Tab");
  await expect(soundChoice).toHaveValue("true");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(await notes()).toEqual([]);
  states.alpha!.labels = ["in-progress"];
  states.beta!.state = "closed";
  await refreshWhenIdle();
  await expect.poll(notes).toEqual([440, 554]);
  // Restore Swedish for the existing per-repository opt-out checks.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("sv");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await repositoryNotification(page, "alpha", toggle => toggle.click());
  states.alpha = { state: "open", labels: [] };
  await refreshWhenIdle();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  expect(await notes()).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  expect(await notes()).toEqual([]);
  // Muting belongs to the signed-in account and survives explicit logout.
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Notifikationsljud", { exact: true }).selectOption("false");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await expect.poll(() => readSettings(page, "sound-test").then(saved => saved?.preferences?.notificationSounds)).toBe(false);
  const signOut = async () => {
    await page.getByRole("button", { name: "Logga ut", exact: true }).click();
    await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  };
  const signIn = async () => {
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-sound-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  };
  await signOut(); login = "sound-other"; await signIn();
  await page.getByRole("checkbox", { name: "sample/alpha" }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(page.getByLabel("Notifikationsljud", { exact: true })).toHaveValue("true");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await signOut(); login = "sound-test"; await signIn();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(page.getByLabel("Notifikationsljud", { exact: true })).toHaveValue("false");
});

for (const audioMode of ['unsupported', 'denied'] as const) {
  test(`dismissed ${audioMode} audio warning stays dismissed while status and OS notifications continue`, async ({ page }) => {
    await page.addInitScript(mode => {
      const notices: string[] = [];
      class DeniedAudioContext {
        state = 'suspended';
        async resume() { throw new DOMException('Audio unavailable', 'NotAllowedError'); }
      }
      class WorkingNotification {
        static permission = 'granted';
        static async requestPermission() { return 'granted'; }
        constructor(title: string) { notices.push(title); }
        close() {}
      }
      Object.assign(window, { AudioContext: mode === 'unsupported' ? undefined : DeniedAudioContext,
        Notification: WorkingNotification, deliveredNotices: notices });
    }, audioMode);
    const repo = { id: 1, name: 'silent', full_name: 'sample/silent', private: false, description: 'Fixture', html_url: 'https://github.com/sample/silent', owner: { login: 'sample' } };
    let state = 'open';
    let labels: string[] = [];
    let closedAt: string | null = null;
    await page.route('https://api.github.com/**', async route => {
      const url = new URL(route.request().url());
      let data: unknown = [];
      if (url.pathname === '/user') data = { login: 'silent-audio', avatar_url: '' };
      else if (url.pathname === '/user/repos') data = [repo];
      else if (url.pathname.endsWith('/issues') && (url.searchParams.get('state') === state || url.searchParams.get('state') === 'all')) {
        data = [{ id: 1, number: 1, title: 'Silent task', state, labels: labels.map(name => ({ name, color: 'ffffff' })), assignees: [], created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(), closed_at: closedAt, html_url: `${repo.html_url}/issues/1` }];
      }
      await route.fulfill({ json: data });
    });
    // Background ticks now carry live data (#123); a shortcut during an in-flight full refresh is
    // satisfied by it, so wait for idle before asking for a refresh of the changed fixture state.
    const refreshWhenIdle = async () => {
      await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
      await page.keyboard.press("Control+r");
    };
    await page.goto('/');
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fictional-silent-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    await page.getByRole('checkbox', { name: repo.full_name }).check();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(page.locator('.backlog .issue-card')).toHaveCount(1);
    await repositoryNotification(page, 'silent', async toggle => { await toggle.click(); await expect(toggle).toBeChecked(); });
    await expect(page.locator('.notification-notice')).toContainText('Ljud kunde inte aktiveras');
    await page.getByRole('button', { name: 'Stäng notismeddelande', exact: true }).click();
    for (let round = 0; round < 2; round++) {
      state = 'open'; labels = ['in-progress']; closedAt = null;
      await refreshWhenIdle();
      await expect(page.locator('.progress .issue-card')).toHaveCount(1);
      await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", 'false');
      await expect(page.locator('.notification-notice')).toHaveCount(0);
      labels = ['in-progress', 'blocked'];
      await refreshWhenIdle();
      await expect(page.locator('.issue-card .labels')).toContainText('blocked');
      await expect(page.locator('.notification-notice')).toHaveCount(0);
      state = 'closed'; labels = []; closedAt = new Date(Date.now() + round).toISOString();
      await refreshWhenIdle();
      await expect(page.locator('.closed .issue-card')).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => (window as unknown as { deliveredNotices: string[] }).deliveredNotices.length)).toBe(round + 1);
      await expect(page.locator('.notification-notice')).toHaveCount(0);
    }
    // Ordinary interactions may retry audio activation without surfacing errors.
    await page.getByRole('textbox', { name: 'Sök issues', exact: true }).click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.notification-notice')).toHaveCount(0);
  });
}
