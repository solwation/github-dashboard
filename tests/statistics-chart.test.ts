import { describe, expect, it } from "vitest";
import { activityHeadings, alignedValueTicks, axisTickIndices, bucketTime, limitChartUnits, statisticsMetricUnit, valueTicks } from "../src/lib/statistics-chart";
import { t, setLanguage } from "../src/lib/i18n";
import { statisticsResolutions } from "../src/lib/statistics";

describe("statistics chart helpers", () => {
  it("chooses 3–6 evenly spaced axis ticks that include both ends", () => {
    expect(axisTickIndices(0, 500)).toEqual([]);
    expect(axisTickIndices(2, 500)).toEqual([0, 1]);
    expect(axisTickIndices(30, 200)).toEqual([0, 15, 29]);
    expect(axisTickIndices(720, 2000)).toHaveLength(6);
    expect(axisTickIndices(720, 2000).at(-1)).toBe(719);
  });
  it("produces rounded value ticks covering the data including zero", () => {
    expect(valueTicks(0, 1)).toEqual([0, 1]);
    expect(valueTicks(0, 4)).toEqual([0, 2, 4]);
    expect(valueTicks(0, 120)).toEqual([0, 50, 100, 150]);
    expect(valueTicks(-30, 60)).toContain(0);
  });
  it("keeps single-axis ticks identical and aligns zero and grid lines across two axes (#283)", () => {
    expect(alignedValueTicks([{ min: 0, max: 120 }])).toEqual([{ ticks: valueTicks(0, 120), labeled: [true, true, true, true] }]);
    // Counts 0–12 next to 3.5 h: each keeps its own step, both get the same number of intervals.
    const [count, hours] = alignedValueTicks([{ min: 0, max: 12 }, { min: 0, max: 3.5 }]);
    expect(count!.ticks).toEqual([0, 5, 10, 15]);
    expect(hours!.ticks).toEqual([0, 2, 4, 6]);
    expect(hours!.labeled).toEqual([true, true, true, true]);
    // A negative deviation puts the zero line at the same height on both axes; negative hours stay unlabeled.
    const [time, deviation] = alignedValueTicks([{ min: 0, max: 3.5 }, { min: -50, max: 0 }]);
    expect(time!.ticks.indexOf(0)).toBe(deviation!.ticks.indexOf(0));
    expect(time!.ticks.length).toBe(deviation!.ticks.length);
    expect(time!.ticks.filter((tick, index) => time!.labeled[index] && tick < 0)).toEqual([]);
    expect(deviation!.ticks[0]).toBeLessThanOrEqual(-50);
  });
  it("assigns units and keeps at most the two most recently chosen ones (#283)", () => {
    expect(["commits", "timePerPoint", "estimateDeviation"].map(statisticsMetricUnit)).toEqual(["count", "hours", "percent"]);
    expect(limitChartUnits(["closed", "commits", "timePerPoint"], statisticsMetricUnit)).toEqual({ kept: ["closed", "commits", "timePerPoint"], removed: [] });
    expect(limitChartUnits(["closed", "timePerPoint", "estimateDeviation"], statisticsMetricUnit)).toEqual({ kept: ["timePerPoint", "estimateDeviation"], removed: ["closed"] });
    expect(limitChartUnits(["timePerPoint", "closed", "estimateDeviation"], statisticsMetricUnit).removed).toEqual(["timePerPoint"]);
  });
  it("parses daily and sub-day bucket dates as UTC", () => {
    expect(bucketTime("2026-10-19")).toBe(Date.UTC(2026, 9, 19));
    expect(bucketTime("2026-10-19 13:15")).toBe(Date.UTC(2026, 9, 19, 13, 15));
  });
  it("has a translated heading for every resolution", () => {
    setLanguage("en");
    for (const resolution of statisticsResolutions) expect(t(activityHeadings[resolution])).toMatch(/^Activity per /);
    setLanguage("auto");
  });
});
