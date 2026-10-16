import { describe, expect, it, vi } from "vitest";
import { RepositoryRequestCancelled, RepositoryRequestQueue, selectedLanes } from "../src/lib/repository-selection";
import { demo } from "../src/lib/demo";
import { ActivityTracker } from "../src/lib/activity";
import { ClosureTracker } from "../src/lib/closures";
import { StatusTransitionTracker } from "../src/lib/status-sounds";
const lanes = demo();
const repositories = lanes.map(lane => lane.repo);
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
describe("immediate repository selection", () => {
  it("removes deselected lanes immediately and preserves retained objects with their data", () => {
    const result = selectedLanes(lanes, repositories, [repositories[2]!.full_name, repositories[0]!.full_name]);
    expect(result).toEqual([lanes[2], lanes[0]]);
    expect(result[0]).toBe(lanes[2]); expect(result[1]).toBe(lanes[0]);
    expect(selectedLanes(lanes, repositories, [])).toEqual([]);
  });
  it("adds an explicit loading placeholder without fabricating issue data", () => {
    const result = selectedLanes([lanes[0]!], repositories, repositories.map(repo => repo.full_name));
    expect(result[0]).toBe(lanes[0]);
    expect(result[1]).toEqual({ repo: repositories[1], issues: [], labels: [], loading: true });
    expect(result[2]!.loading).toBe(true);
    expect(selectedLanes(lanes, repositories, [repositories[0]!.full_name, "unavailable/repo", repositories[0]!.full_name])).toHaveLength(1);
  });
  it("the first real snapshot remains a silent baseline when placeholders are excluded", () => {
    const activity = new ActivityTracker(), closure = new ClosureTracker(), status = new StatusTransitionTracker();
    const pending = selectedLanes([], repositories, [repositories[0]!.full_name]);
    for (const lane of pending.filter(lane => !lane.loading)) { activity.update([lane], {}); closure.update(lane); status.update([lane], {}, () => true); }
    expect(closure.update(lanes[0]!)).toEqual([]);
    expect(status.update([lanes[0]!], {}, () => true)).toEqual([]);
    activity.update([lanes[0]!], {});
    expect(lanes[0]!.issues.every(issue => !activity.moved(repositories[0]!.full_name, issue, Date.now()))).toBe(true);
  });
});
describe("repository request coordination", () => {
  it("reuses pending reads through selection changes, then allows a fresh read", async () => {
    const hold = gate(), request = vi.fn(async () => { await hold.promise; return "snapshot"; });
    const queue = new RepositoryRequestQueue();
    const first = queue.run("same", request), again = queue.run("same", request);
    expect(first).toBe(again); expect(request).toHaveBeenCalledTimes(1);
    hold.resolve(); expect(await first).toBe("snapshot");
    await queue.run("same", request); expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not let a slow repository prevent independent repositories from completing", async () => {
    const queue = new RepositoryRequestQueue(), hold = gate();
    const slow = queue.run("slow", async () => { await hold.promise; return "slow"; });
    expect(await queue.run("fast", async () => "fast")).toBe("fast");
    hold.resolve(); await slow;
  });
  it("caps concurrent reads across overlapping refreshes and handles failures without blocking the queue", async () => {
    let active = 0, maximum = 0;
    const queue = new RepositoryRequestQueue();
    const requests = Array.from({ length: 12 }, (_, index) => queue.run(String(index), async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (index === 3) throw new Error("offline");
      return index;
    }));
    const results = await Promise.allSettled(requests);
    expect(maximum).toBe(3); expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await queue.run("after", async () => "available")).toBe("available");
  });
  it("forgets old-session deduplication and cancels queued old-session reads", async () => {
    const queue = new RepositoryRequestQueue(1), hold = gate(), obsolete = vi.fn(async () => "old account");
    const active = queue.run("same", async () => { await hold.promise; return "old response"; });
    const cancelled = queue.run("queued", obsolete);
    const cancellation = expect(cancelled).rejects.toBeInstanceOf(RepositoryRequestCancelled);
    queue.clear();
    const current = queue.run("same", async () => "new account");
    hold.resolve(); await active; await cancellation;
    expect(await current).toBe("new account"); expect(obsolete).not.toHaveBeenCalled();
  });
});
