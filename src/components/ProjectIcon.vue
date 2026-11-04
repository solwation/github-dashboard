<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useProjectIcon } from "../composables/useProjectIcon";
const props = withDefaults(defineProps<{ repository: string; size?: 16 | 20; decorative?: boolean; sidebar?: boolean }>(), { size: 16, decorative: true });
const icon = useProjectIcon(() => props.repository);
const failed = ref(false);
watch(() => icon.value.data, () => { failed.value = false; });
const initials = computed(() => (props.repository.split("/").pop() || "?").slice(0, 2).toUpperCase());
</script>
<template>
  <span class="project-icon" :class="{ 'project-icon-large': size === 20, 'project-icon-sidebar': sidebar }" :style="{ '--project-icon-color': icon.color }" :title="repository" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : repository" :aria-hidden="decorative ? true : undefined" :data-repository="repository">
    <img v-if="icon.data && !failed" :src="icon.data" alt="" draggable="false" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else class="project-icon-initials">{{ initials }}</span>
    <span class="project-icon-color" />
  </span>
</template>
<style scoped>
.project-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 var(--icon-sm); width: var(--icon-sm); height: var(--icon-sm); min-width: var(--icon-sm); border: 1px solid var(--line); border-radius: var(--space-1); background: var(--hover); color: var(--text); vertical-align: middle; overflow: visible; }
.project-icon-large { flex-basis: var(--icon-md); width: var(--icon-md); min-width: var(--icon-md); height: var(--icon-md); }
.project-icon-sidebar { flex-basis: var(--sidebar-project-icon-size, 44px); width: var(--sidebar-project-icon-size, 44px); min-width: var(--sidebar-project-icon-size, 44px); height: var(--sidebar-project-icon-size, 44px); }
.project-icon-sidebar .project-icon-initials { font-size: 14px; }
.project-icon img { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: inherit; }
.project-icon-initials { font-size: 10px; font-weight: 700; line-height: 1; }
.project-icon-color { position: absolute; right: -1px; bottom: -1px; width: var(--space-2); height: var(--space-2); border: 1px solid var(--surface); border-radius: 50%; background: var(--project-icon-color); }
:global(:root[data-theme="dark"] .project-icon-color) { background: color-mix(in srgb, var(--project-icon-color) 75%, white); }
</style>
