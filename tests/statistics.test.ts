import { describe, expect, it } from "vitest";
import { commitContributor, dayOf, statisticsDimensions, statisticsWindow, summarizeStatistics, type StatisticsData, type StatisticsIssue, type StatisticsSource } from "../src/lib/statistics";

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
});
