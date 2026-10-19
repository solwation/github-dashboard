import { describe, expect, it } from "vitest";
import { coalesceDeltas, ValueDeltaTracker } from "../src/lib/value-delta";

const v = (a: number, b = 0) => ({ a, b });
describe("value delta tracker (#188)", () => {
  it("ignores the first snapshot and unchanged values", () => {
    const t = new ValueDeltaTracker<"a" | "b">();
    expect(t.update(v(3), "s", true)).toEqual({});
    expect(t.update(v(3), "s", true)).toEqual({});
  });
  it("reports increases and decreases per key", () => {
    const t = new ValueDeltaTracker<"a" | "b">();
    t.update(v(3, 5), "s", true);
    expect(t.update(v(4, 3), "s", true)).toEqual({ a: 1, b: -2 });
  });
  it("rebaselines silently on scope change, non-live data and rebaseline()", () => {
    const t = new ValueDeltaTracker<"a" | "b">();
    t.update(v(1), "s", true);
    expect(t.update(v(9), "other", true)).toEqual({});
    expect(t.update(v(10), "other", false)).toEqual({});
    expect(t.update(v(20), "other", true)).toEqual({});
    t.rebaseline(v(25));
    expect(t.update(v(26), "other", true)).toEqual({ a: 1 });
  });
  it("coalesces rapid changes and drops a net zero", () => {
    let d = coalesceDeltas<"a" | "b">({}, { a: 1 });
    d = coalesceDeltas(d, { a: 1, b: -1 });
    expect(d).toEqual({ a: 2, b: -1 });
    expect(coalesceDeltas(d, { b: 1 })).toEqual({ a: 2 });
  });
});
