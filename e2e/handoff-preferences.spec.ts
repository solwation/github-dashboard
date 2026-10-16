import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { createHandoffUrl, parseHandoffUrl, type HandoffPayload, type HandoffPreferences } from "../src/lib/handoff";

const base = "http://127.0.0.1:5173/";
const token = "fictional-optical-sync-token";
const preferences: HandoffPreferences = {
  projectOrder: ["sample/second", "sample/test"], collapsedRepos: ["sample/second"],
  columnLimit: 7, repositoryColumnLimits: { "sample/test": 2 }, notificationRepos: ["sample/test"],
  language: "sv", query: "Fixture", repositoryQueries: { "sample/test": "ready" },
  repoQuery: "sample", hideCoordination: false, timeoutMinutes: 45, currentView: "overview",
  statistics: { "sample/test": { from: "2026-10-01", to: "2026-10-16", label: "", contributor: "", metric: "closed" } },
};
async function fixture(page: Page, readable = ["test", "second"]) {
  await page.route("https://api.github.com/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/user" ? { login: "optical-sync-fixture", avatar_url: "" }
      : path === "/user/repos" ? readable.map((name, index) => ({
        id: index + 1, name, full_name: "sample/" + name, private: false,
        html_url: "https://github.com/sample/" + name, owner: { login: "sample" },
      })) : [] });
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("fixture camera denied", "NotAllowedError"); };
  });
}
async function exportCode(page: Page): Promise<{ payload: HandoffPayload; image: string }> {
  await page.getByRole("button", { name: /^(Öppna på mobilen|Synka med QR-kod)$/ }).click();
  const img = page.getByRole("img", { name: "QR-kod för konto och inställningar", exact: true });
  await expect(img).toHaveAttribute("src", /^data:image\/png/);
  const pixels = await img.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    return { data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data), width: canvas.width, height: canvas.height };
  });
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  expect(Boolean(decoded)).toBe(true);
  const payload = parseHandoffUrl(decoded!.data, base);
  const image = (await img.getAttribute("src"))!;
  await page.getByRole("dialog", { name: "Synka med QR-kod", exact: true }).getByRole("button", { name: "Stäng", exact: true }).click();
  return { payload, image };
}
async function scanCode(page: Page, image: string) {
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByRole("button", { name: "Läs QR-kod", exact: true }).click();
  await page.getByLabel("Välj QR-bild", { exact: true }).setInputFiles({
    name: "fictional-preferences-qr.png", mimeType: "image/png", buffer: Buffer.from(image.split(",")[1]!, "base64"),
  });
  await expect(page.getByRole("dialog", { name: "Läs QR-kod", exact: true })).toHaveCount(0);
}

test("desktop and mobile optically sync all preferences repeatedly without logout or document reload", async ({ page, browser }) => {
  await fixture(page);
  await page.goto(createHandoffUrl(base, { token, selected: ["sample/test", "sample/second"], rules: { "sample/test": { progress: "Working" } }, preferences }).url);
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  const desktop = await exportCode(page);
  expect(desktop.payload.version).toBe(2);
  expect(desktop.payload.preferences).toMatchObject(preferences);
  expect(page.url()).not.toContain("issueflow-handoff");

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "sv-SE" });
  const mobile = await mobileContext.newPage();
  await fixture(mobile);
  await mobile.goto(createHandoffUrl(base, { token, selected: ["sample/test"], rules: {}, preferences: { language: "sv", columnLimit: 3, query: "", hideCoordination: true } }).url);
  await expect(mobile.locator(".repo-lane")).toHaveCount(1);
  const localPermission = await mobile.evaluate(() => Notification.permission);
  await mobile.evaluate(() => Object.assign(window, { opticalDocumentMarker: "same-document" }));
  await scanCode(mobile, desktop.image);
  await expect(mobile.locator(".repo-lane")).toHaveCount(2);
  expect(await mobile.evaluate(() => (window as unknown as { opticalDocumentMarker: string }).opticalDocumentMarker)).toBe("same-document");
  expect(await mobile.evaluate(() => Notification.permission)).toBe(localPermission);
  const imported = await exportCode(mobile);
  expect(imported.payload.preferences).toMatchObject(preferences);
  expect(imported.payload.rules).toEqual(desktop.payload.rules);
  await mobile.getByRole("textbox", { name: "Sök issues", exact: true }).fill("return to desktop");
  const reverse = await exportCode(mobile);
  await scanCode(page, reverse.image);
  await expect(page.getByRole("textbox", { name: "Sök issues", exact: true })).toHaveValue("return to desktop");
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Sök issues", exact: true })).toHaveValue("return to desktop");
  // A language-only edit must replace the account preference restored on reload.
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await mobileContext.close();
});

test("optical import filters inaccessible repository preferences and legacy codes preserve missing fields", async ({ page }) => {
  await fixture(page, ["test"]);
  await page.goto(createHandoffUrl(base, { token, selected: ["sample/test", "sample/second"], rules: { "sample/second": { high: "urgent" } }, preferences }).url);
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  const transferred = await exportCode(page);
  expect(transferred.payload.selected).toEqual(["sample/test"]);
  expect(transferred.payload.preferences?.projectOrder).toEqual(["sample/test"]);
  expect(transferred.payload.preferences?.collapsedRepos).toEqual([]);
  expect(transferred.payload.rules).toEqual({});
  // A v1 code contains no language, limits, filters or other new preference fields.
  const legacy = btoa(JSON.stringify({ version: 1, issuedAt: Date.now(), token, selected: ["sample/test"], rules: {} })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await scanCode(page, await QRCode.toDataURL(base + "#issueflow-handoff=" + legacy, { width: 640, margin: 4, errorCorrectionLevel: "L" }));
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  const afterLegacy = await exportCode(page);
  expect(afterLegacy.payload.preferences?.columnLimit).toBe(7);
  expect(afterLegacy.payload.preferences?.timeoutMinutes).toBe(45);
  expect(afterLegacy.payload.preferences?.query).toBe("Fixture");
});
