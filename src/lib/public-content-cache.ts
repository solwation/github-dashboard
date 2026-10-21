import { loadSettings, saveSettings } from "./settings-store";
import { publicRepositoryRecord } from "./public-workspace";
import type { Issue, Label, Lane } from "./model";

/** Reserved, encrypted settings record; never a credential or a private content-cache key. */
export const PUBLIC_CONTENT_ACCOUNT = ":public-content:";
export const PUBLIC_CONTENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MAX_PUBLIC_CONTENT_BYTES = 4 * 1024 * 1024;
export const MAX_PUBLIC_CONTENT_LANES = 100;
export interface PublicLaneSnapshot { lane: Lane; syncedAt: number }
interface PublicContentSnapshot { version: 1; entries: PublicLaneSnapshot[] }
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const labels = (value: unknown): value is Label[] => Array.isArray(value) && value.every(label => record(label) && typeof label.name === "string" && typeof label.color === "string");
function issue(value: unknown): value is Issue {
  return record(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0 && Number.isSafeInteger(value.number) && Number(value.number) > 0 &&
    typeof value.title === "string" && typeof value.html_url === "string" && ["open", "closed"].includes(String(value.state)) &&
    date(value.created_at) && date(value.updated_at) && (value.closed_at === null || date(value.closed_at)) &&
    (value.state !== "closed" || date(value.closed_at)) && !value.pull_request && labels(value.labels) &&
    Array.isArray(value.assignees) && value.assignees.every(person => record(person) && typeof person.login === "string" && typeof person.avatar_url === "string") &&
    (value.body === undefined || value.body === null || typeof value.body === "string") &&
    (value.comments === undefined || (Number.isSafeInteger(value.comments) && Number(value.comments) >= 0)) &&
    (value.startedAt === undefined || value.startedAt === null || date(value.startedAt)) &&
    (value.workStartedAt === undefined || date(value.workStartedAt));
}
/** Keep complete, public-only lanes. Age is based on the last successful fetch, never a cache write. */
export function normalizePublicContent(value: unknown, now = Date.now()): PublicLaneSnapshot[] {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries)) return [];
  const candidates: PublicLaneSnapshot[] = [];
  for (const entry of value.entries.slice(0, MAX_PUBLIC_CONTENT_LANES * 2)) {
    if (!record(entry) || !Number.isFinite(entry.syncedAt) || Number(entry.syncedAt) > now || Number(entry.syncedAt) <= 0 || now - Number(entry.syncedAt) >= PUBLIC_CONTENT_LIFETIME_MS || !record(entry.lane)) continue;
    const lane = entry.lane, repo = publicRepositoryRecord(lane.repo);
    if (!repo || lane.loading || lane.error || !labels(lane.labels) || !Array.isArray(lane.issues) || !lane.issues.every(issue)) continue;
    if (new Set(lane.issues.map(item => item.id)).size !== lane.issues.length) continue;
    candidates.push({ syncedAt: Number(entry.syncedAt), lane: { repo, labels: lane.labels,
      issues: lane.issues.filter(item => item.state !== "closed" || Date.parse(item.closed_at!) >= now - 30 * 86400000),
      ...(typeof lane.timerWarning === "boolean" ? { timerWarning: lane.timerWarning } : {}) } });
  }
  const kept: PublicLaneSnapshot[] = [], names = new Set<string>(), ids = new Set<number>();
  let bytes = encoder.encode(JSON.stringify({ version: 1, entries: [] })).byteLength;
  // Prefer recent complete repositories; never trim an issue list to make a lane fit.
  for (const entry of candidates.sort((a, b) => b.syncedAt - a.syncedAt)) {
    if (kept.length >= MAX_PUBLIC_CONTENT_LANES || names.has(entry.lane.repo.full_name) || ids.has(entry.lane.repo.id)) continue;
    const added = encoder.encode(JSON.stringify(entry)).byteLength + (kept.length ? 1 : 0);
    if (bytes + added > MAX_PUBLIC_CONTENT_BYTES) continue;
    kept.push(entry); names.add(entry.lane.repo.full_name); ids.add(entry.lane.repo.id); bytes += added;
  }
  return kept;
}
export async function readPublicContent(now = Date.now()): Promise<PublicLaneSnapshot[]> {
  try { return normalizePublicContent(await loadSettings(PUBLIC_CONTENT_ACCOUNT), now); }
  catch { return []; }
}
export function writePublicContent(entries: readonly PublicLaneSnapshot[], now = Date.now()) {
  const snapshot: PublicContentSnapshot = { version: 1, entries: normalizePublicContent({ version: 1, entries }, now) };
  return saveSettings(PUBLIC_CONTENT_ACCOUNT, snapshot);
}
