import { describe, expect, it } from "vitest";
import { repositoryActivity, REPOSITORY_ACTIVITY_MS } from "../src/lib/repository-activity";
import type { Issue, Lane } from "../src/lib/model";
const now = Date.parse("2026-10-28T12:00:00Z");
const issue = (changes: Partial<Issue> = {}): Issue => ({ id: 1, number: 1, title: "Work", state: "open", html_url: "https://github.com/sample/repo/issues/1", created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(now - 1000).toISOString(), closed_at: null, labels: [{ name: "in-progress", color: "" }], assignees: [], ...changes });
const lane = (issues: Issue[], changes: Partial<Lane> = {}): Lane => ({ repo: { id: 1, name: "repo", full_name: "sample/repo", private: false, html_url: "", description: null, owner: { login: "sample" } }, issues, labels: [], ...changes });
describe("repository work evidence", () => {
  it("requires recent active work and expires at the same one-hour threshold as inactivity", () => {
    const work = issue({ updated_at: new Date(now - REPOSITORY_ACTIVITY_MS).toISOString() });
    expect(repositoryActivity(lane([work]), {}, now)).toBeNull();
    expect(repositoryActivity(lane([work]), {}, now - 1)?.issues).toBe(1);
    for (const change of [{ state: "closed" }, { labels: [] }, { pull_request: {} }, { updated_at: "bad" }, { updated_at: new Date(now + 1).toISOString() }])
      expect(repositoryActivity(lane([issue(change)]), {}, now)).toBeNull();
  });
  it("never uses old coordination issues, fresh coordination comments or owner claims alone", () => {
    const coordination = issue({ id: 97, labels: [{ name: "orkester", color: "" }] });
    const owner = issue({ labels: [{ name: "orkester: session", color: "" }] });
    expect(repositoryActivity(lane([coordination, owner]), {}, now)).toBeNull();
    expect(repositoryActivity(lane([coordination, issue({ updated_at: new Date(now - REPOSITORY_ACTIVITY_MS).toISOString() })]), {}, now)).toBeNull();
  });
  it("uses custom rules and unique issues, links hidden coordination, and does not count agents", () => {
    const work = issue({ labels: [{ name: "Building", color: "" }, { name: "orkester: session", color: "" }] });
    const coordination = issue({ id: 97, labels: [{ name: "agent coordination", color: "" }] });
    const result = repositoryActivity(lane([work, work, coordination]), { progress: "Building" }, now);
    expect(result).toEqual({ repository: "sample/repo", latestAt: now - 1000, issues: 1, claimed: true, coordination });
    expect(repositoryActivity(lane([work]), {}, now)).toBeNull();
    expect(repositoryActivity(lane([work], { error: "unavailable" }), { progress: "Building" }, now)).toBeNull();
    expect(repositoryActivity(lane([work], { loading: true }), { progress: "Building" }, now)).toBeNull();
  });
});
