import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";

let server: Server, base: string, directory: string;
let version = 0;
let failCleanup = false;
let failInstall = false;
const commits = ["1".repeat(40), "2".repeat(40)];
// Build two actual apps: a worker-only marker cannot prove new JavaScript loaded.
test.beforeAll(async () => {
  test.setTimeout(120_000);
  directory = await mkdtemp(join(tmpdir(), "issueflow-update-"));
  for (const [index, commit] of commits.entries()) {
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", join(directory, String(index))], {
      env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_SHA: commit },
      stdio: "pipe",
    });
  }
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname.replace(/^\/github-dashboard\//, "/");
    const deployment = join(directory, String(version));
    const file = resolve(deployment, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(deployment + "/")) {
      response.writeHead(404).end();
      return;
    }
    try {
      if (failInstall && /\/assets\/.*\.js$/.test(path)) {
        response.writeHead(503).end("temporary deployment failure");
        return;
      }
      let data = await readFile(file);
      if (path === "/sw.js" && failCleanup)
        data = Buffer.concat([Buffer.from('caches.delete = async () => { throw new Error("fixture cleanup failure"); };\n'), data]);
      const types: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
      };
      // GitHub Pages permits ten minutes of fresh HTTP cache, including HTML.
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=600" }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/github-dashboard/`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function expectBuild(page: Page, commit: string) {
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bygginformation", exact: true }).locator("code")).toHaveAttribute("title", commit);
  await page.getByRole("dialog", { name: "Inställningar", exact: true }).getByRole("button", { name: "Stäng", exact: true }).click();
}
async function discover(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
    window.dispatchEvent(new Event("focus"));
  });
}

test("cacheable deployments load actual new code after countdown, across tabs, immediately, and offline", async ({ page, context }) => {
  test.setTimeout(90_000);
  version = 0;
  failCleanup = false;
  failInstall = false;
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expectBuild(page, commits[0]!);
  const otherTab = await context.newPage();
  await otherTab.goto(base);
  await expectBuild(otherTab, commits[0]!);
  version = 1;
  await discover(page);
  await expect(page.locator(".version-update")).toContainText("10 sekunder");
  const countdownStarted = Date.now();
  await expect(page.locator(".version-update")).toHaveCount(0, { timeout: 25000 });
  expect(Date.now() - countdownStarted).toBeGreaterThanOrEqual(9000);
  await expectBuild(page, commits[1]!);
  await expect(otherTab.locator(".version-update")).toHaveCount(0, { timeout: 25000 });
  await expectBuild(otherTab, commits[1]!);
  await otherTab.close();

  // Returning to a previous build is another real publication and exercises the button.
  version = 0;
  await discover(page);
  await expect(page.locator(".version-update")).toContainText("10 sekunder");
  await page.getByRole("button", { name: "Uppdatera nu", exact: true }).click();
  await expect(page.locator(".version-update")).toHaveCount(0);
  await expectBuild(page, commits[0]!);
  await context.setOffline(true);
  await page.reload();
  await expectBuild(page, commits[0]!);
  await context.setOffline(false);
  version = 1;
  await page.goto(base);
  // Normal revisit must bypass fresh HTTP-cached HTML too.
  await expectBuild(page, commits[1]!);
});

test("real worker takeover survives cleanup failure across existing tabs and retains saved settings", async ({ page, context }) => {
  test.setTimeout(90_000);
  version = 0;
  failCleanup = false;
  failInstall = false;
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expectBuild(page, commits[0]!);
  await page.evaluate(() => localStorage.setItem("update-regression-setting", "preserved"));
  const other = await context.newPage();
  await other.goto(base);
  await expectBuild(other, commits[0]!);
  version = 1;
  failCleanup = true;
  await discover(page);
  await expect(page.locator(".version-update")).toBeVisible();
  await page.getByRole("button", { name: "Uppdatera nu", exact: true }).click();
  await expect(page.locator(".version-update")).toHaveCount(0, { timeout: 25000 });
  await expectBuild(page, commits[1]!);
  await expect(other.locator(".version-update")).toBeVisible();
  // This tab applies an already-activated worker; it must not wait for another activation.
  await other.getByRole("button", { name: "Uppdatera nu", exact: true }).click();
  await expect(other.locator(".version-update")).toHaveCount(0, { timeout: 25000 });
  await expectBuild(other, commits[1]!);
  expect(await other.evaluate(() => localStorage.getItem("update-regression-setting"))).toBe("preserved");
  await other.close();
  failCleanup = false;
});

test("failed shell installation keeps the old app working and can be retried after network recovery", async ({ page }) => {
  test.setTimeout(90_000);
  version = 0;
  failCleanup = false;
  failInstall = false;
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expectBuild(page, commits[0]!);
  version = 1;
  failInstall = true;
  await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const failed = new Promise<void>(resolve => registration.addEventListener("updatefound", () => {
      const worker = registration.installing!;
      worker.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(); });
    }, { once: true }));
    await registration.update();
    await failed;
  });
  await expectBuild(page, commits[0]!);
  await expect(page.locator(".version-update")).toHaveCount(0);
  failInstall = false;
  await discover(page);
  await expect(page.locator(".version-update")).toBeVisible();
  await page.getByRole("button", { name: "Uppdatera nu", exact: true }).click();
  await expect(page.locator(".version-update")).toHaveCount(0, { timeout: 25000 });
  await expectBuild(page, commits[1]!);
});
