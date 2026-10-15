import { t } from "./i18n";
export interface Label {
  name: string;
  color: string;
}
export interface Issue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: Label[];
  assignees: { login: string; avatar_url: string }[];
  pull_request?: unknown;
  startedAt?: string | null;
  timerError?: boolean;
}
export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  owner: { login: string };
  language?: string | null;
}
export interface Lane {
  repo: Repo;
  issues: Issue[];
  labels: Label[];
  error?: string;
  timerWarning?: boolean;
}
export interface Rules {
  progress?: string;
  high?: string;
  medium?: string;
  low?: string;
}
export interface Event {
  id: number;
  event: string;
  created_at: string;
  label?: { name: string };
}
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[\s_:-]+/g, " ");
export function isProgress(label: string, rules: Rules = {}) {
  return rules.progress
    ? label.toLowerCase() === rules.progress.toLowerCase().trim()
    : [
        "in progress",
        "status in progress",
        "wip",
        "working",
        "doing",
        "pågår",
      ].includes(normalize(label));
}
export function priority(issue: Issue, rules: Rules = {}): number {
  const names = issue.labels.map((l) => normalize(l.name));
  for (const [rank, level] of ["high", "medium", "low"].entries()) {
    if (
      rules[level as keyof Rules] &&
      names.includes(normalize(rules[level as keyof Rules]!))
    )
      return rank;
  }
  if (
    names.some(
      (n) =>
        /^(priority )?(critical|urgent|high)( priority)?$/.test(n) ||
        /^(p0|p1|priority p0|priority p1)$/.test(n),
    )
  )
    return 0;
  if (
    names.some(
      (n) =>
        /^(priority )?medium( priority)?$/.test(n) ||
        n === "p2" ||
        n === "priority p2",
    )
  )
    return 1;
  if (
    names.some(
      (n) =>
        /^(priority )?low( priority)?$/.test(n) ||
        ["p3", "p4", "priority p3", "priority p4", "reviewer filed"].includes(
          n,
        ),
    )
  )
    return 2;
  return 1;
}
export function isCoordination(issue: Issue) {
  return issue.labels.some((l) =>
    ["agent coordination", "orkester"].includes(normalize(l.name)),
  );
}
export function column(issue: Issue, rules: Rules = {}) {
  return issue.state === "closed"
    ? "closed"
    : issue.labels.some((l) => isProgress(l.name, rules))
      ? "progress"
      : "backlog";
}
export function sortedIssues(issues: Issue[], col: string, rules: Rules = {}) {
  return issues
    .filter((i) => !i.pull_request && column(i, rules) === col)
    .sort((a, b) =>
      col === "closed"
        ? Date.parse(b.closed_at!) - Date.parse(a.closed_at!)
        : col === "backlog"
          ? priority(a, rules) - priority(b, rules) ||
            Date.parse(a.created_at) - Date.parse(b.created_at)
          : Date.parse(a.startedAt || a.created_at) -
            Date.parse(b.startedAt || b.created_at),
    );
}
export function progressStart(
  events: Event[],
  rules: Rules = {},
): string | null {
  const active = new Map<string, string>();
  for (const e of [...events].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
  )) {
    if (e.event === "closed" || e.event === "reopened") active.clear();
    if (!e.label || !isProgress(e.label.name, rules)) continue;
    if (e.event === "labeled") active.set(e.label.name, e.created_at);
    if (e.event === "unlabeled") active.delete(e.label.name);
  }
  return [...active.values()].sort()[0] || null;
}
export function duration(start: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days}d ${hours}h ${minutes}m`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m ${seconds % 60}s`;
}
export function workflow(labels: Label[]) {
  return labels.some((l) => normalize(l.name).startsWith("priority "))
    ? t("Prioritetslabels")
    : labels.some((l) => normalize(l.name) === "reviewer filed")
      ? t("Agentflöde")
      : labels.some((l) => /^p[0-4]$/.test(normalize(l.name)))
        ? "P0–P4"
        : t("Standardflöde");
}
