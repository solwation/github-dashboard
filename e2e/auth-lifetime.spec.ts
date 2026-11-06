import { expect, test } from "@playwright/test";

for (const stage of ["user", "repos"] as const) {
  for (const outcome of ["success", "rejection"] as const) {
    for (const exit of [false, true]) {
      test(`late ${stage} ${outcome} preserves ${exit ? "welcome after demo exit" : "demo"}`, async ({ page }, testInfo) => {
        let release!: () => void, entered!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const requested = new Promise<void>(resolve => { entered = resolve; });
        let downstreamRequests = 0;
        await page.route("https://api.github.com/**", async route => {
          const path = new URL(route.request().url()).pathname;
          if (path === (stage === "user" ? "/user" : "/user/repos")) {
            entered();
            await pending;
            await route.fulfill(outcome === "rejection"
              ? { status: 401, json: { message: "Fixture rejected" } }
              : { json: stage === "user" ? { login: "late-account", avatar_url: "" } : [] });
          } else {
            downstreamRequests++;
            await route.fulfill({ json: path === "/user" ? { login: "late-account", avatar_url: "" } : [] });
          }
        });
        await page.goto("/");
        await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
        await page.getByLabel("GitHub personal access token").fill("fixture-late-token");
        await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
        await requested;
        await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
        await expect(page.locator(".connection-label")).toHaveText("Demoläge");
        if (exit) await page.getByRole("button", { name: "Till inloggning", exact: true }).click();
        const response = page.waitForResponse(r => new URL(r.url()).pathname === (stage === "user" ? "/user" : "/user/repos"));
        release();
        await (await response).finished();
        // Let the app consume the completed response, including a possible stale catch/finally.
        await page.waitForTimeout(150);
        if (exit) await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toBeVisible();
        else await expect(page.locator(".connection-label")).toHaveText("Demoläge");
        await expect(page.locator(".username")).toHaveCount(0);
        await expect(page.locator(".notice.error")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Visa översikt", exact: true })).toHaveCount(0);
        expect(downstreamRequests).toBe(stage === "user" ? 0 : 1);
        const token = await page.evaluate(async () => {
          const path = "/src/lib/vault.ts";
          return (await import(/* @vite-ignore */ path)).loadToken();
        });
        expect(token).toBeNull();
        if (stage === "user" && outcome === "success") {
          await testInfo.attach(exit ? "late-auth-welcome" : "late-auth-demo", { body: await page.screenshot(), contentType: "image/png" });
        }
      });
    }
  }
}

test("a canceled sign-in cannot release a newer sign-in's busy state", async ({ page }) => {
  const releases: (() => void)[] = [];
  await page.route("https://api.github.com/**", async route => {
    if (new URL(route.request().url()).pathname === "/user") {
      await new Promise<void>(resolve => releases.push(resolve));
      await route.fulfill({ json: { login: "current-account", avatar_url: "" } });
    } else await route.fulfill({ json: [] });
  });
  await page.goto("/");
  const start = async () => {
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fixture-new-attempt");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  };
  await start();
  await expect.poll(() => releases.length).toBe(1);
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  await page.getByRole("button", { name: "Till inloggning", exact: true }).click();
  await start();
  await expect.poll(() => releases.length).toBe(2);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/user");
  releases[0]!();
  await (await response).finished();
  await page.waitForTimeout(150);
  await expect(page.getByRole("button", { name: "Ansluter…", exact: true })).toBeDisabled();
  releases[1]!();
  await expect(page.locator(".username")).toHaveText("current-account");
});

test("a pending saved-session restore offers no demo or welcome transition to race with", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    await (await import(/* @vite-ignore */ path)).saveToken("fixture-saved-credential");
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("https://api.github.com/**", async route => {
    requests++;
    await gate;
    await route.fulfill({ json: new URL(route.request().url()).pathname === "/user" ? { login: "saved-account", avatar_url: "" } : [] });
  });
  await page.reload();
  await expect.poll(() => requests).toBe(1);
  // The lifetime checks in connect() rely on this: startup restore cannot be interrupted from the UI.
  await expect(page.getByRole("button", { name: "Utforska en demo", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toHaveCount(0);
  release();
  await expect(page.locator(".username")).toHaveText("saved-account");
});

test("demo cancels a pending credential save without deleting the saved account", async ({ page }) => {
  await page.route("https://api.github.com/**", route => route.fulfill({ json:
    new URL(route.request().url()).pathname === "/user" ? { login: "replacement-account", avatar_url: "" } : [],
  }));
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    const vault = await import(/* @vite-ignore */ path);
    await vault.saveToken("fixture-original-token");
    await vault.saveContent("fixture-original-token", { marker: "keep-cache" });
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const state = window as typeof window & { encryptionStarted: boolean; finishEncryption: () => void };
    const gate = new Promise<void>(resolve => { state.finishEncryption = resolve; });
    crypto.subtle.encrypt = (async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
      state.encryptionStarted = true;
      await gate;
      return originalEncrypt(...args);
    }) as SubtleCrypto["encrypt"];
  });
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-replacement-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { encryptionStarted: boolean }).encryptionStarted)).toBe(true);
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  const saved = await page.evaluate(async () => {
    (window as typeof window & { finishEncryption: () => void }).finishEncryption();
    const path = "/src/lib/vault.ts";
    const vault = await import(/* @vite-ignore */ path);
    // loadToken queues behind the canceled write, so the assertions see its final outcome.
    return { token: await vault.loadToken(), content: await vault.loadContent("fixture-original-token") };
  });
  expect(saved).toEqual({ token: "fixture-original-token", content: { marker: "keep-cache" } });
  await expect(page.locator(".connection-label")).toHaveText("Demoläge");
  await expect(page.locator(".username")).toHaveCount(0);
  await expect(page.locator(".notice.error")).toHaveCount(0);
});

test("a pending sign-in that fails without a transition reports the error and frees the form", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://api.github.com/**", async route => {
    await pending;
    await route.fulfill({ status: 401, json: { message: "Fixture rejected" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-failing-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ansluter…", exact: true })).toBeDisabled();
  release();
  await expect(page.locator(".notice.error")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Anslut konto", exact: true })).toBeEnabled();
  await expect(page.locator(".username")).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    return (await import(/* @vite-ignore */ path)).loadToken();
  })).toBeNull();
});
