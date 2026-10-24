<script setup lang="ts">
import { Circle, CircleCheck, Clock3, Globe, Lock, Plus, SquareArrowOutUpRight } from "@lucide/vue";
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
const emit = defineEmits<{ select: []; move: [name: string, direction: -1 | 1]; reorder: [source: string, target: string]; interest: [name: string]; activate: [name: string] }>();
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
function activateRepository(event: MouseEvent, repo: SidebarRepository) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit("activate", repo.fullName);
  emit("interest", repo.fullName);
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
    <div class="repo-body">
    <a class="repo-nav sidebar-repository" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.loading ? t('Hämtar…') : lastChange(repo.changedAt)" :aria-busy="repo.loading || undefined">
      <span class="repo-dot" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" aria-hidden="true" />
      <span class="repository-label">{{ repo.name }}</span>
      <!-- Fixed trailing slots (#295): unread · visibility · Pages. An absent icon leaves its slot empty so columns align across rows. -->
      <span class="repo-slots">
        <span class="repo-slot">
          <span v-if="recentlyChanged(repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt, now)" class="recent-activity" :title="t('Oläst aktivitet')" role="img" :aria-label="t('Oläst aktivitet')" />
        </span>
        <span class="repo-slot">
          <span v-if="repo.private !== undefined" class="repo-visibility" :class="repo.private ? 'is-private' : 'is-public'" role="img" :title="repo.private ? t('Privat repository') : t('Publikt repository')" :aria-label="repo.private ? t('Privat repository') : t('Publikt repository')"><component :is="repo.private ? Lock : Globe" aria-hidden="true" /></span>
        </span>
        <span class="repo-slot" aria-hidden="true" />
      </span>
      <span v-if="repo.loading" class="repository-counts">{{ t("Hämtar…") }}</span>
      <span v-else-if="!repo.unavailable" class="repository-counts">
        <span class="status-count backlog" :title="t('Backlog: {count}', { count: repo.backlog })"><Circle aria-hidden="true" /><span class="sr-only">Backlog: </span>{{ repo.backlog }}</span>
        <span class="status-count progress" :title="t('Pågående: {count}', { count: repo.progress })"><Clock3 aria-hidden="true" /><span class="sr-only">{{ t('Pågående') }}: </span>{{ repo.progress }}</span>
        <span class="status-count closed" :title="t('Stängda senaste 30 dagarna: {count}', { count: repo.closed })"><CircleCheck aria-hidden="true" /><span class="sr-only">{{ t('Stängda senaste 30 dagarna') }}: </span>{{ repo.closed }}</span>
      </span>
      <time v-if="repo.changedAt" class="sr-only" :datetime="repo.changedAt">{{ lastChange(repo.changedAt) }}</time>
    </a>
    <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
    </div>
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
/* Row grid (#295): [dot] [name] [slot slot slot] on the name line; counts sit under the name text.
   All row icons share one glyph size and stroke; slots have one fixed width and one right edge. */
.sidebar-repository-row { --row-line: var(--space-5); --slot: var(--icon-sm); --row-pad-end: var(--space-2); display: flex; align-items: flex-start; gap: var(--space-1); margin-top: var(--space-3); min-width: 0; }
.repo-body { position: relative; flex: 1; min-width: 0; display: flex; }
.sidebar-repository {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: var(--space-2) minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  row-gap: var(--space-1);
  align-items: center;
  margin-top: 0;
  padding: var(--space-1) var(--row-pad-end) var(--space-1) var(--space-2);
  border-radius: 4px;
}
.sidebar-repository:focus-visible { outline: 2px solid var(--green); outline-offset: 5px; }
.repo-body svg { width: var(--icon-xs); height: var(--icon-xs); stroke-width: 2; flex-shrink: 0; }
.repo-dot { width: var(--space-2); height: var(--space-2); box-shadow: none; background-color: var(--repository-color); }
.repository-label { min-width: 0; line-height: var(--row-line); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.repo-slots { display: grid; grid-template-columns: repeat(3, var(--slot)); height: var(--row-line); }
.repo-slot { display: grid; place-items: center; }
/* Three equal tracks keep backlog, progress and closed in columns across rows; a track only grows for unusually long numbers. */
.repository-counts { grid-column: 2 / -1; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--space-1); min-width: 0; white-space: nowrap; font-size: 10px; line-height: var(--space-4); font-variant-numeric: tabular-nums; }
.status-count { display: inline-flex; align-items: center; gap: var(--space-1); }
.backlog { color: var(--status-backlog); }
.progress { color: var(--status-progress); }
.closed { color: var(--status-closed); }
.repo-visibility { display: grid; place-items: center; color: var(--muted); }
/* Public is the common case: keep it quiet; private stays at full muted strength. Both keep tooltip + label. */
.repo-visibility.is-public { opacity: .45; }
.repo-pages { position: absolute; right: var(--row-pad-end); top: var(--space-1); display: grid; place-items: center; width: var(--slot); height: var(--row-line); border-radius: 4px; color: var(--muted); }
.repo-pages:hover { color: var(--green); }
.repo-pages:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.recent-activity { width: 6px; height: 6px; border-radius: 50%; background: var(--unread); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
