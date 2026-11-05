import { column, isCoordination, type Issue, type Lane, type Repo, type Rules } from "./model";

export interface SidebarRepository {
  id: number;
  name: string;
  fullName: string;
  backlog: number;
  progress: number;
  closed: number;
  changedAt: string | null;
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

/** A repository is inactive when it has no open issues in Backlog or In Progress, and is not actively loading. */
export function isInactiveRepository(repo: Pick<SidebarRepository, "backlog" | "progress" | "loading">): boolean {
  return !repo.loading && repo.backlog === 0 && repo.progress === 0;
}

/** Count the same active group rendered by the sidebar, independent of expansion and search. */
export function countActiveRepositories(repositories: readonly SidebarRepository[]): number {
  return new Set(repositories.filter(repo => !isInactiveRepository(repo)).map(repo => repo.fullName)).size;
}
