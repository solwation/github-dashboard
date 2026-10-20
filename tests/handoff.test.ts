import { parseHandoffPreferences } from "../src/lib/handoff-preferences";
import { describe, expect, it, vi } from "vitest";
import { consumeHandoff, createHandoffUrl, decodeHandoff, encodeHandoff, handoffQrSegments, parseHandoffUrl, mergeHandoffPreferences, type HandoffPreferences, HANDOFF_LIFETIME_MS, HandoffError } from "../src/lib/handoff";
import { setLanguage, t } from "../src/lib/i18n";
import { decodeCompactHandoff, encodeCompactHandoff } from "../src/lib/handoff-codec";
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
    expect(decodeHandoff(parsed.hash.split("=")[1]!, now)).toEqual({ ...settings, preferences: {}, version: 2, issuedAt: now });
  });
  it("rejects expired, future, unsupported, malformed, and oversized payloads", () => {
    const encoded = encodeHandoff(settings, now);
    const reason = (run: () => unknown) => {
      try { run(); } catch (e) { return e instanceof HandoffError ? e.reason : e; }
      return "accepted";
    };
    expect(reason(() => decodeHandoff(encoded, now + HANDOFF_LIFETIME_MS))).toBe("expired");
    expect(reason(() => decodeHandoff(raw({ ...settings, version: 1, issuedAt: now }), now + HANDOFF_LIFETIME_MS))).toBe("expired");
    expect(reason(() => decodeHandoff(encoded, now - 30_001))).toBe("invalid");
    for (const value of ["", "%%%", "a", "a".repeat(16_001), "1234", encoded.slice(0, -3), raw({ ...settings, version: 2, issuedAt: now }), raw({ ...settings, version: 1, issuedAt: now, extra: true }), raw({ ...settings, version: 1, issuedAt: now, selected: ["../private"] }), raw({ ...settings, version: 1, issuedAt: now, rules: { "sample/repo": { invalid: "label" } } })]) {
      expect(reason(() => decodeHandoff(value, now))).toBe("invalid");
    }
    // An old but malformed code is reported as invalid, not as merely expired.
    expect(reason(() => decodeHandoff(raw({ ...settings, version: 1, issuedAt: now, extra: true }), now + HANDOFF_LIFETIME_MS))).toBe("invalid");
    expect(reason(() => parseHandoffUrl("not a url", "https://example.test/app/", now))).toBe("invalid");
  });
  it("gives rejected links translated, distinguishable messages", () => {
    try {
      setLanguage("sv");
      expect(t(new HandoffError("expired").message)).toBe("Överföringslänken har gått ut. Den gäller i fem minuter – skapa en ny QR-kod på den andra enheten.");
      expect(t(new HandoffError("invalid").message)).toBe("Överföringslänken är ogiltig eller ofullständig. Skapa en ny QR-kod på den andra enheten.");
      setLanguage("en");
      expect(t(new HandoffError("expired").message)).toBe("The transfer link has expired. Links are valid for five minutes – create a new QR code on the other device.");
      expect(t(new HandoffError("invalid").message)).toBe("The transfer link is invalid or incomplete. Create a new QR code on the other device.");
    } finally {
      setLanguage("auto");
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

const preferences: Required<Omit<HandoffPreferences, "listRepos" | "combinedList" | "timeoutMinutes">> = {
  repositoryColors: { "sample/repo": "#8b43b5" },
  projectOrder: ["sample/second", "sample/repo"],
  collapsedRepos: ["sample/second"], columnLimit: 8,
  repositoryColumnLimits: { "sample/repo": 3 }, notificationRepos: ["sample/repo"], notificationSounds: false,
  language: "sv", query: "planned 🚀", repositoryQueries: { "sample/repo": "label:ready" },
  repoQuery: "sample", hideCoordination: false, splitByRepository: false, listMode: true, timeoutEnabled: false, timeoutOverrunPercent: 45, currentView: "statistics",
  statistics: { "sample/repo": { from: "2026-10-01", to: "2026-10-16", label: "ready", contributor: "sample", metric: "deletions", collapsed: true } },
};
describe("optical preference schema v2", () => {
  it("roundtrips every chosen preference without exporting device grants or issue snapshots", () => {
    const decoded = decodeHandoff(encodeHandoff({ ...settings, preferences }, now), now);
    expect(decoded).toEqual({ ...settings, preferences, version: 2, issuedAt: now });
    expect(Object.keys(decoded.preferences!).sort()).toEqual(Object.keys(preferences).sort());
    expect(decoded).not.toHaveProperty("activityRead");
    expect(decoded.preferences).not.toHaveProperty("timeoutAcknowledgements");
  });
  it("reads existing v1 codes and preserves recipient fields missing from old or partial codes", () => {
    const legacy = decodeHandoff(raw({ ...settings, version: 1, issuedAt: now }), now);
    const current = { selected: ["sample/second"], rules: {}, ...preferences };
    const merged = mergeHandoffPreferences(current, legacy, ["sample/repo", "sample/second"]);
    expect(merged.selected).toEqual(settings.selected);
    expect(merged.rules).toEqual(settings.rules);
    for (const [key, value] of Object.entries(preferences)) expect(merged[key as keyof typeof merged]).toEqual(value);
    const partial = decodeHandoff(raw({ ...settings, version: 2, issuedAt: now, preferences: { language: "en", futureSetting: { ignored: true } } }), now);
    expect(partial.preferences).toEqual({ language: "en" });
    expect(mergeHandoffPreferences(current, partial, ["sample/repo", "sample/second"]).columnLimit).toBe(8);
  });
  it("migrates #127 per-repository list choices to one global list mode without keeping legacy fields", () => {
    const selected = ["sample/a", "sample/b", "sample/c"];
    const merge = (preferences: HandoffPreferences, current: { listMode?: boolean; splitByRepository?: boolean } = {}) =>
      mergeHandoffPreferences({ selected, rules: {}, ...current }, { selected, rules: {}, preferences }, selected);
    // Split view: a strict majority of the selected repositories decides; ties and unselected names mean cards.
    expect(merge({ splitByRepository: true, listRepos: ["SAMPLE/A", "sample/b"], combinedList: false }).listMode).toBe(true);
    expect(merge({ splitByRepository: true, listRepos: ["sample/a", "other/x", "other/y"] }).listMode).toBe(false);
    expect(merge({ listRepos: [] }, { listMode: true }).listMode).toBe(false);
    // Combined board: its own choice wins, falling back to the majority when it was never saved.
    expect(merge({ splitByRepository: false, listRepos: [], combinedList: true }).listMode).toBe(true);
    expect(merge({ listRepos: selected, combinedList: false }, { splitByRepository: false }).listMode).toBe(false);
    expect(merge({ splitByRepository: false, listRepos: selected }).listMode).toBe(true);
    expect(merge({ splitByRepository: true, combinedList: true }).listMode).toBe(true);
    // An explicit global choice wins and nothing legacy survives; missing fields keep the receiver's choice.
    const migrated = merge({ listMode: false, listRepos: selected, combinedList: true });
    expect(migrated.listMode).toBe(false);
    expect(migrated).not.toHaveProperty("listRepos");
    expect(migrated).not.toHaveProperty("combinedList");
    expect(merge({ language: "en" }, { listMode: true }).listMode).toBe(true);
  });
  it("applies explicit palette maps and repairs collisions only inside the readable selected workspace", () => {
    const selected = ["Sample/A", "sample/b"];
    const merged = mergeHandoffPreferences({ selected, rules: {}, repositoryColors: { "Sample/A": "#c65d16" } }, {
      selected: ["SAMPLE/A", "sample/b", "private/hidden"], rules: {}, preferences: {
        repositoryColors: { "sample/a": "#8b43b5", "sample/b": "#8b43b5", "private/hidden": "#245bc1" },
      },
    }, selected);
    expect(merged.repositoryColors).toEqual({ "Sample/A": "#8b43b5", "sample/b": "#c65d16" });
  });
  it("filters every repository collection against actual current access and canonicalizes case", () => {
    const incoming = { ...settings, selected: ["SAMPLE/REPO", "sample/second"], rules: { "SAMPLE/REPO": { progress: "Working" }, "sample/second": { high: "urgent" } }, preferences };
    const before = structuredClone(incoming);
    const merged = mergeHandoffPreferences({ selected: [], rules: {} }, incoming, ["Sample/Repo"]);
    expect(merged.selected).toEqual(["Sample/Repo"]);
    expect(merged.projectOrder).toEqual(["Sample/Repo"]);
    expect(merged.collapsedRepos).toEqual([]);
    expect(merged.notificationRepos).toEqual(["Sample/Repo"]);
    expect(merged.rules).toEqual({ "Sample/Repo": { progress: "Working" } });
    expect(merged.repositoryColumnLimits).toEqual({ "Sample/Repo": 3 });
    expect(merged.repositoryColors).toEqual({ "Sample/Repo": "#8b43b5" });
    expect(merged.repositoryQueries).toEqual({ "Sample/Repo": "label:ready" });
    expect(Object.keys(merged.statistics!)).toEqual(["Sample/Repo"]);
    expect(incoming).toEqual(before);
  });
  it.each([
    { repositoryColors: { "sample/repo": "red" } },
    { repositoryColors: { "../private": "#245bc1" } },
    { repositoryColors: { "sample/repo": "#245bc1", "SAMPLE/REPO": "#c65d16" } },
    { repositoryColors: Object.fromEntries(Array.from({ length: 101 }, (_, n) => ["sample/repo" + n, "#245bc1"])) },
    { columnLimit: 0 }, { columnLimit: 101 }, { columnLimit: "6" },
    { timeoutOverrunPercent: -1 }, { timeoutOverrunPercent: 1001 }, { timeoutEnabled: "yes" }, { timeoutMinutes: 0 }, { timeoutMinutes: 10081 }, { timeoutMinutes: 1.5 },
    { language: "fr" }, { currentView: "admin" }, { hideCoordination: "false" }, { splitByRepository: "false" }, { listMode: "true" }, { combinedList: "true" }, { listRepos: ["../private"] },
    { projectOrder: ["sample/repo", "SAMPLE/REPO"] }, { collapsedRepos: ["../private"] },
    { notificationRepos: Array.from({ length: 101 }, (_, n) => "sample/repo" + n) }, { notificationSounds: "false" },
    { repositoryColumnLimits: { "sample/repo": 2.5 } }, { repositoryQueries: { "sample/repo": "a".repeat(501) } },
    { query: "a".repeat(501) }, { statistics: { "sample/repo": { from: "2026-02-30", to: "2026-03-01", label: "", contributor: "", metric: "closed" } } },
    { statistics: { "sample/repo": { from: "2026-10-16", to: "2026-10-01", label: "", contributor: "", metric: "closed" } } },
  ])("rejects malformed known preferences atomically: %j", invalid => {
    expect(() => decodeHandoff(raw({ ...settings, version: 2, issuedAt: now, preferences: { ...preferences, ...invalid } }), now)).toThrow();
  });
  it("does not silently truncate oversized preference collections", () => {
    const rules = Object.fromEntries(Array.from({ length: 100 }, (_, n) => ["sample/repo" + n, { progress: n + "a".repeat(96), high: n + "b".repeat(96) }]));
    expect(() => encodeHandoff({ ...settings, rules, preferences }, now)).toThrow("too large");
  });
});

describe("compact optical format", () => {
  const profile = {
    token: "github_pat_11FICTIONAL0" + "x".repeat(70),
    selected: ["sample/repo", "sample/second", "other-owner/tools"],
    rules: { "sample/repo": settings.rules["sample/repo"], "sample/second": { progress: "in-progress", high: "priority: high" } },
    preferences: { ...preferences, projectOrder: ["sample/second", "sample/repo", "other-owner/tools"] },
  };

  it("writes digits only and decodes to the identical validated payload", () => {
    const encoded = encodeHandoff(profile, now);
    expect(encoded).toMatch(/^\d+$/);
    expect(decodeHandoff(encoded, now)).toEqual({ ...profile, version: 2, issuedAt: now });
  });

  it("is much smaller than the base64 JSON it replaces", () => {
    const legacy = raw({ ...profile, version: 2, issuedAt: now });
    // QR byte mode costs 8 bits per character, numeric mode 10 bits per 3 digits.
    expect(encodeHandoff(profile, now).length * 10 / 3).toBeLessThan(legacy.length * 8 * 0.45);
  });

  it("roundtrips arbitrary JSON values, including keys added by newer senders", () => {
    const value = { a: [0, 1.5, -2, 2 ** 40, null, true, false], "": "", text: "räksmörgås 🚀", date: "2026-02-28", notDate: "2026-02-30",
      color: "#245bc1", upper: "#245BC1", packed: "AbC_def-123", repo: "Owner-1/name.with_dots", again: "Owner-1/name.with_dots", futureSetting: { nested: ["sv"] } };
    expect(decodeCompactHandoff(encodeCompactHandoff(value))).toEqual(value);
  });

  it("rejects malformed digits without partial decoding", () => {
    const encoded = encodeHandoff(profile, now);
    for (const value of [encoded.slice(0, -1), encoded + "0", encoded.replace(/^\d{15}/, "999999999999999"), "1", "000"]) {
      expect(() => decodeHandoff(value, now)).toThrow();
    }
    expect(() => decodeHandoff(encodeCompactHandoff({ ...profile, version: 2, issuedAt: now, extra: true }), now)).toThrow();
    expect(() => decodeHandoff(encodeCompactHandoff({ ...profile, version: 2, issuedAt: now + HANDOFF_LIFETIME_MS }), now + 2 * HANDOFF_LIFETIME_MS)).toThrow();
  });

  it("splits the link into a byte segment for the address and a numeric segment for the payload", () => {
    const { url } = createHandoffUrl("https://example.test/app/", profile, now);
    const [address, payload] = handoffQrSegments(url);
    expect(address.mode).toBe("byte");
    expect(new TextDecoder().decode(address.data)).toBe("https://example.test/app/#issueflow-handoff=");
    expect(payload.mode).toBe("numeric");
    expect(new TextDecoder().decode(address.data) + payload.data).toBe(url);
  });
});

describe("compact format limits", () => {
  it("rejects repeated-structure expansion bombs", () => {
    let value: unknown = "x".repeat(1000);
    for (let level = 0; level < 4; level++) value = Array.from({ length: 8 }, () => value);
    expect(() => decodeCompactHandoff(encodeCompactHandoff(value))).toThrow();
  });
});

it('migrates legacy minute preferences instead of treating minutes as a percentage', () => {
  expect(parseHandoffPreferences({ timeoutMinutes: 180 })).toEqual({ timeoutEnabled: true, timeoutOverrunPercent: 25 });
});
