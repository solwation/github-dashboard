import { describe, expect, it, vi } from "vitest";
import type { Issue, Lane } from "../src/lib/model";
import { BOARD_MOVE_ANIMATION, BOARD_MOVE_FEEDBACK, boardStatusColumns, createBoardMoves, detectStatusMoves } from "../src/lib/board-moves";
import { withPendingClosures } from "../src/lib/pending-closures";
import { matchesIssueFilters } from "../src/lib/issue-filter";
import { sortedIssues } from "../src/lib/model";

// #419: what counts as a status move. Synthetic data only.
const progress = { name: "in progress", color: "fbca04" };
const repoOf = (full_name: string, id = 1) => ({ id, name: full_name.split("/")[1]!, full_name, description: null, private: false, html_url: `https://github.com/${full_name}`, owner: { login: full_name.split("/")[0]! } });
function issue(number: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id: number, number, title: `Issue ${number}`, html_url: `https://github.com/sample/alpha/issues/${number}`, state: "open",
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-02T09:00:00Z", closed_at: null, labels: [], assignees: [], ...overrides,
  };
}
const working = (number: number) => issue(number, { labels: [progress] });
const closed = (number: number) => issue(number, { state: "closed", closed_at: "2026-11-02T09:30:00Z" });
const lane = (issues: Issue[], extra: Partial<Lane> = {}, name = "sample/alpha"): Lane => ({ repo: repoOf(name), labels: [], issues, ...extra });
const moves = (before: Lane[], after: Lane[]) => detectStatusMoves(boardStatusColumns(before), boardStatusColumns(after));
const id = (number: number, repository = "sample/alpha") => `issue-${encodeURIComponent(repository)}-${number}`;

describe("detectStatusMoves", () => {
  it("finds backlog → progress → closed, a jump straight to Closed and a reopening", () => {
    expect(moves([lane([issue(1)])], [lane([working(1)])])).toEqual([{ id: id(1), from: "backlog", to: "progress" }]);
    expect(moves([lane([working(1)])], [lane([closed(1)])])).toEqual([{ id: id(1), from: "progress", to: "closed" }]);
    expect(moves([lane([issue(1)])], [lane([closed(1)])])).toEqual([{ id: id(1), from: "backlog", to: "closed" }]);
    expect(moves([lane([closed(1)])], [lane([issue(1)])])).toEqual([{ id: id(1), from: "closed", to: "backlog" }]);
  });

  it("reports several simultaneous moves and keeps repositories apart", () => {
    const before = [lane([issue(1), working(2), issue(3)]), lane([issue(1)], {}, "sample/beta")];
    const after = [lane([working(1), closed(2), issue(3)]), lane([issue(1)], {}, "sample/beta")];
    expect(moves(before, after)).toEqual([
      { id: id(1), from: "backlog", to: "progress" },
      { id: id(2), from: "progress", to: "closed" },
    ]);
  });

  it("treats a pending closure as a move to Closed and its return as a move back", () => {
    const shown = [lane([working(1)])];
    const entry = { repository: "sample/alpha", issue: working(1), detectedAt: Date.parse("2026-11-02T09:59:00Z"), deadline: 0 };
    const pending = withPendingClosures([lane([])], [entry as never]);
    expect(moves(shown, pending)).toEqual([{ id: id(1), from: "progress", to: "closed" }]);
    expect(moves(pending, [lane([issue(1)])])).toEqual([{ id: id(1), from: "closed", to: "backlog" }]);
  });

  it("does not count the first load or a cache restore", () => {
    expect(moves([lane([], { loading: true })], [lane([working(1)])])).toEqual([]);
    expect(moves([], [lane([working(1), closed(2)])])).toEqual([]);
  });

  it("does not count filters, sorting, limits, Cards/List or new and removed issues", () => {
    const issues = [issue(1, { title: "Alpha" }), working(2), closed(3), issue(4, { title: "Beta" })];
    const board = [lane(issues)];
    // Filters and limits remove issues from what is shown; sorting reorders; Cards/List render the same lanes.
    const filtered = [lane(issues.filter(item => matchesIssueFilters(item, "Alpha", "")))];
    const sorted = [lane(sortedIssues(issues, "backlog", {}, "newest").concat(issues.filter(item => item.state === "closed" || item.labels.length)))];
    const limited = [lane(issues.slice(0, 2))];
    for (const view of [filtered, sorted, limited]) {
      expect(moves(board, view)).toEqual([]);
      expect(moves(view, board)).toEqual([]);
    }
    expect(moves(board, [lane([...issues, issue(5)])])).toEqual([]);
  });

  it("ignores pull requests and uses per-repository work-label rules", () => {
    expect(moves([lane([issue(1, { pull_request: {} })])], [lane([closed(1)])])).toEqual([]);
    const custom = [lane([issue(1, { labels: [{ name: "doing", color: "000" }] })])];
    expect(detectStatusMoves(boardStatusColumns([lane([issue(1)])], { "sample/alpha": { progress: "doing" } }), boardStatusColumns(custom, { "sample/alpha": { progress: "doing" } })))
      .toEqual([{ id: id(1), from: "backlog", to: "progress" }]);
  });
});

