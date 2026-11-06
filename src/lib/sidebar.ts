import { column, isCoordination, type Issue, type Lane, type Repo, type Rules } from "./model";

export interface SidebarRepository {
  id: number;
  name: string;
  fullName: string;
  backlog: number;
  progress: number;
  closed: number;
  changedAt: string | null;
  /** Most recent `closed_at` (ms) among the loaded issues, pending closures included; null when none (#430). */
  lastClosedAt?: number | null;
  unreadAt?: string | null;
  loading?: boolean;
  unavailable?: boolean;
  /** Absent when the repository data does not say (demo, older cache). */
  private?: boolean;
  /** Configured HTTP(S) website, falling back to the standard GitHub Pages address. */
  websiteUrl?: string;
  /** Pages metadata also preserves the existing private/Pages visibility indicator. */
  pagesUrl?: string;
  /** Another person's public repository, shown in its own group below the account's own. */
  external?: boolean;
}

/** Standard GitHub Pages address; `<owner>.github.io` is the user/organization site. Null without Pages. */
export function pagesUrl(repo: Pick<Repo, "name" | "has_pages" | "owner" | "full_name">): string | null {
  if (repo.has_pages !== true) return null;
  const owner = (repo.owner?.login ?? repo.full_name.split("/")[0] ?? "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(owner)) return null;
  const host = `${owner}.github.io`;
  return repo.name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${encodeURIComponent(repo.name)}/`;
}

/** Prefer GitHub's configured Website; reject non-web and credential-bearing addresses. */
export function websiteUrl(repo: Pick<Repo, "name" | "has_pages" | "owner" | "full_name" | "homepage">): string | null {
  if (typeof repo.homepage === "string" && /^https?:\/\//i.test(repo.homepage.trim())) {
    try {
      const url = new URL(repo.homepage.trim());
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
    } catch { /* Invalid Website: keep the existing Pages fallback. */ }
  }
  return pagesUrl(repo);
}

/** Summarize the loaded lanes before text search. Closed issues already use the API's 30-day window. */
export function summarizeLanes(
  lanes: Lane[],
  rules: Record<string, Rules>,
  hideCoordination: boolean,
  unreadAt?: (repo: string, issue: Issue) => string | null,
  external?: ReadonlySet<string>,
): SidebarRepository[] {
  return lanes.map((lane) => {
    const website = websiteUrl(lane.repo);
    const summary: SidebarRepository = {
      id: lane.repo.id,
      name: lane.repo.name,
      fullName: lane.repo.full_name,
      backlog: 0,
      progress: 0,
      closed: 0,
      changedAt: null,
      lastClosedAt: null,
      ...(typeof lane.repo.private === "boolean" ? { private: lane.repo.private } : {}),
      ...(website ? { websiteUrl: website } : {}),
      ...(pagesUrl(lane.repo) ? { pagesUrl: pagesUrl(lane.repo)! } : {}),
      ...(external?.has(lane.repo.full_name) ? { external: true } : {}),
      ...(lane.loading ? { loading: true } : {}),
      ...(lane.error && !lane.issues.length ? { unavailable: true } : {}),
      ...(unreadAt ? { unreadAt: null } : {}),
    };
    let latest = -Infinity;
    for (const issue of lane.issues) {
      if (issue.pull_request || (hideCoordination && isCoordination(issue))) continue;
      summary[column(issue, rules[lane.repo.full_name])]++;
      if (issue.state === "closed" && issue.closed_at) {
        const closed = Date.parse(issue.closed_at);
        if (Number.isFinite(closed) && closed > (summary.lastClosedAt ?? -Infinity)) summary.lastClosedAt = closed;
      }
      const changed = Date.parse(issue.updated_at);
      if (Number.isFinite(changed) && changed > latest) {
        latest = changed;
        summary.changedAt = issue.updated_at;
      }
      const unread = unreadAt?.(lane.repo.full_name, issue);
      if (unread && (!summary.unreadAt || Date.parse(unread) > Date.parse(summary.unreadAt))) summary.unreadAt = unread;
    }
    return summary;
  });
}

export const RECENT_CHANGE_MS = 5 * 60 * 1000;
export function recentlyChanged(changedAt: string | null, now: number): boolean {
  if (!changedAt) return false;
  const elapsed = now - Date.parse(changedAt);
  return elapsed >= 0 && elapsed <= RECENT_CHANGE_MS;
}

/** Default and limits for the "inactive after N minutes since the last closed issue" setting (#430). */
export const DEFAULT_INACTIVE_GRACE_MINUTES = 30;
export const MAX_INACTIVE_GRACE_MINUTES = 1440;
/** A whole number of minutes in 0..MAX, from a number or digit string; null for anything else. */
export function parseInactiveGraceMinutes(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= MAX_INACTIVE_GRACE_MINUTES ? minutes : null;
}
export function normalizeInactiveGraceMinutes(value: unknown): number {
  return parseInactiveGraceMinutes(value) ?? DEFAULT_INACTIVE_GRACE_MINUTES;
}
/** The moment a repository without open work turns inactive; null when it is not held active. */
export function inactiveAfter(repo: Pick<SidebarRepository, "lastClosedAt">, graceMs: number): number | null {
  return graceMs > 0 && typeof repo.lastClosedAt === "number" ? repo.lastClosedAt + graceMs : null;
}

/**
 * A repository is inactive when it has no open issues in Backlog or In Progress, is not loading, and
 * (#430) its most recently closed issue is at least `graceMs` old. Without `closed_at`, or with
 * graceMs 0, it turns inactive at once.
 */
export function isInactiveRepository(
  repo: Pick<SidebarRepository, "backlog" | "progress" | "loading" | "lastClosedAt">,
  now = Date.now(),
  graceMs = 0,
): boolean {
  if (repo.loading || repo.backlog !== 0 || repo.progress !== 0) return false;
  const until = inactiveAfter(repo, graceMs);
  return until === null || now >= until;
}

/** Count the same active group rendered by the sidebar, independent of expansion and search. */
export function countActiveRepositories(repositories: readonly SidebarRepository[], now = Date.now(), graceMs = 0): number {
  return new Set(repositories.filter(repo => !isInactiveRepository(repo, now, graceMs)).map(repo => repo.fullName)).size;
}
