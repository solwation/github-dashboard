import { describe, expect, it } from "vitest";
import { issueType, issueTypeLabel } from "../src/lib/issue-type";
const l = (...names: string[]) => names.map((name) => ({ name }));
describe("issueType", () => {
  it.each([
    [["bug"], "bug"], [["defect"], "bug"], [["regression"], "bug"],
    [["enhancement"], "feature"], [["feature"], "feature"], [["feature request"], "feature"],
    [["documentation"], "docs"], [["docs"], "docs"],
    [["question"], "question"], [["help wanted"], "help"], [["good first issue"], "help"],
    [["chore"], "chore"], [["refactor"], "chore"], [["security"], "security"],
  ])("maps %j to %s", (names, type) => expect(issueType(l(...names))).toBe(type));
  it("ignores case, spacing and separators", () => {
    expect(issueType(l("BUG"))).toBe("bug");
    expect(issueType(l(" Feature  Request "))).toBe("feature");
    expect(issueType(l("good-first-issue"))).toBe("help");
    expect(issueType(l("type: bug"))).toBeNull();
  });
  it("uses a fixed priority with several type labels (bug first)", () => {
    expect(issueType(l("enhancement", "bug", "docs"))).toBe("bug");
    expect(issueType(l("docs", "enhancement"))).toBe("feature");
    expect(issueType(l("help wanted", "question"))).toBe("question");
  });
  it("returns null without a known type label", () => {
    expect(issueType([])).toBeNull();
    expect(issueType(l("priority: high", "in-progress", "wontfix"))).toBeNull();
  });
});
describe("issueTypeLabel", () => {
  it("returns the label the type was derived from, matching issueType priority", () => {
    const labels = l("priority: high", "docs", "Bug", "enhancement");
    expect(issueTypeLabel(labels)).toBe(labels[2]);
    const f = l("x", "Feature Request");
    expect(issueTypeLabel(f)).toBe(f[1]);
  });
  it("consumes only the first label when several match the winning type", () => {
    const labels = l("defect", "bug");
    expect(issueTypeLabel(labels)).toBe(labels[0]);
  });
  it("returns null without a type", () => {
    expect(issueTypeLabel([])).toBeNull();
    expect(issueTypeLabel(l("wontfix"))).toBeNull();
  });
});
