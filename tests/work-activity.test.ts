import { describe, expect, it } from "vitest";
import { inactiveWork, WORK_INACTIVITY_MS } from "../src/lib/work-activity";
import type { Issue } from "../src/lib/model";

const now = Date.parse("2026-10-28T12:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const issue = (changes: Partial<Issue> = {}): Issue => ({ id: 1, number: 1, title: "Work", html_url: "", state: "open", created_at: iso(now - 86400000), updated_at: iso(now - WORK_INACTIVITY_MS), startedAt: iso(now - 2 * WORK_INACTIVITY_MS), closed_at: null, labels: [{ name: "in-progress", color: "" }], assignees: [], ...changes });

describe("visible work activity", () => {
  it("flags inactivity at one hour and clears on any new visible issue activity", () => {
    const work = issue();
    expect(inactiveWork(work, {}, now - 1)).toBeNull();
    expect(inactiveWork(work, {}, now)).toEqual({ lastActivityMs: now - WORK_INACTIVITY_MS, idleMs: WORK_INACTIVITY_MS });
    work.updated_at = iso(now);
    expect(inactiveWork(work, {}, now)).toBeNull();
  });
  it("uses the later of work start and issue update, including custom workflow rules", () => {
    const work = issue({ startedAt: iso(now - 1000), labels: [{ name: "Building", color: "" }] });
    expect(inactiveWork(work, { progress: "Building" }, now)).toBeNull();
    expect(inactiveWork(work, { progress: "Building" }, now + WORK_INACTIVITY_MS)?.lastActivityMs).toBe(now - 1000);
    expect(inactiveWork(work, {}, now + WORK_INACTIVITY_MS)).toBeNull();
  });
  it("does not infer agent status from backlog, closed work, coordination, PRs or incomplete timestamps", () => {
    for (const changes of [{ labels: [] }, { state: "closed" }, { pull_request: {} }, { startedAt: null }, { startedAt: "bad" }, { updated_at: "bad" }, { startedAt: iso(now + 1) }, { updated_at: iso(now + 1) }, { labels: [{ name: "in-progress", color: "" }, { name: "orkester", color: "" }] }]) {
      expect(inactiveWork(issue(changes), {}, now)).toBeNull();
    }
    expect(inactiveWork(issue(), {}, NaN)).toBeNull();
  });
});
