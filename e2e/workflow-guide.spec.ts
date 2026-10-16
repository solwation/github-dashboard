import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ baseURL: "http://127.0.0.1:4173", locale: "sv-SE" });
const base = "/github-dashboard/";
const guideUrl = `http://127.0.0.1:4173${base}ISSUEFLOW.md`;

test("public production guide is directly fetchable and its reference and download use the app base", async ({ page, request }) => {
  // No sign-in, API fixtures or request credentials are needed to fetch the file.
  const response = await request.get(guideUrl);
  expect(response.ok()).toBe(true);
  const markdown = await response.text();
  expect(markdown).toContain("# Issueflow-compatible issue workflow");
  expect(markdown).toContain("priority: medium");
  expect(markdown).toContain("in-progress");
  expect(markdown).not.toContain("<!doctype html>");

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { Object.assign(window, { copiedGuide: value }); },
    } });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  const guide = page.getByRole("region", { name: "Instruktioner för issueflödet" });
  const summary = guide.locator("summary");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(guide.getByRole("heading", { name: "Issueflow-compatible issue workflow", exact: true })).toBeHidden();
  await summary.focus();
  await summary.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  const document = guide.locator(".workflow-document");
  await expect(document.getByRole("heading", { name: "Issueflow-compatible issue workflow", exact: true })).toBeVisible();
  await expect(document.getByRole("table")).toBeVisible();
  // The inline document and downloadable file must describe the same workflow.
  const headings = markdown.split("\n").filter(line => line.startsWith("## ")).map(line => line.slice(3));
  for (const heading of headings) await expect(document.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(document).toContainText("This guide describes Issueflow's default detection and per-repository overrides.");
  expect(await summary.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeLessThanOrEqual(14);
  await summary.press("Space");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(document).toBeHidden();
  await summary.press("Enter");
  await expect(guide.getByRole("link", { name: guideUrl, exact: true })).toHaveAttribute("href", guideUrl);
  const reference = page.getByLabel("Hänvisning för din AI-assistent");
  await expect(reference).toHaveValue(`Läs och följ instruktionerna på ${guideUrl} när du arbetar med issues i det här projektet.`);
  await guide.getByRole("button", { name: "Kopiera hänvisning" }).click();
  await expect(guide.getByRole("status")).toHaveText("Hänvisningen har kopierats.");
  expect(await page.evaluate(() => (window as unknown as { copiedGuide: string }).copiedGuide)).toBe(await reference.inputValue());

  const downloadEvent = page.waitForEvent("download");
  await guide.getByRole("link", { name: "Ladda ned ISSUEFLOW.md" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("ISSUEFLOW.md");
  expect(await readFile((await download.path())!, "utf8")).toBe(markdown);
});

test("denied clipboard selects a manual copy fallback and guide stays within mobile settings", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); },
    } });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByRole("region", { name: "Instruktioner för issueflödet" }).locator("summary").click();
  await page.getByRole("button", { name: "Kopiera hänvisning" }).click();
  const field = page.getByLabel("Hänvisning för din AI-assistent");
  await expect(field).toBeFocused();
  expect(await field.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(await field.inputValue());
  await expect(page.getByRole("status").filter({ hasText: "Kopiera den markerade hänvisningen manuellt." })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Inställningar", exact: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const document = page.locator(".workflow-document");
  expect(await document.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(document.getByRole("table")).toBeVisible();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await expect(page.getByRole("heading", { name: "Issue workflow instructions" })).toBeVisible();
  await expect(page.getByText("ISSUEFLOW.md is a guide for you and your AI assistant.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Issue workflow instructions" }).locator("summary")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Reference for your AI assistant")).toHaveValue(`Read and follow the instructions at ${guideUrl} when working with issues in this project.`);
});
