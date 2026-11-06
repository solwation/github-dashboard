import { describe, expect, it } from "vitest";
import { countActiveRepositories, inactiveAfter, isInactiveRepository, normalizeInactiveGraceMinutes, pagesUrl, parseInactiveGraceMinutes, websiteUrl, recentlyChanged, summarizeLanes } from "../src/lib/sidebar";
import type { Issue, Lane } from "../src/lib/model";
import { repositoryVisibility } from "../src/lib/repository-visibility";
import { withPendingClosures, pendingIssue, type PendingClosure } from "../src/lib/pending-closures";
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
  it("prefers a configured HTTP(S) Website even with Pages enabled", () => {
    for (const homepage of ["https://project.example/custom?q=1#about", "http://project.example/"]) {
      const r = repo("project", { has_pages: true, homepage });
      expect(websiteUrl(r)).toBe(homepage);
      expect(summarizeLanes([{ repo: r, labels: [], issues: [] }], {}, true)[0]?.websiteUrl).toBe(homepage);
    }
    expect(websiteUrl(repo("project", { homepage: "  HTTPS://Project.Example  " }))).toBe("https://project.example/");
  });
  it.each([undefined, null, "", "   ", "example.com", "/relative", "https://", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "https://user:secret@example.com"])("falls back safely for unusable Website %s", homepage => {
    expect(websiteUrl(repo("project", { homepage, has_pages: true }))).toBe("https://example.github.io/project/");
    expect(websiteUrl(repo("project", { homepage, has_pages: false }))).toBeNull();
  });
  it("hides visibility and Pages when the data is unknown or Pages is off", () => {
    const summary = (r: object) => summarizeLanes([{ repo: r, labels: [], issues: [] } as Lane], {}, true)[0]!;
    const unknown = summary(repo("project"));
    expect(unknown).not.toHaveProperty("private");
    expect(unknown).not.toHaveProperty("websiteUrl");
    expect(summary(repo("project", { private: true, has_pages: false }))).toMatchObject({ private: true });
    expect(summary(repo("project", { private: true, has_pages: false }))).not.toHaveProperty("websiteUrl");
    expect(summary(repo("project", { private: false, has_pages: true }))).toMatchObject({ private: false, websiteUrl: "https://example.github.io/project/" });
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

describe("inactivity grace after the last closed issue (#430)", () => {
  const NOW = Date.parse("2026-11-06T12:00:00Z");
  const MIN = 60_000;
  const GRACE = 30 * MIN;
  const idle = { backlog: 0, progress: 0 };
  it("stays active until exactly the grace has passed", () => {
    const repo = { ...idle, lastClosedAt: NOW - GRACE + 1 };
    expect(isInactiveRepository(repo, NOW, GRACE)).toBe(false);
    expect(isInactiveRepository({ ...idle, lastClosedAt: NOW - GRACE }, NOW, GRACE)).toBe(true);
    expect(isInactiveRepository({ ...idle, lastClosedAt: NOW }, NOW, GRACE)).toBe(false);
    expect(inactiveAfter(repo, GRACE)).toBe(NOW + 1);
  });
  it("turns inactive at once with grace 0, without closed_at, or with a missing value", () => {
    expect(isInactiveRepository({ ...idle, lastClosedAt: NOW }, NOW, 0)).toBe(true);
    expect(isInactiveRepository({ ...idle, lastClosedAt: null }, NOW, GRACE)).toBe(true);
    expect(isInactiveRepository(idle, NOW, GRACE)).toBe(true);
    expect(inactiveAfter({ lastClosedAt: NOW }, 0)).toBeNull();
  });
  it("never lets the grace make a busy or loading repository inactive", () => {
    expect(isInactiveRepository({ backlog: 1, progress: 0, lastClosedAt: NOW - 99 * GRACE }, NOW, GRACE)).toBe(false);
    expect(isInactiveRepository({ ...idle, loading: true, lastClosedAt: null }, NOW, GRACE)).toBe(false);
  });
  it("derives the latest close time from closed issues, ignoring open ones, PRs and bad dates", () => {
    const closed = (id: number, at: string | null) => issue(id, [], { state: "closed", closed_at: at });
    const [summary] = summarizeLanes([lane([
      closed(1, "2026-11-06T11:00:00Z"), closed(2, "2026-11-06T11:40:00Z"), closed(3, "garbage"), closed(4, null),
      issue(5, [], { state: "closed", closed_at: "2026-11-06T11:59:00Z", pull_request: { url: "x" } as never }),
      issue(6),
    ])], {}, false);
    expect(summary!.lastClosedAt).toBe(Date.parse("2026-11-06T11:40:00Z"));
    expect(summarizeLanes([lane([])], {}, false)[0]!.lastClosedAt).toBeNull();
  });
  it("counts a pending closure as a close at its detection time", () => {
    const entry: PendingClosure = { repository: "example/project", issue: issue(7, ["in-progress"]), detectedAt: NOW - 5 * MIN, deadline: NOW, failures: 0, nextAttemptAt: NOW };
    expect(pendingIssue(entry).closed_at).toBe(new Date(NOW - 5 * MIN).toISOString());
    const [summary] = summarizeLanes(withPendingClosures([lane([])], [entry]), {}, false);
    expect(summary!.progress).toBe(0);
    expect(summary!.lastClosedAt).toBe(NOW - 5 * MIN);
    expect(isInactiveRepository(summary!, NOW, GRACE)).toBe(false);
    expect(isInactiveRepository(summary!, NOW + 26 * MIN, GRACE)).toBe(true);
  });
  it("applies per repository in counts and board visibility; external and unavailable repositories are unchanged", () => {
    const recent = { fullName: "me/recent", ...idle, lastClosedAt: NOW - MIN };
    const old = { fullName: "me/old", ...idle, lastClosedAt: NOW - 2 * GRACE };
    const never = { fullName: "me/never", ...idle, lastClosedAt: null };
    const busy = { fullName: "me/busy", backlog: 2, progress: 0, lastClosedAt: null };
    const repos = [recent, old, never, busy] as never[];
    expect(countActiveRepositories(repos, NOW, GRACE)).toBe(2);
    expect(countActiveRepositories(repos, NOW, 0)).toBe(1);
    const state = { hidden: [], hideInactive: true, revealed: [], now: NOW, inactiveGraceMs: GRACE };
    expect(repositoryVisibility(recent, state)).toBe("visible");
    expect(repositoryVisibility(old, state)).toBe("inactive");
    expect(repositoryVisibility(recent, { ...state, now: NOW + GRACE })).toBe("inactive");
    expect(repositoryVisibility({ ...never, external: true }, state)).toBe("visible");
    expect(repositoryVisibility({ ...old, unavailable: true }, state)).toBe("visible");
  });
  it("normalizes the setting: whole minutes 0..1440, otherwise the default 30", () => {
    expect([0, 1, 30, 1440, "45", " 7 "].map(parseInactiveGraceMinutes)).toEqual([0, 1, 30, 1440, 45, 7]);
    for (const bad of [-1, 1441, 1.5, "", "x", "1.5", "-3", NaN, null, undefined, {}]) expect(parseInactiveGraceMinutes(bad)).toBeNull();
    expect(normalizeInactiveGraceMinutes(undefined)).toBe(30);
    expect(normalizeInactiveGraceMinutes(0)).toBe(0);
    expect(normalizeInactiveGraceMinutes("junk")).toBe(30);
  });
});
