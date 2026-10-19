import { describe, expect, it } from "vitest";
import { activityHeadings, axisTickIndices, bucketTime, valueTicks } from "../src/lib/statistics-chart";
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
