import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusSoundPlayer, StatusTransitionTracker } from "../src/lib/status-sounds";
import type { Issue, Lane } from "../src/lib/model";
const issue = (id: number, labels: string[] = [], state = "open"): Issue => ({
  id, number: id, title: "Task", labels: labels.map(name => ({ name, color: "000000" })), state,
  closed_at: state === "closed" ? "2026-10-16T12:00:00Z" : null,
  created_at: "2026-10-15", updated_at: "2026-10-16", html_url: "https://github.com/a/b/issues/1", assignees: [],
});
const lane = (issues: Issue[], repo = "a/b", error?: string): Lane => ({
  repo: { id: 1, name: "b", full_name: repo, description: null, private: false, html_url: "https://github.com/a/b", owner: { login: "a" } }, issues, labels: [], error,
});
const enabled = () => true;

describe("status transitions", () => {
  it("establishes silent baselines, emits all three signals and does not repeat them", () => {
    const tracker = new StatusTransitionTracker();
    expect(tracker.update([lane([issue(1), issue(2), issue(3, ["in-progress"])])], {}, enabled)).toEqual([]);
    const next = [lane([issue(1, ["in-progress"]), issue(2, [], "closed"), issue(3)])];
    expect(tracker.update(next, {}, enabled)).toEqual(["progress", "closed", "negative"]);
    expect(tracker.update(next, {}, enabled)).toEqual([]);
  });
  it("detects blocked without a column change and gives negative precedence per issue", () => {
    const tracker = new StatusTransitionTracker();
    tracker.update([lane([issue(1), issue(2, ["in-progress"])])], {}, enabled);
    expect(tracker.update([lane([issue(1, ["status: blocked"]), issue(2, ["blocked"])])], {}, enabled)).toEqual(["negative"]);
    expect(tracker.update([lane([issue(1), issue(2)])], {}, enabled)).toEqual([]);
  });
  it("uses repository rules and ignores settings edits, disabled repositories and hidden coordination", () => {
    const tracker = new StatusTransitionTracker();
    const start = [lane([issue(1), issue(2, ["orkester"])]), lane([issue(1)], "a/c")];
    tracker.update(start, {}, enabled);
    const next = [lane([issue(1, ["doing-custom"]), issue(2, ["orkester", "in-progress"])]), lane([issue(1, ["in-progress"])], "a/c")];
    expect(tracker.update(next, { "a/b": { progress: "doing-custom" } }, repo => repo === "a/b", true)).toEqual([]);
    const done = [lane([issue(1, [], "closed"), issue(2, ["orkester"], "closed")]), lane([issue(1, [], "closed")], "a/c")];
    expect(tracker.update(done, { "a/b": { progress: "doing-custom" } }, repo => repo === "a/b", true)).toEqual(["closed"]);
    // Enabling after a disabled sync must not replay its transitions.
    expect(tracker.update(done, { "a/b": { progress: "doing-custom" } }, enabled, true)).toEqual([]);
  });
  it("keeps successful baselines over API errors and clears them on deselect/logout", () => {
    const tracker = new StatusTransitionTracker();
    tracker.update([lane([issue(1)])], {}, enabled);
    expect(tracker.update([lane([], "a/b", "error")], {}, enabled)).toEqual([]);
    expect(tracker.update([lane([issue(1, ["in-progress"]), issue(2, [], "closed")])], {}, enabled)).toEqual(["progress"]);
    tracker.retain([]);
    expect(tracker.update([lane([issue(1, [], "closed")])], {}, enabled)).toEqual([]);
    tracker.clear();
    expect(tracker.update([lane([issue(1)])], {}, enabled)).toEqual([]);
  });
});

function audio() {
  const starts: number[] = [], frequencies: number[] = [], stops: ReturnType<typeof vi.fn>[] = [];
  const disconnect = vi.fn();
  const context = {
    state: "suspended", currentTime: 0, destination: {},
    resume: vi.fn(async () => { context.state = "running"; }),
    createOscillator: () => {
      const frequency = { value: 0 };
      const stop = vi.fn(); stops.push(stop);
      return { frequency, connect: vi.fn(), disconnect, onended: null, start: (at: number) => { starts.push(at); frequencies.push(frequency.value); }, stop, type: "" };
    },
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect }),
  };
  return { context, starts, frequencies, stops, create: () => context as unknown as AudioContext };
}
afterEach(() => vi.useRealTimers());
describe("status audio", () => {
  it("clearing stops active and scheduled notes, cancels pending audio and allows fresh playback", async () => {
    vi.useFakeTimers();
    const a = audio();
    const player = new StatusSoundPlayer(undefined, a.create);
    await player.unlock();
    player.play(["closed"]);
    vi.advanceTimersByTime(120);
    player.play(["negative"]);
    player.clear();
    for (const stop of a.stops) expect(stop).toHaveBeenLastCalledWith();
    vi.advanceTimersByTime(1000);
    expect(a.frequencies).toEqual([523, 659, 784]);
    player.play(["progress"]);
    vi.advanceTimersByTime(120);
    expect(a.frequencies).toEqual([523, 659, 784, 440, 554]);
  });
  it("requires user activation and reports blocked or unsupported audio without throwing", async () => {
    const unavailable = vi.fn();
    const unsupported = new StatusSoundPlayer(unavailable, () => { throw new Error("unsupported"); });
    expect(await unsupported.unlock()).toBe(false);
    unsupported.play(["progress"]);
    expect(unavailable).toHaveBeenCalledOnce();
    const a = audio();
    const player = new StatusSoundPlayer(unavailable, a.create);
    expect(await player.unlock()).toBe(true);
    expect(a.context.resume).toHaveBeenCalledOnce();
  });
  it("coalesces a burst to one negative signal and cancels queued account sounds", async () => {
    vi.useFakeTimers();
    const a = audio();
    const player = new StatusSoundPlayer(undefined, a.create);
    await player.unlock();
    player.play(["progress", "closed"]);
    player.play(["negative", "negative"]);
    vi.advanceTimersByTime(120);
    expect(a.frequencies).toEqual([330, 247, 196]);
    player.play(["closed"]);
    player.clear();
    vi.advanceTimersByTime(1000);
    expect(a.frequencies).toHaveLength(3);
  });
  it("plays distinct start and completion melodies and waits until the previous sound ends", async () => {
    vi.useFakeTimers();
    const a = audio();
    const player = new StatusSoundPlayer(undefined, a.create);
    await player.unlock();
    player.play(["progress"]);
    vi.advanceTimersByTime(120);
    expect(a.frequencies).toEqual([440, 554]);
    player.play(["closed"]);
    vi.advanceTimersByTime(359);
    expect(a.frequencies).toHaveLength(2);
    a.context.currentTime = 0.36;
    vi.advanceTimersByTime(1);
    expect(a.frequencies).toEqual([440, 554, 523, 659, 784]);
    expect(a.starts[2]).toBeGreaterThan(a.starts[1]! + 0.11);
  });
});
