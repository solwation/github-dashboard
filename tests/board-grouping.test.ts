import { describe, expect, it } from "vitest";
import { boardGroupingFrom } from "../src/lib/board-grouping";
import { decodeHandoff, encodeHandoff, mergeHandoffPreferences, parseHandoffPreferences, type HandoffPreferences } from "../src/lib/handoff";
import { watchSettings } from "../src/lib/background-check";

const selected = ["sample/a", "sample/b"];
const merge = (preferences: HandoffPreferences, current: HandoffPreferences = {}) =>
  mergeHandoffPreferences({ selected, rules: {}, ...current }, { selected, rules: {}, preferences }, selected);

describe("board grouping (#390)", () => {
  it("migrates the old split boolean without changing the effective choice", () => {
    expect(boardGroupingFrom({ splitByRepository: true })).toBe("split");
    expect(boardGroupingFrom({ splitByRepository: false })).toBe("none");
    expect(boardGroupingFrom({})).toBe("split");
    expect(boardGroupingFrom({}, "swimlanes")).toBe("swimlanes");
    expect(boardGroupingFrom({ boardGrouping: "swimlanes", splitByRepository: false })).toBe("swimlanes");
    expect(boardGroupingFrom({ boardGrouping: "rows", splitByRepository: false })).toBe("none");
  });
  it("restores saved and transferred settings, keeping the legacy field in step for older readers", () => {
    // Saved settings from before #390 only have the boolean.
    expect(merge({ splitByRepository: false }, { boardGrouping: "split" })).toMatchObject({ boardGrouping: "none", splitByRepository: false });
    expect(merge({ splitByRepository: true }, { boardGrouping: "none" })).toMatchObject({ boardGrouping: "split", splitByRepository: true });
    // An explicit choice wins over the boolean written beside it.
    expect(merge({ boardGrouping: "swimlanes", splitByRepository: false }, { boardGrouping: "split" })).toMatchObject({ boardGrouping: "swimlanes", splitByRepository: false });
    // Codes without either field keep the receiver's choice, including one derived from an older state.
    expect(merge({ language: "en" }, { boardGrouping: "swimlanes" }).boardGrouping).toBe("swimlanes");
    expect(merge({ language: "en" }, { splitByRepository: false }).boardGrouping).toBe("none");
    expect(merge({ language: "en" }).boardGrouping).toBe("split");
  });
  it("validates the stored value and survives the optical transfer", () => {
    expect(() => parseHandoffPreferences({ boardGrouping: "lanes" })).toThrow();
    expect(parseHandoffPreferences({ boardGrouping: "swimlanes" })).toEqual({ boardGrouping: "swimlanes" });
    const now = Date.UTC(2026, 10, 4, 9);
    const decoded = decodeHandoff(encodeHandoff({ token: "fictional-grouping-token", selected, rules: {}, preferences: { boardGrouping: "swimlanes", splitByRepository: false } }, now), now);
    expect(decoded.preferences).toEqual({ boardGrouping: "swimlanes", splitByRepository: false });
  });
  it("applies per-repository searches in background checks only for split boards", () => {
    const settings = (preferences: Record<string, unknown>) => watchSettings({ selected, preferences: { notificationRepos: selected, ...preferences } });
    expect(settings({}).splitByRepository).toBe(true);
    expect(settings({ splitByRepository: false }).splitByRepository).toBe(false);
    expect(settings({ boardGrouping: "swimlanes", splitByRepository: false }).splitByRepository).toBe(false);
    expect(settings({ boardGrouping: "split", splitByRepository: false }).splitByRepository).toBe(true);
  });
});
