import { describe, expect, it } from "vitest";
import { isInactiveRepository, pagesUrl, recentlyChanged, summarizeLanes } from "../src/lib/sidebar";
import type { Issue, Lane } from "../src/lib/model";
const issue = (id: number, labels: string[] = [], overrides: Partial<Issue> = {}): Issue => ({
  id, number: id, title: `Task ${id}`, html_url: "https://github.com/example/project/issues/1",
  state: "open", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-15T12:00:00Z", closed_at: null,
  labels: labels.map(name => ({ name, color: "fff" })), assignees: [], ...overrides,
});
const lane = (issues: Issue[]): Lane => ({
  repo: { id: 1, name: "project", full_name: "example/project", description: null, private: false, html_url: "https://github.com/example/project", owner: { login: "example" } },
  labels: [], issues,
});
describe("sidebar summaries", () => {
  it("uses custom workflow rules and gives closed state precedence over stale work labels", () => {
    const summary = summarizeLanes([lane([
      issue(1), issue(2, ["building"]), issue(3, ["in-progress"]),
      issue(4, ["building"], { state: "closed", closed_at: "2026-10-14T12:00:00Z" }),
    ])], { "example/project": { progress: "building" } }, true)[0];
    expect(summary).toMatchObject({ backlog: 2, progress: 1, closed: 1 });
  });
  it("excludes pull requests and respects coordination filtering for both counts and latest activity", () => {
    const input = [lane([
      issue(1),
      issue(2, ["agent-coordination", "in-progress"], { updated_at: "2026-10-15T12:01:00Z" }),
      issue(3, [], { pull_request: {}, updated_at: "2026-10-15T12:02:00Z" }),
    ])];
    expect(summarizeLanes(input, {}, true)[0]).toMatchObject({ backlog: 1, progress: 0, changedAt: "2026-10-15T12:00:00Z" });
    expect(summarizeLanes(input, {}, false)[0]).toMatchObject({ backlog: 1, progress: 1, changedAt: "2026-10-15T12:01:00Z" });
  });
  it("includes every loaded issue regardless of title, search terms, or current card display limit", () => {
    const input = lane(Array.from({ length: 40 }, (_, index) => issue(index, [], { title: index % 2 ? "keyboard" : "screen" })));
    expect(summarizeLanes([input], {}, true)[0]?.backlog).toBe(40);
    expect(input.issues).toHaveLength(40);
  });
  it("handles empty lanes and invalid dates without inventing recent activity", () => {
    expect(summarizeLanes([lane([])], {}, true)[0]).toMatchObject({ backlog: 0, progress: 0, closed: 0, changedAt: null });
    expect(summarizeLanes([lane([issue(1, [], { updated_at: "invalid" })])], {}, true)[0]?.changedAt).toBeNull();
  });
  it("uses a five-minute recent window and excludes future timestamps", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(recentlyChanged("2026-10-15T11:55:00Z", now)).toBe(true);
    expect(recentlyChanged("2026-10-15T11:54:59Z", now)).toBe(false);
    expect(recentlyChanged("2026-10-15T12:00:01Z", now)).toBe(false);
    expect(recentlyChanged(null, now)).toBe(false);
    expect(recentlyChanged("invalid", now)).toBe(false);
  });
});

describe("sidebar visibility and Pages link", () => {
  const repo = (name: string, extra: object = {}) => ({ id: 1, name, full_name: `Example/${name}`, description: null, html_url: "x", owner: { login: "Example" }, ...extra }) as never;
  it("builds standard and user-site Pages addresses with a lowercase host", () => {
    expect(pagesUrl(repo("project", { private: false, has_pages: true }))).toBe("https://example.github.io/project/");
    expect(pagesUrl(repo("Example.github.io", { private: false, has_pages: true }))).toBe("https://example.github.io/");
  });
  it("hides visibility and Pages when the data is unknown or Pages is off", () => {
    const summary = (r: object) => summarizeLanes([{ repo: r, labels: [], issues: [] } as Lane], {}, true)[0]!;
    const unknown = summary(repo("project"));
    expect(unknown).not.toHaveProperty("private");
    expect(unknown).not.toHaveProperty("pagesUrl");
    expect(summary(repo("project", { private: true, has_pages: false }))).toMatchObject({ private: true });
    expect(summary(repo("project", { private: true, has_pages: false }))).not.toHaveProperty("pagesUrl");
    expect(summary(repo("project", { private: false, has_pages: true }))).toMatchObject({ private: false, pagesUrl: "https://example.github.io/project/" });
  });
});

describe("isInactiveRepository", () => {
  it("identifies repositories without open backlog or in-progress issues as inactive", () => {
    expect(isInactiveRepository({ backlog: 0, progress: 0 })).toBe(true);
    expect(isInactiveRepository({ backlog: 0, progress: 0, loading: false })).toBe(true);
  });
  it("keeps repositories with open backlog or in-progress issues active", () => {
    expect(isInactiveRepository({ backlog: 1, progress: 0 })).toBe(false);
    expect(isInactiveRepository({ backlog: 0, progress: 2 })).toBe(false);
    expect(isInactiveRepository({ backlog: 3, progress: 1 })).toBe(false);
  });
  it("does not classify actively loading repositories as inactive before issues resolve", () => {
    expect(isInactiveRepository({ backlog: 0, progress: 0, loading: true })).toBe(false);
  });
});
