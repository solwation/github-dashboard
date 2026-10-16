import { describe, expect, it } from "vitest";
import { normalizeStatisticsPreference } from "../src/lib/statistics-preferences";
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
});
