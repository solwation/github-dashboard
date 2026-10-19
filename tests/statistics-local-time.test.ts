import { afterEach, describe, expect, it } from "vitest";
import { browserTimeZone, formatBrowserDateTime, parseBrowserDateTime, isAmbiguousBrowserTime } from "../src/lib/browser-time";
import {
  formatStatisticsBound, parseStatisticsBound, statisticsCalendarWindow, statisticsCollectionWindow,
  statisticsPresetWindow, statisticsWindowMs, summarizeStatistics, type StatisticsData, type StatisticsResolution,
} from "../src/lib/statistics";
const originalTZ = process.env.TZ;
afterEach(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
const hours = (window: { from: string; to: string }) => {
  const { start, end } = statisticsWindowMs(window);
  return (end - start) / 3_600_000;
};
function summary(from: string, to: string, timestamps: string[], resolution: StatisticsResolution = "1d") {
  const now = Date.parse(to);
  const data: StatisticsData = {
    repository: "sample/repo", ...statisticsCollectionWindow(now), fetchedAt: now, temporary: [],
    issues: { data: timestamps.map((created_at, id) => ({ id, number: id, created_at, updated_at: created_at, labels: [] })), complete: true, fetchedAt: now },
    events: null, commits: null, changes: null, pulls: null,
  };
  return summarizeStatistics([data], { from: formatStatisticsBound(Date.parse(from)), to: formatStatisticsBound(Date.parse(to)), label: "", contributor: "", resolution, calendar: "local" });
}
describe("browser-local statistics without changing absolute UTC storage", () => {
  it("formats the same instant on different local dates independent of language", () => {
    const instant = Date.parse("2026-10-19T00:30:00Z");
    process.env.TZ = "Europe/Stockholm";
    expect(browserTimeZone()).toBe("Europe/Stockholm");
    expect(formatBrowserDateTime(instant)).toBe("2026-10-19T02:30");
    expect(parseBrowserDateTime("2026-10-19T02:30")).toBe(instant);
    process.env.TZ = "America/Los_Angeles";
    expect(formatBrowserDateTime(instant)).toBe("2026-10-18T17:30");
    expect(parseBrowserDateTime("2026-10-18T17:30")).toBe(instant);
    // Existing persisted/QR bounds always retain their absolute meaning.
    expect(parseStatisticsBound("2026-10-19T00:30", "start")).toBe(instant);
  });
  it("adds offsets only for genuinely repeated wall-clock times", () => {
    process.env.TZ = "Europe/Stockholm";
    expect(isAmbiguousBrowserTime(Date.parse("2026-10-25T00:30:00Z"))).toBe(true);
    expect(isAmbiguousBrowserTime(Date.parse("2026-10-25T01:30:00Z"))).toBe(true);
    expect(isAmbiguousBrowserTime(Date.parse("2026-10-25T02:30:00Z"))).toBe(false);
    expect(isAmbiguousBrowserTime(Date.parse("2026-03-29T01:30:00Z"))).toBe(false);
    process.env.TZ = "Australia/Lord_Howe";
    expect(isAmbiguousBrowserTime(Date.parse("2026-04-04T14:45:00Z"))).toBe(true);
    expect(isAmbiguousBrowserTime(Date.parse("2026-04-04T15:15:00Z"))).toBe(true);
    process.env.TZ = "UTC";
    expect(isAmbiguousBrowserTime(Date.parse("2026-10-25T01:30:00Z"))).toBe(false);
    expect(isAmbiguousBrowserTime(NaN)).toBe(false);
  });
  it("rejects invalid calendar input and nonexistent spring times; fall-back input selects the earlier instant", () => {
    process.env.TZ = "Europe/Stockholm";
    for (const value of ["2026-03-29T02:30", "2026-02-30T12:00", "2026-13-01T00:00", "2026-10-19T24:00", "2026-10-19", "2026-10-19T00:00Z"]) expect(parseBrowserDateTime(value), value).toBeNaN();
    expect(parseBrowserDateTime("2026-10-25T02:30")).toBe(Date.parse("2026-10-25T00:30:00Z"));
    // Reading/rendering an existing later fold instant does not mutate the saved UTC bound.
    const saved = "2026-10-25T01:30";
    expect(formatBrowserDateTime(parseStatisticsBound(saved, "start"))).toBe("2026-10-25T02:30");
    expect(formatStatisticsBound(parseStatisticsBound(saved, "start"))).toBe(saved);
  });
  it.each(["Europe/Stockholm", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("covers all thirty local calendar dates from a stable UTC source envelope in %s", zone => {
    process.env.TZ = zone;
    for (const timestamp of ["2026-03-29T00:30:00Z", "2026-10-25T23:30:00Z", "2026-11-01T07:30:00Z"]) {
      const now = Date.parse(timestamp), local = statisticsCalendarWindow(now), raw = statisticsCollectionWindow(now);
      const { start, end } = statisticsWindowMs(local), envelope = statisticsWindowMs(raw);
      expect(start).toBeGreaterThanOrEqual(envelope.start);
      // No source record in the local period up through now lies outside raw coverage.
      expect(now).toBeLessThan(envelope.end);
      expect(new Date(start).getHours()).toBe(0); expect(new Date(end).getHours()).toBe(0);
      const result = summarizeStatistics([], { ...local, label: "", contributor: "", calendar: "local", resolution: "1d" });
      expect(result.days).toHaveLength(30);
      expect(new Set(result.days.map(day => formatBrowserDateTime(day.start!).slice(0, 10))).size).toBe(30);
    }
  });
  it("day presets and day buckets use 23/25-hour local days while 24h keeps elapsed duration", () => {
    process.env.TZ = "Europe/Stockholm";
    for (const [timestamp, expectedHours] of [["2026-03-29T12:00:00Z", 71], ["2026-10-25T12:00:00Z", 73]] as const) {
      const now = Date.parse(timestamp), period = statisticsCalendarWindow(now);
      const window = statisticsPresetWindow("3d", now, period, undefined, { calendar: "local" });
      expect(hours(window)).toBe(expectedHours);
      const result = summarizeStatistics([], { ...window, label: "", contributor: "", calendar: "local", resolution: "1d" });
      expect(result.days).toHaveLength(3);
      expect(result.days.map(day => new Date(day.start!).getHours())).toEqual([0, 0, 0]);
      expect(hours(statisticsPresetWindow("24h", now, period, undefined, { calendar: "local" }))).toBe(24);
    }
  });
  it("counts records on either side of local midnight in their correct day, excluding the end", () => {
    process.env.TZ = "Europe/Stockholm";
    const result = summary("2026-10-17T22:00:00Z", "2026-10-19T22:00:00Z", ["2026-10-18T21:59:59Z", "2026-10-18T22:00:00Z", "2026-10-19T22:00:00Z"]);
    expect(result.days.map(day => day.values.created)).toEqual([1, 1]);
    expect(result.days.map(day => formatBrowserDateTime(day.start!))).toEqual(["2026-10-18T00:00", "2026-10-19T00:00"]);
    expect(result.totals.created).toBe(2);
  });
  it("retains distinct repeated fall-back hours and omits the missing spring hour", () => {
    process.env.TZ = "Europe/Stockholm";
    const fall = summary("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"], "1h");
    expect(fall.days).toHaveLength(25);
    const repeated = fall.days.filter(day => formatBrowserDateTime(day.start!) === "2026-10-25T02:00");
    expect(repeated.map(day => day.start)).toEqual([Date.parse("2026-10-25T00:00:00Z"), Date.parse("2026-10-25T01:00:00Z")]);
    expect(repeated.map(day => day.values.created)).toEqual([1, 1]);
    expect(new Set(fall.days.map(day => day.date)).size).toBe(25);
    const spring = summary("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", ["2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z"], "1h");
    expect(spring.days).toHaveLength(23);
    expect(spring.days.some(day => formatBrowserDateTime(day.start!) === "2026-03-29T02:00")).toBe(false);
    expect(spring.totals.created).toBe(2);
    expect(spring.days.reduce((sum, day) => sum + (day.values.created || 0), 0)).toBe(spring.totals.created);
  });
  it("does not carry a nonexistent midnight's normalized hour into following days", () => {
    process.env.TZ = "America/Santiago";
    const now = Date.parse("2026-09-06T16:00:00Z");
    const period = statisticsCalendarWindow(now);
    expect(formatBrowserDateTime(parseStatisticsBound(period.to, "end"))).toBe("2026-09-07T00:00");
    const preset = statisticsPresetWindow("3d", now, period, undefined, { calendar: "local" });
    expect(hours(preset)).toBe(71);
    const result = summarizeStatistics([], { ...preset, label: "", contributor: "", resolution: "1d", calendar: "local" });
    expect(result.days.map(day => formatBrowserDateTime(day.start!))).toEqual(["2026-09-04T00:00", "2026-09-05T00:00", "2026-09-06T01:00"]);
    const next = statisticsCalendarWindow(Date.parse("2026-09-07T16:00:00Z"));
    const nextResult = summarizeStatistics([], { ...next, label: "", contributor: "", resolution: "1d", calendar: "local" });
    expect(formatBrowserDateTime(nextResult.days.at(-1)!.start!)).toBe("2026-09-07T00:00");
  });
  it("does not merge the final partial bucket of an unaligned custom window", () => {
    process.env.TZ = "Europe/Stockholm";
    const result = summary("2026-09-24T00:30:00Z", "2026-10-01T00:30:00Z", ["2026-09-30T23:45:00Z", "2026-10-01T00:15:00Z"], "1h");
    // Like existing UTC windows, a partial first and last bucket can add one boundary bucket.
    expect(result.days).toHaveLength(169);
    expect(result.days.slice(-2).map(day => day.values.created)).toEqual([1, 1]);
  });
  it("aligns half-hour-zone subday presets to local wall-clock grid", () => {
    process.env.TZ = "Asia/Kolkata";
    const now = Date.parse("2026-10-19T00:42:00Z");
    const preset = statisticsPresetWindow("24h", now, statisticsCalendarWindow(now), undefined, { calendar: "local" });
    expect(formatBrowserDateTime(parseStatisticsBound(preset.to, "end"))).toBe("2026-10-19T07:00");
    expect(hours(preset)).toBe(24);
  });
});
