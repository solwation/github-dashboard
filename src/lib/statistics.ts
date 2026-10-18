/** Statistics are credential-bound snapshots; persistent copies are encrypted. */
export interface StatisticsIssue {
  id: number; number: number; created_at: string; updated_at: string;
  labels: { name: string }[]; user?: { login: string } | null; pull_request?: unknown;
}
export interface StatisticsEvent {
  id: number; event: string; created_at: string;
  actor?: { login: string } | null; issue?: StatisticsIssue;
  /** Label of a labeled/unlabeled event; lets the board derive closed issues' work starts (#141). */
  label?: { name: string };
}
export interface StatisticsCommit {
  sha: string; parents: { sha: string }[]; author?: { login: string } | null;
  commit: { author?: { name: string; date: string }; committer?: { date: string } };
}
export interface StatisticsChange {
  sha: string; date: string; contributor: string; additions: number; deletions: number;
  files: number; filesComplete: boolean;
}
export interface StatisticsPull {
  id: number; created_at: string; updated_at: string; closed_at: string | null; merged_at: string | null;
  user?: { login: string } | null; labels: { name: string }[];
}
export interface StatisticsSource<T> { data: T[]; complete: boolean; fetchedAt: number; historyVerifiedAt?: number }
export interface StatisticsData {
  repository: string; from: string; to: string; fetchedAt: number;
  issues: StatisticsSource<StatisticsIssue> | null;
  events: StatisticsSource<StatisticsEvent> | null;
  commits: StatisticsSource<StatisticsCommit> | null;
  changes: StatisticsSource<StatisticsChange> | null;
  pulls: StatisticsSource<StatisticsPull> | null;
  temporary: StatisticsSourceName[];
}
export type StatisticsSourceName = "issues" | "events" | "commits" | "changes" | "pulls";
export const statisticsRanges = ["8h", "12h", "24h", "3d", "7d", "21d", "30d"] as const;
export type StatisticsRangePreset = typeof statisticsRanges[number];
export const DEFAULT_STATISTICS_RANGE: StatisticsRangePreset = "3d";
export const statisticsResolutions = ["1m", "5m", "15m", "30m", "1h", "6h", "12h", "1d"] as const;
export type StatisticsResolution = typeof statisticsResolutions[number];
export const MAX_STATISTICS_BUCKETS = 720;
export const statisticsResolutionMs: Record<StatisticsResolution, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000,
};
export const statisticsRangeMs: Record<StatisticsRangePreset, number> = {
  "8h": 8 * 3_600_000, "12h": 12 * 3_600_000, "24h": 24 * 3_600_000,
  "3d": 3 * 86_400_000, "7d": 7 * 86_400_000, "21d": 21 * 86_400_000, "30d": 30 * 86_400_000,
};
export const rangeNames: Record<StatisticsRangePreset, string> = {
  "8h": "8h", "12h": "12h", "24h": "24h",
  "3d": "3 dagar", "7d": "7 dagar", "21d": "3 veckor", "30d": "30 dagar",
};
export const resolutionNames: Record<StatisticsResolution, string> = {
  "1m": "1 min", "5m": "5 min", "15m": "15 min", "30m": "30 min",
  "1h": "1 h", "6h": "6 h", "12h": "12 h", "1d": "1 dag",
};
export interface StatisticsFilter {
  from: string; to: string; label: string; contributor: string;
  range?: StatisticsRangePreset; resolution?: StatisticsResolution; now?: number;
}
export const statisticsMetrics = ["closed", "created", "reopened", "netIssues", "commits", "additions", "deletions", "netLines", "files", "prsOpened", "prsMerged", "prsClosed"] as const;
export type StatisticsMetric = typeof statisticsMetrics[number];
export interface StatisticsPreference extends StatisticsFilter {
  metric: StatisticsMetric;
  metrics?: StatisticsMetric[];
}
export type StatisticsPreferences = Record<string, StatisticsPreference>;
export type StatisticsValues = Partial<Record<StatisticsMetric, number>>;
export interface StatisticsDay { date: string; values: StatisticsValues }
export interface StatisticsSummary {
  days: StatisticsDay[]; totals: StatisticsValues;
  complete: Partial<Record<StatisticsMetric, boolean>>;
  closureAgeDays: number | null;
  contributors: { name: string; commits: number; additions: number | null; deletions: number | null }[];
  labels: { name: string; count: number }[];
}
export function statisticsDurationMs(filter: Pick<StatisticsFilter, "from" | "to" | "range">): number {
  if (filter.range && statisticsRangeMs[filter.range]) return statisticsRangeMs[filter.range];
  const start = Date.parse(`${filter.from}T00:00:00Z`), end = Date.parse(`${filter.to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return statisticsRangeMs["30d"];
  return Math.min(30, Math.round((end - start) / 86_400_000) + 1) * 86_400_000;
}
export function allowedStatisticsResolutions(durationMs: number): StatisticsResolution[] {
  const valid = statisticsResolutions.filter(res => {
    const step = statisticsResolutionMs[res];
    return step * 2 <= durationMs && durationMs / step <= MAX_STATISTICS_BUCKETS;
  });
  return valid.length ? valid : ["1d"];
}
export function defaultStatisticsResolution(range?: StatisticsRangePreset): StatisticsResolution {
  if (range === "8h") return "15m";
  if (range === "12h") return "30m";
  if (range === "24h") return "1h";
  return "1d";
}
export function clampStatisticsResolution(
  resolution: StatisticsResolution | undefined,
  durationMs: number,
  range?: StatisticsRangePreset,
): StatisticsResolution {
  const allowed = allowedStatisticsResolutions(durationMs);
  if (resolution && allowed.includes(resolution)) return resolution;
  if (resolution) {
    const requestedMs = statisticsResolutionMs[resolution];
    if (requestedMs < statisticsResolutionMs[allowed[0]!]) return allowed[0]!;
    if (requestedMs > statisticsResolutionMs[allowed[allowed.length - 1]!]) return allowed[allowed.length - 1]!;
  }
  const fallback = defaultStatisticsResolution(range);
  return allowed.includes(fallback) ? fallback : allowed[allowed.length - 1]!;
}
export function statisticsWindow(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - 29 * 86400000;
  return { from: new Date(start).toISOString().slice(0, 10), to: day };
}
export function commitDate(commit: StatisticsCommit) { return commit.commit.committer?.date || commit.commit.author?.date || ""; }
export function commitContributor(commit: StatisticsCommit) { return commit.author?.login || commit.commit.author?.name || ""; }
// GitHub timestamps are normally UTC (`YYYY-MM-DDTHH:MM:SSZ`, optionally with
// fractional seconds); their UTC day is the prefix. Offsets and other formats
// still go through Date.parse so they map to the correct UTC calendar day.
const utcTimestamp = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;
export function dayOf(date: string) {
  if (utcTimestamp.test(date)) return date.slice(0, 10);
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}
export function statisticsDimensions(data: StatisticsData[]) {
  const labels = new Set<string>(), contributors = new Set<string>();
  for (const snapshot of data) {
    for (const issue of snapshot.issues?.data || []) {
      for (const label of issue.labels) labels.add(label.name);
      if (issue.user?.login) contributors.add(issue.user.login);
    }
    for (const event of snapshot.events?.data || []) {
      for (const label of event.issue?.labels || []) labels.add(label.name);
      if (event.actor?.login) contributors.add(event.actor.login);
    }
    for (const commit of snapshot.commits?.data || []) { const author = commitContributor(commit); if (author) contributors.add(author); }
    for (const pull of snapshot.pulls?.data || []) {
      for (const label of pull.labels) labels.add(label.name);
      if (pull.user?.login) contributors.add(pull.user.login);
    }
  }
  return { labels: [...labels].sort(), contributors: [...contributors].sort() };
}

export function summarizeStatistics(data: StatisticsData[], filter: StatisticsFilter): StatisticsSummary {
  const days: StatisticsDay[] = [];
  const subDayRange = filter.range === "8h" || filter.range === "12h" || filter.range === "24h";
  const durationMs = statisticsDurationMs(filter);
  const resolution = filter.resolution || filter.range
    ? clampStatisticsResolution(filter.resolution, durationMs, filter.range)
    : "1d";
  const presetDays = filter.range === "3d" ? 3 : filter.range === "7d" ? 7 : filter.range === "21d" ? 21 : filter.range === "30d" ? 30 : null;
  let bucketFor: (date: string) => StatisticsValues | undefined;
  if (resolution === "1d" && !subDayRange) {
    const minStart = Date.parse(`${filter.from}T00:00:00Z`), end = Date.parse(`${filter.to}T00:00:00Z`);
    const start = presetDays && Number.isFinite(end)
      ? Math.max(Number.isFinite(minStart) ? minStart : -Infinity, end - (presetDays - 1) * 86400000)
      : minStart;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      for (let day = start; day <= end && days.length < 30; day += 86400000) days.push({ date: new Date(day).toISOString().slice(0, 10), values: {} });
    }
    const byDate = new Map(days.map(day => [day.date, day.values]));
    bucketFor = (date: string) => byDate.get(dayOf(date));
  } else {
    const stepMs = statisticsResolutionMs[resolution];
    let windowStartMs = NaN, windowEndMs = NaN;
    if (subDayRange) {
      const latestFetched = data.reduce((max, item) => Math.max(max, item.fetchedAt || 0), 0);
      const refNow = filter.now !== undefined && Number.isFinite(filter.now)
        ? filter.now
        : latestFetched > 0 ? latestFetched : Date.parse(`${filter.to}T23:59:59.999Z`);
      if (Number.isFinite(refNow)) {
        const lastBucket = Math.floor(refNow / stepMs) * stepMs;
        const count = Math.min(MAX_STATISTICS_BUCKETS, Math.max(2, Math.round(durationMs / stepMs)));
        windowStartMs = lastBucket - (count - 1) * stepMs;
        windowEndMs = lastBucket + stepMs;
      }
    } else {
      const minStart = Date.parse(`${filter.from}T00:00:00Z`), end = Date.parse(`${filter.to}T00:00:00Z`);
      windowStartMs = presetDays && Number.isFinite(end)
        ? Math.max(Number.isFinite(minStart) ? minStart : -Infinity, end - (presetDays - 1) * 86400000)
        : minStart;
      windowEndMs = Number.isFinite(end) ? end + 86400000 : NaN;
    }
    if (Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs)) {
      for (let t = windowStartMs; t < windowEndMs && days.length < MAX_STATISTICS_BUCKETS; t += stepMs) {
        const iso = new Date(t).toISOString();
        days.push({ date: resolution === "1d" ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " "), values: {} });
      }
    }
    bucketFor = (date: string) => {
      if (!dayOf(date)) return undefined;
      const parsed = Date.parse(date);
      if (!Number.isFinite(parsed) || parsed < windowStartMs || parsed >= windowEndMs) return undefined;
      return days[Math.floor((parsed - windowStartMs) / stepMs)]?.values;
    };
  }
  const complete: StatisticsSummary["complete"] = {};
  const closures: number[] = [];
  const contributors = new Map<string, { name: string; commits: number; additions: number | null; deletions: number | null }>();
  const labels = new Map<string, number>();
  const labelMatches = (record: { labels: { name: string }[] }) => !filter.label || record.labels.some(label => label.name === filter.label);
  const personMatches = (person?: string) => !filter.contributor || person === filter.contributor;
  function enable(metric: StatisticsMetric, isComplete: boolean) {
    complete[metric] = (complete[metric] ?? true) && isComplete;
    for (const day of days) day.values[metric] ??= 0;
  }
  function add(metric: StatisticsMetric, values: StatisticsValues | undefined, value = 1) {
    if (values && values[metric] !== undefined) values[metric]! += value;
  }
  for (const snapshot of data) {
    if (snapshot.issues) {
      enable("created", snapshot.issues.complete);
      for (const issue of snapshot.issues.data) {
        if (!labelMatches(issue) || !personMatches(issue.user?.login)) continue;
        const values = bucketFor(issue.created_at);
        add("created", values);
        if (values) for (const label of issue.labels) labels.set(label.name, (labels.get(label.name) || 0) + 1);
      }
    }
    if (snapshot.events) {
      for (const metric of ["closed", "reopened"] as const) enable(metric, snapshot.events.complete);
      for (const event of snapshot.events.data) {
        if (!event.issue || event.issue.pull_request || !labelMatches(event.issue) || !personMatches(event.actor?.login)) continue;
        if (event.event !== "closed" && event.event !== "reopened") continue;
        const values = bucketFor(event.created_at);
        add(event.event, values);
        if (event.event === "closed" && values) {
          const age = Date.parse(event.created_at) - Date.parse(event.issue.created_at);
          if (Number.isFinite(age) && age >= 0) closures.push(age / 86400000);
        }
      }
    }
    // Labels describe issues/PRs. They have no reliable relationship to commits.
    if (snapshot.commits && !filter.label) {
      enable("commits", snapshot.commits.complete);
      for (const commit of snapshot.commits.data) {
        const author = commitContributor(commit);
        if (!personMatches(author)) continue;
        const values = bucketFor(commitDate(commit));
        add("commits", values);
        if (!values) continue;
        const existing = contributors.get(author) || { name: author, commits: 0, additions: snapshot.changes ? 0 : null, deletions: snapshot.changes ? 0 : null };
        existing.commits++;
        contributors.set(author, existing);
      }
    }
    if (snapshot.changes && !filter.label) {
      enable("additions", snapshot.changes.complete); enable("deletions", snapshot.changes.complete);
      enable("netLines", snapshot.changes.complete);
      enable("files", snapshot.changes.complete && snapshot.changes.data.every(change => change.filesComplete));
      for (const change of snapshot.changes.data) {
        if (!personMatches(change.contributor)) continue;
        const values = bucketFor(change.date);
        if (!values) continue;
        add("additions", values, change.additions); add("deletions", values, change.deletions);
        add("netLines", values, change.additions - change.deletions); add("files", values, change.files);
        const contributor = contributors.get(change.contributor);
        if (contributor) { contributor.additions = (contributor.additions || 0) + change.additions; contributor.deletions = (contributor.deletions || 0) + change.deletions; }
      }
    }
    if (snapshot.pulls) {
      for (const metric of ["prsOpened", "prsMerged", "prsClosed"] as const) enable(metric, snapshot.pulls.complete);
      for (const pull of snapshot.pulls.data) {
        if (!labelMatches(pull) || !personMatches(pull.user?.login)) continue;
        add("prsOpened", bucketFor(pull.created_at));
        if (pull.merged_at) add("prsMerged", bucketFor(pull.merged_at));
        else if (pull.closed_at) add("prsClosed", bucketFor(pull.closed_at));
      }
    }
  }
  // Only report cross-source net flow if every selected repo has both sources.
  if (data.length && data.every(snapshot => snapshot.issues && snapshot.events)) {
    enable("netIssues", complete.created === true && complete.closed === true && complete.reopened === true);
    for (const day of days) day.values.netIssues = (day.values.created || 0) + (day.values.reopened || 0) - (day.values.closed || 0);
  }
  // Hide combined metrics when any selected repository cannot supply that source.
  // Access is never presented as a zero or as a coverage warning.
  const requirements: Record<StatisticsMetric, StatisticsSourceName[]> = {
    created: ["issues"], closed: ["events"], reopened: ["events"], netIssues: ["issues", "events"], commits: ["commits"],
    additions: ["changes"], deletions: ["changes"], netLines: ["changes"], files: ["changes"], prsOpened: ["pulls"], prsMerged: ["pulls"], prsClosed: ["pulls"],
  };
  for (const metric of statisticsMetrics) if (complete[metric] !== undefined && data.some(snapshot => requirements[metric].some(source => !snapshot[source]))) {
    delete complete[metric];
    for (const day of days) delete day.values[metric];
  }
  const totals: StatisticsValues = {};
  for (const metric of statisticsMetrics) if (complete[metric] !== undefined) totals[metric] = days.reduce((sum, day) => sum + (day.values[metric] || 0), 0);
  closures.sort((a, b) => a - b);
  const middle = Math.floor(closures.length / 2);
  const closureAgeDays = closures.length ? (closures.length % 2 ? closures[middle]! : (closures[middle - 1]! + closures[middle]!) / 2) : null;
  return { days, totals, complete, closureAgeDays: totals.closed === undefined ? null : closureAgeDays, contributors: [...contributors.values()].sort((a, b) => b.commits - a.commits), labels: [...labels].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}
