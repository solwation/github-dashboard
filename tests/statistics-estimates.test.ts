import { describe, expect, it, vi } from "vitest";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../src/lib/vault", () => ({ loadStatistics: vi.fn(), saveStatistics: save }));
import { repositoryEstimate } from "../src/lib/estimates";
import type { Issue } from "../src/lib/model";
import { approximatePoints } from "../src/lib/story-points";
import { statisticsCollectionWindow, summarizeStatistics, type StatisticsData, type StatisticsEvent, type StatisticsIssue } from "../src/lib/statistics";
import { closingDeviation, msPerPointAt, statisticsClosings, statisticsIssuePoints } from "../src/lib/statistics-estimates";
import { writeStatisticsCache } from "../src/lib/statistics-cache";

const now = Date.parse("2026-10-16T15:00:00Z");
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();
let nextId = 1;
function issue(id: number, labels: string[] = ["bug"], title = "Short title"): StatisticsIssue {
  return { id, number: id, title, body: null, created_at: "2026-10-01T00:00:00Z", updated_at: at(now), labels: labels.map(name => ({ name })), user: { login: "alice" } };
}
/** One piece of work: labelled in progress `hours` before closing at `closedMs`. */
function work(subject: StatisticsIssue, closedMs: number, hours: number, closer = "alice", progress = "in progress"): StatisticsEvent[] {
  return [
    { id: nextId++, event: "labeled", created_at: at(closedMs - hours * HOUR), issue: subject, actor: { login: closer }, label: { name: progress } },
    { id: nextId++, event: "closed", created_at: at(closedMs), issue: subject, actor: { login: closer } },
  ];
}
function snapshot(events: StatisticsEvent[], complete = true): StatisticsData {
  const issues = [...new Map(events.map(event => [event.issue!.id, event.issue!])).values()];
  return { repository: "sample/repo", ...statisticsCollectionWindow(now), fetchedAt: now, temporary: [], issues: { data: issues, complete, fetchedAt: now }, events: { data: events, complete, fetchedAt: now }, commits: null, changes: null, pulls: null };
}
const day = (offset: number) => Date.parse("2026-10-16T00:00:00Z") - offset * 86_400_000;
// UTC day buckets for 2026-10-14 … 2026-10-16.
const filter = { from: "2026-10-14T00:00", to: "2026-10-17T00:00", label: "", contributor: "", resolution: "1d" as const, now };

