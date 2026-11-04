export type RepositoryOwnerDisplay = "auto" | "yes" | "no";
export function validRepositoryOwnerDisplay(value: unknown): value is RepositoryOwnerDisplay {
  return value === "auto" || value === "yes" || value === "no";
}
/** Older account records retain the existing automatic presentation. */
export function normalizeRepositoryOwnerDisplay(value: unknown): RepositoryOwnerDisplay {
  return validRepositoryOwnerDisplay(value) ? value : "auto";
}

/** A shared owner is a presentation choice; repository IDs remain canonical everywhere else. */
export function compactRepositoryOwner(repositories: readonly string[], combined: boolean): string | null {
  if (!combined || !repositories.length) return null;
  let owner: string | null = null;
  for (const repository of repositories) {
    const parts = repository.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const candidate = parts[0].toLowerCase();
    if (owner !== null && owner !== candidate) return null;
    owner = candidate;
  }
  return owner;
}

export function repositoryDisplayName(repository: string, sharedOwner: string | null, preference: RepositoryOwnerDisplay = "auto"): string {
  const parts = repository.split('/');
  return preference !== "yes" && parts.length === 2 && parts[0] && parts[1] &&
    (preference === "no" || (sharedOwner !== null && parts[0].toLowerCase() === sharedOwner))
    ? parts[1] : repository;
}

/** Sidebar uses all its repositories, independently of board filtering and layout. */
export function sidebarRepositoryDisplayName(repository: string, repositories: readonly string[], preference: RepositoryOwnerDisplay): string {
  return repositoryDisplayName(repository, compactRepositoryOwner(repositories, true), preference);
}
