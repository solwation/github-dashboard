import { describe, expect, it } from "vitest";
import { effectiveColumnLimit, restoreColumnLimits, validColumnLimit } from "../src/lib/column-limits";

describe("column visibility preferences", () => {
  it("migrates existing settings to six and discards malformed, out-of-range and inaccessible overrides", () => {
    expect(restoreColumnLimits(null, ["team/a"])).toEqual({ global: 6, overrides: {} });
    expect(restoreColumnLimits({ columnLimit: 0, repositoryColumnLimits: { "team/a": 3, "private/b": 4, "team/c": 1.5, "team/d": "7" } }, ["team/a", "team/c", "team/d"]))
      .toEqual({ global: 6, overrides: { "team/a": 3 } });
    expect(restoreColumnLimits({ columnLimit: 100, repositoryColumnLimits: [] }, [])).toEqual({ global: 100, overrides: {} });
  });
  it("accepts only whole numbers in range and preserves independent repository limits", () => {
    for (const value of [null, undefined, "6", 0, -1, 1.2, Infinity, NaN, 101]) expect(validColumnLimit(value)).toBe(false);
    expect(validColumnLimit(1)).toBe(true);
    const overrides = { "team/a": 3 };
    expect(effectiveColumnLimit(6, overrides, "team/a")).toBe(3);
    expect(effectiveColumnLimit(2, overrides, "team/a")).toBe(3);
    expect(effectiveColumnLimit(2, overrides, "team/b")).toBe(2);
    expect(restoreColumnLimits({ columnLimit: 7, repositoryColumnLimits: overrides }, ["team/a"]))
      .toEqual({ global: 7, overrides });
  });
});