describe("historical time per story point (#280)", () => {
  it("migrates legacy cached local sizes while preserving explicit point labels", () => {
    const cached = { ...issue(1), title: undefined, points: 13 };
    expect(statisticsIssuePoints(cached)).toBe(3);
    expect(statisticsIssuePoints({ ...cached, points: 2 })).toBe(2);
    expect(statisticsIssuePoints({ ...cached, labels: [{ name: "sp-13" }] })).toBe(13);
    expect(statisticsIssuePoints({ ...cached, labels: [{ name: "sp-8" }, { name: "sp-13" }] })).toBe(3);
  });
  it("equals the board's calibrated msPerPoint at each moment, from the closings known then", () => {
    const subjects = [1, 2, 3, 4].map(id => issue(id));
    const events = [
      ...work(subjects[0]!, day(3) + 10 * HOUR, 2),
      ...work(subjects[1]!, day(2) + 10 * HOUR, 4),
      ...work(subjects[2]!, day(1) + 10 * HOUR, 6),
      ...work(subjects[3]!, day(0) + 10 * HOUR, 8),
    ];
    const closings = statisticsClosings(snapshot(events));
    expect(closings).toHaveLength(4);
    const board = (subject: StatisticsIssue, closedMs: number, hours: number): Issue => ({
      ...subject, title: subject.title!, html_url: "", state: "closed", closed_at: at(closedMs), labels: subject.labels.map(label => ({ ...label, color: "" })),
      assignees: [], workStartedAt: at(closedMs - hours * HOUR),
    });
    const boardIssues = [board(subjects[0]!, day(3) + 10 * HOUR, 2), board(subjects[1]!, day(2) + 10 * HOUR, 4), board(subjects[2]!, day(1) + 10 * HOUR, 6), board(subjects[3]!, day(0) + 10 * HOUR, 8)];
    for (const moment of [day(1) + 9 * HOUR, day(1) + 11 * HOUR, now]) {
      const known = boardIssues.filter(item => Date.parse(item.closed_at!) <= moment);
      expect(msPerPointAt(closings, moment)).toBe(repositoryEstimate(known, moment).basis.msPerPoint);
    }
    const points = approximatePoints({ title: "Short title", body: null, labels: [{ name: "bug", color: "" }] });
    expect(msPerPointAt(closings, now)).toBe(5 * HOUR / points);

    const summary = summarizeStatistics([snapshot(events)], filter);
    // Fewer than three samples before 2026-10-15 10:00: the first bucket is a gap, not zero.
    expect(summary.days.map(item => item.values.timePerPoint)).toEqual([undefined, 4 / points, 5 / points]);
    expect(summary.totals.timePerPoint).toBe(5 / points);
    expect(summary.complete.timePerPoint).toBe(true);
  });

  it("drops extreme interrupted runs like the estimate calibration and forgets reopened closings", () => {
    const subjects = [1, 2, 3, 4].map(id => issue(id));
    const events = [
      ...work(subjects[0]!, now - 40 * HOUR, 2), ...work(subjects[1]!, now - 30 * HOUR, 2), ...work(subjects[2]!, now - 20 * HOUR, 2),
      ...work(subjects[3]!, now - 2 * HOUR, 100),
    ];
    const points = statisticsIssuePoints(subjects[0])!;
    expect(msPerPointAt(statisticsClosings(snapshot(events)), now)).toBe(2 * HOUR / points);
    const reopened: StatisticsEvent = { id: nextId++, event: "reopened", created_at: at(now - HOUR), issue: subjects[2]!, actor: { login: "alice" } };
    const closings = statisticsClosings(snapshot([...events, reopened]));
    expect(msPerPointAt(closings, now - 90 * 60_000)).toBe(2 * HOUR / points);
    // After the reopening three closings remain; the extreme one is filtered, leaving too few samples.
    expect(msPerPointAt(closings, now)).toBeNull();
    expect(closings.find(closing => closing.issue.id === 3)!.reopenedMs).toBe(now - HOUR);
  });

  it("follows the progress label rules and hides silently without a basis or without events", () => {
    const subjects = [1, 2, 3].map(id => issue(id));
    const events = subjects.flatMap((subject, index) => work(subject, now - (index + 1) * HOUR, 1, "alice", "Doing it"));
    expect(summarizeStatistics([snapshot(events)], filter).totals.timePerPoint).toBeUndefined();
    const ruled = summarizeStatistics([snapshot(events)], filter, { rules: { "sample/repo": { progress: "doing it" } } });
    expect(ruled.totals.timePerPoint).toBeGreaterThan(0);
    const missing = { ...snapshot(events), events: null };
    const hidden = summarizeStatistics([missing], filter, { rules: { "sample/repo": { progress: "doing it" } } });
    expect(hidden.totals.timePerPoint).toBeUndefined();
    expect(hidden.totals.estimateDeviation).toBeUndefined();
    expect(hidden.days.every(item => !("timePerPoint" in item.values))).toBe(true);
  });

  it("marks evaluations whose 30-day lookback starts before collected events as partial", () => {
    const subjects = [1, 2, 3].map(id => issue(id));
    const events = subjects.flatMap((subject, index) => work(subject, day(3) + (index + 1) * HOUR, 1));
    // Collection starts 2026-09-16; the 2026-10-14 bucket's lookback reaches 2026-09-15.
    expect(summarizeStatistics([snapshot(events)], filter).complete.timePerPoint).toBe(false);
    const today = { ...filter, from: "2026-10-16T00:00" };
    expect(summarizeStatistics([snapshot(events)], today).complete.timePerPoint).toBe(true);
    expect(summarizeStatistics([snapshot(events, false)], today).complete.timePerPoint).toBe(false);
  });
});

