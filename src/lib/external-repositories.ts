import type { Repo } from "./model";
import { publicRepositoryRecord } from "./public-workspace";
import { moveProject } from "./project-layout";

/** Other people's public repositories ("Andras publika projekt") are a separate, ordered group.
 * They are stored in the encrypted account settings under `externalRepositories`, in group order. */
export const MAX_EXTERNAL_REPOSITORIES = 50;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Verified public records from saved settings, without duplicates or repositories the account already lists. */
export function parseExternalRepositories(saved: unknown, own: readonly Repo[]): Repo[] {
  if (!Array.isArray(saved)) return [];
  const result: Repo[] = [];
  for (const entry of saved.slice(0, MAX_EXTERNAL_REPOSITORIES * 2)) {
    const repo = publicRepositoryRecord(entry);
    if (!repo || own.some(item => same(item.full_name, repo.full_name)) || result.some(item => same(item.full_name, repo.full_name))) continue;
    result.push(repo);
    if (result.length >= MAX_EXTERNAL_REPOSITORIES) break;
  }
  return result;
}

/** Own repositories first, then the external group; an own entry always wins over an external one. */
export function mergeExternalRepositories(base: readonly Repo[], external: readonly Repo[]): Repo[] {
  const names = new Set(external.map(repo => repo.full_name));
  const own = base.filter(repo => !names.has(repo.full_name));
  return [...own, ...external.filter(repo => !own.some(item => same(item.full_name, repo.full_name)))];
}

/** Lane order: own projects by `projectOrder`, then external ones by their own order. */
export function groupedLaneOrder(projectOrder: readonly string[], externalOrder: readonly string[], names: readonly string[]): string[] {
  const external = new Set(externalOrder);
  const own = names.filter(name => !external.has(name));
  const known = new Set(own);
  const ordered = [...new Set(projectOrder)].filter(name => known.has(name));
  const placed = new Set(ordered);
  const outer = externalOrder.filter(name => names.includes(name));
  return [...ordered, ...own.filter(name => !placed.has(name)).sort(), ...outer];
}

/** Reordering never moves a repository between groups. */
export function moveExternal(order: string[], source: string, target: string): string[] {
  return moveProject(order, source, target);
}
export function sameGroup(external: ReadonlySet<string>, a: string, b: string): boolean {
  return external.has(a) === external.has(b);
}
