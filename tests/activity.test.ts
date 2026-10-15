import { describe, expect, it } from "vitest";
import { ActivityTracker, ACTIVITY_LIFETIME_MS } from "../src/lib/activity";
import type { Issue, Lane } from "../src/lib/model";
const now = Date.parse("2026-10-15T12:00:00Z");
const repo = "sample/project";
const issue = (id: number, col = "backlog", at = now): Issue => ({ id, number: id, title: "Fixture", html_url: `https://github.com/${repo}/issues/${id}`, state: col === "closed" ? "closed" : "open", closed_at: col === "closed" ? new Date(at).toISOString() : null, created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(at).toISOString(), labels: col === "progress" ? [{ name: "in-progress", color: "fff" }] : [], assignees: [] });
const lane = (issues: Issue[]): Lane => ({ repo: { id: 1, name: "project", full_name: repo, description: null, private: false, html_url: `https://github.com/${repo}`, owner: { login: "sample" } }, issues, labels: [] });
describe("readable activity", () => {
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