describe("deviation between actual and estimated time (#280)", () => {
  it("is the median of actual ÷ estimated − 1 per closing, estimated from the other closings known when it closed", () => {
    const subjects = [1, 2, 3, 4, 5].map(id => issue(id));
    const events = [
      ...work(subjects[0]!, day(2) + 1 * HOUR, 2), ...work(subjects[1]!, day(2) + 2 * HOUR, 2), ...work(subjects[2]!, day(2) + 3 * HOUR, 2),
      ...work(subjects[3]!, day(1) + 5 * HOUR, 3),
      ...work(subjects[4]!, day(0) + 5 * HOUR, 2),
    ];
    const closings = statisticsClosings(snapshot(events));
    // The first three have fewer than three other closings, so they have no estimate.
    expect(closings.slice(0, 3).map(closing => closingDeviation(closings, closing))).toEqual([null, null, null]);
    expect(closingDeviation(closings, closings[3]!)).toBeCloseTo(0.5);
    // Others: 2, 2, 2, 3 h → median 2 h; actual 2 h is a measured zero.
    expect(closingDeviation(closings, closings[4]!)).toBe(0);
    const summary = summarizeStatistics([snapshot(events)], filter);
    expect(summary.days.map(item => item.values.estimateDeviation)).toEqual([undefined, 50, 0]);
    expect(summary.totals.estimateDeviation).toBe(25);
    expect(summary.complete.estimateDeviation).toBe(false); // 2026-10-15's lookback predates collection
    const today = summarizeStatistics([snapshot(events)], { ...filter, from: "2026-10-16T00:00" });
    expect(today.totals.estimateDeviation).toBe(0);
    expect(today.complete.estimateDeviation).toBe(true);
  });

  it("pools deviation observations with independent project filters and omits incomparable multi-project time-per-point", () => {
    const bugs = [1, 2, 3, 4].map(id => issue(id, ["bug"]));
    const features = [5, 6, 7, 8].map(id => issue(id, ["feature"]));
    const events = [
      ...bugs.flatMap((subject, index) => work(subject, now - (10 - index) * HOUR, index === 3 ? 4 : 2, "alice")),
      ...features.flatMap((subject, index) => work(subject, now - (6 - index) * HOUR, 1, "bob")),
    ];
    const data = [snapshot(events), { ...snapshot(events), repository: "sample/other" }];
    const result = summarizeStatistics(data, filter, { repositoryFilters: {
      "sample/repo": { label: "bug", contributor: "alice" },
      "sample/other": { label: "feature", contributor: "bob" },
    } });
    expect(result.totals.estimateDeviation).toBe(50); // median of per-closing deviations 100% and 0%
    expect(result.totals.timePerPoint).toBeUndefined();
    expect(result.days.every(day => day.values.timePerPoint === undefined)).toBe(true);
  });
  it("follows label and contributor filters", () => {
    const bugs = [1, 2, 3, 4].map(id => issue(id, ["bug"]));
    const features = [5, 6, 7, 8].map(id => issue(id, ["feature"]));
    const events = [
      ...bugs.flatMap((subject, index) => work(subject, now - (10 - index) * HOUR, index === 3 ? 4 : 2, "alice")),
      ...features.flatMap((subject, index) => work(subject, now - (6 - index) * HOUR, 1, "bob")),
    ];
    const all = summarizeStatistics([snapshot(events)], filter);
    const bug = summarizeStatistics([snapshot(events)], { ...filter, label: "bug" });
    const bob = summarizeStatistics([snapshot(events)], { ...filter, contributor: "bob" });
    expect(bug.totals.estimateDeviation).toBe(100);
    expect(bob.totals.estimateDeviation).toBe(0);
    expect(bug.totals.timePerPoint).not.toBe(bob.totals.timePerPoint);
    expect(all.totals.estimateDeviation).toBeDefined();
    expect(summarizeStatistics([snapshot(events)], { ...filter, label: "missing" }).totals.estimateDeviation).toBeUndefined();
  });
});

describe("encrypted statistics cache (#280)", () => {
  it("keeps only the derived story points, never titles or bodies", async () => {
    save.mockResolvedValue(undefined);
    const subject = { ...issue(1, ["sp: 4"]), body: "Private body" };
    await writeStatisticsCache("token", [snapshot(work(subject, now - HOUR, 1))]);
    const saved = JSON.stringify(save.mock.calls[0]![1]);
    expect(saved).not.toContain("Short title");
    expect(saved).not.toContain("Private body");
    const cached = save.mock.calls[0]![1].repositories[0] as StatisticsData;
    expect(cached.issues!.data[0]!.points).toBe(4);
    expect(cached.events!.data[0]!.issue!.points).toBe(4);
    expect(statisticsIssuePoints(cached.events!.data[0]!.issue)).toBe(4);
    expect(statisticsIssuePoints({ ...cached.issues!.data[0]!, points: 0 })).toBeNull();
  });
});
