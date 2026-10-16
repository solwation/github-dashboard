import type { Repo } from './model';

export const permissionDefinitions = [
  { id: 'metadata', name: 'Metadata', feature: 'Repositorynamn, beskrivning och grundinformation.' },
  { id: 'issues', name: 'Issues', feature: 'Issues, etiketter, kommentarer och tid i pågående arbete.' },
  { id: 'contents', name: 'Contents', feature: 'Commitdetaljer och tillagd eller borttagen kod.' },
  { id: 'pull_requests', name: 'Pull requests', feature: 'Information om sammanslagna pull requests och deras koppling till stängda issues.' },
] as const;
export type PermissionId = typeof permissionDefinitions[number]['id'];
export type PermissionStatus = 'granted' | 'missing' | 'unknown';
export type PermissionReason = 'private-access' | 'public-access' | 'denied' | 'unverified';
export interface PermissionResult { repo: string; status: PermissionStatus; reason: PermissionReason }
export interface PermissionEntry { permission: PermissionId; repositories: PermissionResult[] }
export type PermissionReport = PermissionEntry[];
export interface PermissionObservation { ok: boolean; permissionDenied: boolean; checkedAt: number }
export function permissionEndpoint(repo: string, permission: PermissionId) {
  const root = `/repos/${repo}`;
  return permission === 'metadata' ? root : `${root}/${permission === 'contents' ? 'commits' : permission === 'pull_requests' ? 'pulls' : 'issues'}?per_page=1`;
}
export function permissionForPath(path: string): { repo: string; permission: PermissionId } | null {
  const match = /^\/repos\/([\w.-]+\/[\w.-]+)(?:\/(issues|commits|pulls))?$/.exec(path);
  if (!match) return null;
  return { repo: match[1]!, permission: match[2] === 'issues' ? 'issues' : match[2] === 'commits' ? 'contents' : match[2] === 'pulls' ? 'pull_requests' : 'metadata' };
}
export function permissionResult(repo: Pick<Repo, 'full_name' | 'private'>, observation?: PermissionObservation): PermissionResult {
  if (observation?.permissionDenied) return { repo: repo.full_name, status: 'missing', reason: 'denied' };
  if (observation?.ok) return { repo: repo.full_name, status: repo.private ? 'granted' : 'unknown', reason: repo.private ? 'private-access' : 'public-access' };
  return { repo: repo.full_name, status: 'unknown', reason: 'unverified' };
}
export function missingPermissionCount(report: PermissionReport) {
  return new Set(report.filter(entry => entry.repositories.some(repo => repo.status === 'missing')).map(entry => entry.permission)).size;
}
