import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';
import { compactRepositoryOwner, repositoryDisplayName } from '../lib/repository-display-name';
const key: InjectionKey<ComputedRef<string | null>> = Symbol('repository-display-owner');

/** Use the complete selected workspace, independently of issue search or visibility. */
export function provideRepositoryDisplayNames(repositories: () => readonly string[], combined: () => boolean) {
  const owner = computed(() => compactRepositoryOwner(repositories(), combined()));
  provide(key, owner);
}

export function useRepositoryDisplayName(repository: () => string | undefined) {
  const owner = inject(key, undefined);
  return computed(() => repositoryDisplayName(repository() ?? '', owner?.value ?? null));
}
