<script setup lang="ts">
import { ChevronDown, ChevronRight, Circle, CircleCheck, Clock3, Globe, Lock, Plus, SquareArrowOutUpRight } from "@lucide/vue";
import { repositoryColor } from "../lib/repository-color";
import { useLanguage } from "../lib/i18n";
import { isInactiveRepository, recentlyChanged, RECENT_CHANGE_MS, type SidebarRepository } from "../lib/sidebar";
import { HOVER_DELAY_MS } from "../lib/adhoc-refresh";
import { computed, onBeforeUnmount, ref } from "vue";
import { useNow } from "../composables/useNow";

const props = withDefaults(
  defineProps<{
    repos: SidebarRepository[];
    repositoryColors?: Record<string, string>;
    selectedRepository?: string | null;
    canSelect: boolean;
    restoring?: boolean;
    statistics?: boolean;
    showInactive?: boolean;
  }>(),
  {
    showInactive: false,
  },
);
// Re-check only when the newest unread marker expires.
const now = useNow(at => Math.min(...props.repos.map(repo => {
  const left = Date.parse((repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt) || "") + RECENT_CHANGE_MS - at;
  return left >= 0 ? left : Infinity;
})));
const emit = defineEmits<{
  select: [];
  interest: [name: string];
  activate: [name: string];
  "update:showInactive": [value: boolean];
}>();
const localShowInactive = ref(false);
const showInactive = computed({
  get: () => props.showInactive ?? localShowInactive.value,
  set: (val: boolean) => {
    localShowInactive.value = val;
    emit("update:showInactive", val);
  },
});
function toggleInactive() {
  showInactive.value = !showInactive.value;
}
const activeRepos = computed(() => props.repos.filter(repo => !isInactiveRepository(repo)));
const inactiveRepos = computed(() => props.repos.filter(repo => isInactiveRepository(repo)));
// Interest in a repository (#187): click and focus act at once, hover after a short rest.
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
function hoverStart(name: string) { hoverEnd(); hoverTimer = setTimeout(() => emit('interest', name), HOVER_DELAY_MS); }
function hoverEnd() { clearTimeout(hoverTimer); hoverTimer = undefined; }
onBeforeUnmount(hoverEnd);
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
    <!-- Deliberate uppercase section caption (#315) -->
    <div class="repositories-heading"><span class="nav-caption">REPOSITORIES</span>
    <button v-if="canSelect" class="sidebar-add" @click="emit('select')" :aria-label="t('Välj repositories')" :title="t('Välj repositories')">
      <Plus :size="16" />
    </button>
    </div>
    <div v-for="repo in activeRepos" :key="repo.id" class="sidebar-repository-row" :class="{ 'has-wide-counts': Math.max(repo.backlog, repo.progress, repo.closed) >= 100 }" :data-repository="repo.fullName">
    <div class="repo-body">
    <a class="repo-nav sidebar-repository" :class="{ 'repository-selected': selectedRepository === repo.fullName }" :aria-current="selectedRepository === repo.fullName ? 'true' : undefined" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.fullName + ' · ' + (repo.loading ? t('Hämtar…') : lastChange(repo.changedAt))" :aria-busy="repo.loading || undefined">
      <span class="repo-dot" aria-hidden="true" />
      <span class="repository-label" :title="repo.fullName">{{ repo.name }}</span>
      <span v-if="recentlyChanged(repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt, now)" class="repo-slots">
        <span class="recent-activity" :title="t('Oläst aktivitet')" role="img" :aria-label="t('Oläst aktivitet')" />
      </span>
      <span v-if="repo.loading" class="repository-counts">{{ t("Hämtar…") }}</span>
      <span v-else-if="!repo.unavailable" class="repository-counts">
        <span class="status-count backlog" :title="t('Backlog: {count}', { count: repo.backlog })"><Circle aria-hidden="true" /><span class="sr-only">Backlog: </span><span class="status-count-value">{{ repo.backlog }}</span></span>
        <span class="status-count progress" :title="t('Pågående: {count}', { count: repo.progress })"><Clock3 aria-hidden="true" /><span class="sr-only">{{ t('Pågående') }}: </span><span class="status-count-value">{{ repo.progress }}</span></span>
        <span class="status-count closed" :title="t('Stängda senaste 30 dagarna: {count}', { count: repo.closed })"><CircleCheck aria-hidden="true" /><span class="sr-only">{{ t('Stängda senaste 30 dagarna') }}: </span><span class="status-count-value">{{ repo.closed }}</span></span>
      </span>
      <time v-if="repo.changedAt" class="sr-only" :datetime="repo.changedAt">{{ lastChange(repo.changedAt) }}</time>
      <span v-if="repo.private !== undefined" class="repo-icons">
        <span class="repo-visibility" :class="repo.private ? 'is-private' : 'is-public'" role="img" :title="repo.private ? t('Privat repository') : t('Publikt repository')" :aria-label="repo.private ? t('Privat repository') : t('Publikt repository')"><component :is="repo.private ? Lock : Globe" aria-hidden="true" /></span>
      </span>
    </a>
    <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
    </div>
    </div>

    <button
      v-if="inactiveRepos.length > 0"
      type="button"
      class="sidebar-inactive-toggle"
      :aria-expanded="showInactive"
      :aria-controls="'sidebar-inactive-repositories'"
      :aria-label="showInactive ? t('Dölj inaktiva repositories') : t('Visa inaktiva repositories')"
      :title="showInactive ? t('Dölj inaktiva repositories') : t('Visa inaktiva repositories')"
      @click="toggleInactive"
    >
      <ChevronRight v-if="!showInactive" :size="16" aria-hidden="true" />
      <ChevronDown v-else :size="16" aria-hidden="true" />
      <span class="inactive-toggle-label">{{ showInactive ? t("Dölj inaktiva repositories") : t("Visa inaktiva repositories") }}</span>
      <span class="nav-count" :aria-hidden="true">{{ inactiveRepos.length }}</span>
    </button>

    <div v-if="inactiveRepos.length > 0" v-show="showInactive" id="sidebar-inactive-repositories" class="sidebar-inactive-group">
      <div v-for="repo in inactiveRepos" :key="repo.id" class="sidebar-repository-row" :class="{ 'has-wide-counts': Math.max(repo.backlog, repo.progress, repo.closed) >= 100 }" :data-repository="repo.fullName">
      <div class="repo-body">
      <a class="repo-nav sidebar-repository" :class="{ 'repository-selected': selectedRepository === repo.fullName }" :aria-current="selectedRepository === repo.fullName ? 'true' : undefined" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.fullName + ' · ' + (repo.loading ? t('Hämtar…') : lastChange(repo.changedAt))" :aria-busy="repo.loading || undefined">
        <span class="repo-dot" aria-hidden="true" />
        <span class="repository-label" :title="repo.fullName">{{ repo.name }}</span>
        <span v-if="recentlyChanged(repo.unreadAt === undefined ? repo.changedAt : repo.unreadAt, now)" class="repo-slots">
          <span class="recent-activity" :title="t('Oläst aktivitet')" role="img" :aria-label="t('Oläst aktivitet')" />
        </span>
        <span v-if="repo.loading" class="repository-counts">{{ t("Hämtar…") }}</span>
        <span v-else-if="!repo.unavailable" class="repository-counts">
          <span class="status-count backlog" :title="t('Backlog: {count}', { count: repo.backlog })"><Circle aria-hidden="true" /><span class="sr-only">Backlog: </span><span class="status-count-value">{{ repo.backlog }}</span></span>
          <span class="status-count progress" :title="t('Pågående: {count}', { count: repo.progress })"><Clock3 aria-hidden="true" /><span class="sr-only">{{ t('Pågående') }}: </span><span class="status-count-value">{{ repo.progress }}</span></span>
          <span class="status-count closed" :title="t('Stängda senaste 30 dagarna: {count}', { count: repo.closed })"><CircleCheck aria-hidden="true" /><span class="sr-only">{{ t('Stängda senaste 30 dagarna') }}: </span><span class="status-count-value">{{ repo.closed }}</span></span>
        </span>
        <time v-if="repo.changedAt" class="sr-only" :datetime="repo.changedAt">{{ lastChange(repo.changedAt) }}</time>
        <span v-if="repo.private !== undefined" class="repo-icons">
          <span class="repo-visibility" :class="repo.private ? 'is-private' : 'is-public'" role="img" :title="repo.private ? t('Privat repository') : t('Publikt repository')" :aria-label="repo.private ? t('Privat repository') : t('Publikt repository')"><component :is="repo.private ? Lock : Globe" aria-hidden="true" /></span>
        </span>
      </a>
      <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
      </div>
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
/* Name-line icons share a right edge; the next line keeps counts and unread separate. */
.sidebar-repository-row { --row-line: var(--space-5); --pages-target: var(--icon-sm); --row-pad-end: var(--space-2); display: flex; align-items: flex-start; gap: var(--space-1); margin-top: var(--space-1); min-width: 0; }
.repo-body { --metadata-width: 0px; position: relative; flex: 1; min-width: 0; display: flex; }
.repo-body:has(.repo-visibility) { --metadata-width: var(--pages-target); }
.repo-body:has(.repo-pages) { --metadata-width: var(--pages-target); }
.repo-body:has(.repo-visibility):has(.repo-pages) { --metadata-width: calc(2 * var(--pages-target) + var(--space-1)); }
.repo-body:has(.repo-visibility, .repo-pages) .repository-label { margin-inline-end: calc(var(--metadata-width) + var(--space-2)); }
.sidebar-repository {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: var(--space-2) minmax(0, 1fr) var(--space-2);
  column-gap: var(--space-2);
  row-gap: 0;
  align-items: center;
  margin-top: 0;
  padding: var(--space-1) var(--row-pad-end) var(--space-1) var(--space-2);
  border-radius: 4px;
}
.sidebar-repository.repository-selected { background: color-mix(in srgb, var(--repository-indicator-color) 10%, var(--surface)); box-shadow: inset 0 0 0 2px var(--repository-indicator-color); }
.sidebar-repository.repository-selected .repository-label { font-weight: 700; }
.sidebar-repository:focus-visible { outline: 2px solid var(--green); outline-offset: 5px; }
.repo-body svg { width: var(--icon-xs); height: var(--icon-xs); stroke-width: 2; flex-shrink: 0; }
.repo-dot { width: var(--space-2); height: var(--space-2); box-shadow: none; background-color: var(--repository-color); }
.repository-label { grid-column: 2 / -1; grid-row: 1; min-width: 0; line-height: var(--row-line); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.repo-slots { grid-column: 3; grid-row: 2; display: grid; place-items: center; height: var(--space-4); }
/* Three equal tracks keep backlog, progress and closed in columns across rows; a track only grows for unusually long numbers. */
.repository-counts { grid-column: 2; grid-row: 2; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--space-1); min-width: 0; white-space: nowrap; font-size: 10px; line-height: var(--space-4); font-variant-numeric: tabular-nums; }
.status-count { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; }
.status-count-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Preserve room for four-digit counts in the narrow sidebar. */
.sidebar-projects:has(.has-wide-counts) .repository-counts { column-gap: 2px; }
.sidebar-projects:has(.has-wide-counts) .status-count { gap: 2px; }
.backlog { color: var(--status-backlog); }
.progress { color: var(--status-progress); }
.closed { color: var(--status-closed); }
.repo-icons { width: var(--metadata-width); position: absolute; top: var(--space-1); right: var(--row-pad-end); height: var(--row-line); display: flex; align-items: center; gap: var(--space-1); }
.repo-visibility { display: grid; place-items: center; width: var(--pages-target); height: var(--pages-target); color: var(--muted); }
/* Both visibility states keep their tooltip, accessible label and full contrast. */
.repo-pages { position: absolute; right: var(--row-pad-end); top: calc(var(--space-1) + (var(--row-line) - var(--pages-target)) / 2); display: grid; place-items: center; width: var(--pages-target); height: var(--pages-target); border-radius: 4px; color: var(--muted); }
.repo-pages:hover { color: var(--green); }
.repo-pages:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.recent-activity { width: 6px; height: 6px; border-radius: 50%; background: var(--unread); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

.sidebar-inactive-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  margin-top: var(--space-3);
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.sidebar-inactive-toggle:hover {
  color: var(--text);
  background: var(--hover);
}
.sidebar-inactive-toggle:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.inactive-toggle-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-inactive-toggle .nav-count {
  margin-left: auto;
  flex-shrink: 0;
}
@media (pointer: coarse) {
  .sidebar-repository-row { --row-line: 44px; --pages-target: 44px; }
  .sidebar-add { min-width: 44px; min-height: 44px; }
  .sidebar-inactive-toggle {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-inactive-toggle {
    transition: none;
  }
}
</style>
