import { describe, expect, it } from "vitest";
import { ActivityTracker, ACTIVITY_LIFETIME_MS } from "../src/lib/activity";
import type { Issue, Lane } from "../src/lib/model";
const now = Date.parse("2026-10-15T12:00:00Z");
const repo = "sample/project";
const issue = (id: number, col = "backlog", at = now): Issue => ({ id, number: id, title: "Fixture", html_url: `https://github.com/${repo}/issues/${id}`, state: col === "closed" ? "closed" : "open", closed_at: col === "closed" ? new Date(at).toISOString() : null, created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(at).toISOString(), labels: col === "progress" ? [{ name: "in-progress", color: "fff" }] : [], assignees: [] });
const lane = (issues: Issue[]): Lane => ({ repo: { id: 1, name: "project", full_name: repo, description: null, private: false, html_url: `https://github.com/${repo}`, owner: { login: "sample" } }, issues, labels: [] });
describe("readable activity", () => {
  it("uses the request start when a repository response completes after an issue was created", () => {
    const tracker = new ActivityTracker();
    tracker.update([lane([])], {}, now + 3000, { observedAt: { [repo]: now } });
    const fresh = { ...issue(2, "backlog", now + 2000), created_at: new Date(now + 2000).toISOString() };
    tracker.update([lane([fresh])], {}, now + 4000);
    expect(tracker.moved(repo, fresh, now + 4000)).toBe("created");
  });
  it("preserves the creation baseline while polling only known active issues", () => {
    const tracker = new ActivityTracker();
    const existing = issue(1, "progress", now);
    tracker.update([lane([existing])], {}, now);
    tracker.update([lane([existing])], {}, now + 3000, { discoverNew: false });
    const fresh = { ...issue(2, "backlog", now + 2000), created_at: new Date(now + 2000).toISOString() };
    tracker.update([lane([existing, fresh])], {}, now + 4000);
    expect(tracker.moved(repo, fresh, now + 4000)).toBe("created");
  });
  it("marks a newly created Backlog issue after the established baseline and keeps it across syncs", () => {
    const tracker = new ActivityTracker();
    tracker.update([lane([issue(1)])], {}, now);
    const created = { ...issue(2, "backlog", now + 1000), created_at: new Date(now + 1000).toISOString() };
    tracker.update([lane([issue(1), created])], {}, now + 2000);
    expect(tracker.moved(repo, created, now + 2000)).toBe("created");
    tracker.update([lane([issue(1), created])], {}, now + 3000);
    expect(tracker.moved(repo, created, now + 3000)).toBe("created");
    const commented = { ...created, updated_at: new Date(now + 4000).toISOString() };
    tracker.update([lane([issue(1), commented])], {}, now + 4000);
    expect(tracker.moved(repo, commented, now + 4000)).toBe("created");
    expect(tracker.moved(repo, commented, now + 1000 + ACTIVITY_LIFETIME_MS)).toBe(false);
  });
  it("keeps creation separate from movement and acknowledges it using existing read versions", () => {
    const tracker = new ActivityTracker();
    tracker.update([lane([])], {}, now);
    const created = { ...issue(1, "backlog", now + 1000), created_at: new Date(now + 1000).toISOString() };
    tracker.update([lane([created])], {}, now + 1000);
    tracker.read(repo, created);
    tracker.update([lane([created])], {}, now + 2000);
    expect(tracker.moved(repo, created, now + 2000)).toBe(false);
    expect(tracker.changedAt(repo, created, now + 2000)).toBeNull();
    const inProgress = { ...created, labels: [{ name: "in-progress", color: "fff" }], updated_at: new Date(now + 3000).toISOString() };
    tracker.update([lane([inProgress])], {}, now + 3000);
    expect(tracker.moved(repo, inProgress, now + 3000)).toBe(true);
    const returned = { ...created, updated_at: new Date(now + 4000).toISOString() };
    tracker.update([lane([returned])], {}, now + 4000);
    expect(tracker.moved(repo, returned, now + 4000)).toBe(true);
    const restored = new ActivityTracker();
    restored.restore(tracker.acknowledgements());
    restored.update([lane([created])], {}, now + 5000);
    expect(restored.moved(repo, created, now + 5000)).toBe(false);
    expect(restored.changedAt(repo, created, now + 5000)).toBeNull();
  });
  it("does not mark creation at startup, cached hydration, or after selecting a repository again", () => {
    const tracker = new ActivityTracker();
    const created = { ...issue(1), created_at: new Date(now - 1000).toISOString() };
    tracker.update([lane([created])], {}, now);
    expect(tracker.moved(repo, created, now)).toBe(false);
    tracker.retain([]);
    tracker.update([lane([created])], {}, now + 1000);
    expect(tracker.moved(repo, created, now + 1000)).toBe(false);
    const fresh = new ActivityTracker();
    fresh.update([lane([created])], {}, now + 2000);
    fresh.update([lane([created, issue(2)])], {}, now + 3000);
    expect(fresh.moved(repo, issue(2), now + 3000)).toBe(false);
  });
  it("rejects old, invalid, future, PR and already-expired creations and respects repository rules", () => {
    const tracker = new ActivityTracker();
    tracker.update([lane([])], {}, now);
    const recent = { ...issue(1, "backlog", now + 1000), created_at: new Date(now + 1000).toISOString() };
    const old = issue(2, "backlog", now + 1000);
    const invalid = { ...recent, id: 3, created_at: "bad" };
    const future = { ...recent, id: 4, created_at: new Date(now + 10000).toISOString() };
    const pr = { ...recent, id: 5, pull_request: {} };
    const working = { ...recent, id: 6, labels: [{ name: "custom", color: "fff" }] };
    const custom = new ActivityTracker();
    custom.update([lane([])], { [repo]: { progress: "custom" } }, now);
    custom.update([lane([working])], { [repo]: { progress: "custom" } }, now + 2000);
    expect(custom.moved(repo, working, now + 2000)).toBe(false);
    tracker.update([lane([recent, old, invalid, future, pr])], {}, now + 2000);
    for (const item of [old, invalid, future, pr]) expect(tracker.moved(repo, item, now + 2000)).toBe(false);
    expect(tracker.moved(repo, recent, now + 2000)).toBe("created");
    tracker.clear();
    tracker.update([lane([])], {}, now);
    tracker.update([lane([recent])], {}, now + ACTIVITY_LIFETIME_MS + 1001);
    expect(tracker.moved(repo, recent, now + ACTIVITY_LIFETIME_MS + 1001)).toBe(false);
  });
  it("does not infer creation from settings edits or recovery of previously unavailable old issues", () => {
    const tracker = new ActivityTracker();
    tracker.update([{ ...lane([]), error: "offline" }], {}, now);
    const recent = { ...issue(1, "backlog", now + 1000), created_at: new Date(now + 1000).toISOString() };
    tracker.update([lane([recent])], {}, now + 2000);
    expect(tracker.moved(repo, recent, now + 2000)).toBe(false);
    tracker.update([{ ...lane([]), error: "offline" }], {}, now + 3000);
    const recoveredOld = issue(2, "backlog", now + 4000);
    tracker.update([lane([recent, recoveredOld])], {}, now + 4000);
    expect(tracker.moved(repo, recoveredOld, now + 4000)).toBe(false);
    const next = { ...recent, id: 3, created_at: new Date(now + 5000).toISOString(), updated_at: new Date(now + 5000).toISOString() };
    tracker.update([lane([recent, recoveredOld, next])], { [repo]: { progress: "custom" } }, now + 6000);
    expect(tracker.moved(repo, next, now + 6000)).toBe(false);
  });
  it("starts a silent movement baseline but tracks recent unread updates", () => {
    const tracker = new ActivityTracker(); const i = issue(1, "closed");
    tracker.update([lane([i])], {}, now);
    expect(tracker.moved(repo, i, now)).toBe(false);
    expect(tracker.changedAt(repo, i, now)).toBe(new Date(now).toISOString());
  });
  it("detects all column movements, ignores repeated snapshots and expires at two minutes", () => {
    const tracker = new ActivityTracker();
    tracker.update([lane([issue(1)])], {}, now);
    let at = now;
    for (const col of ["progress", "closed", "backlog"]) {
      at += 1000; const i = issue(1, col, at);
      tracker.update([lane([i])], {}, at);
      expect(tracker.moved(repo, i, at)).toBe(true);
      tracker.update([lane([i])], {}, at + ACTIVITY_LIFETIME_MS);
      expect(tracker.moved(repo, i, at + ACTIVITY_LIFETIME_MS)).toBe(false);
    }
  });
  it("acknowledges individual issues, preserves other unread changes, and restores after reload", () => {
    const tracker = new ActivityTracker(); const items = [issue(1), issue(2)];
    tracker.update([lane(items)], {}, now);
    tracker.read(repo, items[0]!);
    tracker.update([lane(items)], {}, now + 1000);
    expect(tracker.changedAt(repo, items[0]!, now + 1000)).toBeNull();
    expect(tracker.changedAt(repo, items[1]!, now + 1000)).not.toBeNull();
    const restored = new ActivityTracker(); restored.restore(tracker.acknowledgements());
    restored.update([lane(items)], {}, now + 1000);
    expect(restored.changedAt(repo, items[0]!, now + 1000)).toBeNull();
    const changed = issue(1, "progress", now + 2000);
    restored.update([lane([changed])], {}, now + 2000);
    expect(restored.moved(repo, changed, now + 2000)).toBe(true);
  });
  it("keeps a movement unread during a subsequent comment update without extending its deadline", () => {
    const tracker = new ActivityTracker(); tracker.update([lane([issue(1)])], {}, now);
    tracker.update([lane([issue(1, "progress", now + 1000)])], {}, now + 1000);
    const comment = issue(1, "progress", now + 3000);
    tracker.update([lane([comment])], {}, now + 3000);
    expect(tracker.moved(repo, comment, now + 4000)).toBe(true);
    expect(tracker.moved(repo, comment, now + 1000 + ACTIVITY_LIFETIME_MS)).toBe(false);
  });
  it("does not interpret custom-rule changes or failed fetches as movements", () => {
    const tracker = new ActivityTracker(); const i = issue(1, "progress");
    tracker.update([lane([i])], {}, now);
    tracker.update([lane([i])], { [repo]: { progress: "other" } }, now + 1000);
    expect(tracker.moved(repo, i, now + 1000)).toBe(false);
    tracker.update([{ ...lane([issue(1, "closed")]), error: "offline" }], {}, now + 2000);
    expect(tracker.moved(repo, i, now + 2000)).toBe(false);
  });
  it("drops stale repositories, deleted issues and account-specific acknowledgements on clear", () => {
    const tracker = new ActivityTracker(); const i = issue(1);
    tracker.update([lane([i])], {}, now); tracker.read(repo, i); tracker.clear();
    expect(tracker.acknowledgements()).toEqual({});
    tracker.update([lane([i])], {}, now); tracker.retain([]);
    expect(tracker.changedAt(repo, i, now)).toBeNull();
  });
});
