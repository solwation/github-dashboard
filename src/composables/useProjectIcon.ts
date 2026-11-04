import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { Repo } from "../lib/model";
import { restoreProjectIcon } from "../lib/project-icon";
import { repositoryColor } from "../lib/repository-color";
const key: InjectionKey<ComputedRef<Map<string, { data: string | null; color: string }>>> = Symbol("project-icons");
export function provideProjectIcons(repositories: () => readonly Repo[], colors: () => Record<string, string>) {
  provide(key, computed(() => new Map(repositories().map(repo => [repo.full_name, { data: restoreProjectIcon(repo.projectIcon)?.data ?? null, color: repositoryColor(repo.full_name, colors()) }]))));
}
export function useProjectIcon(repository: () => string) {
  const icons = inject(key, undefined);
  return computed(() => icons?.value.get(repository()) ?? { data: null, color: repositoryColor(repository()) });
}
