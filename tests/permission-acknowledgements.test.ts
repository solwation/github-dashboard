import { describe, expect, it } from "vitest";
import { permissionProblemKey, reconcilePermissionAcknowledgements, restorePermissionAcknowledgements } from "../src/lib/permission-acknowledgements";
import { missingPermissionCount, type PermissionReport, type PermissionResult } from "../src/lib/permissions";
const report = (status: PermissionResult["status"] = "missing", reason: PermissionResult["reason"] = "denied"): PermissionReport => [
  { permission: "contents", repositories: [{ repo: "Sample/Repo", status, reason }] },
];
describe("account-local permission notice history", () => {
  it("survives JSON persistence and canonical repository case without modifying the visible report", () => {
    const source = report(); const before = structuredClone(source);
    const acknowledged = reconcilePermissionAcknowledgements([], source, true);
    const restored = restorePermissionAcknowledgements(JSON.parse(JSON.stringify(acknowledged)));
    expect(restored).toEqual(["contents:sample/repo"]);
    expect(reconcilePermissionAcknowledgements(restored, report())).toEqual(restored);
    expect(permissionProblemKey("contents", "SAMPLE/REPO")).toBe(restored[0]);
    expect(source).toEqual(before);
    expect(missingPermissionCount(source)).toBe(1);
  });
  it("preserves history across transient unknown access, empty reports and selection changes", () => {
    const acknowledged = ["contents:sample/repo"];
    const reports: PermissionReport[] = [[], report("unknown", "unverified"), [
      { permission: "issues", repositories: [{ repo: "sample/new", status: "missing", reason: "denied" }] },
    ]];
    for (const next of reports) {
      expect(reconcilePermissionAcknowledgements(acknowledged, next)).toEqual(acknowledged);
    }
  });
  it("only acknowledges actual viewed missing problems and leaves new problems unseen", () => {
    expect(reconcilePermissionAcknowledgements([], report())).toEqual([]);
    expect(reconcilePermissionAcknowledgements([], report("unknown", "unverified"), true)).toEqual([]);
    const next: PermissionReport = [...report(), { permission: "issues", repositories: [{ repo: "sample/new", status: "missing", reason: "denied" }] }];
    const old = ["contents:sample/repo"];
    const unseen = next.map(entry => ({ ...entry, repositories: entry.repositories.filter(repo => !old.includes(permissionProblemKey(entry.permission, repo.repo))) }));
    expect(missingPermissionCount(unseen)).toBe(1);
    expect(reconcilePermissionAcknowledgements(old, next, true)).toEqual(["contents:sample/repo", "issues:sample/new"]);
  });
  it("clears resolved identities so a later actual denial attracts attention again", () => {
    for (const recovered of [report("granted", "private-access"), report("unknown", "public-access")]) {
      const resolved = reconcilePermissionAcknowledgements(["contents:sample/repo", "issues:sample/other"], recovered);
      expect(resolved).toEqual(["issues:sample/other"]);
      expect(reconcilePermissionAcknowledgements(resolved, report())).not.toContain("contents:sample/repo");
    }
  });
  it("rejects malformed storage, unknown permissions and credentials, and bounds history", () => {
    for (const value of [null, {}, "contents:sample/repo", Array(2001).fill("contents:sample/repo")]) expect(restorePermissionAcknowledgements(value)).toEqual([]);
    expect(restorePermissionAcknowledgements(["contents:SAMPLE/REPO", "contents:sample/repo", "admin:sample/repo", "contents:../repo", "contents:sample/..", "contents:sample/repo:token", "fixture_pat", 42])).toEqual(["contents:sample/repo"]);
    const full = Array.from({ length: 2000 }, (_, n) => `contents:sample/repo-${n}`);
    const next = reconcilePermissionAcknowledgements(full, report(), true);
    expect(next).toHaveLength(2000);
    expect(next.at(-1)).toBe("contents:sample/repo");
  });
});
