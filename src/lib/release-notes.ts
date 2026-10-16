import notesSource from "../release-notes.json" with { type: "json" };

export type NoteLanguage = "sv" | "en";
export interface ReleaseNoteSection {
  text: Record<NoteLanguage, string>;
  issues: number[];
}
export interface ReleaseNoteDay {
  /** Calendar date (YYYY-MM-DD) in {@link NOTES_TIME_ZONE}. */
  date: string;
  summary: Record<NoteLanguage, string>;
  sections: ReleaseNoteSection[];
}
export interface PublishedReleaseNotes {
  build: { builtAt: string | null; commit: string | null };
  /** Newest first. */
  days: ReleaseNoteDay[];
}

/** Release-note days are dated in the project's local time zone. */
export const NOTES_TIME_ZONE = "Europe/Stockholm";
/** Published file name, relative to the document base (next to index.html). */
export const RELEASE_NOTES_FILE = "release-notes.json";
const languages: readonly NoteLanguage[] = ["sv", "en"];
const maxSummaryDays = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function texts(value: unknown): Record<NoteLanguage, string> | null {
  if (!isRecord(value)) return null;
  const result = {} as Record<NoteLanguage, string>;
  for (const language of languages) {
    const text = value[language];
    if (typeof text !== "string" || !text.trim()) return null;
    result[language] = text.trim();
  }
  return result;
}
function section(value: unknown): ReleaseNoteSection | null {
  if (!isRecord(value) || !Array.isArray(value.issues)) return null;
  const text = texts(value.text);
  const issues = value.issues;
  if (!text || !issues.every((issue) => Number.isSafeInteger(issue) && (issue as number) > 0)) return null;
  if (new Set(issues).size !== issues.length) return null;
  return { text, issues: [...(issues as number[])] };
}

/**
 * Strictly validates release-note days. Every day needs a real calendar date,
 * Swedish and English summary and section texts, and at least one section.
 * Issue numbers are unique positive integers. Days must be unique and ordered
 * newest first. Unknown extra fields are ignored so older installed versions
 * can still read newer published files. Returns copies, or null when invalid.
 */
export function parseReleaseNotes(value: unknown): ReleaseNoteDay[] | null {
  if (!Array.isArray(value)) return null;
  const days: ReleaseNoteDay[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isCalendarDate(entry.date)) return null;
    const summary = texts(entry.summary);
    if (!summary || !Array.isArray(entry.sections) || !entry.sections.length) return null;
    const sections = entry.sections.map(section);
    if (sections.some((item) => !item)) return null;
    const previous = days.at(-1);
    if (previous && previous.date <= entry.date) return null;
    days.push({ date: entry.date, summary, sections: sections as ReleaseNoteSection[] });
  }
  return days;
}

const bundled = parseReleaseNotes(notesSource);
if (!bundled) throw new Error("src/release-notes.json is invalid");
/** Release notes included in the running (installed) bundle. */
export const bundledReleaseNotes: ReleaseNoteDay[] = bundled;

function buildIdentity(value: unknown): PublishedReleaseNotes["build"] | null {
  if (!isRecord(value)) return null;
  const { builtAt, commit } = value;
  if (builtAt !== null && (typeof builtAt !== "string" || Number.isNaN(Date.parse(builtAt)))) return null;
  if (commit !== null && (typeof commit !== "string" || !/^[a-f0-9]{7,64}$/i.test(commit))) return null;
  return { builtAt, commit };
}

/** Validates the published `{ build, days }` document. */
export function parsePublishedReleaseNotes(value: unknown): PublishedReleaseNotes | null {
  if (!isRecord(value)) return null;
  const build = buildIdentity(value.build);
  const days = parseReleaseNotes(value.days);
  return build && days ? { build, days } : null;
}

function documentBase(): string | null {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  if (typeof location !== "undefined") return location.href;
  return null;
}

/**
 * Fetches the notes published with the latest deployment, so an older
 * installed bundle can show what is new. Public file: no credentials or
 * Authorization header, and never served from HTTP/service-worker caches.
 * Returns null when offline, on any HTTP or network error, or invalid data.
 */
export async function fetchPublishedReleaseNotes(
  fetcher: typeof fetch = globalThis.fetch,
): Promise<PublishedReleaseNotes | null> {
  const base = documentBase();
  if (!base || typeof fetcher !== "function") return null;
  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(15_000) : undefined;
    const response = await fetcher(new URL(RELEASE_NOTES_FILE, base).href, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    return parsePublishedReleaseNotes(await response.json());
  } catch {
    return null;
  }
}

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function calendarDate(instant: Date, timeZone = NOTES_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Days that may contain changes the installed build lacks. A day is included
 * when its date is on or after the installed build's calendar date in
 * {@link NOTES_TIME_ZONE} (the zone the notes are dated in). The build day is
 * included because notes are per day, not per commit; it can therefore repeat
 * changes made earlier that day. Without a valid installed build time
 * (development builds) nothing is returned.
 */
export function notesSince(
  days: ReleaseNoteDay[],
  installedBuiltAt: string | null,
  timeZone = NOTES_TIME_ZONE,
): ReleaseNoteDay[] {
  if (!installedBuiltAt) return [];
  const instant = new Date(installedBuiltAt);
  if (Number.isNaN(instant.getTime())) return [];
  const installedDate = calendarDate(instant, timeZone);
  return days.filter((day) => day.date >= installedDate);
}

/**
 * Short text for the update popup: the summaries of the newest
 * {@link maxSummaryDays} days, newest first, joined with spaces.
 * Returns "" when there are no days.
 */
export function updateSummary(days: ReleaseNoteDay[], language: NoteLanguage): string {
  return [...days]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, maxSummaryDays)
    .map((day) => day.summary[language])
    .join(" ");
}

/** Release-note language for an i18n locale such as "sv-SE" or "en-GB". */
export function noteLanguage(locale: string): NoteLanguage {
  return locale === "sv-SE" ? "sv" : "en";
}
