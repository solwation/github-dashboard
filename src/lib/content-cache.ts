import { loadContent, saveContent } from "./vault";
import type { GitHub } from "./github";
import type { Lane, Repo } from "./model";

export const CONTENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
export interface ContentSnapshot {
  version: 1;
  savedAt: number;
  syncedAt: number | null;
  user: { login: string; avatar_url: string };
  repos: Repo[];
  lanes: Lane[];
  responses: ReturnType<GitHub["exportResponses"]>;
}
export async function readSnapshot(token: string, now = Date.now()): Promise<ContentSnapshot | null> {
  try {
    const data = await loadContent<ContentSnapshot>(token);
    if (!data || data.version !== 1 || !Number.isFinite(data.savedAt) || data.savedAt > now || now - Math.min(data.savedAt, data.syncedAt ?? data.savedAt) >= CONTENT_LIFETIME_MS ||
      (data.syncedAt !== null && !Number.isFinite(data.syncedAt)) ||
      typeof data.user?.login !== "string" || !Array.isArray(data.repos) || !Array.isArray(data.lanes) || !Array.isArray(data.responses) ||
      data.repos.length > 2000 || data.lanes.length > 2000 ||
      !data.lanes.every(lane => typeof lane.repo?.full_name === "string" && Array.isArray(lane.issues) && Array.isArray(lane.labels))) return null;
    return data;
  } catch { return null; }
}
export function writeSnapshot(token: string, snapshot: Omit<ContentSnapshot, "version" | "savedAt">) {
  return saveContent(token, { ...snapshot, version: 1, savedAt: Date.now() });
}
