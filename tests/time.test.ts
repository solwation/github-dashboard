import { afterEach, describe, expect, it } from "vitest";
import { backlogAgeLabel, closedTimeLabel, RECENT_CLOSURE_MS } from "../src/lib/time";
import { setLanguage } from "../src/lib/i18n";
const stamp = "2026-10-15T10:00:00Z",
  closed = Date.parse(stamp);
afterEach(() => setLanguage("auto"));
describe("backlog age", () => {
  it("counts creation age across short and long periods in both languages", () => {
    setLanguage("sv");
    expect(backlogAgeLabel(stamp, closed + 5000, "sv-SE")).toBe("Skapad för 5 sekunder sedan");
    expect(backlogAgeLabel(stamp, closed + 86400000, "sv-SE")).toBe("Skapad för 1 dag sedan");
    setLanguage("en");
    expect(backlogAgeLabel(stamp, closed + 2 * 365 * 86400000, "en-GB")).toBe("Created 2 years ago");
    expect(backlogAgeLabel(stamp, closed + 90 * 86400000, "en-GB")).toBe("Created 3 months ago");
  });
  it("handles missing, invalid and future dates without inventing a negative age", () => {
    setLanguage("en");
    expect(backlogAgeLabel("", closed, "en-GB")).toBe("Unknown age");
    expect(backlogAgeLabel("bad", closed, "en-GB")).toBe("Unknown age");
    expect(backlogAgeLabel(stamp, closed - 1000, "en-GB")).toMatch(/^Created \d/);
  });
});
describe("live closure timestamp", () => {
  it("counts seconds and minutes in Swedish", () => {
    setLanguage("sv");
    expect(closedTimeLabel(stamp, closed + 5000, "sv-SE")).toBe(
      "5 sekunder sedan",
    );
    expect(closedTimeLabel(stamp, closed + 1000, "sv-SE")).toBe(
      "1 sekund sedan",
    );
    expect(closedTimeLabel(stamp, closed + 90000, "sv-SE")).toBe("1 min sedan");
    expect(closedTimeLabel(stamp, closed + 5400000, "sv-SE")).toBe(
      "1h 30 min sedan",
    );
  });
  it("switches to exact date and time at the six hour boundary", () => {
    setLanguage("sv");
    expect(
      closedTimeLabel(stamp, closed + RECENT_CLOSURE_MS - 1, "sv-SE"),
    ).toBe("5h 59 min sedan");
    expect(closedTimeLabel(stamp, closed + RECENT_CLOSURE_MS, "sv-SE")).toMatch(
      /^Stängd .*\d{2}:\d{2}$/,
    );
  });
  it("localizes and handles future/invalid timestamps without negative durations", () => {
    setLanguage("en");
    expect(closedTimeLabel(stamp, closed + 5000, "en-GB")).toBe(
      "5 seconds ago",
    );
    expect(closedTimeLabel(stamp, closed - 1000, "en-GB")).toMatch(/^Closed /);
    expect(closedTimeLabel("bad", closed, "en-GB")).toBe(
      "Unknown closure time",
    );
  });
});
