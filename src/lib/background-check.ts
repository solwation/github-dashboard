/**
 * Periodic background check run by the service worker (#130). Pure comparison and notification
 * logic plus an orchestrator with injected storage, GitHub and notification access, so it can be
 * tested without a service worker. Token, settings and the last seen state are only read from
 * and written to the encrypted IndexedDB stores; nothing private enters caches or plaintext.
 */
import { issueNavigationHash } from "./issue-navigation";
import { matchesIssueFilters } from "./issue-filter";
import { column, isCoordination, type Issue, type Label, type Lane, type Repo, type Rules } from "./model";
import { normalizeTimeoutSettings, TimeoutTracker, timeoutBases, timeoutDetail, type TimeoutSettings } from "./timeouts";
import { setLanguage, t, type LanguagePreference } from "./i18n";
import type { GitHub } from "./github";

/** Same value as BACKGROUND_CHECK_TAG in background-sync.ts (#129); defined here so the
 * service-worker bundle does not depend on the app-side registration module. */
export const BACKGROUND_CHECK_TAG = "issueflow-check";
/** A stored anchor older than this gets a full lane load, so the `since` list stays small. */
export const FULL_RELOAD_MS = 24 * 60 * 60 * 1000;
/** Only state this fresh is compared; older state is a silent new baseline (no stale notices). */
export const COMPARABLE_MS = FULL_RELOAD_MS;
export const MAX_WATCHED_REPOS = 20;
export const MAX_NOTIFICATIONS_PER_CHECK = 10;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

export interface StoredRepo {
  repo: Repo;
  /** Fixed `since` anchor for conditional list requests, as in GitHub.syncLane (#123). */
  since: number;
  checkedAt: number;
  rules: string;
  timeoutSettings?: TimeoutSettings;
  timeoutCalibrationKey?: string;
  labels: Label[];
  issues: Issue[];
}
export interface BackgroundState {
  version: 1;
  login: string;
  repos: Record<string, StoredRepo>;
  responses: unknown[];
}
export type NoticeKind = "closed" | "progress" | "backlog" | "reopened" | "timeout";
export interface BackgroundNotice { detail?: string; kind: NoticeKind; repo: Repo; issue: Issue }
export interface WatchSettings {
  repos: string[];
  rules: Record<string, Rules>;
  timeoutEnabled: boolean;
  timeoutOverrunPercent: number;
  query: string;
  repositoryQueries: Record<string, string>;
  splitByRepository: boolean;
  hideCoordination: boolean;
  language: LanguagePreference;
}
export interface NotificationRequest {
  title: string;
  options: { body: string; tag: string; icon: string; data: { app: string; url: string } };
}

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
export const rulesKey = (rules: Rules = {}) =>
  JSON.stringify(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));

/** Watched repositories are those selected on the board with notifications switched on. */
export function watchSettings(saved: unknown): WatchSettings {
  const value = isRecord(saved) ? saved : {};
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  const names = (list: unknown) => Array.isArray(list) ? list.filter((name): name is string => typeof name === "string" && REPO_NAME.test(name)) : [];
  const selected = new Set(names(value.selected));
  const notify = names(preferences.notificationRepos ?? value.notificationRepos);
  const rules = isRecord(value.rules) ? value.rules as Record<string, Rules> : {};
  const language = preferences.language === "sv" || preferences.language === "en" ? preferences.language : "auto";
  return {
    repos: [...new Set(notify.filter(name => selected.has(name)))].slice(0, MAX_WATCHED_REPOS),
    rules,
    ...normalizeTimeoutSettings({ ...value, ...preferences }),
    query: typeof preferences.query === "string" ? preferences.query.slice(0, 500) : "",
    repositoryQueries: isRecord(preferences.repositoryQueries) ? Object.fromEntries(Object.entries(preferences.repositoryQueries).filter((entry): entry is [string, string] => REPO_NAME.test(entry[0]) && typeof entry[1] === "string").map(([name, query]) => [name, query.slice(0, 500)])) : {},
    splitByRepository: preferences.splitByRepository !== false,
    hideCoordination: typeof preferences.hideCoordination === "boolean" ? preferences.hideCoordination : true,
    language,
  };
}

/** Preserve bounded sizing/history inputs in the encrypted state so calibration matches the board. */
export function compactIssue(issue: Issue): Issue {
  return {
    id: issue.id, number: issue.number, title: issue.title, html_url: issue.html_url, state: issue.state,
    created_at: issue.created_at, updated_at: issue.updated_at, closed_at: issue.closed_at,
    labels: (issue.labels ?? []).map(label => ({ name: label.name, color: label.color })), assignees: [],
    body: issue.body?.slice(0, 65536) ?? null,
    ...(issue.workStartedAt ? { workStartedAt: issue.workStartedAt } : {}),
    ...(issue.pull_request ? { pull_request: {} } : {}),
    ...(issue.startedAt !== undefined ? { startedAt: issue.startedAt } : {}),
    ...(issue.timerError !== undefined ? { timerError: issue.timerError } : {}),
  };
}
function compactRepo(repo: Repo): Repo {
  return { id: repo.id, name: repo.name, full_name: repo.full_name, description: null, private: repo.private, html_url: repo.html_url, owner: { login: repo.owner?.login ?? repo.full_name.split("/")[0]! } };
}

