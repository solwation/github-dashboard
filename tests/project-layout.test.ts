import { describe, expect, it } from "vitest";
import { moveProject, reconcileOrder, restoreLayout } from "../src/lib/project-layout";

describe("project layout", () => {
  it("keeps saved positions and appends new repositories alphabetically regardless of API order", () => {
    const saved = ["team/zeta", "team/beta"];
    const available = ["team/gamma", "team/beta", "team/alpha", "team/zeta"];
    expect(reconcileOrder(saved, available)).toEqual(["team/zeta", "team/beta", "team/alpha", "team/gamma"]);
    expect(reconcileOrder(saved, [...available].reverse())).toEqual(reconcileOrder(saved, available));
    expect(saved).toEqual(["team/zeta", "team/beta"]);
  });
  it("discards inaccessible repos, duplicates and malformed stored values", () => {
    const available = ["team/a", "team/b"];
    expect(restoreLayout({ projectOrder: [null, "other/private", "team/b", "team/b", 12], collapsedRepos: ["other/private", "team/a", "team/a", false] }, available))
      .toEqual({ order: ["team/b", "team/a"], collapsed: ["team/a"] });
    expect(restoreLayout({ projectOrder: {}, collapsedRepos: "team/a" }, available)).toEqual({ order: available, collapsed: [] });
    expect(restoreLayout(null, available)).toEqual({ order: available, collapsed: [] });
  });
  it("moves in both directions without changing its input and ignores unknown drag sources", () => {
    const order = ["a", "b", "c", "d"];
    expect(moveProject(order, "a", "d")).toEqual(["b", "c", "d", "a"]);
    expect(moveProject(order, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveProject(order, "a", "missing")).toEqual(order);
    expect(moveProject(order, "missing", "a")).toEqual(order);
    expect(moveProject(order, "b", "b")).toEqual(order);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });
  it("retains an unselected project's position when other visible repositories move", () => {
    const saved = ["team/a", "team/unselected", "team/b", "team/c"];
    const moved = moveProject(saved, "team/c", "team/a");
    expect(reconcileOrder(moved, ["team/a", "team/b", "team/c"])).toEqual(["team/c", "team/a", "team/b"]);
    expect(reconcileOrder(moved, saved)).toEqual(["team/c", "team/a", "team/unselected", "team/b"]);
  });
});
