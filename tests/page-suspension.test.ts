import { describe, expect, it } from "vitest";
import { createPageSuspension, isTransientNetworkError, STALL_MS } from "../src/lib/page-suspension";
import { cacheFailureReason } from "../src/lib/cache-failure";
import { ContentCacheError } from "../src/lib/content-codec";
import { GitHubApiError } from "../src/lib/github";

function setup() {
  let time = 1000, hidden = false, offline = false;
  const windowEvents = new EventTarget(), documentEvents = new EventTarget();
  const tracker = createPageSuspension({ now: () => time, hidden: () => hidden, offline: () => offline, windowEvents, documentEvents, heartbeat: false });
  return { tracker, windowEvents, documentEvents, at(value: number) { time = value; }, hide(value: boolean) { hidden = value; }, disconnect(value: boolean) { offline = value; } };
}

describe("page suspension (#434)", () => {
  it("treats requests spanning hidden, frozen, offline or stalled windows as interrupted", () => {
    const page = setup();
    expect(page.tracker.interruptedSince(1000)).toBe(false); // Foreground and online throughout.
    page.hide(true);
    expect(page.tracker.interruptedSince(1000)).toBe(true);
    page.hide(false); page.at(2000);
    page.documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(page.tracker.interruptedSince(1500)).toBe(true); // Started before the page returned.
    page.at(3000);
    expect(page.tracker.interruptedSince(2500)).toBe(false); // Started after it returned.
    let start = 4000;
    for (const [target, type] of [[page.documentEvents, "freeze"], [page.documentEvents, "resume"], [page.windowEvents, "pagehide"], [page.windowEvents, "offline"]] as const) {
      start += 100;
      page.at(start);
      expect(page.tracker.interruptedSince(start)).toBe(false);
      page.at(start + 10);
      target.dispatchEvent(new Event(type));
      expect(page.tracker.interruptedSince(start)).toBe(true);
    }
    page.at(5000);
    page.windowEvents.dispatchEvent(new Event("pageshow")); // An ordinary load is no interruption.
    expect(page.tracker.interruptedSince(4900)).toBe(false);
    page.windowEvents.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(page.tracker.interruptedSince(4900)).toBe(true);
    page.disconnect(true);
    page.at(10_000);
    expect(page.tracker.interruptedSince(9_999)).toBe(true);
    page.disconnect(false);
    page.at(10_500);
    expect(page.tracker.interruptedSince(10_400)).toBe(false);
    page.at(10_500 + STALL_MS + 1); // The event loop did not run: a sleeping device.
    expect(page.tracker.interruptedSince(10_400)).toBe(true);
    page.tracker.stop();
  });
  it("classifies only response-less failures as transient", () => {
    expect(isTransientNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isTransientNetworkError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("Request took too long."), { name: "TimeoutError" }))).toBe(true);
    for (const status of [401, 403, 404, 429]) expect(isTransientNetworkError(new GitHubApiError("denied", status, status === 403, status === 429))).toBe(false);
    expect(isTransientNetworkError(new Error("Something else"))).toBe(false);
    expect(isTransientNetworkError("Load failed")).toBe(false);
  });
});

describe("cache failure advice (#434)", () => {
  const streamFailure = new ContentCacheError("compression", { cause: new TypeError("stream failed") });
  it("gives no warning for an aborted stream or a failure while the page was interrupted", () => {
    expect(cacheFailureReason(new ContentCacheError("interrupted"))).toBeNull();
    expect(cacheFailureReason(streamFailure, true)).toBeNull();
    expect(cacheFailureReason(new ContentCacheError("storage", { cause: new DOMException("x", "UnknownError") }), true)).toBeNull();
  });
  it("keeps update advice for a missing CompressionStream or a foreground failure, and genuine limits always", () => {
    const advice = "Webbläsaren kunde inte komprimera översikten. Uppdatera webbläsaren och försök igen.";
    expect(cacheFailureReason(new ContentCacheError("compression"), true)).toBe(advice);
    expect(cacheFailureReason(streamFailure)).toBe(advice);
    expect(cacheFailureReason(new ContentCacheError("size"), true)).toMatch(/ryms inte/);
    expect(cacheFailureReason(new ContentCacheError("storage", { cause: new DOMException("full", "QuotaExceededError") }), true)).toMatch(/lagringsutrymme/);
    expect(cacheFailureReason(new ContentCacheError("storage"))).toMatch(/säkra lagringen/);
  });
});
