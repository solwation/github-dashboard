import { describe, expect, it } from "vitest";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, commitContributor, dayOf, DEFAULT_STATISTICS_RANGE,
  statisticsDimensions, statisticsDurationMs, statisticsWindow, summarizeStatistics,
  type StatisticsData, type StatisticsIssue, type StatisticsSource,
} from "../src/lib/statistics";

const now = Date.parse("2026-10-16T15:00:00Z");
const source = <T>(data: T[], complete = true): StatisticsSource<T> => ({ data, complete, fetchedAt: now });
const issue: StatisticsIssue = { id: 1, number: 1, created_at: "2026-10-10T12:00:00Z", updated_at: "2026-10-16T10:00:00Z", labels: [{ name: "bug" }], user: { login: "alice" } };
function snapshot(): StatisticsData {
  return {
    repository: "sample/repo", ...statisticsWindow(now), fetchedAt: now, temporary: [], issues: source([issue]),
    events: source([
      { id: 1, event: "closed", created_at: "2026-10-11T12:00:00Z", actor: { login: "bob" }, issue },
      { id: 2, event: "reopened", created_at: "2026-10-12T12:00:00Z", actor: { login: "alice" }, issue },
      { id: 3, event: "closed", created_at: "2026-10-13T12:00:00Z", actor: { login: "alice" }, issue },
    ]),
    commits: source([
      { sha: "first", parents: [{ sha: "parent" }], author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-09T23:00:00-02:00" }, committer: { date: "2026-10-10T00:10:00Z" } } },
      { sha: "merge", parents: [{ sha: "first" }, { sha: "other" }], author: { login: "bob" }, commit: { committer: { date: "2026-10-11T00:00:00Z" } } },
    ]),
    changes: source([{ sha: "first", date: "2026-10-10T00:10:00Z", contributor: "alice", additions: 30, deletions: 50, files: 2, filesComplete: true }]),
    pulls: source([
      { id: 1, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-13", closed_at: "2026-10-13T00:00:00Z", merged_at: "2026-10-13T00:00:00Z", labels: [{ name: "feature" }], user: { login: "bob" } },
      { id: 2, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-13", closed_at: "2026-10-13T00:00:00Z", merged_at: null, labels: [], user: { login: "alice" } },
    ]),
  };
}
const filter = { ...statisticsWindow(now), label: "", contributor: "" };
describe("statistics calculations", () => {
  it("uses exactly thirty UTC calendar days even around timezone changes", () => {
    expect(statisticsWindow(Date.parse("2026-10-25T23:30:00-02:00"))).toEqual({ from: "2026-09-27", to: "2026-10-26" });
    const result = summarizeStatistics([snapshot()], filter);
    expect(result.days).toHaveLength(30);
    expect(result.days[0]!.date).toBe("2026-09-17");
    expect(result.days[29]!.date).toBe("2026-10-16");
  });
  it("counts actual closure and reopen events, including multiple closures of one issue", () => {
    const result = summarizeStatistics([snapshot()], filter);
    expect(result.totals).toMatchObject({ created: 1, closed: 2, reopened: 1, netIssues: 0, commits: 2, additions: 30, deletions: 50, netLines: -20, files: 2, prsOpened: 2, prsMerged: 1, prsClosed: 1 });
    expect(result.closureAgeDays).toBe(2);
    expect(result.days.find(day => day.date === "2026-10-12")!.values).toMatchObject({ reopened: 1, closed: 0, netIssues: 1 });
    expect(result.days.find(day => day.date === "2026-10-10")!.values.commits).toBe(1);
  });
  it("filters exact dates, present-day labels and each source's relevant contributor", () => {
    const result = summarizeStatistics([snapshot()], { ...filter, from: "2026-10-12", to: "2026-10-13", label: "bug", contributor: "alice" });
    expect(result.days).toHaveLength(2);
    expect(result.totals).toMatchObject({ closed: 1, reopened: 1, created: 0, netIssues: 0, prsOpened: 0 });
    expect(result.totals.commits).toBeUndefined();
    expect(result.totals.additions).toBeUndefined();
    expect(result.closureAgeDays).toBe(3);
  });
  it("distinguishes inaccessible sources from true zero and hides combined incomplete access", () => {
    const restricted = { ...snapshot(), events: null, commits: null, changes: null, pulls: null };
    const result = summarizeStatistics([restricted], filter);
    expect(result.totals).toEqual({ created: 1 });
    expect(result.closureAgeDays).toBeNull();
    const combined = summarizeStatistics([snapshot(), restricted], filter);
    expect(combined.totals).toEqual({ created: 2 });
    expect(combined.complete).toEqual({ created: true });
    expect(summarizeStatistics([{ ...restricted, issues: source([]) }], filter).totals.created).toBe(0);
  });
  it("marks capped pages and truncated commit files without disguising them as totals", () => {
    const data = snapshot(); data.events!.complete = false; data.changes!.data[0]!.filesComplete = false;
    const result = summarizeStatistics([data], filter);
    expect(result.complete.closed).toBe(false);
    expect(result.complete.netIssues).toBe(false);
    expect(result.complete.files).toBe(false);
    expect(result.complete.additions).toBe(true);
    expect(result.complete.created).toBe(true);
  });
  it("compares repository sums and keeps contributor and label breakdowns", () => {
    const result = summarizeStatistics([snapshot(), { ...snapshot(), repository: "sample/other" }], filter);
    expect(result.totals.closed).toBe(4);
    expect(result.contributors.find(person => person.name === "alice")).toEqual({ name: "alice", commits: 2, additions: 60, deletions: 100 });
    expect(result.labels).toEqual([{ name: "bug", count: 2 }]);
    expect(statisticsDimensions([snapshot()])).toEqual({ labels: ["bug", "feature"], contributors: ["alice", "bob"] });
    expect(commitContributor({ sha: "a", parents: [], commit: { author: { name: "Unlinked author", date: "2026-10-10" } } })).toBe("Unlinked author");
  });
  it("never treats PR events or malformed timestamps as issue closures", () => {
    const data = snapshot(); data.events!.data.push({ id: 99, event: "closed", created_at: "2026-10-15", issue: { ...issue, pull_request: {} } }, { id: 100, event: "closed", created_at: "not a date", issue });
    expect(summarizeStatistics([data], filter).totals.closed).toBe(2);
  });
  it("maps UTC and timezone-offset timestamps to the same UTC calendar day as Date.parse", () => {
    for (const value of ["2026-10-10T00:00:00Z", "2026-10-10T23:59:59Z", "2026-10-10T12:00:00.123Z", "2026-10-10T23:30:00-02:00", "2026-10-10T01:30:00+02:00", "2026-10-10T00:10:00+00:00", "2026-10-10", "2026-10-10T24:00:00Z"]) {
      expect(dayOf(value)).toBe(new Date(Date.parse(value)).toISOString().slice(0, 10));
    }
    expect(dayOf("not a date")).toBe("");
    const data = snapshot();
    data.issues!.data = [{ ...issue, created_at: "2026-10-10T23:30:00-02:00" }, { ...issue, id: 2, created_at: "2026-10-11T01:30:00+02:00" }, { ...issue, id: 3, created_at: "2026-10-10T23:30:00Z" }];
    data.events!.data = [{ id: 1, event: "closed", created_at: "2026-10-12T00:30:00+01:00", actor: { login: "bob" }, issue: data.issues!.data[0]! }];
    data.changes!.data = [{ sha: "first", date: "2026-10-09T22:00:00-03:00", contributor: "alice", additions: 5, deletions: 1, files: 1, filesComplete: true }];
    data.pulls!.data = [{ id: 1, created_at: "2026-10-12T23:00:00-05:00", updated_at: "2026-10-13", closed_at: "2026-10-13T00:30:00+01:00", merged_at: null, labels: [], user: { login: "bob" } }];
    const result = summarizeStatistics([data], filter);
    const day = (date: string) => result.days.find(entry => entry.date === date)!.values;
    expect(day("2026-10-10").created).toBe(2);
    expect(day("2026-10-11").created).toBe(1);
    expect(day("2026-10-11").closed).toBe(1);
    expect(result.closureAgeDays).toBeCloseTo(22 / 24, 5);
    expect(day("2026-10-10").additions).toBe(5);
    expect(day("2026-10-13").prsOpened).toBe(1);
    expect(day("2026-10-12").prsClosed).toBe(1);
  });
  it("bounds resolutions by duration and buckets sub-day and preset windows accurately", () => {
    expect(DEFAULT_STATISTICS_RANGE).toBe("3d");
    const duration30d = statisticsDurationMs({ ...filter, range: "30d" });
    expect(allowedStatisticsResolutions(duration30d)).toEqual(["6h", "12h", "1d"]);
    expect(allowedStatisticsResolutions(duration30d)).not.toContain("1m");
    expect(clampStatisticsResolution("1m", duration30d, "30d")).toBe("6h");

    const duration8h = statisticsDurationMs({ ...filter, range: "8h" });
    expect(allowedStatisticsResolutions(duration8h)).toContain("1m");
    expect(allowedStatisticsResolutions(duration8h)).toContain("15m");
    expect(allowedStatisticsResolutions(duration8h)).not.toContain("1d");

    const duration3d = statisticsDurationMs({ ...filter, range: "3d" });
    expect(allowedStatisticsResolutions(duration3d)).toEqual(["15m", "30m", "1h", "6h", "12h", "1d"]);

    const threeDayResult = summarizeStatistics([snapshot()], { ...filter, range: "3d", resolution: "1d" });
    expect(threeDayResult.days.map(d => d.date)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);

    const data = snapshot();
    data.issues!.data = [{ ...issue, created_at: "2026-10-16T14:17:00Z" }];
    data.events!.data = [{ id: 10, event: "closed", created_at: "2026-10-16T14:22:00Z", actor: { login: "alice" }, issue: data.issues!.data[0]! }];
    const eightHour15m = summarizeStatistics([data], { ...filter, range: "8h", resolution: "15m", now });
    expect(eightHour15m.days).toHaveLength(32);
    const bucket = eightHour15m.days.find(d => d.date === "2026-10-16 14:15")!;
    expect(bucket.values).toMatchObject({ created: 1, closed: 1 });
  });
});

describe("statistics totals follow the chart window (#167)", () => {
  const oldIssue: StatisticsIssue = { id: 11, number: 11, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-16T02:00:00Z", labels: [{ name: "old" }], user: { login: "alice" } };
  const recentIssue: StatisticsIssue = { id: 12, number: 12, created_at: "2026-10-15T09:00:00Z", updated_at: "2026-10-15T21:00:00Z", labels: [{ name: "bug" }], user: { login: "bob" } };
  const todayIssue: StatisticsIssue = { id: 13, number: 13, created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T14:00:00Z", labels: [{ name: "feature" }], user: { login: "alice" } };
  const commit = (sha: string, login: string, date: string) => ({ sha, parents: [{ sha: "p" }], author: { login }, commit: { committer: { date } } });
  function spread(): StatisticsData {
    return {
      repository: "sample/repo", ...statisticsWindow(now), fetchedAt: now, temporary: [],
      issues: source([oldIssue, recentIssue, todayIssue]),
      events: source([
        { id: 21, event: "closed", created_at: "2026-10-05T00:00:00Z", actor: { login: "alice" }, issue: oldIssue },
        { id: 22, event: "reopened", created_at: "2026-10-14T12:00:00Z", actor: { login: "alice" }, issue: oldIssue },
        { id: 23, event: "closed", created_at: "2026-10-15T21:00:00Z", actor: { login: "bob" }, issue: recentIssue },
        { id: 24, event: "closed", created_at: "2026-10-16T02:00:00Z", actor: { login: "alice" }, issue: oldIssue },
        { id: 25, event: "closed", created_at: "2026-10-16T14:00:00Z", actor: { login: "alice" }, issue: todayIssue },
      ]),
      commits: source([commit("c1", "alice", "2026-10-02T12:00:00Z"), commit("c2", "bob", "2026-10-15T12:00:00Z"), commit("c3", "alice", "2026-10-16T12:00:00Z")]),
      changes: source([
        { sha: "c1", date: "2026-10-02T12:00:00Z", contributor: "alice", additions: 100, deletions: 10, files: 5, filesComplete: true },
        { sha: "c2", date: "2026-10-15T12:00:00Z", contributor: "bob", additions: 20, deletions: 2, files: 2, filesComplete: true },
        { sha: "c3", date: "2026-10-16T12:00:00Z", contributor: "alice", additions: 3, deletions: 1, files: 1, filesComplete: true },
      ]),
      pulls: source([
        { id: 31, created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-04", closed_at: "2026-10-04T00:00:00Z", merged_at: "2026-10-04T00:00:00Z", labels: [], user: { login: "bob" } },
        { id: 32, created_at: "2026-10-16T08:00:00Z", updated_at: "2026-10-16", closed_at: null, merged_at: null, labels: [], user: { login: "alice" } },
      ]),
    };
  }
  type Summary = ReturnType<typeof summarizeStatistics>;
  function expectTotalsMatchChart(result: Summary) {
    expect(Object.keys(result.totals).length).toBeGreaterThan(0);
    for (const [metric, total] of Object.entries(result.totals)) {
      expect(result.days.reduce((sum, day) => sum + (day.values[metric as keyof typeof day.values] ?? 0), 0), metric).toBe(total);
    }
  }
  const labelsOf = (result: Summary) => Object.fromEntries(result.labels.map(item => [item.name, item.count]));
  const people = (result: Summary) => Object.fromEntries(result.contributors.map(person => [person.name, [person.commits, person.additions, person.deletions]]));

  it("limits cards, contributors, labels and median to the default three-day preset", () => {
    const result = summarizeStatistics([spread()], { ...filter, range: "3d", resolution: "1d" });
    expect(result.days.map(day => day.date)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expectTotalsMatchChart(result);
    expect(result.totals).toMatchObject({ created: 2, closed: 3, reopened: 1, netIssues: 0, commits: 2, additions: 23, deletions: 3, files: 3, prsOpened: 1, prsMerged: 0, prsClosed: 0 });
    expect(labelsOf(result)).toEqual({ bug: 1, feature: 1 });
    expect(people(result)).toEqual({ alice: [1, 3, 1], bob: [1, 20, 2] });
    expect(result.closureAgeDays).toBe(0.5);
    // A finer resolution inside the same preset covers exactly the same records.
    const quarterDays = summarizeStatistics([spread()], { ...filter, range: "3d", resolution: "6h" });
    expectTotalsMatchChart(quarterDays);
    expect(quarterDays.totals).toEqual(result.totals);
    expect(quarterDays.closureAgeDays).toBe(0.5);
  });

  it("limits every summary to the rolling 24-hour window", () => {
    const result = summarizeStatistics([spread()], { ...filter, range: "24h", resolution: "1h", now });
    expect(result.days).toHaveLength(24);
    expect(result.days[0]!.date).toBe("2026-10-15 16:00");
    expectTotalsMatchChart(result);
    expect(result.totals).toMatchObject({ created: 1, closed: 3, reopened: 0, commits: 1, additions: 3, prsOpened: 1 });
    expect(labelsOf(result)).toEqual({ feature: 1 });
    expect(people(result)).toEqual({ alice: [1, 3, 1] });
    expect(result.closureAgeDays).toBe(0.5);
  });

  it("uses all thirty days for the thirty-day preset", () => {
    const result = summarizeStatistics([spread()], { ...filter, range: "30d", resolution: "1d" });
    expect(result.days).toHaveLength(30);
    expectTotalsMatchChart(result);
    expect(result.totals).toMatchObject({ created: 3, closed: 4, reopened: 1, commits: 3, additions: 123, prsOpened: 2, prsMerged: 1 });
    expect(labelsOf(result)).toEqual({ old: 1, bug: 1, feature: 1 });
    expect(people(result)).toEqual({ alice: [2, 103, 11], bob: [1, 20, 2] });
    expect(result.closureAgeDays).toBeCloseTo((0.5 + 4) / 2, 5);
  });

  it("follows a custom date range, including sub-day resolution", () => {
    const early = summarizeStatistics([spread()], { ...filter, from: "2026-10-01", to: "2026-10-05", resolution: "1d" });
    expect(early.days).toHaveLength(5);
    expectTotalsMatchChart(early);
    expect(early.totals).toMatchObject({ created: 1, closed: 1, reopened: 0, commits: 1, additions: 100, prsOpened: 1, prsMerged: 1 });
    expect(labelsOf(early)).toEqual({ old: 1 });
    expect(people(early)).toEqual({ alice: [1, 100, 10] });
    expect(early.closureAgeDays).toBe(4);

    const recent = summarizeStatistics([spread()], { ...filter, from: "2026-10-14", to: "2026-10-15", resolution: "6h" });
    expect(recent.days).toHaveLength(8);
    expectTotalsMatchChart(recent);
    expect(recent.totals).toMatchObject({ created: 1, closed: 1, reopened: 1, commits: 1, prsOpened: 0 });
    expect(labelsOf(recent)).toEqual({ bug: 1 });
    expect(people(recent)).toEqual({ bob: [1, 20, 2] });
    expect(recent.closureAgeDays).toBe(0.5);
  });

  it("keeps measured zeros available when the window has no matching records", () => {
    const result = summarizeStatistics([spread()], { ...filter, from: "2026-09-20", to: "2026-09-22", resolution: "1d" });
    expect(result.totals).toMatchObject({ created: 0, closed: 0, commits: 0, additions: 0, prsOpened: 0 });
    expect(result.closureAgeDays).toBeNull();
    expect(result.labels).toEqual([]);
    expect(result.contributors).toEqual([]);
  });
});
