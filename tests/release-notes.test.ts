import { afterEach, describe, expect, it, vi } from "vitest";
import source from "../src/release-notes.json";
import deltaSource from "../src/update-summary.json";
import {
  bundledReleaseNotes,
  bundledUpdateSummary,
  calendarDate,
  fetchPublishedReleaseNotes,
  notesSince,
  parsePublishedReleaseNotes,
  parsePublicationDelta,
  parseReleaseNotes,
  updateSummary,
  type ReleaseNoteDay,
} from "../src/lib/release-notes";

const day = (date: string, sv = `Sv ${date}.`, en = `En ${date}.`): ReleaseNoteDay => ({
  date,
  summary: { sv, en },
  sections: [{ text: { sv: "Text", en: "Text" }, issues: [1] }],
});
const days = [day("2026-10-17"), day("2026-10-16"), day("2026-10-15")];
const published = { build: { builtAt: "2026-10-17T08:00:00.000Z", commit: "a".repeat(40) }, days };

afterEach(() => vi.unstubAllGlobals());

describe("bundled release notes", () => {
  it("are valid, bilingual, newest first and traceable to issues", () => {
    expect(parseReleaseNotes(source)).toEqual(bundledReleaseNotes);
    expect(bundledReleaseNotes.length).toBeGreaterThan(0);
    const dates = bundledReleaseNotes.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
    const issues = bundledReleaseNotes.flatMap((entry) => entry.sections.flatMap((item) => item.issues));
    expect(new Set(issues).size).toBe(issues.length);
  });
  it("prepares a concise publication delta with issue references present in the full notes", () => {
    expect(parsePublicationDelta(deltaSource)).toEqual(bundledUpdateSummary);
    expect(bundledUpdateSummary).not.toBeNull();
    const known = new Set(bundledReleaseNotes.flatMap(day => day.sections.flatMap(section => section.issues)));
    expect(bundledUpdateSummary!.issues.every(issue => known.has(issue))).toBe(true);
  });
  it("contain no credentials or private-looking URLs", () => {
    const text = JSON.stringify(source);
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|Bearer |https?:\/\//i);
  });
});

describe("parseReleaseNotes", () => {
  it("accepts valid days, ignores unknown fields and returns copies", () => {
    const input = [{ ...day("2026-10-16"), extra: true }];
    const parsed = parseReleaseNotes(input);
    expect(parsed).toEqual([day("2026-10-16")]);
    expect(parsed?.[0].sections[0].issues).not.toBe(input[0].sections[0].issues);
  });
  it.each([
    ["not an array", {}],
    ["invalid date", [day("2026-02-30")]],
    ["loose date", [{ ...day("2026-10-16"), date: "2026-10-16T00:00" }]],
    ["missing English", [{ ...day("2026-10-16"), summary: { sv: "Hej" } }]],
    ["blank text", [{ ...day("2026-10-16"), summary: { sv: " ", en: "Hi" } }]],
    ["no sections", [{ ...day("2026-10-16"), sections: [] }]],
    ["bad issue", [{ ...day("2026-10-16"), sections: [{ text: { sv: "a", en: "b" }, issues: [0] }] }]],
    ["duplicate issue", [{ ...day("2026-10-16"), sections: [{ text: { sv: "a", en: "b" }, issues: [2, 2] }] }]],
    ["oldest first", [day("2026-10-15"), day("2026-10-16")]],
    ["duplicate day", [day("2026-10-16"), day("2026-10-16")]],
  ])("rejects %s", (_, value) => {
    expect(parseReleaseNotes(value)).toBeNull();
  });
  it("validates the published build identity", () => {
    expect(parsePublishedReleaseNotes(published)).toEqual(published);
    expect(parsePublishedReleaseNotes({ build: { builtAt: null, commit: null }, days: [] })).toEqual({ build: { builtAt: null, commit: null }, days: [] });
    expect(parsePublishedReleaseNotes({ build: { builtAt: "soon", commit: null }, days })).toBeNull();
    expect(parsePublishedReleaseNotes({ build: { builtAt: null, commit: "<script>" }, days })).toBeNull();
    expect(parsePublishedReleaseNotes({ days })).toBeNull();
  });
});

describe("notesSince", () => {
  it("includes days on or after the installed build's Stockholm date", () => {
    expect(notesSince(days, "2026-10-16T09:00:00Z").map((entry) => entry.date)).toEqual(["2026-10-17", "2026-10-16"]);
    // 23:30 UTC on the 15th is already the 16th in Stockholm.
    expect(calendarDate(new Date("2026-10-15T23:30:00Z"))).toBe("2026-10-16");
    expect(notesSince(days, "2026-10-15T23:30:00Z").map((entry) => entry.date)).toEqual(["2026-10-17", "2026-10-16"]);
    expect(notesSince(days, "2026-10-18T09:00:00Z")).toEqual([]);
  });
  it("returns nothing without a valid installed build time", () => {
    expect(notesSince(days, null)).toEqual([]);
    expect(notesSince(days, "invalid")).toEqual([]);
  });
});

describe("updateSummary", () => {
  const delta = { baseCommit: "b".repeat(40), summary: { sv: "Enbart nya förbättringar.", en: "Only the latest improvements." }, issues: [1] };
  it("uses only a valid publication delta, even when daily notes contain older changes", () => {
    const parsed = parsePublishedReleaseNotes({ ...published, delta });
    expect(updateSummary(parsed?.delta, "sv")).toBe(delta.summary.sv);
    expect(updateSummary(parsed?.delta, "en")).toBe(delta.summary.en);
    expect(updateSummary(parsePublishedReleaseNotes(published)?.delta, "sv")).toBe("");
    expect(updateSummary(null, "en")).toBe("");
  });
  it("rejects untraceable, stale, malformed or overly long summaries without losing the full notes", () => {
    expect(parsePublicationDelta({ ...delta, summary: { sv: "x".repeat(181), en: "Short" } })).toBeNull();
    expect(parsePublicationDelta({ ...delta, issues: [1, 1] })).toBeNull();
    expect(parsePublicationDelta({ ...delta, baseCommit: "unknown" })).toBeNull();
    expect(parsePublishedReleaseNotes({ ...published, delta: { ...delta, issues: [999] } })).toEqual(published);
    expect(parsePublishedReleaseNotes({ ...published, delta: { ...delta, baseCommit: published.build.commit } })).toEqual(published);
  });
});

describe("fetchPublishedReleaseNotes", () => {
  it("fetches the public file next to the document without credentials or cache", async () => {
    vi.stubGlobal("document", { baseURI: "https://solwation.github.io/github-dashboard/" });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(published), { status: 200 }));
    expect(await fetchPublishedReleaseNotes(fetcher as typeof fetch)).toEqual(published);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://solwation.github.io/github-dashboard/release-notes.json");
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit" });
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
  it("returns null when offline, failing or invalid", async () => {
    vi.stubGlobal("document", { baseURI: "https://example.test/app/" });
    expect(await fetchPublishedReleaseNotes((async () => { throw new TypeError("offline"); }) as typeof fetch)).toBeNull();
    expect(await fetchPublishedReleaseNotes((async () => new Response("nope", { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchPublishedReleaseNotes((async () => new Response("{", { status: 200 })) as typeof fetch)).toBeNull();
    expect(await fetchPublishedReleaseNotes((async () => new Response(JSON.stringify({ build: published.build, days: [{}] }))) as typeof fetch)).toBeNull();
  });
});
