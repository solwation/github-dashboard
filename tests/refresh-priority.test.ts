import { describe, expect, it } from "vitest";
import { refreshTargetPriority, sortRefreshTargets } from "../src/lib/refresh-priority";

describe("refresh priority strategy", () => {
  it("assigns priority based on loading, visibility, collapse, and active status", () => {
    expect(refreshTargetPriority({ fullName: "a", isLoading: true })).toBe(0);
    expect(refreshTargetPriority({ fullName: "b", isHidden: false, isCollapsed: false, hasActive: true })).toBe(1);
    expect(refreshTargetPriority({ fullName: "c", isHidden: false, isCollapsed: false, hasActive: false })).toBe(2);
    expect(refreshTargetPriority({ fullName: "d", isHidden: false, isCollapsed: true, hasActive: true })).toBe(3);
    expect(refreshTargetPriority({ fullName: "e", isHidden: true, isCollapsed: false, hasActive: true })).toBe(4);
  });

  it("sorts targets by priority and respects visual position within the same priority", () => {
    const repos = [
      { full_name: "hidden/repo" },
      { full_name: "collapsed/repo" },
      { full_name: "visible/idle-2" },
      { full_name: "visible/active-2" },
      { full_name: "visible/active-1" },
      { full_name: "visible/idle-1" },
      { full_name: "loading/repo" },
    ];

    const visualOrder = [
      "visible/active-1",
      "visible/idle-1",
      "visible/active-2",
      "visible/idle-2",
      "collapsed/repo",
      "hidden/repo",
      "loading/repo",
    ];

    const sorted = sortRefreshTargets(repos, {
      visualOrder,
      getState: (r) => ({
        fullName: r.full_name,
        isLoading: r.full_name === "loading/repo",
        isHidden: r.full_name === "hidden/repo",
        isCollapsed: r.full_name === "collapsed/repo",
        hasActive: r.full_name.includes("active"),
      }),
    });

    expect(sorted.map((r) => r.full_name)).toEqual([
      "loading/repo",      // priority 0
      "visible/active-1",  // priority 1, pos 0
      "visible/active-2",  // priority 1, pos 2
      "visible/idle-1",    // priority 2, pos 1
      "visible/idle-2",    // priority 2, pos 3
      "collapsed/repo",    // priority 3, pos 4
      "hidden/repo",       // priority 4, pos 5
    ]);
  });
});