export function parseState(value: unknown, login: string): BackgroundState | null {
  if (!isRecord(value) || value.version !== 1 || value.login !== login || !isRecord(value.repos)) return null;
  const repos: Record<string, StoredRepo> = {};
  for (const [name, entry] of Object.entries(value.repos)) {
    if (!REPO_NAME.test(name) || !isRecord(entry) || !isRecord(entry.repo) || entry.repo.full_name !== name ||
      !Number.isSafeInteger(entry.repo.id) || !Number.isFinite(entry.since) || !Number.isFinite(entry.checkedAt) ||
      typeof entry.rules !== "string" || !Array.isArray(entry.labels) || !Array.isArray(entry.issues) || entry.issues.length > 5000) continue;
    repos[name] = entry as StoredRepo;
  }
  return { version: 1, login, repos, responses: Array.isArray(value.responses) ? value.responses : [] };
}

/** Status changes between the previous and current snapshot of one repository. */
export function statusNotices(previous: StoredRepo, current: Lane, rules: Rules = {}, hideCoordination = true): BackgroundNotice[] {
  const before = new Map(previous.issues.map(issue => [issue.id, issue]));
  const notices: BackgroundNotice[] = [];
  for (const issue of current.issues) {
    if (issue.pull_request || (hideCoordination && isCoordination(issue))) continue;
    const old = before.get(issue.id);
    const next = column(issue, rules);
    if (!old) {
      // Unknown issues only matter when they closed after the previous check, like ClosureTracker.
      if (next === "closed" && issue.closed_at && Date.parse(issue.closed_at) > previous.checkedAt)
        notices.push({ kind: "closed", repo: current.repo, issue });
      continue;
    }
    const was = column(old, rules);
    if (next === "closed") {
      if (was !== "closed" || old.closed_at !== issue.closed_at) notices.push({ kind: "closed", repo: current.repo, issue });
    } else if (was === "closed") notices.push({ kind: "reopened", repo: current.repo, issue });
    else if (was !== "progress" && next === "progress") notices.push({ kind: "progress", repo: current.repo, issue });
    else if (was === "progress" && next === "backlog") notices.push({ kind: "backlog", repo: current.repo, issue });
  }
  return notices;
}

/** Work periods that crossed the timeout threshold since the previous check, reusing TimeoutTracker. */
export function timeoutNotices(previous: StoredRepo, current: Lane, rules: Rules, settings: TimeoutSettings, now: number, hideCoordination = true, calibrationIssues = current.issues): BackgroundNotice[] {
  if (!settings.timeoutEnabled || !previous.timeoutSettings || JSON.stringify(previous.timeoutSettings) !== JSON.stringify(settings)) return [];
  const tracker = new TimeoutTracker();
  const name = current.repo.full_name;
  const bases = timeoutBases([{ ...current, issues: calibrationIssues.filter(issue => !hideCoordination || !isCoordination(issue)) }], { [name]: rules }, now);
  // Periods already over the threshold at the previous check were notified then (or predate it).
  tracker.scan([{ repo: current.repo, issues: previous.issues, labels: [] }], { [name]: rules }, settings, previous.checkedAt, { notify: false, bases });
  return tracker.scan([current], { [name]: rules }, settings, now, { bases }).newlyTimedOut
    .filter(entry => !(hideCoordination && isCoordination(entry.issue)))
    .map(entry => ({ kind: "timeout", repo: current.repo, issue: entry.issue, detail: timeoutDetail(entry.issue, entry.estimatedMs, settings.timeoutOverrunPercent, now) }));
}

/** Tags match the open app's notifications (closureKey / notifyTimeout), so one replaces the other. */
export function notificationTag({ kind, repo, issue }: BackgroundNotice): string {
  if (kind === "closed") return `${repo.full_name}:${issue.id}:${issue.closed_at}`;
  if (kind === "timeout") return `timeout:${repo.full_name}:${issue.id}:${issue.startedAt}`;
  return `${kind}:${repo.full_name}:${issue.id}:${issue.updated_at}`;
}
const descriptions: Record<NoticeKind, string> = {
  closed: "Issue stängd",
  timeout: "Estimatet för pågående arbete har överskridits",
  progress: "Issue påbörjad",
  backlog: "Issue tillbaka i backlog",
  reopened: "Issue återöppnad",
};
export function notificationFor(notice: BackgroundNotice, root: string): NotificationRequest {
  return {
    title: `${notice.repo.name} · ${t(descriptions[notice.kind])}`,
    options: {
      body: `#${notice.issue.number} ${notice.issue.title}${notice.detail ? "\n" + notice.detail : ""}`,
      tag: notificationTag(notice),
      icon: new URL("favicon.svg", root).href,
      // The click opens or focuses the app and highlights the issue on its board (#278).
      data: { app: new URL("./" + issueNavigationHash({ repoId: notice.repo.id, number: notice.issue.number }), root).href, url: notice.issue.html_url },
    },
  };
}

