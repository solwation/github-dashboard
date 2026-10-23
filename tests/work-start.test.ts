import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import { historySamples } from "../src/lib/estimates";
import { carriedWorkStart, closedWorkStart, column, deriveWorkStarts, type Event, type Issue, type Lane, type Repo, type RepositoryIssueEvent } from "../src/lib/model";
import { sameLaneContent } from "../src/lib/lane-changes";

/** Closed issues' work starts for time estimates (#141). */
const repo: Repo = { id: 1, name: "test", full_name: "sample/test", description: null, private: true, html_url: "https://github.com/sample/test", owner: { login: "sample" } };
const closedAt = "2026-10-16T12:00:00Z";
const make = (id: number, extra: Partial<Issue> = {}): Issue => ({
  id, number: id, title: "Fixture", state: "open", html_url: `${repo.html_url}/issues/${id}`, created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-15T12:00:00Z", closed_at: null, labels: [], assignees: [], ...extra,
});
const working = (id: number, startedAt: string, extra: Partial<Issue> = {}) => make(id, { labels: [{ name: "in-progress", color: "aaa" }], startedAt, timerError: false, ...extra });
const closed = (id: number, extra: Partial<Issue> = {}) => make(id, { state: "closed", closed_at: closedAt, updated_at: closedAt, ...extra });
const event = (id: number, kind: string, created_at: string, label?: string): Event => ({ id, event: kind, created_at, ...(label ? { label: { name: label } } : {}) });

afterEach(() => vi.unstubAllGlobals());

describe("closing work start", () => {
  it("carries the in-progress start, or the previous closing's start, but never across a new closing", () => {
    expect(carriedWorkStart(closed(1), working(1, "2026-10-16T10:00:00Z"))).toBe("2026-10-16T10:00:00Z");
    expect(carriedWorkStart(closed(1), closed(1, { workStartedAt: "2026-10-16T09:00:00Z" }))).toBe("2026-10-16T09:00:00Z");
    expect(carriedWorkStart(closed(1, { closed_at: "2026-10-17T00:00:00Z" }), closed(1, { workStartedAt: "2026-10-16T09:00:00Z" }))).toBeUndefined();
    expect(carriedWorkStart(closed(1), make(1))).toBeUndefined();
    expect(carriedWorkStart(closed(1), working(1, "2026-10-16T10:00:00Z", { timerError: true }))).toBeUndefined();
    expect(carriedWorkStart(closed(1), working(1, "2026-10-16T13:00:00Z"))).toBeUndefined();
    expect(carriedWorkStart(make(1), working(1, "2026-10-16T10:00:00Z"))).toBeUndefined();
    expect(carriedWorkStart(closed(1), undefined)).toBeUndefined();
  });
  it("derives the last in-progress period before closing from label events", () => {
    const events = [
      event(1, "labeled", "2026-10-10T08:00:00Z", "in-progress"),
      event(2, "closed", "2026-10-10T09:00:00Z"),
      event(3, "reopened", "2026-10-11T09:00:00Z"),
      event(5, "labeled", "2026-10-16T10:00:00Z", "in-progress"),
      event(4, "labeled", "2026-10-15T10:00:00Z", "bug"),
      event(6, "unlabeled", "2026-10-16T11:00:00Z", "in-progress"),
      event(7, "closed", closedAt),
      event(8, "labeled", "2026-10-16T13:00:00Z", "in-progress"),
    ];
    // The label was removed on delivery before closing; the period still counts.
    expect(closedWorkStart(events, closedAt)).toBe("2026-10-16T10:00:00Z");
    expect(closedWorkStart(events.slice(0, 3), closedAt)).toBeNull();
    expect(closedWorkStart([event(1, "labeled", "2026-10-16T10:00:00Z", "Doing")], closedAt, { progress: "Doing" })).toBe("2026-10-16T10:00:00Z");
    expect(closedWorkStart(events, "invalid")).toBeNull();
  });
  it("fills missing starts of closed lane issues from repository events, keeping the lane when nothing changes", () => {
    const lane: Lane = { repo, labels: [], issues: [closed(1), closed(2, { workStartedAt: "2026-10-16T08:00:00Z" }), closed(3), working(4, "2026-10-16T09:00:00Z")] };
    const on = (issue: number, extra: Event): RepositoryIssueEvent => ({ ...extra, issue: { id: issue } });
    const events = [
      on(1, event(1, "labeled", "2026-10-16T10:00:00Z", "in-progress")),
      on(2, event(2, "labeled", "2026-10-16T11:00:00Z", "in-progress")),
      on(4, event(3, "labeled", "2026-10-16T09:00:00Z", "in-progress")),
      { ...event(4, "labeled", "2026-10-16T09:00:00Z", "in-progress") },
      on(3, { id: 5, event: "labeled", created_at: "2026-10-16T09:00:00Z", label: { name: 5 } } as unknown as Event),
    ];
    const derived = deriveWorkStarts(lane, events);
    expect(derived).not.toBe(lane);
    expect(derived.issues.map(issue => issue.workStartedAt)).toEqual(["2026-10-16T10:00:00Z", "2026-10-16T08:00:00Z", undefined, undefined]);
    expect(derived.issues[1]).toBe(lane.issues[1]);
    expect(derived.issues[3]).toBe(lane.issues[3]);
    expect(sameLaneContent(lane, derived)).toBe(false);
    expect(deriveWorkStarts(derived, events)).toBe(derived);
    // Estimates now see the closed issue; timers and columns do not.
    // Samples are newest first with ties broken by id, so compare membership in id order.
    expect(historySamples(derived.issues, Date.parse("2026-10-17T00:00:00Z")).map(sample => [sample.issue.id, sample.durationMs]).sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 7200000], [2, 14400000]]);
    expect(derived.issues[0]!.startedAt).toBeUndefined();
    expect(column(derived.issues[0]!)).toBe("closed");
  });
});

