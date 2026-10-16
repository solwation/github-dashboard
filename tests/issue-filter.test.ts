import { describe, expect, it } from "vitest";
import { matchesIssueFilters } from "../src/lib/issue-filter";
import { demo } from "../src/lib/demo";

describe("issue text filters", () => {
  const issue = demo()[0]!.issues[0]!;
  it("matches titles, numbers and labels without case sensitivity", () => {
    for (const query of ["TANGENTBORD", "#120", "PRIORITY: HIGH", ""]) {
      expect(matchesIssueFilters(issue, query, "")).toBe(true);
      expect(matchesIssueFilters(issue, "", query)).toBe(true);
    }
  });
  it("requires both independent searches to match", () => {
    expect(matchesIssueFilters(issue, "bug", "tangentbord")).toBe(true);
    expect(matchesIssueFilters(issue, "enhancement", "tangentbord")).toBe(false);
    expect(matchesIssueFilters(issue, "bug", "missing")).toBe(false);
  });
});
