import { expect, test, type Page } from "@playwright/test";
import { createHandoffUrl } from "../src/lib/handoff";
import QRCode from "qrcode";
import { devOrigin } from "./ports";

const accounts: Record<string, string> = { "fixture-saved-token": "saved-account", "fixture-foreign-token": "foreign-account" };
const repo = { id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
async function fixture(page: Page) {
  await page.route("https://api.github.com/**", route => {
    const path = new URL(route.request().url()).pathname;
    const token = (route.request().headers().authorization || "").replace(/^Bearer /, "");
    return route.fulfill({ json: path === "/user" ? { login: accounts[token] ?? "unknown", avatar_url: "" } : path === "/user/repos" ? [repo] : [] });
  });
}
const link = (token: string) => createHandoffUrl(`${devOrigin}/`, { token, selected: ["sample/test"], rules: {} }).url;
async function openLink(page: Page, token: string) {
  // Leave the document first so a hash-only change performs a real application start.
  await page.goto("about:blank");
  await page.goto(link(token));
}

test("a foreign handoff link needs confirmation before replacing a different saved session", async ({ page }) => {
  await fixture(page);
  // Without a saved session the link signs in directly, as before.
  await openLink(page, "fixture-saved-token");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".username")).toHaveText("saved-account");

  // Canceling with Escape keeps and restores the saved session and board.
  await openLink(page, "fixture-foreign-token");
  const dialog = page.getByRole("dialog", { name: "Byta GitHub-konto?", exact: true });
  await expect(dialog).toContainText("saved-account");
  await expect(dialog).toContainText("foreign-account");
  expect(page.url()).not.toContain("issueflow-handoff");
  await expect(dialog.getByRole("button", { name: "Behåll sparat konto", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".username")).toHaveText("saved-account");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".username")).toHaveText("saved-account");
  await expect(page.locator(".repo-lane")).toHaveCount(1);

  // The cancel button also restores the saved session.
  await openLink(page, "fixture-foreign-token");
  await dialog.getByRole("button", { name: "Behåll sparat konto", exact: true }).click();
  await expect(page.locator(".username")).toHaveText("saved-account");
  await expect(page.locator(".repo-lane")).toHaveCount(1);

  // Explicit keyboard confirmation switches and persists the new account.
  await openLink(page, "fixture-foreign-token");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Byt konto", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".username")).toHaveText("foreign-account");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".username")).toHaveText("foreign-account");
});

test("account switch dialog is translated to English", async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem("issueflow-language", "en"));
  await openLink(page, "fixture-saved-token");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await openLink(page, "fixture-foreign-token");
  const dialog = page.getByRole("dialog", { name: "Switch GitHub account?", exact: true });
  await expect(dialog).toContainText("foreign-account");
  await dialog.getByRole("button", { name: "Keep saved account", exact: true }).click();
  await expect(page.locator(".username")).toHaveText("saved-account");
});

test("a signed-in QR scan of another account asks before switching and cancel keeps the session", async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); };
  });
  await openLink(page, "fixture-saved-token");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await page.getByRole("button", { name: "Öppna på mobilen", exact: true }).click();
  await page.getByRole("button", { name: "Skanna QR-kod från annan enhet", exact: true }).click();
  await page.getByLabel("Välj QR-bild", { exact: true }).setInputFiles({ name: "qr.png", mimeType: "image/png",
    buffer: await QRCode.toBuffer(link("fixture-foreign-token"), { width: 640, margin: 4, errorCorrectionLevel: "L" }) });
  const dialog = page.getByRole("dialog", { name: "Byta GitHub-konto?", exact: true });
  await expect(dialog).toContainText("foreign-account");
  await dialog.getByRole("button", { name: "Behåll sparat konto", exact: true }).click();
  await expect(page.locator(".username")).toHaveText("saved-account");
  await page.reload();
  await expect(page.locator(".username")).toHaveText("saved-account");
});
