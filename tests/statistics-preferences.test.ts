import { describe, expect, it } from "vitest";
import { normalizeStatisticsPreference, statisticsRepositoryCollapsed } from "../src/lib/statistics-preferences";
import type { StatisticsPreference } from "../src/lib/statistics";
const window = { from: "2026-09-17", to: "2026-10-16" };
const preference: StatisticsPreference = { ...window, label: "bug", contributor: "alice", metric: "commits" };
describe("repository statistics preferences", () => {
  it("defaults to the entire current window with no dimension filter", () => {
    expect(normalizeStatisticsPreference(undefined, window)).toEqual({ ...window, label: "", contributor: "", metric: "closed" });
  });
  it("clamps transferred dates while preserving independent valid filter choices", () => {
    const normalized = normalizeStatisticsPreference({ ...preference, from: "2025-01-01", to: "2027-01-01" }, window, { labels: ["bug"], contributors: ["alice"], metrics: ["closed", "commits"] });
    expect(normalized).toEqual(preference);
    expect(preference.from).toBe("2026-09-17");
  });
  it("resets impossible calendar dates and inverted ranges", () => {
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-09-31", to: "2026-02-30" }, window)).toEqual(preference);
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-10-15", to: "2026-09-20" }, window)).toEqual(preference);
  });
  it("preserves imported dimensions until data arrives, then silently removes inaccessible choices", () => {
    expect(normalizeStatisticsPreference(preference, window)).toEqual(preference);
    expect(normalizeStatisticsPreference(preference, window, { labels: ["feature"], contributors: [], metrics: ["created"] })).toEqual({ ...window, label: "", contributor: "", metric: "created" });
  });
  it("does not mutate preferences shared by another repository", () => {
    const other = { ...preference, label: "feature", contributor: "bob" };
    const first = normalizeStatisticsPreference(preference, window, { labels: [], contributors: [], metrics: ["closed"] });
    const second = normalizeStatisticsPreference(other, window, { labels: ["feature"], contributors: ["bob"], metrics: ["commits"] });
    expect(first.label).toBe(""); expect(second).toEqual(other); expect(preference.label).toBe("bug");
  });
  it("normalizes multiple chart metrics and clamps overly fine resolution for long ranges", () => {
    const multi = normalizeStatisticsPreference(
      { ...preference, metric: "created", metrics: ["created", "closed", "commits"], range: "30d", resolution: "1m" },
      window,
      { labels: ["bug"], contributors: ["alice"], metrics: ["created", "closed"] },
    );
    expect(multi).toEqual({
      ...preference,
      metric: "created",
      metrics: ["created", "closed"],
      range: "30d",
      resolution: "6h",
    });
    const fine8h = normalizeStatisticsPreference(
      { ...preference, range: "8h", resolution: "1m" },
      window,
    );
    expect(fine8h.resolution).toBe("1m");
  });
});

it('preserves explicit collapse flags while old preferences default to first open', () => {
  for (const collapsed of [false, true]) {
    const saved = normalizeStatisticsPreference({ ...preference, collapsed }, window);
    expect(saved.collapsed).toBe(collapsed);
    expect(statisticsRepositoryCollapsed({ 'sample/repo': saved }, 'sample/repo', collapsed ? 0 : 2)).toBe(collapsed);
  }
  expect(statisticsRepositoryCollapsed({}, 'sample/first', 0)).toBe(false);
  expect(statisticsRepositoryCollapsed({ 'sample/repo': preference }, 'sample/repo', 1)).toBe(true);
});
