import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import QRCode from "qrcode";
import { createHandoffUrl } from "../src/lib/handoff";
import { openSettings } from "./support/phone-menu";
import { revealPhoneMenu } from "./support/phone-menu";

const settings = { token: "fixture-scanned-token", selected: ["sample/test"], rules: { "sample/test": { progress: "Building" } } };
async function fixture(page: Page) {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.route("https://api.github.com/**", route => route.fulfill({ json:
    new URL(route.request().url()).pathname === "/user" ? { login: "scanner-test", avatar_url: "" } :
    new URL(route.request().url()).pathname === "/user/repos" ? [{ id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } }] : [] }));
  return requests;
}
async function denied(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); };
  });
}
async function image(page: Page, url: string) {
  await page.getByLabel("Välj QR-bild", { exact: true }).setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: await QRCode.toBuffer(url, { width: 640, margin: 4, errorCorrectionLevel: "L" }) });
}
test("scans real QR pixels from an in-app camera stream and stops camera after sign-in", async ({ page }) => {
  const requests = await fixture(page);
  const { url } = createHandoffUrl("http://127.0.0.1:5173/", settings);
  const data = await QRCode.toDataURL(url, { width: 640, margin: 4 });
  await page.addInitScript(data => {
    (window as any).cameraStarts = 0;
    (window as any).cameraStops = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).cameraStarts++;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 640;
      const img = new Image(); img.src = data; await img.decode();
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      const stream = canvas.captureStream(4);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { (window as any).cameraStops++; stop(); };
      }
      return stream;
    };
  }, data);
  await page.goto("/");
  expect(await page.evaluate(() => (window as any).cameraStarts)).toBe(0);
  await page.getByRole("button", { name: "Logga in med QR-kod", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).cameraStops)).toBe(1);
  expect(page.url()).toBe("http://127.0.0.1:5173/#overview");
  expect(requests.some(url => url.includes("fixture-scanned-token") || url.includes("issueflow-handoff"))).toBe(false);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
});
test("denied camera offers image fallback, imports settings and persists in the current app", async ({ page }) => {
  await fixture(page); await denied(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Logga in med QR-kod", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Kameraåtkomst nekades");
  await image(page, createHandoffUrl("http://127.0.0.1:5173/", settings).url);
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect.poll(() => readSettings(page, "scanner-test").then(saved => saved?.rules)).toEqual(settings.rules);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("rejects expired and foreign QR codes without authentication and allows retry", async ({ page }) => {
  const requests = await fixture(page); await denied(page); await page.goto("/");
  await page.getByRole("button", { name: "Logga in med QR-kod", exact: true }).click();
  for (const [url, text] of [
    [createHandoffUrl("https://other.test/", settings).url, "QR-koden är ogiltig. Skanna en QR-kod från Issueflow på den andra enheten."],
    [createHandoffUrl("http://127.0.0.1:5173/", settings, Date.now() - 600_000).url, "QR-koden har gått ut. Skapa en ny kod på den andra enheten."],
  ]) {
    await image(page, url!);
    await expect(page.getByRole("alert")).toContainText(text!);
  }
  expect(requests.some(url => url.startsWith("https://api.github.com/"))).toBe(false);
  await image(page, createHandoffUrl("http://127.0.0.1:5173/", settings).url);
  await expect(page.locator(".repo-lane")).toHaveCount(1);
});
test("cancel stops a camera whose permission resolves after the dialog closes", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).cameraStops = 0;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      (window as any).grantCamera = () => {
        const canvas = document.createElement("canvas");
        const stream = canvas.captureStream();
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { (window as any).cameraStops++; stop(); };
        }
        resolve(stream);
      };
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Logga in med QR-kod", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Väntar på kameran" })).toBeVisible();
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.evaluate(() => (window as any).grantCamera());
  await expect.poll(() => page.evaluate(() => (window as any).cameraStops)).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test('signed-in QR popup opens the camera only on scan and stops it on cancel', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.assign(window, { signedInCameraStarts: 0, signedInCameraStops: 0 });
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).signedInCameraStarts++;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d')!.fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { (window as any).signedInCameraStops++; stop(); };
      }
      return stream;
    };
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(createHandoffUrl('http://127.0.0.1:5173/', settings).url);
  await expect(page.locator('.repo-lane')).toHaveCount(1);
  await revealPhoneMenu(page);
  await page.getByRole('button', { name: 'Öppna på mobilen', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Synka med QR-kod', exact: true });
  const scan = popup.getByRole('button', { name: 'Skanna QR-kod från annan enhet', exact: true });
  await expect(scan).toBeVisible();
  expect(await page.evaluate(() => (window as any).signedInCameraStarts)).toBe(0);
  expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await scan.focus(); await page.keyboard.press('Enter');
  const scanner = page.getByRole('dialog', { name: 'Läs QR-kod', exact: true });
  await expect(scanner).toBeVisible();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'QR-kod för konto och inställningar' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).signedInCameraStarts)).toBe(1);
  await scanner.getByRole('button', { name: 'Avbryt', exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).signedInCameraStops)).toBe(1);
  await expect(page.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
  await openSettings(page);
  await page.getByLabel('Språk', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Open on mobile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scan QR code from another device', exact: true })).toBeVisible();
});
