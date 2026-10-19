<script setup lang="ts">
import { Circle, CircleCheck, Clock3, Plus } from "@lucide/vue";
import RepositoryOrderControls from "./RepositoryOrderControls.vue";
import { repositoryColor } from "../lib/repository-color";
import { projectDragType } from "../lib/project-layout";
import { useLanguage } from "../lib/i18n";
import { recentlyChanged, RECENT_CHANGE_MS, type SidebarRepository } from "../lib/sidebar";
import { HOVER_DELAY_MS } from "../lib/adhoc-refresh";
import { onBeforeUnmount } from "vue";
import { useNow } from "../composables/useNow";

const props = defineProps<{ repos: SidebarRepository[]; repositoryColors?: Record<string, string>; canSelect: boolean; restoring?: boolean; statistics?: boolean }>();
// Re-check only when the newest unread marker expires.
const now = useNow(at => Math.min(...props.repos.map(repo => {
  const left = Date.parse((repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt) || "") + RECENT_CHANGE_MS - at;
  return left >= 0 ? left : Infinity;
})));
const emit = defineEmits<{ select: []; move: [name: string, direction: -1 | 1]; reorder: [source: string, target: string]; interest: [name: string] }>();
// Interest in a repository (#187): click and focus act at once, hover after a short rest.
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
function hoverStart(name: string) { hoverEnd(); hoverTimer = setTimeout(() => emit('interest', name), HOVER_DELAY_MS); }
function hoverEnd() { clearTimeout(hoverTimer); hoverTimer = undefined; }
onBeforeUnmount(hoverEnd);
function drop(event: DragEvent, target: string) {
  const source = event.dataTransfer?.getData(projectDragType);
  if (source) emit("reorder", source, target);
}
const { t, locale } = useLanguage();
function revealRepository(id: number) {
  const controls = document.getElementById('repo-' + id)?.closest("details");
  if (controls) controls.open = true;
}
function lastChange(changedAt: string | null) {
  return changedAt
    ? t("Senaste ändring: {time}", {
        time: new Date(changedAt).toLocaleString(locale.value, { dateStyle: "full", timeStyle: "long" }),
      })
    : t("Ingen registrerad aktivitet");
}
</script>
<template>
  <div class="sidebar-projects" :aria-busy="restoring || undefined">
    <div class="repositories-heading"><span class="nav-caption">REPOSITORIES</span>
    <button v-if="canSelect" class="sidebar-add" @click="emit('select')" :aria-label="t('Välj repositories')">
      <Plus :size="16" />
    </button>
    </div>
    <div v-for="(repo, index) in repos" :key="repo.id" class="sidebar-repository-row" :data-repository="repo.fullName" @dragover.prevent @drop.prevent="drop($event, repo.fullName)">
    <RepositoryOrderControls :name="repo.name" :full-name="repo.fullName" :index="index" :total="repos.length" @move="emit('move', repo.fullName, $event)" @reorder="(source, target) => emit('reorder', source, target)" />
    <a class="repo-nav sidebar-repository" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="!statistics && revealRepository(repo.id); emit('interest', repo.fullName)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.loading ? t('Hämtar…') : lastChange(repo.changedAt)" :aria-busy="repo.loading || undefined">
      <span class="repository-name">
        <span class="repo-dot" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" aria-hidden="true" />
        <span class="repository-label">{{ repo.name }}</span>
        <span v-if="recentlyChanged(repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt, now)" class="recent-activity" :title="t('Oläst aktivitet')" role="img" :aria-label="t('Oläst aktivitet')" />
      </span>
      <span v-if="repo.loading" class="repository-counts">{{ t("Hämtar…") }}</span>
      <span v-else-if="!repo.unavailable" class="repository-counts">
        <span class="status-count backlog" :title="t('Backlog: {count}', { count: repo.backlog })"><Circle :size="11" aria-hidden="true" /><span class="sr-only">Backlog: </span>{{ repo.backlog }}</span>
        <span class="status-count progress" :title="t('Pågående: {count}', { count: repo.progress })"><Clock3 :size="11" aria-hidden="true" /><span class="sr-only">{{ t('Pågående') }}: </span>{{ repo.progress }}</span>
        <span class="status-count closed" :title="t('Stängda senaste 30 dagarna: {count}', { count: repo.closed })"><CircleCheck :size="11" aria-hidden="true" /><span class="sr-only">{{ t('Stängda senaste 30 dagarna') }}: </span>{{ repo.closed }}</span>
      </span>
      <time v-if="repo.changedAt" class="sr-only" :datetime="repo.changedAt">{{ lastChange(repo.changedAt) }}</time>
    </a>
    </div>
    <div v-if="restoring && !repos.length" class="sidebar-placeholder" aria-hidden="true"><span /><span /><span /></div>
    <p v-else-if="!repos.length" class="sidebar-empty">{{ t("Dina projekt börjar här.") }}</p>
  </div>
</template>
<style scoped>
.sidebar-placeholder { display: grid; gap: 16px; padding: 18px 0; }
.sidebar-placeholder span { height: 24px; width: 80%; border-radius: 4px; background: currentColor; opacity: .06; }
.sidebar-placeholder span:nth-child(2) { width: 65%; }
.sidebar-projects { min-height: 0; overflow-y: auto; }
.sidebar-repository-row { display: flex; align-items: flex-start; gap: 4px; margin-top: 14px; min-width: 0; }
.sidebar-repository {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  margin-top: 0;
  padding-right: 5px;
  border-radius: 4px;
}
.sidebar-repository:focus-visible { outline: 2px solid var(--green); outline-offset: 5px; }
.repo-dot { width: 11px; height: 11px; box-shadow: none; background-color: var(--repository-color); }
.repository-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.repository-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.repository-counts { display: flex; flex-wrap: wrap; gap: 11px; padding-left: 19px; font-size: 10px; font-variant-numeric: tabular-nums; }
.status-count { display: inline-flex; align-items: center; gap: 4px; }
.backlog { color: #61727b; }
.progress { color: #916010; }
.closed { color: #287c66; }
.recent-activity { flex-shrink: 0; margin-left: auto; width: 5px; height: 5px; border-radius: 50%; background: #25866a; box-shadow: 0 0 0 3px #25866a14; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
