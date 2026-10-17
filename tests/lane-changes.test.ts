import { describe, expect, it } from "vitest";
import { sameLaneContent, sameLaneList } from "../src/lib/lane-changes";
import type { Issue, Lane } from "../src/lib/model";

const issue = (id: number, extra: Partial<Issue> = {}): Issue => ({ id, number: id, title: `Issue ${id}`, html_url: "", state: "open",
  created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-16T10:00:00Z", closed_at: null, labels: [{ name: "bug", color: "ededed" }], assignees: [], ...extra });
const lane = (issues: Issue[], extra: Partial<Lane> = {}): Lane => ({ repo: { id: 1, name: "test", full_name: "sample/test", description: null, private: true,
  html_url: "", owner: { login: "sample" } }, labels: [{ name: "bug", color: "ededed" }], issues, ...extra });

describe("unchanged sync detection (#122)", () => {
  it("treats freshly copied but identical issue versions (a 304 sync) as unchanged", () => {
    const shown = lane([issue(1, { startedAt: "2026-10-16T09:00:00Z" }), issue(2)]);
    const synced = { ...shown, repo: { ...shown.repo }, labels: shown.labels.map(label => ({ ...label })), issues: shown.issues.map(entry => ({ ...entry })) };
    expect(sameLaneContent(shown, synced)).toBe(true);
  });
  it("detects every change the board shows", () => {
    const shown = lane([issue(1), issue(2)]);
    for (const synced of [
      lane([issue(1), issue(2, { updated_at: "2026-10-16T11:00:00Z" })]),
      lane([issue(1)]), lane([issue(2), issue(1)]),
      lane([issue(1), issue(2, { startedAt: "2026-10-16T09:00:00Z" })]),
      lane([issue(1), issue(2, { timerError: true })], { timerWarning: true }),
      lane([issue(1), issue(2, { sub_issues_summary: { total: 2, completed: 1 } })]),
      lane([issue(1), issue(2)], { labels: [{ name: "bug", color: "ff0000" }] }),
      lane([issue(1), issue(2)], { repo: { ...shown.repo, description: "New" } }),
    ]) expect(sameLaneContent(shown, synced)).toBe(false);
    expect(sameLaneContent(undefined, shown)).toBe(false);
    expect(sameLaneContent({ ...shown, error: "Failure" }, lane([issue(1), issue(2)]))).toBe(false);
    expect(sameLaneContent({ ...shown, loading: true }, lane([issue(1), issue(2)]))).toBe(false);
  });
  it("compares lane lists by identity", () => {
    const a = lane([]), b = lane([]);
    expect(sameLaneList([a, b], [a, b])).toBe(true);
    expect(sameLaneList([a, b], [a, { ...b }])).toBe(false);
    expect(sameLaneList([a], [a, b])).toBe(false);
  });
});
