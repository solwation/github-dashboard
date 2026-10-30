<script setup lang="ts">
import { Circle, CircleCheck, Clock3, Eye, EyeOff, Globe, Lock, Plus, SquareArrowOutUpRight } from "@lucide/vue";
import { repositoryColor } from "../lib/repository-color";
import { useLanguage } from "../lib/i18n";
import type { RepositoryVisibility } from "../lib/repository-visibility";
import { isInactiveRepository, recentlyChanged, RECENT_CHANGE_MS, type SidebarRepository } from "../lib/sidebar";
import { HOVER_DELAY_MS } from "../lib/adhoc-refresh";
import { computed, onBeforeUnmount } from "vue";
import { useNow } from "../composables/useNow";

const props = withDefaults(
  defineProps<{
    repos: SidebarRepository[];
    repositoryColors?: Record<string, string>;
    selectedRepository?: string | null;
    canSelect: boolean;
    restoring?: boolean;
    statistics?: boolean;
    hideInactive?: boolean;
    /** Board visibility per repository (#367); absent means every repository is shown. */
    visibility?: Record<string, RepositoryVisibility>;
  }>(),
  {
    hideInactive: false,
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
  "update:hideInactive": [value: boolean];
  toggleVisibility: [name: string];
}>();
// "Hide inactive repositories" leaves inactive projects greyed here and off the board (#367).
function setHideInactive(event: Event) {
  emit("update:hideInactive", (event.target as HTMLInputElement).checked);
}
function hiddenFromBoard(repo: SidebarRepository) {
  return (props.visibility?.[repo.fullName] ?? "visible") !== "visible";
}
function visibilityAction(repo: SidebarRepository) {
  return t(hiddenFromBoard(repo) ? "Visa {name} i innehållsvyn" : "Dölj {name} i innehållsvyn", { name: repo.name });
}
// GitHub address from the full name; the sidebar summary carries no html_url.
function githubUrl(repo: SidebarRepository) { return `https://github.com/${repo.fullName}`; }
const ownRepos = computed(() => props.repos.filter(repo => !repo.external));
const externalRepos = computed(() => props.repos.filter(repo => repo.external));
const activeRepos = computed(() => ownRepos.value.filter(repo => !isInactiveRepository(repo)));
const inactiveRepos = computed(() => ownRepos.value.filter(repo => isInactiveRepository(repo)));
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
    <div v-for="repo in activeRepos" :key="repo.id" class="sidebar-repository-row" :class="{ 'has-wide-counts': Math.max(repo.backlog, repo.progress, repo.closed) >= 100, 'repository-hidden': hiddenFromBoard(repo) }" :data-repository="repo.fullName">
    <div class="repo-body">
    <a class="repo-nav sidebar-repository" :class="{ 'repository-selected': selectedRepository === repo.fullName }" :aria-current="selectedRepository === repo.fullName ? 'true' : undefined" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.fullName + ' · ' + (hiddenFromBoard(repo) ? t('Dold i innehållsvyn') + ' · ' : '') + (repo.loading ? t('Hämtar…') : lastChange(repo.changedAt))" :aria-busy="repo.loading || undefined">
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
      <span v-if="hiddenFromBoard(repo)" class="sr-only">{{ t("Dold i innehållsvyn") }}</span>
    </a>
    <span class="repo-icons">
      <span v-if="repo.private && !repo.pagesUrl" class="repo-visibility is-private" role="img" :title="t('Privat repository')" :aria-label="t('Privat repository')"><Lock aria-hidden="true" /></span>
      <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><Globe aria-hidden="true" /></a>
      <a class="repo-github" :href="githubUrl(repo)" target="_blank" rel="noopener" :title="t('Öppna {repo} på GitHub', { repo: repo.name })" :aria-label="t('Öppna {repo} på GitHub', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
    </span>
    <button v-if="visibility" type="button" class="repo-board-toggle" :aria-label="visibilityAction(repo)" :title="visibilityAction(repo)" @click="emit('toggleVisibility', repo.fullName)"><component :is="hiddenFromBoard(repo) ? Eye : EyeOff" aria-hidden="true" /></button>
    </div>
    </div>

    <label v-if="inactiveRepos.length > 0" class="sidebar-inactive-toggle" :title="t('Dölj inaktiva repositories')">
      <input type="checkbox" :checked="hideInactive" @change="setHideInactive" />
      <span class="inactive-toggle-label">{{ t("Dölj inaktiva repositories") }}</span>
      <span class="nav-count" aria-hidden="true">{{ inactiveRepos.length }}</span>
    </label>

    <div v-if="inactiveRepos.length > 0" id="sidebar-inactive-repositories" class="sidebar-inactive-group">
      <div v-for="repo in inactiveRepos" :key="repo.id" class="sidebar-repository-row" :class="{ 'has-wide-counts': Math.max(repo.backlog, repo.progress, repo.closed) >= 100, 'repository-hidden': hiddenFromBoard(repo) }" :data-repository="repo.fullName">
      <div class="repo-body">
      <a class="repo-nav sidebar-repository" :class="{ 'repository-selected': selectedRepository === repo.fullName }" :aria-current="selectedRepository === repo.fullName ? 'true' : undefined" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.fullName + ' · ' + (hiddenFromBoard(repo) ? t('Dold i innehållsvyn') + ' · ' : '') + (repo.loading ? t('Hämtar…') : lastChange(repo.changedAt))" :aria-busy="repo.loading || undefined">
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
        <span v-if="hiddenFromBoard(repo)" class="sr-only">{{ t("Dold i innehållsvyn") }}</span>
      </a>
      <span class="repo-icons">
        <span v-if="repo.private && !repo.pagesUrl" class="repo-visibility is-private" role="img" :title="t('Privat repository')" :aria-label="t('Privat repository')"><Lock aria-hidden="true" /></span>
        <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><Globe aria-hidden="true" /></a>
        <a class="repo-github" :href="githubUrl(repo)" target="_blank" rel="noopener" :title="t('Öppna {repo} på GitHub', { repo: repo.name })" :aria-label="t('Öppna {repo} på GitHub', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
      </span>
      <button v-if="visibility" type="button" class="repo-board-toggle" :aria-label="visibilityAction(repo)" :title="visibilityAction(repo)" @click="emit('toggleVisibility', repo.fullName)"><component :is="hiddenFromBoard(repo) ? Eye : EyeOff" aria-hidden="true" /></button>
      </div>
      </div>
    </div>

    <section v-if="externalRepos.length" class="sidebar-external-group" aria-labelledby="sidebar-external-heading">
      <h3 id="sidebar-external-heading" class="nav-caption sidebar-external-heading">{{ t("Andras publika projekt") }}</h3>
      <div v-for="repo in externalRepos" :key="repo.id" class="sidebar-repository-row" :class="{ 'has-wide-counts': Math.max(repo.backlog, repo.progress, repo.closed) >= 100, 'repository-hidden': hiddenFromBoard(repo) }" :data-repository="repo.fullName">
      <div class="repo-body">
      <a class="repo-nav sidebar-repository" :class="{ 'repository-selected': selectedRepository === repo.fullName }" :aria-current="selectedRepository === repo.fullName ? 'true' : undefined" :style="{ '--repository-color': repositoryColor(repo.fullName, repositoryColors) }" :href="(statistics ? '#statistics-repo-' : '#repo-') + repo.id" @click="activateRepository($event, repo)" @focus="emit('interest', repo.fullName)" @pointerenter="$event.pointerType === 'mouse' && hoverStart(repo.fullName)" @pointerleave="hoverEnd" :title="repo.fullName + ' · ' + (hiddenFromBoard(repo) ? t('Dold i innehållsvyn') + ' · ' : '') + (repo.loading ? t('Hämtar…') : lastChange(repo.changedAt))" :aria-busy="repo.loading || undefined">
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
        <span v-if="hiddenFromBoard(repo)" class="sr-only">{{ t("Dold i innehållsvyn") }}</span>
      </a>
      <span class="repo-icons">
        <span v-if="repo.private && !repo.pagesUrl" class="repo-visibility is-private" role="img" :title="t('Privat repository')" :aria-label="t('Privat repository')"><Lock aria-hidden="true" /></span>
        <a v-if="repo.pagesUrl" class="repo-pages" :href="repo.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repo.name })" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repo.name })"><Globe aria-hidden="true" /></a>
        <a class="repo-github" :href="githubUrl(repo)" target="_blank" rel="noopener" :title="t('Öppna {repo} på GitHub', { repo: repo.name })" :aria-label="t('Öppna {repo} på GitHub', { repo: repo.name })"><SquareArrowOutUpRight aria-hidden="true" /></a>
      </span>
      <button v-if="visibility" type="button" class="repo-board-toggle" :aria-label="visibilityAction(repo)" :title="visibilityAction(repo)" @click="emit('toggleVisibility', repo.fullName)"><component :is="hiddenFromBoard(repo) ? Eye : EyeOff" aria-hidden="true" /></button>
      </div>
      </div>
    </section>

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
.repo-body { --metadata-width: 0px; --action-width: 0px; position: relative; flex: 1; min-width: 0; display: flex; }
/* The board visibility action (#367) owns the rightmost slot in every row, so other icons keep one column. */
.repo-body:has(.repo-board-toggle) { --action-width: calc(var(--pages-target) + var(--space-1)); }
/* The GitHub link is always present; the globe (Pages) adds a second icon; the non-interactive lock is only icon-wide. */
.repo-body { --metadata-width: var(--pages-target); }
.repo-body:has(.repo-visibility) { --metadata-width: calc(var(--pages-target) + var(--icon-sm) + var(--space-1)); }
.repo-body:has(.repo-pages) { --metadata-width: calc(2 * var(--pages-target) + var(--space-1)); }
.repo-body .repository-label { margin-inline-end: calc(var(--metadata-width) + var(--action-width) + var(--space-2)); }
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
.repo-icons { width: var(--metadata-width); position: absolute; top: var(--space-1); right: calc(var(--row-pad-end) + var(--action-width)); height: var(--row-line); display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); pointer-events: none; }
.repo-visibility { display: grid; place-items: center; width: var(--icon-sm); height: var(--pages-target); color: var(--muted); }
.repo-pages, .repo-github { pointer-events: auto; display: grid; place-items: center; width: var(--pages-target); height: var(--pages-target); border-radius: 4px; color: var(--muted); }
.repo-pages:hover, .repo-github:hover { color: var(--green); }
.repo-pages:focus-visible, .repo-github:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.repo-board-toggle { position: absolute; right: var(--row-pad-end); top: calc(var(--space-1) + (var(--row-line) - var(--pages-target)) / 2); display: grid; place-items: center; width: var(--pages-target); height: var(--pages-target); padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer; transition: opacity .15s ease, color .15s ease; }
.repo-board-toggle:hover { color: var(--green); }
.repo-board-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
/* Hover reveals Hide; keyboard focus, touch screens and hidden rows always show the action. */
@media (hover: hover) and (pointer: fine) {
  .sidebar-repository-row:not(.repository-hidden):not(:hover):not(:focus-within) .repo-board-toggle { opacity: 0; }
}
/* Hidden from the board: greyed name and counts, hollow dot; contrast stays at the muted text level. */
.repository-hidden .sidebar-repository { color: var(--muted); }
.repository-hidden :is(.backlog, .progress, .closed) { color: var(--muted); }
.sidebar-repository-row.repository-hidden .sidebar-repository .repo-dot { background-color: transparent; box-shadow: inset 0 0 0 1px var(--muted); }
.recent-activity { width: 6px; height: 6px; border-radius: 50%; background: var(--unread); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

.sidebar-external-group { margin-top: var(--space-3); }
.sidebar-external-heading { margin: 0; padding-block: var(--space-1); text-transform: uppercase; line-height: 1.5; }
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
.sidebar-inactive-toggle:focus-within:has(:focus-visible) {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.sidebar-inactive-toggle input { flex-shrink: 0; margin: 0; accent-color: var(--green); }
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
  /* No room for a third 44px target beside the name: touch uses Settings > Reorder repositories, and tapping a greyed row shows it. */
  .repo-board-toggle { display: none; }
  .repo-body:has(.repo-board-toggle) { --action-width: 0px; }
  .sidebar-add { min-width: 44px; min-height: 44px; }
  .sidebar-inactive-toggle {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-inactive-toggle, .repo-board-toggle {
    transition: none;
  }
}
</style>
