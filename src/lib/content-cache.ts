import { loadContent, MAX_CONTENT_BYTES, saveEncodedContent } from "./vault";
import type { GitHub } from "./github";
import type { Issue, Lane, Repo } from "./model";

export const CONTENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** Background syncs that change nothing refresh the stored `syncedAt` at most this often (#122). */
export const SYNCED_AT_PERSIST_MS = 5 * 60 * 1000;
export interface ContentSnapshot {
  version: 1;
  savedAt: number;
  syncedAt: number | null;
  user: { login: string; avatar_url: string };
  repos: Repo[];
  lanes: Lane[];
  responses: ReturnType<GitHub["exportResponses"]>;
}
type Response = ContentSnapshot["responses"][number];
/**
 * Stored form of an issue-list response whose board issues are all in `lanes` (#122): only the
 * ETag, the pagination link and the issue ids. Pull requests are left out because neither lane
 * loader uses them. Older builds skip these entries (no `data`) and simply download the list again.
 */
interface StoredIssueList { etag: string; next: string | null; issues: number[] }

const ISSUE_LIST = /^\/repos\/[\w.-]+\/[\w.-]+\/issues$/;
const isIssueListUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://api.github.com" && ISSUE_LIST.test(parsed.pathname);
  } catch { return false; }
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

function compactResponse([url, response]: Response, board: ReadonlySet<number>): [string, unknown] {
  if (!isIssueListUrl(url) || !Array.isArray(response.data)) return [url, response];
  const issues: number[] = [];
  for (const item of response.data as unknown[]) {
    if (!isRecord(item) || !Number.isSafeInteger(item.id)) return [url, response];
    if (item.pull_request) continue;
    // A list issue the board does not hold (e.g. closed just outside the window) keeps the raw body.
    if (!board.has(item.id as number)) return [url, response];
    issues.push(item.id as number);
  }
  return [url, { etag: response.etag, next: response.next, issues } satisfies StoredIssueList];
}

/** Rebuilds compacted list bodies from the restored board; unresolved entries are dropped, so they are refetched. */
function expandResponses(responses: unknown[], lanes: Lane[]): unknown[] {
  let issues: Map<number, Issue> | undefined;
  return responses.flatMap(entry => {
    if (!Array.isArray(entry) || !isRecord(entry[1]) || "data" in entry[1] || !Array.isArray(entry[1].issues)) return [entry];
    const [url, { etag, next, issues: ids }] = entry as [string, StoredIssueList];
    if (typeof url !== "string" || !isIssueListUrl(url) || ids.length > 1000) return [];
    issues ??= new Map(lanes.flatMap(lane => lane.issues.map(issue => [issue.id, issue] as const)));
    const data: Issue[] = [];
    for (const id of ids) {
      const issue = issues.get(id);
      if (!issue) return [];
      // Lane issues carry local timer enrichment that is not part of GitHub's response.
      const { startedAt: _startedAt, timerError: _timerError, ...raw } = issue;
      data.push(raw);
    }
    return [[url, { etag, next, data }]];
  });
}

export async function readSnapshot(token: string, now = Date.now()): Promise<ContentSnapshot | null> {
  try {
    const data = await loadContent<ContentSnapshot>(token);
    if (!data || data.version !== 1 || !Number.isFinite(data.savedAt) || data.savedAt > now || now - Math.min(data.savedAt, data.syncedAt ?? data.savedAt) >= CONTENT_LIFETIME_MS ||
      (data.syncedAt !== null && !Number.isFinite(data.syncedAt)) ||
      typeof data.user?.login !== "string" || !Array.isArray(data.repos) || !Array.isArray(data.lanes) || !Array.isArray(data.responses) ||
      data.repos.length > 2000 || data.lanes.length > 2000 ||
      !data.lanes.every(lane => typeof lane.repo?.full_name === "string" && Array.isArray(lane.issues) && Array.isArray(lane.labels))) return null;
    // Snapshots from before #115 may carry timeout acknowledgements; they are no longer used.
    delete (data as { timeoutAcknowledgements?: unknown }).timeoutAcknowledgements;
    data.responses = expandResponses(data.responses, data.lanes) as ContentSnapshot["responses"];
    return data;
  } catch { return null; }
}

/** UTF-8 JSON of the snapshot, serialized exactly once; the measured bytes are the encrypted bytes (#122). */
export function encodeSnapshot(snapshot: Omit<ContentSnapshot, "version" | "savedAt">, savedAt = Date.now()): Uint8Array<ArrayBuffer> {
  // The board is essential for startup; raw API responses only avoid repeat downloads.
  // Budget their serialized UTF-8 bytes before encryption rather than rejecting a
  // useful board because GitHub returned large fields or unrelated pull requests.
  const { responses, ...rest } = snapshot;
  const encoder = new TextEncoder();
  const board = encoder.encode(JSON.stringify({ ...rest, version: 1, savedAt }).slice(0, -1) + ',"responses":[');
  const end = encoder.encode("]}");
  const ids = new Set(snapshot.lanes.flatMap(lane => lane.issues.map(issue => issue.id)));
  const kept: Uint8Array[] = [];
  let bytes = board.byteLength + end.byteLength;
  for (const response of responses.slice(-100).reverse()) {
    const encoded = encoder.encode(JSON.stringify(compactResponse(response, ids)));
    const addedBytes = encoded.byteLength + (kept.length ? 1 : 0);
    if (bytes + addedBytes > MAX_CONTENT_BYTES) continue;
    kept.push(encoded);
    bytes += addedBytes;
  }
  kept.reverse();
  const result = new Uint8Array(bytes);
  result.set(board);
  let offset = board.byteLength;
  kept.forEach((part, index) => {
    if (index) result[offset++] = 0x2c; // ","
    result.set(part, offset);
    offset += part.byteLength;
  });
  result.set(end, offset);
  return result;
}

export function writeSnapshot(token: string, snapshot: Omit<ContentSnapshot, "version" | "savedAt">) {
  // Essential boards larger than this budget are compressed by the vault without
  // dropping issues. The encrypted and expanded payloads remain independently bounded.
  return saveEncodedContent(token, encodeSnapshot(snapshot));
}
