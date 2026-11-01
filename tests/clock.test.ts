import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { boardNow, observeLaneTimes, observeServerTime, resetBoardClock } from "../src/lib/clock";
import { useIssueClock } from "../src/composables/useIssueClock";
import { duration, type Issue, type Lane } from "../src/lib/model";

// The device clock runs 16 minutes behind GitHub, as in the reported board (#375).
const device = Date.parse("2026-11-01T10:26:00Z"), skew = 16 * 60000;
const iso = (at: number) => new Date(at).toISOString();
const issue = (extra: Partial<Issue>): Issue => ({ id: 1, number: 1, title: "Work", state: "open", labels: [{ name: "in-progress", color: "" }], assignees: [], html_url: "", closed_at: null, created_at: iso(device), updated_at: iso(device), ...extra });
const lane = (issues: Issue[]): Lane => ({ repo: { id: 1, name: "b", full_name: "a/b", description: null, private: true, html_url: "", owner: { login: "a" } }, issues, labels: [] });

beforeEach(() => { vi.useFakeTimers({ now: device }); resetBoardClock(); });
afterEach(() => { vi.useRealTimers(); resetBoardClock(); });

describe("board clock", () => {
  it("uses the device clock until GitHub shows a later time, then advances from it", () => {
    observeServerTime(iso(device - 60000));
    expect(boardNow()).toBe(device);
    observeServerTime(iso(device + skew));
    expect(boardNow()).toBe(device + skew);
    vi.advanceTimersByTime(5000);
    expect(boardNow()).toBe(device + skew + 5000);
  });
  it("ignores missing, invalid and day-sized future timestamps", () => {
    for (const value of [null, undefined, "", "soon", iso(device + 2 * 86400000)]) observeServerTime(value);
    expect(boardNow()).toBe(device);
  });
  it("lets a corrected device clock take over", () => {
    observeServerTime(iso(device + skew));
    vi.setSystemTime(device + 2 * skew);
    expect(boardNow()).toBeGreaterThanOrEqual(device + 2 * skew);
  });
  it("starts a just-claimed issue's timer at its label time instead of standing at 0m 0s", async () => {
    const started = issue({ startedAt: iso(device + skew), updated_at: iso(device + skew) });
    observeLaneTimes([lane([started])]);
    const scope = effectScope();
    const now = scope.run(() => useIssueClock(() => started, () => "progress", () => true))!;
    vi.advanceTimersByTime(5000);
    await nextTick();
    expect(duration(started.startedAt!, now.value)).toBe("0m 5s");
    scope.stop();
  });
});
