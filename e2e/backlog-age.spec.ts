import { expect, test } from "@playwright/test";

for (const language of [
  { locale: "en-US", demo: "Explore a demo", age: /^Created .* ago$/ },
  { locale: "sv-SE", demo: "Utforska en demo", age: /^Skapad .* sedan$/ },
]) {
  test.describe(language.locale, () => {
    test.use({ locale: language.locale });

    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      test(`backlog age uses compact metadata at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto("/");
        await page.getByRole("button", { name: language.demo, exact: true }).click();
        const age = page.locator(".backlog-age").first();
        const closedDate = page.locator(".issue-card.closed .closed-date").first();
        await age.scrollIntoViewIfNeeded();
        await expect(age).toBeVisible();
        await expect(age).toHaveText(language.age);
        await expect(age).toHaveJSProperty("tagName", "TIME");
        const timestamp = await age.getAttribute("datetime");
        expect(Number.isFinite(Date.parse(timestamp!))).toBe(true);
        expect(await age.getAttribute("title")).toBeTruthy();

        const metadataStyle = (element: Element) => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, color: style.color, fontWeight: style.fontWeight };
        };
        const ageStyle = await age.evaluate(metadataStyle);
        const closedStyle = await closedDate.evaluate(metadataStyle);
        expect(ageStyle.fontSize).toBe(closedStyle.fontSize);
        expect(ageStyle.fontWeight).toBe(closedStyle.fontWeight);
        expect(ageStyle.color).toBe("rgb(135, 146, 154)");
        expect(parseFloat(ageStyle.fontSize)).toBeLessThanOrEqual(11);
        const titleSize = await page.locator(".issue-card.backlog .issue-title").first()
          .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        expect(parseFloat(ageStyle.fontSize)).toBeLessThan(titleSize);
      });
    }
  });
}
