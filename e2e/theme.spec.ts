import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";
test.use({ locale: "en-US" });

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)"
  ? getComputedStyle(document.documentElement).backgroundColor
  : getComputedStyle(document.body).backgroundColor);
const themeColor = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute("content");

test("Auto follows the emulated color scheme live and a manual choice overrides it", async ({ page }) => {
  // Records the theme at the moment <body> is parsed, before the app bundle renders anything.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      (window as unknown as { firstPaintTheme?: string }).firstPaintTheme = document.documentElement.dataset.theme;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => (window as unknown as { firstPaintTheme?: string }).firstPaintTheme)).toBe("dark");
  expect(await background(page)).toBe("rgb(15, 23, 25)");
  expect(await themeColor(page)).toBe("#10191b");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await background(page)).toBe("rgb(246, 247, 249)");
  expect(await themeColor(page)).toBe("#147d69");

  await openSettings(page, "Settings");
  const theme = page.getByLabel("Theme", { exact: true });
  await expect(theme).toHaveValue("auto");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => (window as unknown as { firstPaintTheme?: string }).firstPaintTheme)).toBe("dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page, "Settings");
  await theme.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.selectOption("auto");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("dark demo board keeps text and repository colors readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Project overview/ })).toBeVisible();
  const contrast = await page.evaluate(() => {
    const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    // color-mix() computes to color(srgb r g b) with 0–1 channels; rgb() uses 0–255.
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) * (color.startsWith("color(") ? 255 : 1));
    const luminance = (color: string) => { const [r, g, b] = rgb(color).map(channel); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
    const card = document.querySelector(".issue-card")!;
    const cardBackground = getComputedStyle(card).backgroundColor;
    const sidebarBackground = getComputedStyle(document.querySelector(".sidebar")!).backgroundColor;
    return {
      title: ratio(getComputedStyle(card.querySelector(".issue-title")!).color, cardBackground),
      number: ratio(getComputedStyle(card.querySelector(".issue-number")!).color, cardBackground),
      dots: [...document.querySelectorAll(".sidebar-repository .repo-dot")].map(dot => ratio(getComputedStyle(dot).backgroundColor, sidebarBackground)),
      dotColors: new Set([...document.querySelectorAll(".sidebar-repository .repo-dot")].map(dot => getComputedStyle(dot).backgroundColor)).size,
      dotCount: document.querySelectorAll(".sidebar-repository .repo-dot").length,
    };
  });
  expect(contrast.title).toBeGreaterThanOrEqual(4.5);
  expect(contrast.number).toBeGreaterThanOrEqual(4.5);
  expect(contrast.dots.length).toBeGreaterThan(0);
  for (const dot of contrast.dots) expect(dot).toBeGreaterThanOrEqual(3);
  expect(contrast.dotColors).toBe(contrast.dotCount);
});