/** The open, visible app notifies on its own; the worker then only refreshes its baseline. */
export async function appVisible(clients: { matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<ReadonlyArray<{ visibilityState?: string }>> }): Promise<boolean> {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some(client => client.visibilityState === "visible");
}

const SINCE_LIST = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/issues\?state=all&.*since=/;
/** Keeps only reusable ETags (the `since` lists and /user), without issue bodies. */
export function storedResponses(responses: ReturnType<GitHub["exportResponses"]>): unknown[] {
  return responses
    .filter(([url]) => url === "https://api.github.com/user" || SINCE_LIST.test(url))
    .map(([url, response]) => [url, {
      etag: response.etag, next: response.next,
      data: Array.isArray(response.data) ? (response.data as Issue[]).map(item => item?.pull_request ? { id: item.id, pull_request: true } : compactIssue(item)) : response.data,
    }]);
}

export type BackgroundApi = Pick<GitHub, "user" | "request" | "lane" | "syncLane" | "exportResponses" | "restoreResponses" | "retryAfterMs">;
export interface BackgroundDependencies {
  permission(): string;
  loadToken(): Promise<string | null>;
  loadState(token: string): Promise<unknown>;
  saveState(token: string, state: BackgroundState): Promise<void>;
  loadSettings(login: string): Promise<unknown>;
  api(token: string): BackgroundApi;
  appVisible(): Promise<boolean>;
  /** True when a notification with this tag is already displayed. */
  existing(tag: string): Promise<boolean>;
  show(request: NotificationRequest): Promise<void>;
  root: string;
  now(): number;
}

/** Runs one check; resolves with the number of notifications shown and never rejects. */
export async function runBackgroundCheck(deps: BackgroundDependencies): Promise<number> {
  try {
    if (deps.permission() !== "granted") return 0;
    const token = await deps.loadToken();
    if (!token) return 0; // Logged out.
    const api = deps.api(token);
    const saved = await deps.loadState(token);
    if (isRecord(saved) && Array.isArray(saved.responses)) api.restoreResponses(saved.responses);
    const { login } = await api.user();
    if (typeof login !== "string" || !login) return 0;
    const previous = parseState(saved, login);
    const settings = watchSettings(await deps.loadSettings(login));
    setLanguage(settings.language);
    const next: BackgroundState = { version: 1, login, repos: {}, responses: [] };
    const notices: BackgroundNotice[] = [];
    for (const name of settings.repos) {
      const prev = previous?.repos[name];
      if (api.retryAfterMs()) { if (prev) next.repos[name] = prev; continue; }
      const rules = settings.rules[name] ?? {};
      const started = deps.now();
      const repositoryQuery = settings.splitByRepository ? settings.repositoryQueries[name] ?? "" : "";
      const timeoutCalibrationKey = JSON.stringify([settings.query, repositoryQuery, settings.hideCoordination]);
      try {
        const repo = prev?.repo ?? compactRepo((await api.request<Repo>(`/repos/${name}`, { store: false })).data);
        const full = !prev || started - prev.since >= FULL_RELOAD_MS || started - prev.checkedAt >= FULL_RELOAD_MS;
        const lane = full
          ? await api.lane(repo, rules)
          : await api.syncLane({ repo, issues: prev.issues, labels: prev.labels }, rules, prev.since, { labels: false });
        const current: Lane = { ...lane, repo };
        if (prev && prev.rules === rulesKey(rules) && started - prev.checkedAt < COMPARABLE_MS && started >= prev.checkedAt)
          notices.push(...statusNotices(prev, current, rules, settings.hideCoordination),
            ...(prev.timeoutCalibrationKey === timeoutCalibrationKey ? timeoutNotices(prev, current, rules, { timeoutEnabled: settings.timeoutEnabled, timeoutOverrunPercent: settings.timeoutOverrunPercent }, started, settings.hideCoordination, current.issues.filter(issue => matchesIssueFilters(issue, settings.query, repositoryQuery))) : []));
        next.repos[name] = {
          repo, since: full ? started : prev.since, checkedAt: started, rules: rulesKey(rules),
          timeoutCalibrationKey,
          timeoutSettings: { timeoutEnabled: settings.timeoutEnabled, timeoutOverrunPercent: settings.timeoutOverrunPercent },
          labels: lane.labels.map(label => ({ name: label.name, color: label.color })),
          issues: lane.issues.filter(issue => !issue.pull_request).map(compactIssue),
        };
      } catch {
        if (prev) next.repos[name] = prev; // An unavailable repository keeps its previous baseline.
      }
    }
    next.responses = storedResponses(api.exportResponses());
    // Save before notifying: if the state cannot be stored, notifying would repeat on every check.
    await deps.saveState(token, next);
    if (!notices.length || await deps.appVisible()) return 0;
    let shown = 0;
    for (const notice of notices.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) {
      const request = notificationFor(notice, deps.root);
      try {
        if (await deps.existing(request.options.tag)) continue;
        await deps.show(request);
        shown++;
      } catch { /* One failing notification must not stop the check. */ }
    }
    return shown;
  } catch {
    return 0; // Background checks fail silently; the app reports errors when opened.
  }
}
