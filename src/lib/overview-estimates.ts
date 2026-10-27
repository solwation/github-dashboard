import { matchesIssueFilters } from "./issue-filter";
import { column, isCoordination, type Issue, type Lane, type Rules } from "./model";
import { sumStoryPoints, type StoryPoints } from "./story-points";
import { estimateGroups, median, otherRepositoryMembers, repositoryEstimate, type SubIssueWork } from "./estimates";

export interface OverviewEstimateGroup { repository: string; issues: Issue[]; rules: Rules }
export type OverviewEstimateColumn = "open" | "progress";

/** The badge and its points use the same query scope, counting each repository issue once. */
export function overviewEstimateGroups(lanes: Lane[], rules: Record<string, Rules>, hideCoordination: boolean,
  filters: { query?: string; repositoryQueries?: Record<string, string> } = {}): OverviewEstimateGroup[] {
  const groups = new Map<string, OverviewEstimateGroup>();
  const seen = new Set<string>();
  for (const lane of lanes) {
    const repository = lane.repo.full_name;
    let group = groups.get(repository);
    if (!group) { group = { repository, issues: [], rules: rules[repository] || {} }; groups.set(repository, group); }
    for (const issue of lane.issues) {
      const key = `${repository}:${issue.id}`;
      if (seen.has(key) || issue.pull_request || (hideCoordination && isCoordination(issue)) ||
        !matchesIssueFilters(issue, filters.query || "", filters.repositoryQueries?.[repository] || "")) continue;
      seen.add(key); group.issues.push(issue);
    }
  }
  return [...groups.values()];
}
const selected = (group: OverviewEstimateGroup, key: OverviewEstimateColumn) => group.issues.filter(issue =>
  key === "open" ? issue.state === "open" : column(issue, group.rules) === "progress");
/**
 * Story points of the selected work. With loaded sub-issues (#281) they follow the time estimate's
 * grouping: a sub-issue absorbed into an open estimated parent is not counted on its own, and the
 * group counts the parent's points in the column its time is counted in (In progress as soon as a
 * sub-issue runs), so the points and time beside each other describe the same work.
 */
export function overviewPointSummary(groups: OverviewEstimateGroup[], key: OverviewEstimateColumn,
  children?: ReadonlyMap<number, readonly SubIssueWork[]>, now = Date.now()): StoryPoints {
  // Repositories are estimated side by side, so a sub-issue estimated in its own repository is not walked again (#287).
  const external = otherRepositoryMembers(groups);
  const contributors = groups.flatMap((group, index) => {
    const issues = selected(group, key);
    if (!children?.size || repositoryEstimate(group.issues, now, { rules: group.rules }).basis.msPerPoint === null)
      return issues;
    const grouped = estimateGroups(group.issues, now, { rules: group.rules, children, external: external[index] });
    const members = new Set(group.issues.filter(issue => { const state = column(issue, group.rules); return !issue.pull_request && (state === "progress" || state === "backlog"); }).map(issue => issue.id));
    // Open issues outside the estimated columns keep their own points; absorbed members are part of their root.
    const own = issues.filter(issue => !members.has(issue.id));
    const counted = grouped.filter(entry => key === "open" || entry.inProgress);
    return [...own, ...counted.map(entry => entry.root)];
  });
  return sumStoryPoints(contributors);
}

/** Numeric API retained for consumers that only need the total. */
export function overviewPoints(groups: OverviewEstimateGroup[], key: OverviewEstimateColumn,
  children?: ReadonlyMap<number, readonly SubIssueWork[]>, now = Date.now()): number {
  return overviewPointSummary(groups, key, children, now).points;
}

/** Repositories run in parallel; open work includes the backlog horizon after current work. */
export function overviewTimeEstimate(groups: OverviewEstimateGroup[], key: OverviewEstimateColumn, now: number,
  children?: ReadonlyMap<number, readonly SubIssueWork[]>) {
  let repositories = 0, knownRepositories = 0, remainingMs = 0, overdue = 0, unknownStart = 0, counting = false;
  let nextStartMs = Infinity;
  const external = otherRepositoryMembers(groups);
  for (const [index, group] of groups.entries()) {
    if (!selected(group, key).length) continue;
    repositories++;
    const estimate = repositoryEstimate(group.issues, now, { rules: group.rules, children, external: external[index] });
    if (estimate.basis.msPerPoint === null) continue;
    knownRepositories++;
    remainingMs = Math.max(remainingMs, estimate.progress?.remainingMs ?? 0, key === "open" ? estimate.backlog?.remainingMs ?? 0 : 0);
    overdue += estimate.progress?.overdue ?? 0;
    for (const item of estimate.progress?.items ?? []) {
      const start = Date.parse(item.issue.startedAt || "");
      if (start > now) nextStartMs = Math.min(nextStartMs, start);
    }
    // Like an unknown start, a future start assumes the full time, unless sub-issue time was deducted (#287).
    unknownStart += estimate.progress?.items.filter(item => item.unknownStart || (!item.subIssueSpentMs && Date.parse(item.issue.startedAt || "") > now)).length ?? 0;
    counting ||= !!estimate.progress?.items.some(item => item.counting);
  }
  return { repositories, knownRepositories, remainingMs: knownRepositories ? remainingMs : null, overdue, unknownStart, counting, nextStartMs };
}

/**
 * Closed card detail (#291): points of the closed issues the card counts (same filtered scope) and the median
 * measured work time of those that have a known start. `medianMs` is null when no duration is known.
 */
export function overviewClosedSummary(groups: OverviewEstimateGroup[], now: number) {
  const contributors: Issue[] = [];
  const durations: number[] = [];
  for (const group of groups) for (const issue of group.issues) {
    if (issue.state !== "closed") continue;
    contributors.push(issue);
    const start = Date.parse(issue.workStartedAt || ""), end = Date.parse(issue.closed_at || "");
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && end <= now) durations.push(end - start);
  }
  return { ...sumStoryPoints(contributors), medianMs: median(durations), measured: durations.length };
}

/** Repository card detail (#291): visibility split and owner count of the loaded repositories, each counted once. */
export function overviewRepositoryInfo(lanes: Lane[]) {
  const repos = new Map(lanes.map(lane => [lane.repo.full_name, lane.repo]));
  const all = [...repos.values()];
  return {
    private: all.filter(repo => repo.private).length,
    public: all.filter(repo => !repo.private).length,
    owners: new Set(all.map(repo => repo.owner?.login).filter(Boolean)).size,
  };
}
