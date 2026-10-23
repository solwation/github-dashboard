import { expect, test } from "@playwright/test";
import { openSettings } from "./support/phone-menu";
import { previewOrigin } from "./ports";

test.use({ baseURL: previewOrigin, locale: "sv-SE" });
const base = "/github-dashboard/";
const guideUrl = `${previewOrigin}${base}ISSUEFLOW.md`;

test("production popup shows and copies the complete raw Markdown with no reference or download links", async ({ page, request }) => {
  const response = await request.get(guideUrl);
  expect(response.ok()).toBe(true);
  const markdown = await response.text();
  expect(markdown).toContain("# Issueflow-compatible issue workflow");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { Object.assign(window, { copiedGuide: value }); },
    } });
  });
  await page.goto(base);
  await openSettings(page);
  const trigger = page.getByRole("button", { name: "Instruktioner för issueflödet", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const guide = page.getByRole("dialog", { name: "Instruktioner för issueflödet", exact: true });
  await expect(guide.getByRole("button", { name: "Stäng", exact: true })).toBeFocused();
  const field = guide.getByLabel("Instruktioner (Markdown)", { exact: true });
  await expect(field).toHaveValue(markdown);
  await expect(field).toHaveAttribute("readonly", "");
  await expect(guide.locator(".workflow-document, a")).toHaveCount(0);
  expect(await field.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect((await field.boundingBox())!.height).toBeLessThanOrEqual(220);
  await guide.getByRole("button", { name: "Kopiera instruktioner", exact: true }).click();
  await expect(guide.getByRole("status")).toHaveText("Instruktionerna har kopierats.");
  expect(await page.evaluate(() => (window as unknown as { copiedGuide: string }).copiedGuide)).toBe(markdown);
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible(); await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Inställningar", exact: true })).toBeVisible();
});

test("denied clipboard selects all Markdown and the compact textarea scrolls on mobile in either language", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); },
    } });
  });
  await page.goto(base);
  await openSettings(page);
  await page.getByRole("button", { name: "Instruktioner för issueflödet", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Instruktioner för issueflödet", exact: true });
  const field = dialog.getByLabel("Instruktioner (Markdown)", { exact: true });
  const markdown = await field.inputValue();
  await dialog.getByRole("button", { name: "Kopiera instruktioner", exact: true }).click();
  await expect(field).toBeFocused();
  expect(await field.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(markdown);
  await expect(dialog.getByRole("status")).toHaveText("Kopiera den markerade texten manuellt.");
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Stäng", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Issue workflow instructions", exact: true }).click();
  const english = page.getByRole("dialog", { name: "Issue workflow instructions", exact: true });
  const englishField = english.getByLabel("Instructions (Markdown)", { exact: true });
  await expect(englishField).toHaveValue(markdown);
  const headingBox = await english.locator(".guide-heading").boundingBox();
  await englishField.focus(); await englishField.press("Control+End");
  await expect.poll(() => englishField.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(english.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await expect(english.getByRole("button", { name: "Copy instructions", exact: true })).toBeVisible();
  expect(await english.locator(".guide-heading").boundingBox()).toEqual(headingBox);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
