import { permissionDefinitions, type PermissionId, type PermissionReport } from "./permissions";

const MAX_ACKNOWLEDGEMENTS = 2000;
export function permissionProblemKey(permission: PermissionId, repository: string): string {
  return `${permission}:${repository.toLowerCase()}`;
}
function validProblemKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [permission, repository, extra] = value.split(":");
  return extra === undefined && permissionDefinitions.some(entry => entry.id === permission) &&
    typeof repository === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) &&
    ![".", ".."].includes(repository.split("/")[1]!);
}
/** Account-local notice history, never a credential or a transferable chosen preference. */
export function restorePermissionAcknowledgements(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ACKNOWLEDGEMENTS) return [];
  return [...new Set(value.filter(validProblemKey).map(key => key.toLowerCase()))];
}
/** Unknown access and omitted repositories must not revive already viewed notices. */
export function reconcilePermissionAcknowledgements(value: unknown, report: PermissionReport, viewed = false): string[] {
  const seen = new Set(restorePermissionAcknowledgements(value));
  for (const entry of report) for (const repository of entry.repositories) {
    const key = permissionProblemKey(entry.permission, repository.repo);
    if (repository.status === "granted" || repository.reason === "public-access") seen.delete(key);
    else if (viewed && repository.status === "missing" && validProblemKey(key)) {
      // Keep recent observations when the bounded account history fills up.
      seen.delete(key);
      seen.add(key);
    }
  }
  return [...seen].slice(-MAX_ACKNOWLEDGEMENTS);
}
