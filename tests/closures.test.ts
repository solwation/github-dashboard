import { describe, expect, it } from "vitest";
import { ClosureTracker } from "../src/lib/closures";
import type { Issue, Lane } from "../src/lib/model";
const issue = (
  id: number,
  state = "open",
  closed_at: string | null = null,
): Issue => ({
  id,
  number: id,
  title: "Task",
  state,
  closed_at,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  html_url: "https://github.com/sample/repo/issues/" + id,
  labels: [],
  assignees: [],
});
const lane = (issues: Issue[], error?: string): Lane => ({
  repo: {
    id: 1,
    name: "repo",
    full_name: "sample/repo",
    private: false,
    html_url: "https://github.com/sample/repo",
    description: null,
    owner: { login: "sample" },
  },
  issues,
  labels: [],
  error,
});
const first = "2026-01-02T12:00:00Z",
  second = "2026-01-02T13:00:00Z";
describe("closure detection", () => {
  it("silently establishes a baseline and detects each new closure once", () => {
    const tracker = new ClosureTracker();
    expect(tracker.update(lane([issue(1), issue(2, "closed", first)]))).toEqual(
      [],
    );
    expect(
      tracker
        .update(lane([issue(1, "closed", second), issue(2, "closed", first)]))
        .map((i) => i.id),
    ).toEqual([1]);
    expect(
      tracker.update(
        lane([issue(1, "closed", second), issue(2, "closed", first)]),
      ),
    ).toEqual([]);
  });
  it("detects reclosures even if reopening happened between polls", () => {
    const tracker = new ClosureTracker();
    tracker.update(lane([issue(1, "closed", first)]));
    expect(tracker.update(lane([issue(1, "closed", second)]))).toHaveLength(1);
  });
  it("ignores failed snapshots and detects changes after recovery", () => {
    const tracker = new ClosureTracker();
    tracker.update(lane([issue(1)]));
    expect(
      tracker.update(lane([issue(1, "closed", first)], "API failed")),
    ).toEqual([]);
    expect(tracker.update(lane([issue(1, "closed", first)]))).toHaveLength(1);
  });
  it("does not replay old history arriving late, but finds new issues closed between snapshots", () => {
    const tracker = new ClosureTracker();
    tracker.update(lane([]), Date.parse(first));
    expect(
      tracker
        .update(
          lane([issue(1, "closed", first), issue(2, "closed", second)]),
          Date.parse(second),
        )
        .map((i) => i.id),
    ).toEqual([2]);
  });
  it("clears baselines when deselected or logged out", () => {
    const tracker = new ClosureTracker();
    tracker.update(lane([issue(1)]));
    tracker.retain([]);
    expect(tracker.update(lane([issue(1, "closed", first)]))).toEqual([]);
    tracker.clear();
    expect(tracker.update(lane([issue(1, "closed", second)]))).toEqual([]);
  });
});
