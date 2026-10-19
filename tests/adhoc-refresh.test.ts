import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, MIN_REMAINING_QUOTA, STALE_AFTER_MS, inCooldown, isStale, shouldAdhocRefresh } from "../src/lib/adhoc-refresh";

const base = { now: 10_000_000, lastSuccess: 10_000_000 - STALE_AFTER_MS, lastAttempt: undefined, inFlight: false, retryAfterMs: 0 };
describe("ad-hoc repository refresh policy", () => {
  it("treats the threshold as inclusive and unknown history as stale", () => {
    expect(isStale(base.now, base.now - STALE_AFTER_MS + 1)).toBe(false);
    expect(isStale(base.now, base.now - STALE_AFTER_MS)).toBe(true);
    expect(isStale(base.now, undefined)).toBe(true);
  });
  it("applies a cooldown after an attempt", () => {
    expect(inCooldown(base.now, base.now - COOLDOWN_MS + 1)).toBe(true);
    expect(inCooldown(base.now, base.now - COOLDOWN_MS)).toBe(false);
    expect(inCooldown(base.now, undefined)).toBe(false);
  });
  it("refreshes only stale, idle, unlimited repositories", () => {
    expect(shouldAdhocRefresh(base)).toBe(true);
    expect(shouldAdhocRefresh({ ...base, lastSuccess: base.now - 1000 })).toBe(false);
    expect(shouldAdhocRefresh({ ...base, inFlight: true })).toBe(false);
    expect(shouldAdhocRefresh({ ...base, lastAttempt: base.now - 1000 })).toBe(false);
    expect(shouldAdhocRefresh({ ...base, retryAfterMs: 5000 })).toBe(false);
    expect(shouldAdhocRefresh({ ...base, remainingQuota: MIN_REMAINING_QUOTA - 1 })).toBe(false);
    expect(shouldAdhocRefresh({ ...base, remainingQuota: MIN_REMAINING_QUOTA })).toBe(true);
    expect(shouldAdhocRefresh({ ...base, remainingQuota: null })).toBe(true);
  });
});
