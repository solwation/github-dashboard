import { expect, type Page } from "@playwright/test";

/** Checks rendered text rather than matching CSS declarations: inherited colour, actual
 * state/badge surfaces and translucent color-mix() hover layers all participate. */
export async function textAccessibility(page: Page) {
  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const blend = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3]! + back[index]! * (1 - front[3]!)).concat(1);
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index]!, 0);
    const ratio = (a: number[], b: number[]) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high! + .05) / (low! + .05);
    };
    const root = getComputedStyle(document.documentElement);
    const secondary = ["--muted", "--faint"].map(name => rgba(root.getPropertyValue(name)).slice(0, 3).join(","));
    const violations: string[] = [], measured: { text: string; selector: string; size: number; contrast: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const element = node.parentElement!;
      const range = document.createRange(); range.selectNodeContents(node);
      const textBox = range.getBoundingClientRect();
      // Icon-rail labels use font-size:0; the parent has an icon-sized hit target.
      if (!textBox.width || !textBox.height) continue;
      if (element.closest("script,style")) continue;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!box.width || !box.height || style.visibility !== "visible") continue;
      const chain: Element[] = [];
      let opacity = 1;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        chain.unshift(ancestor); opacity *= Number(getComputedStyle(ancestor).opacity);
      }
      if (opacity === 0) continue;
      const text = node.textContent.trim().slice(0, 65), selector = element.className.toString();
      const size = parseFloat(style.fontSize);
      if (size < 10) violations.push(`${selector} ${size}px: ${text}`);
      const foreground = rgba(style.color);
      if (!secondary.includes(foreground.slice(0, 3).join(","))) continue;
      // Disabled controls have an explicit WCAG contrast exemption.
      if (element.closest(":disabled")) continue;
      let background = rgba(root.backgroundColor);
      for (const ancestor of chain) background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background);
      const effective = foreground.slice(0, 3).concat(foreground[3]! * opacity);
      const contrast = ratio(blend(effective, background), background);
      measured.push({ text, selector, size, contrast });
      if (contrast < 4.5) violations.push(`${selector} ${contrast.toFixed(2)}:1: ${text}`);
    }
    return { violations, measured };
  });
  expect(result.violations).toEqual([]);
  expect(result.measured.length).toBeGreaterThan(0);
  return result.measured;
}
