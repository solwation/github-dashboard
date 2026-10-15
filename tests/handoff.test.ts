import { describe, expect, it, vi } from "vitest";
import { consumeHandoff, createHandoffUrl, decodeHandoff, encodeHandoff, parseHandoffUrl, HANDOFF_LIFETIME_MS } from "../src/lib/handoff";
const now = 1_800_000_000_000;
const settings = { token: "test_not_a_real_token", selected: ["sample/repo"], rules: { "sample/repo": { progress: "pågår 🚀", high: "prioritet:hög" } } };
function raw(value: unknown) {
  return btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
describe("mobile handoff", () => {
  it("accepts scanned links only for this app and validates expiry without navigating", () => {
    const { url } = createHandoffUrl("https://example.test/app/", settings, now);
    expect(parseHandoffUrl(url, "https://example.test/app/", now).token).toBe(settings.token);
    for (const link of [url.replace("example.test", "attacker.test"), url.replace("/app/", "/other/"), url.replace("#", "?credential=unsafe#"), "javascript:alert(1)", "not a url"]) {
      expect(() => parseHandoffUrl(link, "https://example.test/app/", now)).toThrow();
    }
    expect(() => parseHandoffUrl(url, "https://example.test/app/", now + HANDOFF_LIFETIME_MS)).toThrow();
  });
  it("roundtrips UTF-8 labels and keeps credentials out of path/query", () => {
    const { url, expiresAt } = createHandoffUrl("https://example.test/app/?old=1#repo", settings, now);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/app/");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toMatch(/^#issueflow-handoff=/);
    expect(expiresAt).toBe(now + HANDOFF_LIFETIME_MS);
    expect(decodeHandoff(parsed.hash.split("=")[1]!, now)).toEqual({ ...settings, version: 1, issuedAt: now });
  });
  it("rejects expired, future, unsupported, malformed, and oversized payloads", () => {
    const encoded = encodeHandoff(settings, now);
    expect(() => decodeHandoff(encoded, now + HANDOFF_LIFETIME_MS)).toThrow();
    expect(() => decodeHandoff(encoded, now - 30_001)).toThrow();
    for (const value of ["", "%%%", "a", "a".repeat(16_001), raw({ ...settings, version: 2, issuedAt: now }), raw({ ...settings, version: 1, issuedAt: now, extra: true }), raw({ ...settings, version: 1, issuedAt: now, selected: ["../private"] }), raw({ ...settings, version: 1, issuedAt: now, rules: { "sample/repo": { invalid: "label" } } })]) {
      expect(() => decodeHandoff(value, now)).toThrow();
    }
  });
  it("removes recognized credentials before decoding even when invalid, preserving history state", () => {
    const replaceState = vi.fn();
    const history = { state: { navigation: 1 }, replaceState };
    expect(() => consumeHandoff({ hash: "#issueflow-handoff=bad", pathname: "/app/", search: "?view=1" }, history, now)).toThrow();
    expect(replaceState).toHaveBeenCalledWith(history.state, "", "/app/?view=1");
    replaceState.mockClear();
    expect(consumeHandoff({ hash: "#sample/repo", pathname: "/app/", search: "" }, history, now)).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
  it("consumes a valid fragment after scrubbing it", () => {
    let scrubbed = false;
    const payload = consumeHandoff({ hash: "#issueflow-handoff=" + encodeHandoff(settings, now), pathname: "/app/", search: "" }, { state: null, replaceState() { scrubbed = true; } }, now);
    expect(scrubbed).toBe(true);
    expect(payload?.token).toBe(settings.token);
  });
});
