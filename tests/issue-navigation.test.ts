import { describe, expect, it } from "vitest";
import { issueDomId, issueNavigationHash, parseIssueNavigationHash } from "../src/lib/issue-navigation";

describe("issue navigation hash", () => {
  it("formats deterministic DOM ids for issues", () => {
    expect(issueDomId("sample/alpha", 42)).toBe("issue-sample%2Falpha-42");
    expect(issueDomId("Sample/Alpha", 42)).toBe("issue-sample%2Falpha-42");
  });
  it("round-trips a repository id and issue number", () => {
    const hash = issueNavigationHash({ repoId: 7, number: 42 });
    expect(hash).toBe("#repo-7-issue-42");
    expect(parseIssueNavigationHash(hash)).toEqual({ repoId: 7, number: 42 });
  });
  it("ignores ordinary navigation and malformed targets", () => {
    for (const hash of ["#repo-7", "#overview", "#statistics-repo-7", "#repo-7-issue-0", "#repo-x-issue-1", "#repo-7-issue-1/extra", ""])
      expect(parseIssueNavigationHash(hash)).toBeNull();
  });
});
