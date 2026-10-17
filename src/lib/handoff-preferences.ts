import { reconcileRepositoryColors, validRepositoryColor } from "./repository-color";
import { validColumnLimit } from "./column-limits";
import { reconcileOrder } from "./project-layout";
import { statisticsMetrics, type StatisticsMetric } from "./statistics";
import type { Rules } from "./model";

/**
 * Optical schema v2 transfers chosen preferences, never snapshots or local device state.
 * Missing fields preserve receiver choices; unknown fields are ignored for forward compatibility.
 * Read/activity versions stay receiver-local and account-bound.
 * Camera, notification/OS grants, audio unlock, caches, transient errors and expanded issue
 * details are device/session state. notificationRepos records desired subscriptions only.
 */
export interface HandoffStatisticsFilter {
  from: string;
  to: string;
  label: string;
  contributor: string;
  metric: StatisticsMetric;
}
export type HandoffStatisticsPreferences = Record<string, HandoffStatisticsFilter>;
export interface HandoffPreferences {
  repositoryColors?: Record<string, string>;
  projectOrder?: string[];
  collapsedRepos?: string[];
  columnLimit?: number;
  repositoryColumnLimits?: Record<string, number>;
  notificationRepos?: string[];
  language?: "auto" | "sv" | "en";
  query?: string;
  repositoryQueries?: Record<string, string>;
  repoQuery?: string;
  hideCoordination?: boolean;
  splitByRepository?: boolean;
  /** Split-view repositories shown as compact lists instead of cards (#127). */
  listRepos?: string[];
  /** The combined board's shared card/list choice (#127). */
  combinedList?: boolean;
  timeoutMinutes?: number;
  currentView?: "overview" | "statistics";
  statistics?: HandoffStatisticsPreferences;
}
export interface HandoffPreferenceState extends HandoffPreferences {
  selected: string[];
  rules: Record<string, Rules>;
}
export const handoffRepository = (value: unknown): value is string => typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value) && ![".", ".."].includes(value.split("/")[1]!);
export const handoffRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function handoffRepositoryList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(handoffRepository) &&
    new Set(value.map(repo => repo.toLowerCase())).size === value.length;
}
function text(value: unknown): value is string { return typeof value === "string" && value.length <= 500; }
function repoMap(value: unknown, valid: (value: unknown) => boolean): boolean {
  return handoffRecord(value) && Object.keys(value).length <= 100 &&
    new Set(Object.keys(value).map(repo => repo.toLowerCase())).size === Object.keys(value).length &&
    Object.entries(value).every(([repo, setting]) => handoffRepository(repo) && valid(setting));
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const validators: Record<keyof HandoffPreferences, (value: unknown) => boolean> = {
  repositoryColors: value => repoMap(value, validRepositoryColor),
  projectOrder: handoffRepositoryList, collapsedRepos: handoffRepositoryList,
  columnLimit: validColumnLimit, repositoryColumnLimits: value => repoMap(value, validColumnLimit),
  notificationRepos: handoffRepositoryList, language: value => ["auto", "sv", "en"].includes(value as string),
  query: text, repositoryQueries: value => repoMap(value, text), repoQuery: text,
  hideCoordination: value => typeof value === "boolean",
  splitByRepository: value => typeof value === "boolean",
  listRepos: handoffRepositoryList, combinedList: value => typeof value === "boolean",
  timeoutMinutes: value => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 10080,
  currentView: value => value === "overview" || value === "statistics",
  statistics: value => repoMap(value, filter => handoffRecord(filter) &&
    Object.keys(filter).every(key => ["from", "to", "label", "contributor", "metric"].includes(key)) &&
    validDate(filter.from) && validDate(filter.to) && filter.from <= filter.to &&
    text(filter.label) && text(filter.contributor) && statisticsMetrics.includes(filter.metric as StatisticsMetric)),
};

/** Validate every known field atomically, returning only supported preference keys. */
export function parseHandoffPreferences(value: unknown): HandoffPreferences {
  if (!handoffRecord(value)) throw new Error("Invalid handoff preferences");
  const supported: Record<string, unknown> = {};
  for (const [key, validate] of Object.entries(validators)) {
    if (!Object.hasOwn(value, key)) continue;
    if (!validate(value[key])) throw new Error("Invalid handoff preference");
    // Copy JSON data so application edits cannot mutate the decoded transfer.
    supported[key] = JSON.parse(JSON.stringify(value[key]));
  }
  return supported as HandoffPreferences;
}

/** Apply only readable repositories; canonicalize case to GitHub's actual repository names. */
export function mergeHandoffPreferences(
  current: HandoffPreferenceState,
  incoming: { selected: string[]; rules: Record<string, Rules>; preferences?: HandoffPreferences },
  accessibleNames: string[],
): HandoffPreferenceState {
  const accessible = new Map(accessibleNames.map(repo => [repo.toLowerCase(), repo]));
  const list = (names: string[]) => [...new Set(names.flatMap(name => accessible.get(name.toLowerCase()) || []))];
  const map = <T>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).flatMap(([repo, value]) => {
    const name = accessible.get(repo.toLowerCase());
    return name ? [[name, value]] : [];
  }));
  const merged: HandoffPreferenceState = {
    ...current, ...parseHandoffPreferences(incoming.preferences || {}),
    selected: list(incoming.selected), rules: map(incoming.rules),
  };
  if (merged.projectOrder) merged.projectOrder = reconcileOrder(list(merged.projectOrder), accessibleNames);
  for (const key of ["collapsedRepos", "notificationRepos", "listRepos"] as const) if (merged[key]) merged[key] = list(merged[key]);
  if (merged.repositoryColumnLimits) merged.repositoryColumnLimits = map(merged.repositoryColumnLimits);
  if (merged.repositoryQueries) merged.repositoryQueries = map(merged.repositoryQueries);
  if (merged.statistics) merged.statistics = map(merged.statistics);
  if (merged.repositoryColors) merged.repositoryColors = reconcileRepositoryColors(merged.selected, map(merged.repositoryColors));
  return merged;
}
