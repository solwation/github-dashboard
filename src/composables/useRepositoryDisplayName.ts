import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';
import { compactRepositoryOwner, repositoryDisplayName, type RepositoryOwnerDisplay } from '../lib/repository-display-name';
const key: InjectionKey<ComputedRef<{ owner: string | null; preference: RepositoryOwnerDisplay }>> = Symbol('repository-display-owner');

/** Use the complete selected workspace, independently of issue search or visibility. */
export function provideRepositoryDisplayNames(repositories: () => readonly string[], combined: () => boolean, preference?: () => RepositoryOwnerDisplay) {
  // Nested scopes (Statistics) keep their own shared-owner calculation and inherit the account choice.
  const parent = inject(key, undefined);
  const owner = computed(() => ({ owner: compactRepositoryOwner(repositories(), combined()), preference: preference?.() ?? parent?.value.preference ?? "auto" }));
  provide(key, owner);
}

export function useRepositoryDisplayName(repository: () => string | undefined) {
  const owner = inject(key, undefined);
  return computed(() => repositoryDisplayName(repository() ?? '', owner?.value.owner ?? null, owner?.value.preference ?? 'auto'));
}
