import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";

let server: Server, base: string, directory: string;
let version = 0;
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
      const data = await readFile(file);
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
