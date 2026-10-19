import { describe, expect, it } from "vitest";
import {
  formatStatisticsBound, parseStatisticsBound, statisticsDurationMs, statisticsPresetWindow, statisticsRanges,
  statisticsWindow, summarizeStatistics, validStatisticsBound,
  type StatisticsData, type StatisticsIssue, type StatisticsRangePreset, type StatisticsSource,
} from "../src/lib/statistics";
import { normalizeStatisticsPreference } from "../src/lib/statistics-preferences";
import { parseHandoffPreferences } from "../src/lib/handoff-preferences";
import { decodeCompactHandoff, encodeCompactHandoff } from "../src/lib/handoff-codec";

const now = Date.parse("2026-10-16T15:20:00Z");
const period = statisticsWindow(now); // 2026-09-17 .. 2026-10-16
const source = <T>(data: T[]): StatisticsSource<T> => ({ data, complete: true, fetchedAt: now });
const oldIssue: StatisticsIssue = { id: 1, number: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-16T02:00:00Z", labels: [{ name: "old" }], user: { login: "alice" } };
const recentIssue: StatisticsIssue = { id: 2, number: 2, created_at: "2026-10-15T09:00:00Z", updated_at: "2026-10-15T21:00:00Z", labels: [{ name: "bug" }], user: { login: "bob" } };
const commit = (sha: string, login: string, date: string) => ({ sha, parents: [{ sha: "p" }], author: { login }, commit: { committer: { date } } });
function data(): StatisticsData {
  return {
    repository: "sample/repo", ...period, fetchedAt: now, temporary: [],
    issues: source([oldIssue, recentIssue]),
    events: source([
      { id: 1, event: "closed", created_at: "2026-10-15T21:00:00Z", actor: { login: "bob" }, issue: recentIssue },
      { id: 2, event: "closed", created_at: "2026-10-16T02:00:00Z", actor: { login: "alice" }, issue: oldIssue },
      { id: 3, event: "reopened", created_at: "2026-10-16T14:59:00Z", actor: { login: "alice" }, issue: oldIssue },
    ]),
    commits: source([commit("c1", "alice", "2026-10-02T12:00:00Z"), commit("c2", "bob", "2026-10-15T12:00:00Z")]),
    changes: source([{ sha: "c2", date: "2026-10-15T12:00:00Z", contributor: "bob", additions: 20, deletions: 2, files: 2, filesComplete: true }]),
    pulls: source([{ id: 1, created_at: "2026-10-15T08:59:00Z", updated_at: "2026-10-15", closed_at: null, merged_at: null, labels: [], user: { login: "bob" } }]),
  };
}
const base = { label: "", contributor: "" };
function expectTotalsMatchDays(result: ReturnType<typeof summarizeStatistics>) {
  expect(Object.keys(result.totals).length).toBeGreaterThan(0);
  for (const [metric, total] of Object.entries(result.totals)) {
    expect(result.days.reduce((sum, day) => sum + (day.values[metric as keyof typeof day.values] ?? 0), 0), metric).toBe(total);
  }
}

describe("statistics window bounds with UTC clock time (#168)", () => {
  it("parses legacy dates and exact datetimes and formats back", () => {
    expect(parseStatisticsBound("2026-10-16", "start")).toBe(Date.parse("2026-10-16T00:00:00Z"));
    expect(parseStatisticsBound("2026-10-16", "end")).toBe(Date.parse("2026-10-17T00:00:00Z"));
    expect(parseStatisticsBound("2026-10-16T09:45", "start")).toBe(Date.parse("2026-10-16T09:45:00Z"));
    expect(parseStatisticsBound("2026-10-16T09:45", "end")).toBe(Date.parse("2026-10-16T09:45:00Z"));
    expect(formatStatisticsBound(Date.parse("2026-10-16T09:45:30Z"))).toBe("2026-10-16T09:45");
    for (const bad of ["2026-02-30", "2026-10-16T24:00", "2026-10-16T09:60", "2026-10-16 09:00", "2026-10-16T09:00Z", ""]) {
      expect(validStatisticsBound(bad), bad).toBe(false);
      expect(parseStatisticsBound(bad, "start")).toBeNaN();
    }
  });

  it("gives each preset a concrete window ending at its current bucket boundary", () => {
    const expected: Record<StatisticsRangePreset, { from: string; to: string }> = {
      "8h": { from: "2026-10-16T07:30", to: "2026-10-16T15:30" },
      "12h": { from: "2026-10-16T03:30", to: "2026-10-16T15:30" },
      "24h": { from: "2026-10-15T16:00", to: "2026-10-16T16:00" },
      "3d": { from: "2026-10-14T00:00", to: "2026-10-17T00:00" },
      "7d": { from: "2026-10-10T00:00", to: "2026-10-17T00:00" },
      "21d": { from: "2026-09-26T00:00", to: "2026-10-17T00:00" },
      "30d": { from: "2026-09-17T00:00", to: "2026-10-17T00:00" },
    };
    for (const preset of statisticsRanges) expect(statisticsPresetWindow(preset, now, period), preset).toEqual(expected[preset]);
    // Exactly on a boundary, the bucket starting at now is the last one.
    expect(statisticsPresetWindow("24h", Date.parse("2026-10-16T15:00:00Z"), period)).toEqual({ from: "2026-10-15T16:00", to: "2026-10-16T16:00" });
    // The start never precedes the fetched period.
    expect(statisticsPresetWindow("30d", now, { from: "2026-10-01", to: "2026-10-16" })).toEqual({ from: "2026-10-01T00:00", to: "2026-10-17T00:00" });
    // #169: a coarser selected resolution aligns the window to its own step; a finer one keeps the default.
    expect(statisticsPresetWindow("8h", now, period, "30m")).toEqual({ from: "2026-10-16T07:30", to: "2026-10-16T15:30" });
    expect(statisticsPresetWindow("8h", now, period, "1m")).toEqual(statisticsPresetWindow("8h", now, period));
    expect(statisticsPresetWindow("3d", now, period, "1h")).toEqual(statisticsPresetWindow("3d", now, period));
  });

  it("summarizes a preset's concrete window exactly like the legacy range filter", () => {
    for (const [range, resolution] of [["24h", "1h"], ["8h", "15m"], ["3d", "1d"], ["3d", "6h"], ["30d", "1d"]] as const) {
      const legacy = summarizeStatistics([data()], { ...base, ...period, range, resolution, now });
      const concrete = summarizeStatistics([data()], { ...base, ...statisticsPresetWindow(range, now, period), range, resolution });
      expect(concrete.days, `${range}/${resolution}`).toEqual(legacy.days);
      expect(concrete.totals).toEqual(legacy.totals);
      expect(concrete.contributors).toEqual(legacy.contributors);
      expect(concrete.labels).toEqual(legacy.labels);
      expect(concrete.closureAgeDays).toBe(legacy.closureAgeDays);
    }
  });

  it("counts only events inside a custom [from, to) datetime window, totals equal the buckets", () => {
    const window = { from: "2026-10-15T09:00", to: "2026-10-16T02:00" };
    expect(statisticsDurationMs({ ...window, range: "3d" })).toBe(17 * 3_600_000);
    const result = summarizeStatistics([data()], { ...base, ...window, range: "3d", resolution: "1h" });
    expect(result.days).toHaveLength(17);
    expect(result.days[0]!.date).toBe("2026-10-15 09:00");
    expect(result.days[16]!.date).toBe("2026-10-16 01:00");
    expectTotalsMatchDays(result);
    // Start is inclusive (issue at 09:00), end is exclusive (closure at 02:00).
    expect(result.totals).toMatchObject({ created: 1, closed: 1, reopened: 0, commits: 1, additions: 20, prsOpened: 0 });
    expect(result.labels).toEqual([{ name: "bug", count: 1 }]);
    expect(result.contributors).toEqual([{ name: "bob", commits: 1, additions: 20, deletions: 2 }]);

    // An unaligned start keeps grid labels but drops records before the exact minute.
    const shifted = summarizeStatistics([data()], { ...base, from: "2026-10-15T09:30", to: "2026-10-16T02:01", resolution: "1h" });
    expect(shifted.days[0]!.date).toBe("2026-10-15 09:00");
    expect(shifted.days).toHaveLength(18);
    expectTotalsMatchDays(shifted);
    expect(shifted.totals).toMatchObject({ created: 0, closed: 2, commits: 1 });

    // Without an explicit resolution the duration picks a valid one; day buckets use date labels.
    const days = summarizeStatistics([data()], { ...base, from: "2026-10-10T00:00", to: "2026-10-17T00:00" });
    expect(days.days.map(day => day.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expectTotalsMatchDays(days);
    expect(days.totals).toMatchObject({ created: 1, closed: 2, reopened: 1, commits: 1, prsOpened: 1 });
  });
});

describe("statistics preferences with UTC clock time (#168)", () => {
  const preference = { ...period, label: "", contributor: "", metric: "closed" as const };
  it("keeps legacy date preferences unchanged", () => {
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-10-01", to: "2026-10-05", range: "3d" }, period))
      .toEqual({ ...preference, from: "2026-10-01", to: "2026-10-05", range: "3d" });
    expect(normalizeStatisticsPreference({ ...preference, from: "2025-01-01", to: "2027-01-01" }, period)).toEqual(preference);
  });
  it("accepts datetime windows, clamps them to the period and resets inverted ones", () => {
    const valid = { ...preference, from: "2026-10-16T07:30", to: "2026-10-16T15:30", range: "8h" as const, resolution: "1m" as const };
    expect(normalizeStatisticsPreference(valid, period)).toEqual(valid);
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-09-01T10:00", to: "2026-12-01T00:00" }, period))
      .toEqual({ ...preference, from: "2026-09-17T00:00", to: "2026-10-17T00:00" });
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-10-16T10:00", to: "2026-10-16T10:00" }, period)).toEqual(preference);
    // An invalid bound falls back to the period edge on its own, as for dates.
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-10-16T25:00", to: "2026-10-16T10:00" }, period))
      .toEqual({ ...preference, to: "2026-10-16T10:00" });
    // Mixed formats are a valid concrete window.
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-10-15", to: "2026-10-16T12:00" }, period))
      .toEqual({ ...preference, from: "2026-10-15", to: "2026-10-16T12:00" });
    // Resolution is clamped against the concrete duration, not the preset label.
    expect(normalizeStatisticsPreference({ ...preference, from: "2026-09-17T00:00", to: "2026-10-17T00:00", range: "8h", resolution: "1m" }, period).resolution).toBe("1h");
  });
  it("accepts transferred datetime windows and rejects malformed ones", () => {
    const statistics = { "sample/repo": { from: "2026-10-15T16:00", to: "2026-10-16T16:00", label: "", contributor: "", metric: "closed", range: "24h" } };
    expect(parseHandoffPreferences({ statistics })).toEqual({ statistics });
    expect(decodeCompactHandoff(encodeCompactHandoff({ statistics }))).toEqual({ statistics });
    expect(parseHandoffPreferences({ statistics: { "sample/repo": { ...statistics["sample/repo"], from: "2026-10-15" } } })).toBeTruthy();
    for (const bad of [{ from: "2026-10-16T16:00", to: "2026-10-16T16:00" }, { from: "2026-10-16T24:00" }, { to: "2026-10-16 16:00" }]) {
      expect(() => parseHandoffPreferences({ statistics: { "sample/repo": { ...statistics["sample/repo"], ...bad } } })).toThrow();
    }
  });
});
