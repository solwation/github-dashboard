import { afterEach, describe, expect, it } from "vitest";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, statisticsCalendarWindow,
  statisticsDurationMs, statisticsPresetWindow, statisticsResolutions, statisticsWindowMs, summarizeStatistics,
  type StatisticsData,
} from "../src/lib/statistics";
import { normalizeStatisticsPreference } from "../src/lib/statistics-preferences";
import { parseHandoffPreferences } from "../src/lib/handoff-preferences";
import { decodeCompactHandoff, encodeCompactHandoff } from "../src/lib/handoff-codec";
const HOUR = 3_600_000;
const originalTZ = process.env.TZ;
afterEach(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
describe("month-scale statistics resolution policy (#180)", () => {
  it.each([718, 719, 720, 721, 722])("allows only six-hour or coarser buckets for a %ih month window", hours => {
    const duration = hours * HOUR;
    expect(allowedStatisticsResolutions(duration)).toEqual(["6h", "12h", "1d"]);
    for (const fine of ["1m", "5m", "15m", "30m", "1h"] as const) expect(clampStatisticsResolution(fine, duration, "30d")).toBe("6h");
    for (const coarse of ["6h", "12h", "1d"] as const) expect(clampStatisticsResolution(coarse, duration, "30d")).toBe(coarse);
    expect(clampStatisticsResolution(undefined, duration, "30d")).toBe("1d");
  });
  it("retains finer choices below the explicit two-hour DST tolerance and on shorter presets", () => {
    expect(allowedStatisticsResolutions(718 * HOUR - 1)).toContain("1h");
    expect(allowedStatisticsResolutions(29 * 24 * HOUR)).toContain("1h");
    expect(allowedStatisticsResolutions(21 * 24 * HOUR)).toEqual(["1h", "6h", "12h", "1d"]);
    expect(allowedStatisticsResolutions(3 * 24 * HOUR)).toEqual(["15m", "30m", "1h", "6h", "12h", "1d"]);
    expect(allowedStatisticsResolutions(8 * HOUR)).toContain("1m");
    expect(clampStatisticsResolution(undefined, 8 * HOUR, "8h")).toBe("15m");
    expect(clampStatisticsResolution(undefined, 24 * HOUR, "24h")).toBe("1h");
  });
  it.each([
    ["Europe/Stockholm", "2026-03-29T12:00:00Z", 719],
    ["Europe/Stockholm", "2026-10-25T12:00:00Z", 721],
    ["America/Los_Angeles", "2026-03-08T20:00:00Z", 719],
    ["America/Los_Angeles", "2026-11-01T20:00:00Z", 721],
    ["Antarctica/Troll", "2026-03-29T12:00:00Z", 718],
    ["Antarctica/Troll", "2026-10-25T12:00:00Z", 722],
  ])("uses the same policy for a local thirty-day preset and custom window in %s at %s", (zone, timestamp, hours) => {
    process.env.TZ = zone as string;
    const now = Date.parse(timestamp as string), period = statisticsCalendarWindow(now);
    const window = statisticsPresetWindow("30d", now, period, "1h", { calendar: "local" });
    expect(statisticsDurationMs(window) / HOUR).toBe(hours);
    expect(window).toEqual(period); // Changing resolution must never move the selected bounds.
    const saved = { ...window, label: "", contributor: "", metric: "closed" as const, resolution: "1h" as const };
    const custom = normalizeStatisticsPreference(saved, period);
    const preset = normalizeStatisticsPreference({ ...saved, range: "30d" }, period);
    expect(custom.resolution).toBe("6h"); expect(preset.resolution).toBe("6h");
    expect(custom.from).toBe(window.from); expect(custom.to).toBe(window.to);
    const statistics = { "sample/repo": { ...saved, range: "30d" } };
    const received = parseHandoffPreferences(decodeCompactHandoff(encodeCompactHandoff({ statistics })));
    expect(normalizeStatisticsPreference(received.statistics!["sample/repo"], period).resolution).toBe("6h");
  });
  it("uses clamped six-hour buckets without changing record inclusion or totals", () => {
    process.env.TZ = "Europe/Stockholm";
    const now = Date.parse("2026-03-29T12:00:00Z"), window = statisticsCalendarWindow(now);
    const { start, end } = statisticsWindowMs(window);
    const created = [start - 1, start, start + 60_000, end - 1, end];
    const source = { data: created.map((at, id) => ({ id, number: id, created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString(), labels: [] })), complete: true, fetchedAt: now };
    const data: StatisticsData = { repository: "sample/repo", from: "2026-02-27", to: "2026-03-29", fetchedAt: now, issues: source, events: null, commits: null, changes: null, pulls: null, temporary: [] };
    const filter = { ...window, label: "", contributor: "", calendar: "local" as const };
    const corrected = summarizeStatistics([data], { ...filter, resolution: "1h" });
    const sixHours = summarizeStatistics([data], { ...filter, resolution: "6h" });
    const day = summarizeStatistics([data], { ...filter, resolution: "1d" });
    expect(corrected.days).toEqual(sixHours.days);
    expect(corrected.days).toHaveLength(120);
    expect(corrected.totals.created).toBe(3);
    expect(corrected.totals).toEqual(day.totals);
    expect(corrected.days.reduce((sum, bucket) => sum + (bucket.values.created || 0), 0)).toBe(3);
    expect(statisticsResolutions).toContain("1h"); // Finer controls remain available for shorter periods.
  });
});