describe("createBoardMoves", () => {
  function fakeDocument(reduced = false) {
    const rects = new Map<string, { left: number; top: number }>();
    const animate = vi.fn(() => ({ id: "", cancel() {} }));
    const element = (key: string) => ({
      getBoundingClientRect: () => ({ ...rects.get(key)!, width: 100, height: 40, right: rects.get(key)!.left + 100, bottom: rects.get(key)!.top + 40 }),
      getAnimations: () => [], animate, contains: () => false, querySelectorAll: () => [], querySelector: () => null,
    });
    const doc = {
      activeElement: null, body: {},
      defaultView: { innerWidth: 1600, innerHeight: 1000, matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({ getPropertyValue: () => "#2875ba" }) },
      getElementById: vi.fn((key: string) => rects.has(key) ? element(key) : null),
    };
    return { doc: doc as unknown as Document, rects, animate, getElementById: doc.getElementById };
  }
  const run = () => { const queue: (() => void)[] = []; return { nextTick: (fn: () => void) => queue.push(fn), flush: () => { while (queue.length) queue.shift()!(); } }; };

  it("animates only after a sync armed it, from the old place to the new one", () => {
    const fake = fakeDocument(), ticks = run();
    const motion = createBoardMoves({ rules: () => ({}), nextTick: ticks.nextTick, doc: fake.doc });
    const before = [lane([issue(1)])], after = [lane([working(1)])];
    // Without arm() (filter, restore, mode switch) nothing is read or animated.
    motion.update(before, after);
    ticks.flush();
    expect(fake.getElementById).not.toHaveBeenCalled();

    fake.rects.set(id(1), { left: 10, top: 300 });
    motion.arm();
    motion.update(before, after);
    fake.rects.set(id(1), { left: 600, top: 100 });
    ticks.flush();
    expect(fake.animate).toHaveBeenCalledTimes(1);
    const [frames] = fake.animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(frames[0]!.transform).toBe("translate(-590px, 200px)");
    expect(fake.animate.mock.results[0]!.value.id).toBe(BOARD_MOVE_ANIMATION);
  });

  it("pulses instead of flying when one end is off-screen, and does nothing with reduced motion", () => {
    const fake = fakeDocument(), ticks = run();
    const motion = createBoardMoves({ rules: () => ({}), nextTick: ticks.nextTick, doc: fake.doc });
    fake.rects.set(id(1), { left: 10, top: 300 });
    motion.arm();
    motion.update([lane([issue(1)])], [lane([closed(1)])]);
    fake.rects.set(id(1), { left: 10, top: 2400 });
    ticks.flush();
    expect(fake.animate.mock.results[0]!.value.id).toBe(BOARD_MOVE_FEEDBACK);

    const still = fakeDocument(true), stillTicks = run();
    const reduced = createBoardMoves({ rules: () => ({}), nextTick: stillTicks.nextTick, doc: still.doc });
    still.rects.set(id(1), { left: 10, top: 300 });
    reduced.arm();
    reduced.update([lane([issue(1)])], [lane([working(1)])]);
    still.rects.set(id(1), { left: 600, top: 300 });
    stillTicks.flush();
    expect(still.animate).not.toHaveBeenCalled();
  });

  it("drops a stale arm that no board change consumed", () => {
    const fake = fakeDocument(), ticks = run();
    const motion = createBoardMoves({ rules: () => ({}), nextTick: ticks.nextTick, doc: fake.doc });
    motion.arm();
    ticks.flush();
    fake.rects.set(id(1), { left: 10, top: 300 });
    motion.update([lane([issue(1)])], [lane([working(1)])]);
    ticks.flush();
    expect(fake.getElementById).not.toHaveBeenCalled();
  });
});