describe("sync keeps the start when an issue closes", () => {
  function stub(lists: { open?: Issue[]; closed?: Issue[]; changed?: Issue[] }) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      calls.push(url.pathname + url.search);
      if (url.pathname.endsWith("/labels")) return new Response("[]");
      if (url.pathname.endsWith("/events")) return new Response("[]");
      const state = url.searchParams.get("state");
      return new Response(JSON.stringify(state === "open" ? lists.open ?? [] : state === "closed" ? lists.closed ?? [] : lists.changed ?? []));
    }));
    return calls;
  }
  it("moves the in-progress start to workStartedAt in an incremental sync without timeline requests", async () => {
    const previous: Lane = { repo, labels: [], issues: [working(1, "2026-10-16T10:00:00Z"), closed(2, { workStartedAt: "2026-10-15T10:00:00Z" })] };
    const calls = stub({ changed: [closed(1)] });
    const lane = await new GitHub("token").syncLane(previous, {}, Date.now() - 60000);
    expect(calls.some(call => call.includes("/events"))).toBe(false);
    expect(lane.issues.map(issue => [issue.id, issue.workStartedAt, issue.startedAt])).toEqual([[1, "2026-10-16T10:00:00Z", undefined], [2, "2026-10-15T10:00:00Z", undefined]]);
    expect(lane.timerWarning).toBe(false);
  });
  it("keeps known closing starts through a full lane load, and stays without them on a first load", async () => {
    const previous: Lane = { repo, labels: [], issues: [working(1, "2026-10-16T10:00:00Z"), closed(2, { workStartedAt: "2026-10-15T10:00:00Z" })] };
    const now = new Date().toISOString();
    const calls = stub({ closed: [closed(1, { closed_at: now }), closed(2, { closed_at: now })] });
    const client = new GitHub("token");
    const first = await client.lane(repo, {});
    expect(first.issues.map(issue => issue.workStartedAt)).toEqual([undefined, undefined]);
    // Issue 2's closing changed, so its old start no longer applies.
    const lane = await client.lane(repo, {}, previous);
    expect(lane.issues.map(issue => issue.workStartedAt)).toEqual(["2026-10-16T10:00:00Z", undefined]);
    expect(calls.some(call => call.includes("/events"))).toBe(false);
    expect(JSON.stringify(client.exportResponses())).not.toContain("workStartedAt");
  });
});
