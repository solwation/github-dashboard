import { describe, it, expect } from "vitest";
import {
  column,
  isCoordination,
  priority,
  progressStart,
  sortedIssues,
  type Issue,
  type Event,
} from "../src/lib/model";
const issue = (
  number: number,
  labels: string[] = [],
  state = "open",
  created = "2026-01-01",
): Issue => ({
  id: number,
  number,
  title: "Issue",
  html_url: "https://github.com",
  labels: labels.map((name) => ({ name, color: "ededed" })),
  state,
  created_at: created,
  updated_at: created,
  closed_at: state === "closed" ? created : null,
  assignees: [],
});
describe("project conventions", () => {
  it("orders both observed project priority schemes and defaults missing priority to medium", () => {
    expect(priority(issue(1, ["priority:high"]))).toBe(0);
    expect(priority(issue(1, ["priority: high"]))).toBe(0);
    expect(priority(issue(1, ["high priority", "reviewer-filed"]))).toBe(0);
    expect(priority(issue(1, ["reviewer-filed"]))).toBe(2);
    expect(priority(issue(1))).toBe(1);
    expect(priority(issue(1, ["sp-1"]))).toBe(1);
  });
  it("sorts highest priority then oldest within priority", () =>
    expect(
      sortedIssues(
        [
          issue(1, ["priority:low"]),
          issue(2, [], "open", "2026-01-03"),
          issue(3, ["high priority"]),
          issue(4, [], "open", "2026-01-02"),
        ],
        "backlog",
      ).map((i) => i.number),
    ).toEqual([3, 4, 2, 1]));
  it("closed state takes precedence over stale progress labels, latest closed first", () => {
    const a = issue(1, ["in-progress"], "closed", "2026-01-01");
    const b = issue(2, [], "closed", "2026-01-03");
    expect(column(a)).toBe("closed");
    expect(sortedIssues([a, b], "closed").map((i) => i.number)).toEqual([2, 1]);
  });
  it("recognizes variants and exact custom labels without treating ownership as progress", () => {
    expect(column(issue(1, ["status: in_progress"]))).toBe("progress");
    expect(column(issue(1, ["orkester: worker"]))).toBe("backlog");
    expect(column(issue(1, ["Building"]), { progress: "Building" })).toBe(
      "progress",
    );
  });
  it("hides coordination labels but keeps assigned orchestrator work", () => {
    expect(isCoordination(issue(1, ["orkester"]))).toBe(true);
    expect(isCoordination(issue(1, ["agent-coordination"]))).toBe(true);
    expect(isCoordination(issue(1, ["orkester: foo", "in-progress"]))).toBe(
      false,
    );
  });
});
describe("active timer interval", () => {
  const event = (id: number, event: string, label = "in-progress"): Event => ({
    id,
    event,
    label: { name: label },
    created_at: `2026-01-0${id}T12:00:00Z`,
  });
  it("resets when paused and resumed rather than using the first claim", () =>
    expect(
      progressStart([
        event(1, "labeled"),
        event(2, "unlabeled"),
        event(3, "labeled"),
      ]),
    ).toBe("2026-01-03T12:00:00Z"));
  it("resets on reopening, and never falls back to updated_at", () => {
    expect(
      progressStart([
        event(1, "labeled"),
        event(2, "closed"),
        event(3, "reopened"),
      ]),
    ).toBeNull();
    expect(progressStart([])).toBeNull();
  });
  it("keeps time while at least one active work label remains", () =>
    expect(
      progressStart([
        event(1, "labeled"),
        event(2, "labeled", "wip"),
        event(3, "unlabeled"),
      ]),
    ).toBe("2026-01-02T12:00:00Z"));
});
