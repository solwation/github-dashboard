import { describe, expect, it } from "vitest";
import { emptyEventHistory, EVENT_HISTORY_LIMIT, reconcileEventHistory, restoreEventHistory, seeEvents, appendEvents, unseenSeverity, type EventSignal } from "../src/lib/event-history";
const failure: EventSignal = { source: "repository:sample/alpha", repository: "sample/alpha", severity: "error", message: "Temporary failure", recovery: "Sync recovered" };
describe("diagnostic event history", () => {
  it("deduplicates failed polls even after restore; records one recovery and a later failure", () => {
    let state = reconcileEventHistory(emptyEventHistory(), [failure], 1);
    state = reconcileEventHistory(restoreEventHistory(JSON.parse(JSON.stringify(state))), [failure], 2);
    expect(state.entries).toHaveLength(1);
    state = reconcileEventHistory(state, [], 3, new Set([failure.source]));
    expect(state.entries.map(item => [item.severity, item.message])).toEqual([["error", "Temporary failure"], ["info", "Sync recovered"]]);
    state = reconcileEventHistory(state, [], 4);
    expect(state.entries).toHaveLength(2);
    state = reconcileEventHistory(state, [failure], 5);
    expect(state.entries).toHaveLength(3);
    expect(reconcileEventHistory(state, [], 6, new Set()).entries).toHaveLength(3); // Deselection is not a recovery.
  });
  it("keeps fingerprints for all active sources independently of the retained timeline", () => {
    const signals = Array.from({ length: 110 }, (_, i) => ({ ...failure, source: `repository:sample/${i}` }));
    let state = reconcileEventHistory(emptyEventHistory(), signals, 1);
    state = seeEvents(state, state.entries.map(item => item.id));
    const ids = state.entries.map(item => item.id);
    state = reconcileEventHistory(restoreEventHistory(JSON.parse(JSON.stringify(state))), signals, 2);
    expect(state.entries.map(item => item.id)).toEqual(ids);
    expect(state.entries.every(item => item.seen)).toBe(true);
  });
  it("only acknowledges a displayed snapshot; bounds the history and validates saved content", () => {
    let state = reconcileEventHistory(emptyEventHistory(), [failure], 1);
    const displayed = state.entries.map(item => item.id);
    for (let i = 0; i < 110; i++) state = reconcileEventHistory(state, [{ ...failure, message: `Failure ${i}` }], i + 2);
    state = seeEvents(state, displayed);
    expect(state.entries).toHaveLength(EVENT_HISTORY_LIMIT);
    expect(state.entries.every(item => !item.seen)).toBe(true);
    expect(restoreEventHistory({ entries: [{ severity: "error" }], active: [null] })).toEqual(emptyEventHistory());
    expect(seeEvents(state, [state.entries[0]!.id]).entries.filter(item => item.seen)).toHaveLength(1);
    expect(emptyEventHistory().entries).toEqual([]); // A fresh account has no shared mutable state.
  });
});

it("records foreground info as seen, preserving background info and severity precedence", () => {
  const info: EventSignal = { source: "movement", severity: "info", message: "Moved" };
  let state = appendEvents(emptyEventHistory(), [info], 1, true);
  expect(state.entries).toHaveLength(1); expect(state.entries[0]!.seen).toBe(true); expect(unseenSeverity(state.entries)).toBeNull();
  state = appendEvents(state, [info], 2, false);
  expect(unseenSeverity(state.entries)).toBe("info");
  state = appendEvents(state, [{ ...info, severity: "warning" }], 3, true);
  expect(unseenSeverity(state.entries)).toBe("warning");
  state = appendEvents(state, [failure], 4, true);
  expect(unseenSeverity(state.entries)).toBe("error");
  state = seeEvents(state, [state.entries.at(-1)!.id]); expect(unseenSeverity(state.entries)).toBe("warning");
  expect(state.entries[1]!.seen).toBe(false); // Returning to foreground never clears earlier background info.
  state = reconcileEventHistory(reconcileEventHistory(emptyEventHistory(), [failure], 5), [], 6, undefined, true);
  expect(state.entries.at(-1)!.seen).toBe(true); // Foreground recovery is information too.
});
