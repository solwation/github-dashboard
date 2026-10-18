import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

// A dedicated production build on a free port: identity is checked against a known commit.
const commit = "3".repeat(40);
let server: Server, base: string, directory: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  directory = await mkdtemp(join(tmpdir(), "issueflow-build-info-"));
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", directory], {
    env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_SHA: commit },
    stdio: "pipe",
  });
  const types: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/markdown",
  };
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname.replace(/^\/github-dashboard\//, "/");
    const file = resolve(directory, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(directory + "/")) return void response.writeHead(404).end();
    try {
      const data = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(data);
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
test.use({ locale: "sv-SE" });

const expectedDate = (page: Page, language: string, timestamp: string) => page.evaluate(({ language, timestamp }) =>
  new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)), { language, timestamp });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the sidebar identifies the running build above the footer, in both languages and offline", async ({ page, context }) => {
  await page.goto(base);
  const version = page.getByRole("region", { name: "Version", exact: true });
  await expect(version).toBeVisible();
  const time = version.locator("time");
  const timestamp = await time.getAttribute("datetime");
  expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Date.parse(timestamp!)).toBeLessThanOrEqual(Date.now());
  await expect(time).toHaveAttribute("title", timestamp!);
  await expect(time).toHaveText(await expectedDate(page, "sv-SE", timestamp!));
  await expect(version.locator("code")).toHaveText(commit.slice(0, 7));
  await expect(version.locator("code")).toHaveAttribute("title", commit);
  await expect(version).toHaveAttribute("tabindex", "0");
  await expect(version).toHaveCSS("cursor", "pointer");
  await expect(version.getByRole("button", { name: "Versionsnyheter", exact: true })).toHaveCount(0);
  await expect(version.getByRole("button", { name: "Ny uppdatering tillgänglig" })).toHaveCount(0);

  // Directly above the author/license footer at the bottom of the sidebar.
  const footer = page.locator(".sidebar-footer");
  const [versionBox, footerBox] = [await version.boundingBox(), await footer.boundingBox()];
  expect(Math.abs(versionBox!.y + versionBox!.height - footerBox!.y)).toBeLessThanOrEqual(1);
  expect(versionBox!.x).toBeGreaterThanOrEqual(0);

  // Settings no longer carries build details, but opens the separate update view.
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Inställningar", exact: true });
  await expect(settings.locator("time, code")).toHaveCount(0);
  const opener = settings.getByRole("button", { name: "Automatiska uppdateringar", exact: true });
  await opener.click();
  const updates = page.getByRole("dialog", { name: "Automatiska uppdateringar", exact: true });
  await expect(updates).toBeVisible();
  await expect(updates.getByRole("button", { name: "Stäng", exact: true })).toBeFocused();
  await expect(updates).toContainText("Du har den senaste versionen av Issueflow.");
  await expect(updates.locator("code")).toHaveAttribute("title", commit);
  await expect(updates.getByRole("button", { name: "Installera uppdateringen" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(updates).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(settings).toBeVisible();

  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const english = page.getByRole("region", { name: "Version", exact: true });
  await expect(english).toHaveAttribute("tabindex", "0");
  await expect(english).toHaveCSS("cursor", "pointer");
  await expect(english.getByRole("button", { name: "Release notes", exact: true })).toHaveCount(0);
  await expect(english.locator("time")).toHaveText(await expectedDate(page, "en-GB", timestamp!));

  // A cached shell keeps its own build identity rather than fetching metadata.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(english.locator("time")).toHaveAttribute("datetime", timestamp!);
  await expect(english.locator("code")).toHaveAttribute("title", commit);
});

test("collapsed and phone sidebars hide the version text without horizontal scrolling", async ({ page }) => {
  for (const width of [900, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(base);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByRole("region", { name: "Version", exact: true })).toBeHidden();
    expect(await noHorizontalScroll(page)).toBe(true);
  }
});

test("release notes open from the sidebar with the bundled days and return focus", async ({ page }) => {
  await page.goto(base);
  const opener = page.getByRole("region", { name: "Version", exact: true });
  await opener.click();
  const notes = page.getByRole("dialog", { name: "Versionsnyheter", exact: true });
  await expect(notes).toBeVisible();
  await expect(notes.getByRole("button", { name: "Stäng versionsnyheter" })).toBeFocused();
  await expect(notes.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(notes.getByRole("link", { name: "Issue #52 på GitHub" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Escape");
  await expect(notes).toBeHidden();
  await expect(opener).toBeFocused();

  // #165: also opens via keyboard Enter on the focused version region
  await page.keyboard.press("Enter");
  await expect(notes).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notes).toBeHidden();
  await expect(opener).toBeFocused();

  // The published copy carries this build's identity for older installed versions.
  const published = await page.evaluate(async () => (await fetch("release-notes.json", { cache: "no-store" })).json());
  expect(published.build.commit).toBe(commit);
  expect(published.days.length).toBeGreaterThan(0);
});
