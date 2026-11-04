import { expect, it } from "vitest";
import { IssueStateEventTracker } from "../src/lib/issue-state-events";
import type { Issue, Lane } from "../src/lib/model";
const issue = (labels: string[] = [], state = "open"): Issue => ({ id: 1, number: 8, title: "Task", html_url: "https://github.com/sample/project/issues/8", state, labels: labels.map(name => ({ name, color: "fff" })), assignees: [], created_at: "2026-11-04T00:00:00Z", updated_at: "2026-11-04T01:00:00Z", closed_at: state === "closed" ? "2026-11-04T01:00:00Z" : null });
const lane = (entry: Issue): Lane => ({ repo: { id: 1, name: "project", full_name: "sample/project", private: true, html_url: "https://github.com/sample/project", description: null, owner: { login: "sample" } }, issues: [entry], labels: [] });
it("records only live observed state changes, including integration handoff, closure and reopening", () => {
 const tracker = new IssueStateEventTracker();
 expect(tracker.update([lane(issue())], {})).toEqual([]);
 expect(tracker.update([lane(issue())], {})).toEqual([]);
 expect(tracker.update([lane(issue(["in-progress"]))], {})[0]).toMatchObject({ from: "backlog", to: "progress", repository: "sample/project" });
 expect(tracker.update([lane(issue(["integration-ready"]))], {})[0]).toMatchObject({ from: "progress", to: "integration" });
 expect(tracker.update([lane(issue([], "closed"))], {})[0]).toMatchObject({ from: "integration", to: "closed" });
 expect(tracker.update([lane(issue())], {})[0]).toMatchObject({ from: "closed", to: "backlog" });
 tracker.clear(); expect(tracker.update([lane(issue(["in-progress"]))], {})).toEqual([]);
});
it("skips errors, loading, rule edits, PRs and deselected/account baselines", () => {
 const tracker = new IssueStateEventTracker(), first = lane(issue()); tracker.update([first], {});
 expect(tracker.update([{ ...lane(issue(["in-progress"])), error: "Failure" }], {})).toEqual([]);
 expect(tracker.update([{ ...lane(issue(["in-progress"])), loading: true }], {})).toEqual([]);
 expect(tracker.update([lane(issue(["in-progress"]))], {})).toHaveLength(1);
 expect(tracker.update([lane(issue(["in-progress"]))], { "sample/project": { progress: "working-now" } })).toEqual([]);
 expect(tracker.update([lane({ ...issue([], "closed"), pull_request: {} })], {})).toEqual([]);
 tracker.retain([]); expect(tracker.update([lane(issue([], "closed"))], {})).toEqual([]);
});
