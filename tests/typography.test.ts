import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Guard every breakpoint and scoped component, including content not open in the browser matrix.
// Relative rem sizes resolve against the browser's default 16px root.
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(join(directory, entry.name))
    : /\.(css|vue)$/.test(entry.name) ? [join(directory, entry.name)] : []);
}
test("application typography never sets text below the 10px design floor", () => {
  const small: string[] = [];
  for (const file of sources("src")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/font(?:-size)?\s*:\s*(?:[\w.-]+\s+)*?(\d*\.?\d+)\s*(px|rem)\b/g)) {
      const pixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
      if (pixels < 10) small.push(`${file}:${source.slice(0, match.index).split("\n").length} ${match[0]}`);
    }
  }
  expect(small).toEqual([]);
});

test("secondary tokens meet AA on shared surfaces and translucent hover layers in both themes", () => {
  const css = readFileSync("src/style.css", "utf8");
  const declarations = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));
  const light = declarations(css.match(/:root\s*\{([^}]+)\}/)![1]!);
  const dark = { ...light, ...declarations(css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]!) };
  const luminance = (rgb: number[]) => rgb.map(value => {
    const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index]!, 0);
  for (const tokens of [light, dark]) {
    const rgb = (name: string): number[] => {
      const value = tokens[name]!;
      const variable = value.match(/^var\((--[\w-]+)\)$/);
      if (variable) return rgb(variable[1]!);
      const hex = value.slice(1);
      return (hex.length === 3 ? hex.split("").map(v => v + v) : hex.match(/../g)!).map(v => parseInt(v, 16));
    };
    const backgrounds = ["--bg", "--surface", "--card", "--hover", "--code-bg", "--unread-move-bg", "--unread-created-bg", "--timeout-bg", "--badge-bg", "--badge-progress-bg", "--badge-closed-bg"].map(rgb);
    // Shared hover/focus rules mix green over the actual surface with 10–12% alpha.
    for (const base of ["--surface", "--bg"]) backgrounds.push(rgb(base).map((value, index) => .88 * value + .12 * rgb("--green")[index]!));
    for (const token of ["--muted", "--faint"]) for (const background of backgrounds) {
      const [low, high] = [luminance(rgb(token)), luminance(background)].sort((a, b) => a - b);
      expect((high! + .05) / (low! + .05), `${token} on ${background.join(",")}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
