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

export function repositoryDisplayName(repository: string, sharedOwner: string | null): string {
  const parts = repository.split('/');
  return sharedOwner !== null && parts.length === 2 && parts[0]!.toLowerCase() === sharedOwner && parts[1]
    ? parts[1] : repository;
}
