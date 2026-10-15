import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
let server: Server,
  base: string,
  version = 1;
const directory = resolve("dist");
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname.replace(
      /^\/github-dashboard\//,
      "/",
    );
    const file = resolve(
      directory,
      "." + (path === "/" ? "/index.html" : path),
    );
    if (!file.startsWith(directory + "/")) {
      response.writeHead(404).end();
      return;
    }
    try {
      let data = await readFile(file);
      if (file.endsWith("/sw.js"))
        data = Buffer.from(
          data.toString() +
            `\nself.addEventListener('message',event=>{if(event.data==='TEST_VERSION')event.ports[0].postMessage(${version})});\n`,
        );
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      };
      response
        .writeHead(200, {
          "Content-Type": types[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/github-dashboard/`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});
async function activeVersion(page: import("@playwright/test").Page) {
  try {
    return await page.evaluate(
      () =>
        new Promise((resolve) => {
          if (!navigator.serviceWorker.controller) {
            resolve(null);
            return;
          }
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => resolve(event.data);
          navigator.serviceWorker.controller!.postMessage("TEST_VERSION", [
            channel.port2,
          ]);
        }),
    );
  } catch {
    return null;
  }
}

test("real service-worker updates count down ten seconds and support immediate reload", async ({
  page,
}) => {
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  expect(await activeVersion(page)).toBe(1);
  // Finish the app's initial update job before publishing a different worker.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  version = 2;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
    await registration!.update();
  });
  await expect(page.locator(".version-update")).toContainText("10 sekunder");
  const countdownStarted = Date.now();
  await expect.poll(() => activeVersion(page), { timeout: 25000 }).toBe(2);
  expect(Date.now() - countdownStarted).toBeGreaterThanOrEqual(9000);
  await expect(page.locator(".version-update")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Utforska en demo" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  version = 3;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
    await registration!.update();
  });
  await expect(page.locator(".version-update")).toContainText("10 sekunder");
  await page.getByRole("button", { name: "Uppdatera nu", exact: true }).click();
  await expect.poll(() => activeVersion(page)).toBe(3);
  await expect(page.locator(".version-update")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Utforska en demo" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
});
