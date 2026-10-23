<script setup lang="ts">
import { statisticsRepositoryCollapsed } from "./lib/statistics-preferences";
import { useLanguage } from "./lib/i18n";
import { browserTimeZone } from "./lib/browser-time";
const accountTimeZone = browserTimeZone();
const { t, locale, preference, setLanguage } = useLanguage();
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  Activity,
  Bell,
  BellOff,
  ArrowRight,
  ChevronDown,
  CircleCheck,
  Clock3,
  ExternalLink,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "@lucide/vue";
import LanguageSettings from "./components/LanguageSettings.vue";
import RepositorySection from "./components/RepositorySection.vue";
import RepositoryHeading from "./components/RepositoryHeading.vue";
import OverviewSummary from "./components/OverviewSummary.vue";
import ColumnLimitField from "./components/ColumnLimitField.vue";
import { defaultColumnLimit, effectiveColumnLimit, restoreColumnLimits } from "./lib/column-limits";
import VersionUpdate from "./components/VersionUpdate.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import SidebarVersion from "./components/SidebarVersion.vue";
import ReleaseNotes from "./components/ReleaseNotes.vue";
import { bundledReleaseNotes, fetchPublishedReleaseNotes, noteLanguage, notesSince, updateSummary as summarizeUpdate, type PublishedReleaseNotes, type ReleaseNoteDay } from "./lib/release-notes";
import { useAppUpdate } from "./composables/useAppUpdate";
import { PUBLIC_CONTENT_LIFETIME_MS, readPublicContent, writePublicContent, type PublicLaneSnapshot } from "./lib/public-content-cache";
import { PUBLIC_SETTINGS_ACCOUNT, publicRepositoryRecord, publicWorkspaceRemembered, rememberPublicWorkspace } from "./lib/public-workspace";
import { provideRepositoryDisplayNames } from "./composables/useRepositoryDisplayName";
import { provideIssueEstimates } from "./composables/useIssueEstimates";
import { setBoardVisible } from "./composables/useNow";
import SidebarRepositories from "./components/SidebarRepositories.vue";
import { reconcileOrder, restoreLayout, moveProject } from "./lib/project-layout";
import { summarizeLanes } from "./lib/sidebar";
import { TimeoutTracker, normalizeTimeoutSettings, parseTimeoutOverrunPercent, nextTimeout, timeoutBases, type TimeoutEntry } from "./lib/timeouts";
import { countUnreadActivity, ActivityTracker } from "./lib/activity";
import { StatusSoundPlayer, StatusTransitionTracker } from "./lib/status-sounds";
import { createIssueSync } from "./lib/sync";
import { createBackgroundCheckScheduler } from "./lib/background-sync";
import { selectedLanes, RepositoryRequestQueue, RepositoryRequestCancelled } from "./lib/repository-selection";
import { shouldAdhocRefresh } from "./lib/adhoc-refresh";
import { isDataRefreshShortcut } from "./lib/refresh-shortcuts";
import { matchesIssueFilters } from "./lib/issue-filter";
import { combinedItems, boardEntryKey } from "./lib/combined-board";
import { reconcileRepositoryColors } from "./lib/repository-color";
import LogoutDialog from "./components/LogoutDialog.vue";
import AccountSwitchDialog from "./components/AccountSwitchDialog.vue";
import MobileHandoff from "./components/MobileHandoff.vue";
import { restorePermissionAcknowledgements, reconcilePermissionAcknowledgements } from "./lib/permission-acknowledgements";
import type { PermissionReport } from "./lib/permissions";
import type { StatisticsPreferences } from "./lib/statistics";
const statisticsPreferences = ref<StatisticsPreferences>({});
const StatisticsView = defineAsyncComponent(() => import("./components/StatisticsView.vue"));
const ScanLogin = defineAsyncComponent(() => import("./components/ScanLogin.vue"));
import { saveToken, loadToken, clearToken, VaultError } from "./lib/vault";
import { loadSettings, saveSettings } from "./lib/settings-store";
import { readSnapshot, writeSnapshot, SYNCED_AT_PERSIST_MS, type ContentSnapshot } from "./lib/content-cache";
import { sameLaneContent, sameLaneList } from "./lib/lane-changes";
import { measureRender } from "./lib/startup-timing";
import { cacheFailureReason } from "./lib/cache-failure";
import { consumeHandoff, mergeHandoffPreferences, parseHandoffPreferences, type HandoffPreferences, type HandoffSettings } from "./lib/handoff";
import IssueCard from "./components/IssueCard.vue";
import IssueRow from "./components/IssueRow.vue";
import BoardModeToggle from "./components/BoardModeToggle.vue";
import ColumnEstimate from "./components/ColumnEstimate.vue";
import Github from "./components/GithubIcon.vue";
import InstallApp from "./components/InstallApp.vue";
import { provideSubIssues } from "./composables/useSubIssues";
import { GitHub } from "./lib/github";
import { callback, login, oauthReady } from "./lib/auth";
import { demo } from "./lib/demo";
import { ClosureTracker, closureKey } from "./lib/closures";
import {
  notificationPermission,
  requestNotifications,
  notifyClosure,
  notifyTimeout,
} from "./lib/notifications";
import {
  column,
  deriveWorkStarts,
  isCoordination,
  sortedIssues,
  workflow,
  type Lane,
  type Issue,
  type Repo,
  type RepositoryIssueEvent,
  type Rules,
} from "./lib/model";
// One update controller shared by the automatic prompt, the update dialog and the sidebar badge.
const appUpdate = useAppUpdate();
const {
  available: updateAvailable, seconds: updateSeconds, counting: updateCounting,
  applying: updateApplying, error: updateError, deferred: updateDeferred,
  checked: updateChecked, checking: updateChecking,
} = appUpdate;
const updateDialogOpen = ref(false);
// Notes published with the latest deployment describe what the waiting update adds.
const publishedNotes = ref<PublishedReleaseNotes | null>(null);
let notesRequest: Promise<void> | null = null;
function loadPublishedNotes() {
  notesRequest ??= fetchPublishedReleaseNotes()
    .then((notes) => { if (notes) publishedNotes.value = notes; })
    .finally(() => { notesRequest = null; });
}
watch(updateAvailable, (available) => { if (available) loadPublishedNotes(); }, { immediate: true });
const installedBuild = __BUILD_INFO__;
const newerBuild = computed(() => {
  const build = publishedNotes.value?.build;
  return build && build.commit !== installedBuild.commit ? build : null;
});
const newNoteDays = computed(() =>
  newerBuild.value && publishedNotes.value ? notesSince(publishedNotes.value.days, installedBuild.builtAt) : []);
const updateSummary = computed(() => summarizeUpdate(newerBuild.value ? publishedNotes.value?.delta : null, noteLanguage(locale.value)));
const availableBuild = computed(() => (updateAvailable.value ? newerBuild.value : null));
const sidebarVersion = ref<InstanceType<typeof SidebarVersion> | null>(null);
function openUpdateDialog() {
  updateDialogOpen.value = true;
  void appUpdate.check();
  if (updateAvailable.value) loadPublishedNotes();
}
const releaseNotesOpen = ref(false);
const releaseNotesDays = ref<ReleaseNoteDay[]>(bundledReleaseNotes);
/** Without days the installed bundle's notes are shown; the update views pass what is new. */
function openReleaseNotes(days?: ReleaseNoteDay[]) {
  releaseNotesDays.value = days?.length ? days : bundledReleaseNotes;
  releaseNotesOpen.value = true;
}
function deferUpdate() {
  appUpdate.defer();
  // The prompt disappears; keep keyboard focus on the remaining update badge.
  void nextTick(() => sidebarVersion.value?.focusBadge());
}
const user = ref<{ login: string; avatar_url: string } | null>(null);
// Lanes and their issues are always replaced, never mutated in place, so a shallow ref avoids
// deep proxies over every cached issue at startup (#121).
const lanes = shallowRef<Lane[]>([]);
// A board restored from the cache mounts its repositories' cards a few per frame, so the
// first cards draw without one long main-thread task (#121).
const renderedLanes = ref(Number.POSITIVE_INFINITY);
let laneFrame = 0;
function renderLanesGradually() {
  cancelAnimationFrame(laneFrame);
  renderedLanes.value = 2;
  const step = () => {
    renderedLanes.value = renderedLanes.value + 1 >= lanes.value.length ? Number.POSITIVE_INFINITY : renderedLanes.value + 1;
    if (Number.isFinite(renderedLanes.value)) laneFrame = requestAnimationFrame(step);
  };
  laneFrame = requestAnimationFrame(step);
}
const repos = ref<Repo[]>([]);
const selected = ref<string[]>([]);
const repositoryColors = ref<Record<string, string>>({});
const projectOrder = ref<string[]>([]);
const collapsedRepos = ref<string[]>([]);
const layoutAnnouncement = ref("");
const orderedLanes = computed(() => {
  const order = reconcileOrder(projectOrder.value, lanes.value.map(lane => lane.repo.full_name));
  const positions = new Map(order.map((name, index) => [name, index]));
  return [...lanes.value].sort((a, b) => positions.get(a.repo.full_name)! - positions.get(b.repo.full_name)!);
});
function reorderProject(source: string, target: string) {
  const names = orderedLanes.value.map(lane => lane.repo.full_name);
  if (!names.includes(source) || !names.includes(target) || source === target) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  projectOrder.value = moveProject(reconcileOrder(projectOrder.value, repos.value.length ? repos.value.map(repo => repo.full_name) : names), source, target);
  layoutAnnouncement.value = t("{name} flyttad till plats {position} av {total}", {
    name: source.split("/").pop()!, position: orderedLanes.value.findIndex(lane => lane.repo.full_name === source) + 1, total: names.length,
  });
  save();
  nextTick(() => {
    if (!focused?.isConnected) return;
    focused.focus({ preventScroll: true });
    focused.scrollIntoView({ block: "nearest" });
  });
}
function moveRepository(name: string, direction: -1 | 1) {
  const names = orderedLanes.value.map(lane => lane.repo.full_name);
  const target = names[names.indexOf(name) + direction];
  if (target) reorderProject(name, target);
}
function toggleCollapsed(name: string) {
  if (collapsedRepos.value.includes(name)) resetVisible(name);
  collapsedRepos.value = collapsedRepos.value.includes(name)
    ? collapsedRepos.value.filter(repo => repo !== name) : [...collapsedRepos.value, name];
  save();
}
let highlightedRepository: HTMLElement | null = null;
let repositoryHighlightTimer: ReturnType<typeof setTimeout> | undefined;
let repositoryNavigationTarget: string | null = null;
let repositoryNavigationRun = 0;
function clearRepositoryHighlight() {
  repositoryNavigationRun++;
  clearTimeout(repositoryHighlightTimer);
  repositoryHighlightTimer = undefined;
  highlightedRepository?.classList.remove("repository-navigation-highlight");
  highlightedRepository = null;
  repositoryNavigationTarget = null;
}
const focusedSidebarRepository = ref<string | null>(null);
const statisticsNavigation = ref<{ name: string; toggle: boolean; sequence: number }>();
let sidebarNavigationSequence = 0;
const mobileBoardNavigatorOpen = ref(false);
const mobileNavigationRepository = ref("");
const mobileNavigationAnnouncement = ref("");
const mobileBoardNavigatorButton = ref<HTMLButtonElement | null>(null);
let boardNavigationHighlight: HTMLElement | null = null;
let boardNavigationTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => orderedLanes.value.map(lane => lane.repo.full_name).join("\n"), () => {
  if (!orderedLanes.value.some(lane => lane.repo.full_name === mobileNavigationRepository.value)) {
    mobileNavigationRepository.value = orderedLanes.value[0]?.repo.full_name ?? "";
  }
}, { immediate: true });
function closeMobileBoardNavigator(returnFocus = false) {
  mobileBoardNavigatorOpen.value = false;
  if (returnFocus) void nextTick(() => mobileBoardNavigatorButton.value?.focus());
}
function mobileStatusLabel(key: string) {
  return key === "progress" ? t("Pågående") : key === "closed" ? t("Stängda") : t("Backlog");
}
const mobileNavigationStatuses = computed(() => columns.value.map(col => {
  const lane = orderedLanes.value.find(item => item.repo.full_name === mobileNavigationRepository.value) ?? orderedLanes.value[0];
  const count = splitByRepository.value
    ? (lane ? items(lane, col.key).length : 0)
    : combinedColumns.value[col.key]?.length ?? 0;
  return { key: col.key, label: mobileStatusLabel(col.key), count };
}));
async function navigateToBoardStatus(key: string) {
  const lane = orderedLanes.value.find(item => item.repo.full_name === mobileNavigationRepository.value) ?? orderedLanes.value[0];
  if (splitByRepository.value && !lane) return;
  if (splitByRepository.value && lane) {
    const laneIndex = orderedLanes.value.findIndex(item => item.repo.full_name === lane.repo.full_name);
    if (laneIndex >= renderedLanes.value) renderedLanes.value = laneIndex + 1;
  }
  if (splitByRepository.value && lane && collapsedRepos.value.includes(lane.repo.full_name)) {
    // Reveal the target without resetting its Show more limit.
    collapsedRepos.value = collapsedRepos.value.filter(name => name !== lane.repo.full_name);
    save();
  }
  closeMobileBoardNavigator();
  await nextTick();
  const targetId = splitByRepository.value
    ? `board-${lane!.repo.id}-${key}`
    : `board-combined-${key}`;
  const target = document.getElementById(targetId);
  if (!target) return;
  clearTimeout(boardNavigationTimer);
  boardNavigationHighlight?.classList.remove("board-navigation-highlight");
  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  target.classList.add("board-navigation-highlight");
  boardNavigationHighlight = target;
  boardNavigationTimer = setTimeout(() => {
    boardNavigationHighlight?.classList.remove("board-navigation-highlight");
    boardNavigationHighlight = null;
  }, 1400);
  mobileNavigationAnnouncement.value = splitByRepository.value
    ? t("Visar {status} i {repository}", { status: mobileStatusLabel(key), repository: lane!.repo.full_name })
    : t("Visar {status} i alla repositories", { status: mobileStatusLabel(key) });
}
function activateSidebarRepository(name: string) {
  const repo = lanes.value.find(lane => lane.repo.full_name === name)?.repo;
  if (!repo) return;
  const toggle = focusedSidebarRepository.value === name;
  focusedSidebarRepository.value = name;
  const hash = (currentView.value === "statistics" ? "#statistics-repo-" : "#repo-") + repo.id;
  // Explicit activation owns this navigation; a hashchange would also reveal collapsed content.
  if (window.location.hash !== hash) history.pushState(null, "", hash);
  if (currentView.value === "statistics") statisticsNavigation.value = { name, toggle, sequence: ++sidebarNavigationSequence };
  void revealRepository(name, toggle);
}
async function revealRepository(name: string, toggle = false) {
  clearRepositoryHighlight();
  const run = repositoryNavigationRun;
  const repo = lanes.value.find(lane => lane.repo.full_name === name)?.repo;
  if (!repo) return;
  const targetId = (currentView.value === "statistics" ? "statistics-repo-" : "repo-") + repo.id;
  repositoryNavigationTarget = targetId;
  if (currentView.value === "overview" && splitByRepository.value && (toggle || collapsedRepos.value.includes(name))) toggleCollapsed(name);
  await nextTick();
  if (run !== repositoryNavigationRun) return;
  const target = document.getElementById(targetId);
  if (!target) return;
  const controls = target.closest("details");
  if (controls) controls.open = toggle ? !controls.open : true;
  target.scrollIntoView({ block: "start" });
  // Flush removal of the previous outline so same-repository activation restarts its pulse.
  void target.offsetWidth;
  target.classList.add("repository-navigation-highlight");
  highlightedRepository = target;
  repositoryHighlightTimer = setTimeout(clearRepositoryHighlight, 1200);
}
const rules = ref<Record<string, Rules>>({});
const editing = ref<string | null>(null);
const isDemo = ref(false);
const publicMode = ref(false);
const publicRepoInput = ref("");
const publicRepoBusy = ref(false);
const publicRepoError = ref("");
const isStatisticsHash = () => /^#statistics(?:-repo-\d+)?$/.test(window.location.hash);
const currentView = ref(isStatisticsHash() ? "statistics" : "overview");
// Board time labels keep their own clocks and stop while Statistics is shown.
watch(currentView, view => setBoardVisible(view === "overview"), { immediate: true });
async function navigateWorkspace() {
  focusedSidebarRepository.value = null;
  statisticsNavigation.value = undefined;
  if (window.location.hash !== "#" + repositoryNavigationTarget) clearRepositoryHighlight();
  currentView.value = isStatisticsHash() ? "statistics" : "overview";
  await nextTick();
  const target = document.getElementById(window.location.hash.slice(1));
  const repositoryControls = target?.closest("details");
  if (repositoryControls) repositoryControls.open = true;
  target?.scrollIntoView({ block: "start" });
  if (target?.tagName === "MAIN") target.focus({ preventScroll: true });
}
const busy = ref(false);
// A manual refresh requested during a partial background sync runs right after it, instead of
// being dropped. A full refresh already in flight satisfies it.
let refreshRequested = false;
let fullRefreshRunning = false;
// Repositories whose header status was clicked during another run (#149) follow right after it.
let requestedRepos = new Set<string>();
watch(busy, (running) => {
  if (running) return;
  fullRefreshRunning = false;
  if (refreshRequested) {
    refreshRequested = false;
    requestedRepos = new Set();
    void refresh();
  } else if (requestedRepos.size) {
    const only = [...requestedRepos];
    requestedRepos = new Set();
    void refresh(false, false, true, false, only);
  }
});
const error = ref("");
const refreshed = ref<number | null>(null);
const statusTime = (time: number) => new Date(time).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" });
const showingCache = ref(false);
const cacheWarning = ref("");
/** What the last successful encrypted write contained, by identity: lanes are replaced, never mutated. */
let persisted: { run: number; token: string; user: object; repos: Repo[]; lanes: Lane[]; syncedAt: number } | null = null;
let persistWaiting: Promise<void> | null = null;
let persistWaitingChangedOnly = true;
let persistTail: Promise<void> = Promise.resolve();
/**
 * Writes the encrypted content cache. `changedOnly` (background syncs) skips the write when the
 * board, repositories and identity are the ones already stored and only `syncedAt` moved by less
 * than SYNCED_AT_PERSIST_MS (#122). Calls made while a write is running coalesce into one
 * trailing write of the then-current state.
 */
function persistContent(changedOnly = false): Promise<void> {
  persistWaitingChangedOnly &&= changedOnly;
  if (persistWaiting) return persistWaiting;
  persistWaitingChangedOnly = changedOnly;
  const waiting = persistTail.then(() => {
    persistWaiting = null;
    const onlyChanged = persistWaitingChangedOnly;
    persistWaitingChangedOnly = true;
    return writeContent(onlyChanged);
  });
  persistWaiting = waiting;
  persistTail = waiting.catch(() => {});
  return waiting;
}
let publicSnapshots: PublicLaneSnapshot[] = [];
async function writeContent(changedOnly: boolean) {
  if (publicMode.value) {
    const run = generation;
    try { await writePublicContent(publicSnapshots); if (run === generation) cacheWarning.value = ""; }
    catch (cause) { if (run === generation) cacheWarning.value = cacheFailureReason(cause); }
    return;
  }
  if (!user.value || !sessionToken.value || !api || isDemo.value) return;
  const run = generation;
  const state = { run, token: sessionToken.value, user: user.value, repos: repos.value,
    lanes: lanes.value.filter(lane => !lane.loading), syncedAt: refreshed.value ?? 0 };
  if (changedOnly && persisted && persisted.run === run && persisted.token === state.token && persisted.user === state.user &&
    persisted.repos === state.repos && sameLaneList(persisted.lanes, state.lanes) &&
    Math.abs(state.syncedAt - persisted.syncedAt) < SYNCED_AT_PERSIST_MS) return;
  persisted = null;
  try {
    await writeSnapshot(state.token, { user: state.user, repos: state.repos, lanes: state.lanes,
      syncedAt: refreshed.value, responses: api.exportResponses() });
    if (run === generation) { cacheWarning.value = ""; persisted = state; }
  } catch (cause) { if (run === generation) cacheWarning.value = cacheFailureReason(cause); }
}
const syncError = ref("");
const lastSynced = new Map<string, number>();
const lastFullSynced = new Map<string, number>();
/**
 * Per-repository sync status for the repository headers (#146). Kept outside the cached lanes, so a
 * new timestamp never rewrites the content cache or the lane objects; both refs are replaced, never
 * mutated, and the time only changes when its displayed minute does (#120).
 */
const syncingRepos = shallowRef<ReadonlySet<string>>(new Set());
const repoSyncedAt = shallowRef<Readonly<Record<string, number>>>({});
// Balanced per request, so a cancelled older run never stops a newer run's indicator.
const syncingCounts = new Map<string, number>();
function markSyncing(name: string, delta: 1 | -1) {
  const count = Math.max(0, (syncingCounts.get(name) || 0) + delta);
  if (count) syncingCounts.set(name, count); else syncingCounts.delete(name);
  if (syncingRepos.value.has(name) === count > 0) return;
  syncingRepos.value = new Set(syncingCounts.keys());
}
function markSynced(names: readonly string[], time: number) {
  const minute = (value: number) => Math.floor(value / 60000);
  const changed = names.filter(name => repoSyncedAt.value[name] === undefined || minute(repoSyncedAt.value[name]!) !== minute(time));
  if (changed.length) repoSyncedAt.value = { ...repoSyncedAt.value, ...Object.fromEntries(changed.map(name => [name, time])) };
}
const combinedSyncing = computed(() => lanes.value.some(lane => syncingRepos.value.has(lane.repo.full_name)));
/**
 * The header status is also a button (#149): one repository in split view, every repository on the
 * combined board, through the same manual refresh path as F5. A click while that status already
 * shows the spinner is ignored, and refresh() itself never starts a second parallel run.
 */
function refreshFromStatus(name?: string) {
  if ((!loggedIn.value && !publicMode.value) || isDemo.value || authBusy.value) return;
  if (name ? syncingRepos.value.has(name) : combinedSyncing.value) return;
  void refresh(false, false, true, false, name ? [name] : undefined);
}
/**
 * Ad-hoc refresh (#187): interest in a stale repository's sidebar entry refreshes just that one
 * through the manual per-repository path. Policy lives in lib/adhoc-refresh; every guard skips silently.
 */
const lastAdhoc = new Map<string, number>();
function refreshStaleRepository(name: string) {
  if (!api || !loggedIn.value || isDemo.value || authBusy.value || busy.value || restoring.value || !selected.value.includes(name)) return;
  const lane = lanes.value.find(entry => entry.repo.full_name === name);
  if (!lane || lane.loading || lane.error || syncingRepos.value.has(name)) return;
  const now = Date.now();
  if (!shouldAdhocRefresh({ now, lastSuccess: lastSynced.get(name), lastAttempt: lastAdhoc.get(name), inFlight: false,
    retryAfterMs: api.retryAfterMs(), remainingQuota: api.rateLimit()?.remaining })) return;
  lastAdhoc.set(name, now);
  void refresh(false, false, true, false, [name]).catch(() => {});
}
const query = ref("");
const issueSearch = ref<HTMLInputElement | null>(null);
const mobileToolsOpen = ref(false);
function openIssueSearch() {
  mobileToolsOpen.value = false;
  const focusSearch = () => nextTick(() => issueSearch.value?.focus());
  if (currentView.value !== "overview") {
    window.addEventListener("hashchange", focusSearch, { once: true });
    window.location.hash = "#overview";
  } else focusSearch();
}
const repositoryQueries = ref<Record<string, string>>({});
const repoQuery = ref("");
const picker = ref(false);
const tokenPanel = ref(false);
const tokenInput = ref("");
const hideCoordination = ref(true);
const splitByRepository = ref(true);
// Card/list choice (#127): one global choice for every repository and the combined board (#147).
const listMode = ref(false);
const combinedLimits = ref<Record<string, number>>({});
const pendingSelected = ref<string[]>([]);
watch(picker, (open) => {
  if (open) pendingSelected.value = [...selected.value];
});
const visibleLimit = ref<Record<string, number>>({});
const columnLimit = ref(defaultColumnLimit);
const timeoutSettings = ref(normalizeTimeoutSettings({}));
const timeoutTracker = new TimeoutTracker();
const timedOut = ref<TimeoutEntry[]>([]);
function setTimeoutEnabled(enabled: boolean) {
  timeoutSettings.value = { ...timeoutSettings.value, timeoutEnabled: enabled };
  save();
}
function setTimeoutOverrunPercent(percent: number) {
  const parsed = parseTimeoutOverrunPercent(percent);
  if (parsed === null) return;
  timeoutSettings.value = { ...timeoutSettings.value, timeoutOverrunPercent: parsed };
  save();
}
function timeoutEstimateMs(repo: string, issue: Issue) {
  return timedOut.value.find(entry => entry.repo === repo && entry.issue.id === issue.id)?.estimatedMs;
}
function issueTimedOut(repo: string, issue: Issue) {
  const started = issue.startedAt ? Date.parse(issue.startedAt) : NaN;
  if (!timeoutSettings.value.timeoutEnabled || issue.timerError || !Number.isFinite(started) || started > Date.now()) return false;
  return timedOut.value.some(entry => entry.repo === repo && entry.issue.id === issue.id &&
    entry.issue.startedAt === issue.startedAt && Date.now() - started > entry.estimatedMs * (1 + timeoutSettings.value.timeoutOverrunPercent / 100));
}
const repositoryColumnLimits = ref<Record<string, number>>({});
let issueNavigationHighlight: HTMLElement | null = null;
let issueNavigationTimer: ReturnType<typeof setTimeout> | undefined;
const parentNavigationRevision = ref(0);
function issueDomId(repository: string, number: number) { return `issue-${encodeURIComponent(repository.toLowerCase())}-${number}`; }
async function revealParentIssue(repository: string, number: number) {
  parentNavigationRevision.value++;
  const lane = lanes.value.find(item => item.repo.full_name.toLowerCase() === repository.toLowerCase());
  if (!lane) return;
  const issue = lane.issues.find(item => item.number === number);
  if (!issue) return;
  if (currentView.value !== "overview") {
    currentView.value = "overview";
    if (window.location.hash !== "#overview") history.pushState(null, "", "#overview");
  }
  const key = column(issue, rules.value[lane.repo.full_name] || {});
  const repositoryQuery = splitByRepository.value ? repositoryQueries.value[lane.repo.full_name] || "" : "";
  if (!matchesIssueFilters(issue, query.value, repositoryQuery)) {
    query.value = "";
    if (repositoryQueries.value[lane.repo.full_name]) repositoryQueries.value = { ...repositoryQueries.value, [lane.repo.full_name]: "" };
  }
  if (splitByRepository.value) {
    const laneIndex = orderedLanes.value.findIndex(item => item.repo.full_name === lane.repo.full_name);
    if (laneIndex >= renderedLanes.value) renderedLanes.value = laneIndex + 1;
    collapsedRepos.value = collapsedRepos.value.filter(name => name !== lane.repo.full_name);
  }
  await nextTick();
  const index = splitByRepository.value
    ? items(lane, key).findIndex(item => item.number === number)
    : (combinedColumns.value[key] ?? []).findIndex(item => item.lane.repo.full_name.toLowerCase() === repository.toLowerCase() && item.issue.number === number);
  if (index < 0) return;
  if (splitByRepository.value) visibleLimit.value[lane.repo.full_name + key] = Math.max(shownLimit(lane.repo.full_name, key), index + 1);
  else combinedLimits.value[key] = Math.max(combinedLimit(key), index + 1);
  await nextTick();
  const target = document.getElementById(issueDomId(repository, number));
  if (!target) return;
  clearTimeout(issueNavigationTimer);
  issueNavigationHighlight?.classList.remove("issue-navigation-highlight");
  target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
  target.classList.add("issue-navigation-highlight");
  issueNavigationHighlight = target;
  issueNavigationTimer = setTimeout(() => {
    issueNavigationHighlight?.classList.remove("issue-navigation-highlight");
    issueNavigationHighlight = null;
  }, 1500);
}
function initialLimit(repo: string) {
  return effectiveColumnLimit(columnLimit.value, repositoryColumnLimits.value, repo);
}
function shownLimit(repo: string, column: string) {
  return visibleLimit.value[repo + column] ?? initialLimit(repo);
}
function setColumnLimit(value: number | null) {
  if (value === null) return;
  columnLimit.value = value;
  for (const lane of lanes.value) {
    if (repositoryColumnLimits.value[lane.repo.full_name] === undefined) resetVisible(lane.repo.full_name);
  }
  save();
}
function resetVisible(repo: string) {
  for (const column of ["backlog", "progress", "closed"]) delete visibleLimit.value[repo + column];
}
function setRepositoryColumnLimit(repo: string, value: number | null) {
  if (value === null) delete repositoryColumnLimits.value[repo];
  else repositoryColumnLimits.value[repo] = value;
  resetVisible(repo);
  save();
}
const authBusy = ref(false);
const restoring = ref(true);
const savedSession = ref(false);
const sessionToken = ref("");
watch([currentView, splitByRepository, sessionToken, () => lanes.value.map(lane => lane.repo.full_name).sort().join("\n")], () => {
  focusedSidebarRepository.value = null;
  statisticsNavigation.value = undefined;
});

watch([currentView, splitByRepository, sessionToken], clearRepositoryHighlight);
const logoutPrompt = ref(false);
const logoutBusy = ref(false);
const handoffOpen = ref(false);
const scannerOpen = ref(false);
const accountSwitch = ref<{ current: string | null; incoming: string } | null>(null);
let resolveAccountSwitch: ((confirmed: boolean) => void) | null = null;
function answerAccountSwitch(confirmed: boolean) {
  const resolve = resolveAccountSwitch;
  resolveAccountSwitch = null;
  accountSwitch.value = null;
  resolve?.(confirmed);
}
/** Unsigned handoff payloads may come from anyone; never replace a different saved sign-in silently. */
async function confirmAccountSwitch(current: string | null, token: string): Promise<boolean> {
  const incoming = (await new GitHub(token).user()).login;
  answerAccountSwitch(false);
  return new Promise(resolve => {
    resolveAccountSwitch = resolve;
    accountSwitch.value = { current, incoming };
  });
}
async function importScanned(payload: HandoffSettings) {
  scannerOpen.value = false;
  // A user-started scan while signed in is meant to sync preferences, so a different account still needs consent.
  if (user.value && !isDemo.value && sessionToken.value && payload.token !== sessionToken.value) {
    try {
      if (!await confirmAccountSwitch(user.value.login, payload.token)) return;
    } catch (e) {
      error.value = message(e);
      return;
    }
  }
  await connect(payload.token, payload);
}
const commitRetry = ref(0);
// Bumped per repository so a sync only revalidates relations on that repository's cards (#149).
const relationsRevisions = ref<Record<string, number>>({});
const permissionReport = ref<PermissionReport>([]);
const permissionAcknowledgements = ref<string[]>([]);
function setPermissionAcknowledgements(value: string[]) {
  permissionAcknowledgements.value = restorePermissionAcknowledgements(value);
  save();
}
const permissionsChecking = ref(false);
let permissionRun = 0;
const permissionRepos = computed(() => repos.value.filter(repo => selected.value.includes(repo.full_name)));
async function refreshPermissions(force = false) {
  const client = api;
  const session = generation;
  if (!client || !user.value || isDemo.value) return;
  const run = ++permissionRun;
  permissionsChecking.value = true;
  try {
    const report = await client.checkPermissions(permissionRepos.value, { force });
    if (run === permissionRun && client === api && session === generation) {
      const acknowledgements = reconcilePermissionAcknowledgements(permissionAcknowledgements.value, report);
      if (JSON.stringify(acknowledgements) !== JSON.stringify(permissionAcknowledgements.value)) setPermissionAcknowledgements(acknowledgements);
      permissionReport.value = report;
      if (force) commitRetry.value++;
    }
  } catch {
    if (run === permissionRun) permissionReport.value = [];
  } finally {
    if (run === permissionRun) permissionsChecking.value = false;
  }
}
watch([sessionToken, permissionRepos], () => {
  permissionRun++;
  permissionReport.value = [];
  permissionsChecking.value = false;
  void refreshPermissions();
}, { flush: "post" });
const notificationRepos = ref<string[]>([]);
const notificationSounds = ref(true);
const notificationNotice = ref("");
const notificationNoticeRepo = ref<string | null>(null);
const permission = ref(notificationPermission());
const notificationPending = ref<string | null>(null);
const recentClosures = ref(new Set<string>());
const closureTracker = new ClosureTracker();
const statusTracker = new StatusTransitionTracker();
const audioUnavailableText = "Ljud kunde inte aktiveras. Klicka eller tryck på en tangent i dashboarden för att försöka igen. Notiser fungerar fortfarande.";
// Background playback failures stay silent. Explain unavailable audio only when
// the user explicitly enables repository notifications below.
const statusPlayer = new StatusSoundPlayer();
watch(notificationSounds, enabled => {
  if (!enabled) statusPlayer.clear();
}, { flush: "sync" });
function setNotificationSounds(enabled: boolean) {
  notificationSounds.value = enabled;
  if (enabled && notificationRepos.value.some(notificationsEnabled)) void statusPlayer.unlock();
  save();
}
const activity = new ActivityTracker();
const activityRevision = ref(0);
// Activity markers are re-evaluated when one appears or expires, never on a per-second clock (#120).
const activityNow = ref(Date.now());
let activityTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleActivity() {
  clearTimeout(activityTimer);
  const next = activity.nextChange(activityNow.value);
  if (next !== null) activityTimer = setTimeout(() => { activityNow.value = Date.now(); scheduleActivity(); }, next - activityNow.value + 10);
}
watch(activityRevision, () => { activityNow.value = Date.now(); scheduleActivity(); });
/** One set of card props for the card view and expanded list rows (#154). */
function cardProps(lane: Lane, issue: Issue, showRepository = false) {
  const repo = lane.repo.full_name, load = isDemo.value ? undefined : loaders(repo);
  return {
    issue, repository: repo, showRepository, assignedColor: workspaceRepositoryColors.value[repo],
    loadRelations: load?.relations, relationsRevision: relationsRevisions.value[repo] ?? 0,
    rules: rules.value[repo] || {}, timedOut: issueTimedOut(repo, issue), timeoutOverrunPercent: timeoutSettings.value.timeoutOverrunPercent, timeoutEstimateMs: timeoutEstimateMs(repo, issue),
    loadCommit: load?.commit, demo: isDemo.value, loadComments: load?.comments, commentsSession: generation,
    commitRetry: commitRetry.value, recentMove: activity.moved(repo, issue, activityNow.value),
    newComments: activity.newComments(repo, issue, activityNow.value),
    celebrate: recentClosures.value.has(closureKey(repo, issue)),
  };
}
function readIssue(repo: string, issue: Issue) {
  activity.read(repo, issue);
  activityRevision.value++;
  save();
}
const celebrationTimers = new Set<ReturnType<typeof setTimeout>>();
function clearClosureFeedback() {
  timeoutTracker.clear();
  timedOut.value = [];
  statusTracker.clear();
  statusPlayer.clear();
  activity.clear();
  closureTracker.clear();
  recentClosures.value.clear();
  for (const timer of celebrationTimers) clearTimeout(timer);
  celebrationTimers.clear();
  notificationNotice.value = "";
}
function notificationsEnabled(repo: string) {
  return (
    permission.value === "granted" && notificationRepos.value.includes(repo)
  );
}
async function toggleNotifications(repo: string) {
  if (notificationPending.value) return;
  notificationNotice.value = "";
  notificationNoticeRepo.value = repo;
  permission.value = notificationPermission();
  if (
    notificationRepos.value.includes(repo) &&
    permission.value === "granted"
  ) {
    statusPlayer.clear();
    notificationRepos.value = notificationRepos.value.filter(
      (name) => name !== repo,
    );
    save();
    return;
  }
  const run = generation;
  notificationPending.value = repo;
  // Start audio while the click still supplies browser user activation.
  const audioReady = notificationSounds.value ? statusPlayer.unlock() : Promise.resolve(true);
  try {
    const result = await requestNotifications();
    if (run !== generation) return;
    permission.value = result;
    if (result === "granted") {
      if (!notificationRepos.value.includes(repo))
        notificationRepos.value.push(repo);
      save();
      const soundReady = await audioReady;
      if (run !== generation) return;
      notificationNotice.value = t(notificationSounds.value ?
        "Notiser på för {repo}. Statusändringar spelar ljud och nya stängningar meddelas medan dashboarden är öppen. Webbläsaren kan fördröja uppdateringar i bakgrunden."
        : "Notiser på för {repo}. Nya stängningar meddelas medan dashboarden är öppen. Webbläsaren kan fördröja uppdateringar i bakgrunden.",
        { repo },
      ) + (soundReady || !notificationSounds.value ? "" : " " + t(audioUnavailableText));
    } else {
      notificationNotice.value =
        result === "unsupported"
          ? t(
              "Den här webbläsaren stöder inte notiser här. Använd en datorwebbläsare med HTTPS.",
            )
          : result === "denied"
            ? t(
                "Notiser är blockerade. Tillåt notiser för den här webbplatsen i webbläsarens inställningar och försök igen.",
              )
            : t(
                "Notiser aktiverades inte. Du kan försöka igen med klockan vid projektet.",
              );
    }
  } catch {
    if (run === generation)
      notificationNotice.value = t(
        "Webbläsaren kunde inte aktivera notiser. Kontrollera webbplatsens behörigheter.",
      );
  } finally {
    await audioReady;
    if (run === generation) notificationPending.value = null;
  }
}
async function sendClosure(lane: Lane, issue: import("./lib/model").Issue) {
  const run = generation;
  try {
    await notifyClosure(lane.repo, issue);
  } catch {
    if (run !== generation) return;
    notificationRepos.value = notificationRepos.value.filter(
      (name) => name !== lane.repo.full_name,
    );
    save();
    notificationNoticeRepo.value = lane.repo.full_name;
    notificationNotice.value = t(
      "Notiser kunde inte visas och har stängts av för {repo}. Kontrollera webbläsarens stöd och behörigheter.",
      { repo: lane.repo.name },
    );
  }
}
function closureFeedback(result: Lane[], fullSnapshot = true) {
  result = result.filter(lane => !lane.loading);
  relationsRevisions.value = { ...relationsRevisions.value, ...Object.fromEntries(result.map(lane => [lane.repo.full_name, (relationsRevisions.value[lane.repo.full_name] ?? 0) + 1])) };
  activity.retain(selected.value);
  activity.update(result, rules.value, Date.now(), { discoverNew: fullSnapshot, observedAt: Object.fromEntries(lastSynced) });
  activityRevision.value++;
  permission.value = notificationPermission();
  statusTracker.retain(selected.value);
  statusPlayer.play(statusTracker.update(result, rules.value, repo => notificationSounds.value && notificationsEnabled(repo), hideCoordination.value));
  for (const lane of result) {
    for (const issue of closureTracker.update(lane)) {
      if (hideCoordination.value && isCoordination(issue)) continue;
      const key = closureKey(lane.repo.full_name, issue);
      recentClosures.value.add(key);
      const timer = setTimeout(() => {
        recentClosures.value.delete(key);
        celebrationTimers.delete(timer);
      }, 6000);
      celebrationTimers.add(timer);
      if (notificationsEnabled(lane.repo.full_name)) {
        void sendClosure(lane, issue);
      }
    }
  }
}
let api: GitHub | null = null;
let generation = 0;
let selectionRevision = 0;
const repositoryRequests = new RepositoryRequestQueue();
let repositoryRequestClient: GitHub | null = null;
// Scan on data changes and when the next work period crosses the threshold, not every second (#120).
const timeoutCheck = ref(0);
let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
const loggedIn = computed(() => Boolean(user.value));
const workspaceOpen = computed(() => loggedIn.value || isDemo.value || publicMode.value);
const connectionLabel = computed(() =>
  loggedIn.value ? t("GitHub anslutet") : publicMode.value ? t("Publik vy") : isDemo.value ? t("Demoläge") : t("Ej ansluten"),
);
const filteredRepos = computed(() =>
  repos.value.filter((r) =>
    r.full_name.toLowerCase().includes(repoQuery.value.toLowerCase()),
  ),
);
const columns = computed(() => [
  { key: "backlog", title: "Backlog", hint: t("Högst prioritet först") },
  {
    key: "progress",
    title: "In progress",
    hint: t("Tid sedan arbetet startade"),
  },
  {
    key: "closed",
    title: "Closed",
    hint: t("Senaste 30 dagarna · nyast först"),
  },
]);
// Per-repository searches belong to the split view only; the combined board uses the main search alone (#132).
const activeRepositoryQueries = computed<Record<string, string>>(() => splitByRepository.value ? repositoryQueries.value : {});
// Filtered and sorted once per data or filter change instead of on every render (#120).
const laneColumns = computed(() => new Map(lanes.value.map((lane) => {
  const issues = lane.issues.filter(
    (i) =>
      (!hideCoordination.value || !isCoordination(i)) &&
      matchesIssueFilters(i, query.value, activeRepositoryQueries.value[lane.repo.full_name] || ""),
  );
  const repoRules = rules.value[lane.repo.full_name];
  return [lane.repo.full_name, { issues, ...Object.fromEntries(columns.value.map(col => [col.key, sortedIssues(issues, col.key, repoRules)])) } as Record<string, Issue[]>];
})));
function laneIssues(lane: Lane) { return laneColumns.value.get(lane.repo.full_name)?.issues ?? []; }
function items(lane: Lane, key: string) { return laneColumns.value.get(lane.repo.full_name)?.[key] ?? []; }
const combinedColumns = computed(() => Object.fromEntries(columns.value.map(col => [col.key, combinedItems(orderedLanes.value, col.key, rules.value, { query: query.value, hideCoordination: hideCoordination.value })])));
// Column estimates (#140) read the filtered issues shown; stable arrays keep the header clocks quiet.
const laneEstimateGroups = computed(() => new Map(lanes.value.map((lane) => [lane.repo.full_name,
  [{ issues: laneColumns.value.get(lane.repo.full_name)?.issues ?? [], rules: rules.value[lane.repo.full_name] }]])));
const combinedEstimateGroups = computed(() => orderedLanes.value.filter((lane) => !lane.loading).map((lane) => ({
  issues: lane.issues.filter((issue) => (!hideCoordination.value || !isCoordination(issue)) && matchesIssueFilters(issue, query.value, "")),
  rules: rules.value[lane.repo.full_name],
})));
// Match the current column calibration, including filters and loading repository exclusion.
provideRepositoryDisplayNames(() => orderedLanes.value.map(lane => lane.repo.full_name), () => !splitByRepository.value);
provideIssueEstimates(() => splitByRepository.value ? laneEstimateGroups.value : new Map(
  orderedLanes.value.filter(lane => !lane.loading).map((lane, index) => [lane.repo.full_name, [combinedEstimateGroups.value[index]!]]),
));
const timeoutCalibrationLanes = computed(() => lanes.value.filter(lane => splitByRepository.value || !lane.loading).map(lane => ({
  ...lane, issues: splitByRepository.value ? laneIssues(lane) : lane.issues.filter(issue =>
    (!hideCoordination.value || !isCoordination(issue)) && matchesIssueFilters(issue, query.value, "")),
})));
watch([lanes, rules, timeoutCheck, timeoutSettings, timeoutCalibrationLanes, showingCache, restoring, busy, hideCoordination], () => {
  clearTimeout(timeoutTimer);
  if (!timeoutSettings.value.timeoutEnabled) {
    timedOut.value = [];
    timeoutTracker.scan(lanes.value, rules.value, timeoutSettings.value, Date.now(), { notify: false });
    return;
  }
  if (busy.value) return;
  const at = Date.now();
  const bases = timeoutBases(timeoutCalibrationLanes.value, rules.value, at);
  const next = nextTimeout(lanes.value, rules.value, timeoutSettings.value, at, bases);
  if (next !== null) timeoutTimer = setTimeout(() => timeoutCheck.value++, Math.min(2147483647, Math.max(1, next - at)));
  const result = timeoutTracker.scan(lanes.value, rules.value, timeoutSettings.value, at,
    { notify: !showingCache.value && !restoring.value, bases });
  timedOut.value = result.active.filter(entry => !hideCoordination.value || !isCoordination(entry.issue));
  for (const entry of result.newlyTimedOut) {
    if ((hideCoordination.value && isCoordination(entry.issue)) || !notificationsEnabled(entry.repo)) continue;
    const repo = lanes.value.find(lane => lane.repo.full_name === entry.repo)?.repo;
    if (repo) void notifyTimeout(repo, entry.issue, entry.estimatedMs, timeoutSettings.value.timeoutOverrunPercent).catch(() => {});
  }
}, { deep: true });
function combinedLimit(key: string) { return combinedLimits.value[key] ?? columnLimit.value; }
watch(columnLimit, () => { combinedLimits.value = {}; });
// One set of loaders per repository and session keeps card props stable between renders (#120).
const loaderCache = new Map<string, { client: GitHub; run: number; comments: (issue: Issue) => ReturnType<GitHub["issueComments"]>;
  relations: (issue: Issue) => ReturnType<GitHub["issueRelations"]>; commit: (issue: Issue) => ReturnType<GitHub["closingCommit"]> }>();
function loaders(repo: string) {
  const client = api;
  const run = generation;
  if (!client) return undefined;
  const cached = loaderCache.get(repo);
  if (cached?.client === client && cached.run === run) return cached;
  const guard = <T,>(result: T) => {
    if (client !== api || run !== generation) throw new Error("Session changed");
    return result;
  };
  const created = { client, run,
    comments: async (issue: Issue) => guard(await client.issueComments(repo, issue.number)),
    relations: async (issue: Issue) => guard(await client.issueRelations(repo, issue)),
    commit: async (issue: Issue) => guard(await client.closingCommit(repo, issue)) };
  loaderCache.set(repo, created);
  return created;
}
const subIssueBoardIndex = computed(() => new Map(lanes.value.map(lane =>
  [lane.repo.full_name.toLowerCase(), new Map(lane.issues.map(issue => [issue.id, issue]))])));
provideSubIssues({
  async load(repository, issue) {
    const client = api, run = generation;
    if (!client || isDemo.value) return null;
    const result = await client.subIssues(repository, issue);
    return client === api && run === generation ? result : null;
  },
  rules: repository => rules.value[repository] ?? Object.entries(rules.value).find(([name]) => name.toLowerCase() === repository.toLowerCase())?.[1] ?? {},
  known: (repository, id) => subIssueBoardIndex.value.get(repository.toLowerCase())?.get(id),
  revision: repository => relationsRevisions.value[repository] ?? 0,
});
const statisticsRepositories = computed(() => orderedLanes.value.map(lane => lane.repo));
const unreadOverviewCount = computed(() => {
  activityRevision.value;
  return countUnreadActivity(activity, lanes.value, activityNow.value,
    issue => !hideCoordination.value || !isCoordination(issue));
});
const sidebarRepos = computed(() => {
  activityRevision.value;
  return summarizeLanes(orderedLanes.value, rules.value, hideCoordination.value,
    (repo, issue) => activity.changedAt(repo, issue, activityNow.value));
});
const stats = computed(() => {
  const all = lanes.value.flatMap((l) =>
    laneIssues(l).map((i) => ({ i, r: rules.value[l.repo.full_name] })),
  );
  return {
    open: all.filter(({ i }) => i.state === "open").length,
    progress: all.filter(({ i, r }) => column(i, r) === "progress").length,
    closed: all.filter(({ i }) => i.state === "closed").length,
  };
});
const workspaceRepositoryColors = computed(() => reconcileRepositoryColors(
  isDemo.value ? lanes.value.map(lane => lane.repo.full_name) : selected.value, repositoryColors.value,
));
const transferablePreferences = computed<HandoffPreferences>(() => ({
  repositoryColors: workspaceRepositoryColors.value,
  projectOrder: projectOrder.value, collapsedRepos: collapsedRepos.value,
  columnLimit: columnLimit.value, repositoryColumnLimits: repositoryColumnLimits.value,
  notificationRepos: notificationRepos.value, notificationSounds: notificationSounds.value, language: preference.value,
  query: query.value, repositoryQueries: repositoryQueries.value, repoQuery: repoQuery.value,
  hideCoordination: hideCoordination.value, splitByRepository: splitByRepository.value,
  listMode: listMode.value, ...timeoutSettings.value,
  currentView: currentView.value as "overview" | "statistics", statistics: statisticsPreferences.value,
}));
function applyChosenPreferences(value: HandoffPreferences, preserveNavigation = false) {
  repositoryColors.value = value.repositoryColors ?? repositoryColors.value;
  projectOrder.value = value.projectOrder ?? projectOrder.value;
  collapsedRepos.value = value.collapsedRepos ?? collapsedRepos.value;
  columnLimit.value = value.columnLimit ?? columnLimit.value;
  repositoryColumnLimits.value = value.repositoryColumnLimits ?? repositoryColumnLimits.value;
  notificationRepos.value = value.notificationRepos ?? notificationRepos.value;
  notificationSounds.value = value.notificationSounds ?? notificationSounds.value;
  if (value.language !== undefined) setLanguage(value.language);
  query.value = value.query ?? query.value;
  repositoryQueries.value = value.repositoryQueries ?? repositoryQueries.value;
  repoQuery.value = value.repoQuery ?? repoQuery.value;
  hideCoordination.value = value.hideCoordination ?? hideCoordination.value;
  splitByRepository.value = value.splitByRepository ?? splitByRepository.value;
  listMode.value = value.listMode ?? listMode.value;
  const legacyTimeout = value.timeoutMinutes !== undefined && value.timeoutEnabled === undefined && value.timeoutOverrunPercent === undefined;
  timeoutSettings.value = normalizeTimeoutSettings(legacyTimeout ? {} : { ...timeoutSettings.value, ...value });
  statisticsPreferences.value = value.statistics ?? statisticsPreferences.value;
  if (value.currentView && !(preserveNavigation && /^#(?:overview|statistics(?:-repo-\d+)?|repo-\d+)$/.test(window.location.hash))) {
    currentView.value = value.currentView;
    history.replaceState(null, "", "#" + value.currentView);
  }
  visibleLimit.value = {};
  combinedLimits.value = {};
}
function applyImportedPreferences(incoming: HandoffSettings, available: Repo[]) {
  const state = mergeHandoffPreferences({ ...transferablePreferences.value, selected: selected.value, rules: rules.value }, incoming, available.map(repo => repo.full_name));
  selected.value = state.selected;
  rules.value = state.rules;
  applyChosenPreferences(state);
  return save();
}
watch([query, repositoryQueries, repoQuery, hideCoordination, splitByRepository, listMode, currentView, statisticsPreferences, preference], () => save(), { deep: true });
// Periodic Background Sync (#129): keep the installed app's background check registered only
// while a signed-in account has notifications on for a selected repository. Untouched elsewhere.
const scheduleBackgroundCheck = createBackgroundCheckScheduler();
// A string key so the browser is only called when the effective state actually changes.
watch(() => restoring.value ? "" : JSON.stringify({
  loggedIn: loggedIn.value,
  demo: isDemo.value,
  notificationRepos: permission.value === "granted" ? notificationRepos.value.filter(repo => selected.value.includes(repo)) : [],
}), (key) => { if (key) void scheduleBackgroundCheck(JSON.parse(key)); }, { immediate: true });
/** Login whose encrypted settings were read successfully; saves for other accounts, or after a
 * failed read, are skipped so a transient storage error never overwrites saved settings. */
let settingsAccount: string | null = null;
type LoadedSettings = { login: string; value: Record<string, any> | null; readable: boolean };
async function readSettings(login: string): Promise<LoadedSettings> {
  try {
    const value = await loadSettings(login);
    return { login, value: value && typeof value === "object" ? value as Record<string, any> : null, readable: true };
  } catch {
    return { login, value: null, readable: false };
  }
}
/** Resolves once the encrypted write settles; failures never reject. */
function save(): Promise<void> {
  const account = publicMode.value ? PUBLIC_SETTINGS_ACCOUNT : user.value?.login;
  if (!account || settingsAccount !== account) return Promise.resolve();
  repositoryColors.value = workspaceRepositoryColors.value;
  try {
    return saveSettings(account, {
        ...(publicMode.value ? { publicRepositories: repos.value } : {}),
        preferences: transferablePreferences.value,
        selected: selected.value,
        projectOrder: projectOrder.value,
        collapsedRepos: collapsedRepos.value,
        rules: rules.value,
        columnLimit: columnLimit.value,
        repositoryColumnLimits: repositoryColumnLimits.value,
        notificationRepos: notificationRepos.value,
        activityRead: activity.acknowledgements(),
        permissionAcknowledgements: permissionAcknowledgements.value,
        ...timeoutSettings.value,
      }).catch(() => { /* App remains usable without storage. */ });
  } catch {
    return Promise.resolve(); // Unserializable state must not break the board.
  }
}
function restorePreferences(available: Repo[], settings: LoadedSettings) {
    settingsAccount = settings.readable ? settings.login : null;
    permissionAcknowledgements.value = [];
    repositoryColors.value = {};
    projectOrder.value = reconcileOrder([], available.map(repo => repo.full_name));
    collapsedRepos.value = [];
    columnLimit.value = defaultColumnLimit;
    timeoutSettings.value = normalizeTimeoutSettings({});
    repositoryColumnLimits.value = {};
    visibleLimit.value = {};
    combinedLimits.value = {};
    query.value = ""; repositoryQueries.value = {}; repoQuery.value = "";
    hideCoordination.value = true; splitByRepository.value = true; statisticsPreferences.value = {};
    listMode.value = false;
    notificationSounds.value = true;
    try {
      const saved = settings.value;
      if (saved) {
        timeoutSettings.value = normalizeTimeoutSettings(saved);
        const limits = restoreColumnLimits(saved, available.map(repo => repo.full_name));
        columnLimit.value = limits.global;
        repositoryColumnLimits.value = limits.overrides;
        const layout = restoreLayout(saved, available.map(repo => repo.full_name));
        projectOrder.value = layout.order;
        collapsedRepos.value = layout.collapsed;
        activity.restore(saved.activityRead);
        permissionAcknowledgements.value = restorePermissionAcknowledgements(saved.permissionAcknowledgements);
        selected.value = Array.isArray(saved.selected)
          ? saved.selected.filter(
              (n: unknown) =>
                typeof n === "string" &&
                available.some((r) => r.full_name === n),
            )
          : [];
        notificationRepos.value = Array.isArray(saved.notificationRepos)
          ? saved.notificationRepos.filter(
              (name: unknown) =>
                typeof name === "string" &&
                available.some((repo) => repo.full_name === name),
            )
          : [];
        rules.value =
          saved.rules && typeof saved.rules === "object" ? saved.rules : {};
        if (saved.preferences) {
          const preferences = parseHandoffPreferences(saved.preferences);
          const state = mergeHandoffPreferences({ ...transferablePreferences.value, selected: selected.value, rules: rules.value }, { selected: selected.value, rules: rules.value, preferences }, available.map(repo => repo.full_name));
          applyChosenPreferences(state, true);
        }
      }
    } catch {
      /* Ignore invalid preferences. */
    }
}
/** Anonymous workspaces never create, replace or delete a credential. */
async function openPublicWorkspace() {
  if (authBusy.value) return;
  authBusy.value = true;
  const run = ++generation;
  selectionRevision++; repositoryRequests.clear(); clearClosureFeedback();
  const client = new GitHub();
  try {
    const [settings, snapshots] = await Promise.all([readSettings(PUBLIC_SETTINGS_ACCOUNT), readPublicContent()]);
    const available: Repo[] = Array.isArray(settings.value?.publicRepositories)
      ? settings.value!.publicRepositories.slice(0, 100).map(publicRepositoryRecord).filter((repo: Repo | null): repo is Repo => repo !== null) : [];
    if (run !== generation) return;
    api = client; sessionToken.value = ""; user.value = null;
    isDemo.value = false; publicMode.value = true;
    publicSnapshots = snapshots.filter(entry => available.some(repo => repo.id === entry.lane.repo.id && repo.full_name === entry.lane.repo.full_name));
    lastSynced.clear(); lastFullSynced.clear(); repoSyncedAt.value = {}; refreshed.value = null;
    lanes.value = []; repos.value = available; selected.value = []; notificationRepos.value = [];
    restorePreferences(available, settings);
    rememberPublicWorkspace(true);
    reconcileSelection();
    error.value = ""; tokenPanel.value = false; tokenInput.value = "";
    if (selected.value.length) await refreshPublicSelection();
    else picker.value = true;
  } catch (cause) { error.value = message(cause); }
  finally { authBusy.value = false; }
}
/** Restoring or changing public selection only fetches missing/expired whole repositories. */
async function refreshPublicSelection() {
  const now = Date.now();
  publicSnapshots = publicSnapshots.filter(entry => now >= entry.syncedAt && now - entry.syncedAt < PUBLIC_CONTENT_LIFETIME_MS);
  const usable = new Map(publicSnapshots.map(entry => [entry.lane.repo.full_name, entry]));
  lanes.value = lanes.value.map(lane => {
    const cached = usable.get(lane.repo.full_name);
    if (!cached || cached.lane.repo.id !== lane.repo.id) return lane;
    markSynced([lane.repo.full_name], cached.syncedAt);
    return lane.loading ? { ...cached.lane, issues: cached.lane.issues.filter(issue => issue.state !== "closed" || Date.parse(issue.closed_at!) >= now - 30 * 86400000) } : lane;
  });
  const missing = selected.value.filter(name => !usable.has(name));
  const times = selected.value.flatMap(name => usable.has(name) ? [usable.get(name)!.syncedAt] : []);
  refreshed.value = times.length ? Math.min(...times) : null;
  if (missing.length) await refresh(false, true, false, false, missing);
}
async function addPublicRepository() {
  const client = api, run = generation;
  if (!publicMode.value || !client || publicRepoBusy.value) return;
  publicRepoBusy.value = true; publicRepoError.value = "";
  try {
    const repo = await client.publicRepository(publicRepoInput.value);
    if (client !== api || run !== generation || !publicMode.value) return;
    if (!repos.value.some(entry => entry.id === repo.id)) repos.value = [...repos.value, repo];
    if (!pendingSelected.value.includes(repo.full_name)) pendingSelected.value = [...pendingSelected.value, repo.full_name];
    publicRepoInput.value = "";
    await save();
  } catch (cause) { if (run === generation) publicRepoError.value = message(cause); }
  finally { if (run === generation) publicRepoBusy.value = false; }
}
/** Resolves true when the account connected live; failures are shown in `error` instead of thrown. */
async function connect(token: string, imported?: HandoffSettings, cached?: ContentSnapshot | null): Promise<boolean> {
  if (authBusy.value) return false;
  authBusy.value = true;
  error.value = "";
  // Set once GitHub accepted the token, so a later board refresh failure still counts as connected.
  let connected = false;
  try {
    if (imported && token === sessionToken.value && api && user.value && !isDemo.value) {
      const available = await api.repos();
      repos.value = available;
      await applyImportedPreferences(imported, available);
      reconcileSelection();
      await refresh(false, true);
      return true;
    }
    const next = new GitHub(token);
    // Read before changing any state, so the cached board appears with its settings at once.
    const cachedSettings = cached ? await readSettings(cached.user.login) : null;
    if (cached && cachedSettings) {
      generation++;
      next.restoreResponses(cached.responses);
      clearClosureFeedback();
      api = next;
      user.value = cached.user;
      sessionToken.value = token;
      repos.value = cached.repos;
      restorePreferences(cached.repos, cachedSettings);
      renderLanesGradually();
      measureRender("cache-first-render", nextTick);
      lanes.value = cached.lanes.filter(lane => selected.value.includes(lane.repo.full_name));
      refreshed.value = cached.syncedAt;
      repoSyncedAt.value = {};
      if (cached.syncedAt) markSynced(lanes.value.map(lane => lane.repo.full_name), cached.syncedAt);
      showingCache.value = true;
      activity.update(lanes.value, rules.value);
      for (const lane of lanes.value) closureTracker.update(lane);
    }
    const identity = await next.user();
    const available = await next.repos();
    const liveSettings = cached?.user.login === identity.login ? null : await readSettings(identity.login);
    connected = true;
    let storageWarning = "";
    try {
      await saveToken(token);
      savedSession.value = true;
    } catch (cause) {
      storageWarning = message(cause);
    }
    if (!cached) generation++;
    lastSynced.clear();
    lastFullSynced.clear();
    sessionToken.value = token;
    api = next;
    publicMode.value = false; rememberPublicWorkspace(false);
    user.value = identity;
    repos.value = available;
    const sameCachedIdentity = cached?.user.login === identity.login;
    if (!sameCachedIdentity) {
      lanes.value = [];
      selected.value = [];
      rules.value = {};
      notificationRepos.value = [];
      clearClosureFeedback();
    }
    isDemo.value = false;
    tokenPanel.value = false;
    tokenInput.value = "";
    if (sameCachedIdentity) {
      // Revalidate repository access without resetting the already visible layout,
      // read markers or settings the user may have edited while GitHub was slow.
      const accessible = new Set(available.map(repo => repo.full_name));
      selected.value = selected.value.filter(name => accessible.has(name));
      projectOrder.value = reconcileOrder(projectOrder.value, [...accessible]);
      collapsedRepos.value = collapsedRepos.value.filter(name => accessible.has(name));
      notificationRepos.value = notificationRepos.value.filter(name => accessible.has(name));
      repositoryColumnLimits.value = Object.fromEntries(Object.entries(repositoryColumnLimits.value).filter(([name]) => accessible.has(name)));
      rules.value = Object.fromEntries(Object.entries(rules.value).filter(([name]) => accessible.has(name)));
    } else restorePreferences(available, liveSettings!);
    // Commit imported settings before their lanes appear, so an immediate reload keeps them.
    if (imported) await applyImportedPreferences(imported, available);
    reconcileSelection();
    if (selected.value.length) await refresh(false, true);
    else { picker.value = true; showingCache.value = false; await persistContent(); }
    if (storageWarning) error.value = storageWarning;
    return true;
  } catch (e) {
    error.value = message(e);
    return connected;
  } finally {
    authBusy.value = false;
  }
}
function message(e: unknown) {
  return e instanceof Error ? t(e.message) : t("Något gick fel. Försök igen.");
}
function reconcileSelection() {
  selectionRevision++;
  busy.value = false;
  const accessible = new Set(repos.value.map(repo => repo.full_name));
  selected.value = [...new Set(selected.value)].filter(name => accessible.has(name));
  lanes.value = selectedLanes(lanes.value, repos.value, selected.value);
  closureTracker.retain(selected.value);
  activity.retain(selected.value);
  activityRevision.value++;
  statusTracker.retain(selected.value);
  statusPlayer.clear();
  recentClosures.value = new Set([...recentClosures.value].filter(key => selected.value.some(name => key.startsWith(name + ":"))));
  timedOut.value = timedOut.value.filter(entry => selected.value.includes(entry.repo));
  for (const name of lastSynced.keys()) if (!selected.value.includes(name)) lastSynced.delete(name);
  for (const name of lastFullSynced.keys()) if (!selected.value.includes(name)) lastFullSynced.delete(name);
}
/**
 * `activeOnly` is the 15-second tick: one conditional list per repository with active issues (#123).
 * `only` limits a manual run to the repositories whose header status was clicked (#149).
 */
async function refresh(incremental = false, replacePending = false, manual = false, activeOnly = false, only?: readonly string[]) {
  if (!api) {
    refreshRequested = false;
    requestedRepos = new Set();
    return;
  }
  if (busy.value && !replacePending) {
    if (manual && only) { if (!fullRefreshRunning) only.forEach(name => requestedRepos.add(name)); }
    else if (manual && !fullRefreshRunning) refreshRequested = true;
    return;
  }
  refreshRequested = false;
  if (!only && !incremental) requestedRepos = new Set();
  const client = api, run = generation, selection = selectionRevision;
  const current = () => run === generation && client === api && selection === selectionRevision;
  if (repositoryRequestClient !== client) {
    repositoryRequests.clear();
    repositoryRequestClient = client;
  }
  const reconciled = selectedLanes(lanes.value, repos.value, selected.value);
  if (!sameLaneList(reconciled, lanes.value)) lanes.value = reconciled;
  if (!selected.value.length) {
    busy.value = false;
    showingCache.value = false;
    await persistContent();
    return;
  }
  busy.value = true;
  fullRefreshRunning = !incremental && !only;
  if (!activeOnly) error.value = "";
  const targets = repos.value.filter(repo => selected.value.includes(repo.full_name) && (!only || only.includes(repo.full_name)) &&
    (!activeOnly || lanes.value.some(lane => lane.repo.full_name === repo.full_name && laneHasActiveIssues(lane)))).sort((a, b) =>
    Number(!!lanes.value.find(lane => lane.repo.full_name === b.full_name)?.loading) - Number(!!lanes.value.find(lane => lane.repo.full_name === a.full_name)?.loading));
  const result: Lane[] = [];
  let cursor = 0;
  try {
    // A targeted refresh only drops and refetches relations for the repositories it updates (#149).
    if (!incremental) client.invalidateIssueRelations(only);
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (cursor < targets.length && current()) {
        const repo = targets[cursor++]!;
        markSyncing(repo.full_name, 1);
        try {
          const repoRules = { ...rules.value[repo.full_name] };
          const key = JSON.stringify([repo.full_name, Object.entries(repoRules).sort(([a], [b]) => a.localeCompare(b))]);
          const loaded = await repositoryRequests.run(key, async () => {
            if (run !== generation || client !== api || !selected.value.includes(repo.full_name)) throw new RepositoryRequestCancelled();
            const started = Date.now();
            const previous = lanes.value.find(lane => lane.repo.full_name === repo.full_name);
            const since = lastSynced.get(repo.full_name);
            const full = !incremental || !previous || previous.loading || previous.error || !since || (lastFullSynced.get(repo.full_name) || 0) <= started - 30 * 60000;
            const lane = full ? await client.lane(repo, repoRules, previous && !previous.loading ? previous : undefined) : await client.syncLane(previous!, repoRules, lastFullSynced.get(repo.full_name)!, { labels: !activeOnly });
            return { lane, started, full };
          });
          if (!current() || !selected.value.includes(repo.full_name)) continue;
          lastSynced.set(repo.full_name, loaded.started);
          const syncedAt = Date.now();
          markSynced([repo.full_name], syncedAt);
          if (loaded.full) lastFullSynced.set(repo.full_name, loaded.started);
          // An unchanged sync (e.g. all 304) keeps the shown lane object, so nothing re-renders or is rewritten (#122).
          const shown = lanes.value.find(lane => lane.repo.full_name === repo.full_name);
          const synced = withWorkStarts(loaded.lane);
          const lane = sameLaneContent(shown, synced) ? shown : synced;
          if (publicMode.value && !lane.loading && !lane.error) publicSnapshots = [...publicSnapshots.filter(entry => entry.lane.repo.full_name !== repo.full_name), { lane, syncedAt }];
          result.push(lane);
          closureFeedback([lane]);
          if (lane !== shown) lanes.value = lanes.value.map(entry => entry.repo.full_name === repo.full_name ? lane : entry);
        } catch (cause) {
          if (!current() || cause instanceof RepositoryRequestCancelled) continue;
          const old = lanes.value.find(lane => lane.repo.full_name === repo.full_name);
          if (!old || !selected.value.includes(repo.full_name)) continue;
          const reason = message(cause);
          // A repeated identical failure keeps the shown lane instead of rewriting the cache again.
          const failed = !old.loading && old.error === reason ? old : { ...old, loading: false, error: reason };
          result.push(failed);
          if (failed !== old) lanes.value = lanes.value.map(lane => lane.repo.full_name === repo.full_name ? failed : lane);
        } finally {
          markSyncing(repo.full_name, -1);
        }
      }
    }));
    if (current()) {
      if (publicMode.value) {
        const times = publicSnapshots.filter(entry => selected.value.includes(entry.lane.repo.full_name)).map(entry => entry.syncedAt);
        refreshed.value = times.length ? Math.min(...times) : null;
      }
      if (!only && result.every(lane => !lane.error)) {
        refreshed.value = Date.now();
        showingCache.value = false;
      }
      await persistContent(incremental);
      if (incremental && result.some(lane => lane.error)) throw new Error(result.find(lane => lane.error)!.error);
    }
  } finally {
    if (current()) busy.value = false;
  }
}

function toggleRepo(name: string) {
  pendingSelected.value = pendingSelected.value.includes(name)
    ? pendingSelected.value.filter((n) => n !== name)
    : [...pendingSelected.value, name];
}
async function applyRepos() {
  // Capture initial/default assignments before changing membership.
  repositoryColors.value = workspaceRepositoryColors.value;
  selected.value = [...pendingSelected.value];
  reconcileSelection();
  picker.value = false;
  save();
  if (publicMode.value) await refreshPublicSelection();
  else await refresh(false, true);
}
function showDemo() {
  timeoutSettings.value = normalizeTimeoutSettings({});
  notificationSounds.value = true;
  permissionAcknowledgements.value = [];
  repositoryColors.value = {};
  splitByRepository.value = true;
  listMode.value = false;
  combinedLimits.value = {};
  generation++;
  selectionRevision++;
  repositoryRequests.clear();
  clearClosureFeedback();
  isDemo.value = true;
  columnLimit.value = defaultColumnLimit;
  repositoryColumnLimits.value = {};
  visibleLimit.value = {};
  projectOrder.value = [];
  collapsedRepos.value = [];
  lanes.value = demo();
  refreshed.value = Date.now();
  repoSyncedAt.value = {};
  markSynced(lanes.value.map(lane => lane.repo.full_name), refreshed.value);
  error.value = "";
}
async function confirmLogout() {
  if (logoutBusy.value || authBusy.value) return;
  logoutBusy.value = true;
  try {
    await clearToken();
    logoutPrompt.value = false;
    savedSession.value = false;
    logout();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    logoutBusy.value = false;
  }
}
function logout() {
  mobileToolsOpen.value = false;
  rememberPublicWorkspace(false); publicRepoInput.value = ""; publicRepoError.value = ""; publicRepoBusy.value = false;
  timeoutSettings.value = normalizeTimeoutSettings({});
  notificationSounds.value = true;
  settingsAccount = null; publicMode.value = false; publicSnapshots = []; // Encrypted settings stay saved for this account's next sign-in.
  permissionAcknowledgements.value = [];
  repositoryColors.value = {};
  showingCache.value = false;
  cacheWarning.value = "";
  tokenInput.value = "";
  tokenPanel.value = false;
  lastSynced.clear();
  lastFullSynced.clear();
  syncError.value = "";
  sessionToken.value = "";
  handoffOpen.value = false;
  generation++;
  selectionRevision++;
  repositoryRequests.clear();
  clearClosureFeedback();
  notificationRepos.value = [];
  notificationPending.value = null;
  api = null;
  user.value = null;
  lanes.value = [];
  repos.value = [];
  selected.value = [];
  projectOrder.value = [];
  collapsedRepos.value = [];
  layoutAnnouncement.value = "";
  rules.value = {};
  columnLimit.value = defaultColumnLimit;
  repositoryColumnLimits.value = {};
  visibleLimit.value = {};
  isDemo.value = false;
  busy.value = false;
  error.value = "";
  query.value = "";
  currentView.value = "overview";
  history.replaceState(null, "", "#overview");
  splitByRepository.value = true;
  listMode.value = false;
  combinedLimits.value = {};
  repositoryQueries.value = {};
  picker.value = false;
  editing.value = null;
  refreshed.value = null;
  repoSyncedAt.value = {};
}
async function oauth() {
  try {
    error.value = "";
    await login();
  } catch (e) {
    error.value = message(e);
  }
}
function editRules(lane: Lane) {
  if (notificationPending.value === null && notificationNoticeRepo.value !== lane.repo.full_name) notificationNotice.value = "";
  editing.value = lane.repo.full_name;
  rules.value[lane.repo.full_name] ||= {};
}
async function applyRules() {
  editing.value = null;
  save();
  await refresh();
}
let previousFocus: HTMLElement | null = null;
const pickerDialog = ref<HTMLElement | null>(null);
const rulesDialog = ref<HTMLElement | null>(null);
const modalOpen = computed(() => picker.value || Boolean(editing.value));
const openModal = () => (picker.value ? pickerDialog.value : editing.value ? rulesDialog.value : null);
function modalFocusables(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ).filter(
    (node) =>
      !(node as HTMLButtonElement).disabled &&
      !node.closest("[inert], dialog:not([open])") &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== "hidden",
  );
}
watch(modalOpen, async (open) => {
  if (open) {
    previousFocus = document.activeElement as HTMLElement;
    await nextTick();
    document.body.style.overflow = "hidden";
    const dialog = openModal();
    if (dialog) modalFocusables(dialog)[0]?.focus();
  } else {
    document.body.style.overflow = "";
    const target = previousFocus;
    previousFocus = null;
    if (target?.isConnected) target.focus();
  }
});
function closeModal() {
  if (editing.value) void applyRules();
  else if (picker.value) picker.value = false;
}
function trapFocus(event: KeyboardEvent) {
  if (!modalOpen.value) return;
  const dialog = openModal();
  if (!dialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = modalFocusables(dialog);
  const first = nodes[0],
    last = nodes.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (!active || !dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(() => document.addEventListener("keydown", trapFocus));
onUnmounted(() => document.removeEventListener("keydown", trapFocus));
function laneHasActiveIssues(lane: Lane) {
  return lane.issues.some(
    (issue) =>
      column(issue, rules.value[lane.repo.full_name]) === "progress" &&
      (!hideCoordination.value || !isCoordination(issue)),
  );
}
const sync = createIssueSync({
  canSync: () =>
    Boolean(api) &&
    loggedIn.value &&
    selected.value.length > 0 &&
    !authBusy.value &&
    !restoring.value &&
    !picker.value &&
    !editing.value &&
    navigator.onLine &&
    (!document.hidden ||
      (notificationPermission() === "granted" &&
        selected.value.some((repo) => notificationRepos.value.includes(repo)))),
  hasActiveIssues: () => lanes.value.some(laneHasActiveIssues),
  refreshActive: () => refresh(true, false, false, true),
  reconcile: () => refresh(true),
  retryAfterMs: () => api?.retryAfterMs(),
  onError: (cause) => {
    syncError.value = message(cause);
  },
  onSuccess: () => {
    syncError.value = "";
  },
});
// Background statistics (#135): fill the encrypted statistics cache in idle portions; the module
// and collector load on demand, and board sync, restoration and the Statistics view take priority.
let statisticsBackground: import("./lib/statistics-background").StatisticsBackground | null = null;
let statisticsBackgroundRun = 0;
/** Repository issue events from the session's statistics, kept in memory only (#141). */
const workEvents = new Map<string, readonly RepositoryIssueEvent[]>();
/** Closed issues' work starts derived from already fetched statistics events, without requests (#141). */
function withWorkStarts(lane: Lane): Lane {
  const events = workEvents.get(lane.repo.full_name);
  return events && !lane.loading ? deriveWorkStarts(lane, events, { ...rules.value[lane.repo.full_name] }) : lane;
}
function statisticsCollected(data: import("./lib/statistics").StatisticsData) {
  if (!data.events?.data.length) return;
  workEvents.set(data.repository, data.events.data as RepositoryIssueEvent[]);
  if (!selected.value.includes(data.repository)) return;
  let changed = false;
  const next = lanes.value.map(lane => {
    if (lane.repo.full_name !== data.repository) return lane;
    const derived = withWorkStarts(lane);
    changed ||= derived !== lane;
    return derived;
  });
  if (changed) { lanes.value = next; void persistContent(true); }
}
function restartStatisticsBackground() {
  const run = ++statisticsBackgroundRun;
  statisticsBackground?.stop(); statisticsBackground = null;
  workEvents.clear();
  const client = api, token = sessionToken.value;
  if (!client || !token || !user.value || isDemo.value) return;
  void import("./lib/statistics-background").then(({ StatisticsBackground }) => {
    if (run !== statisticsBackgroundRun || client !== api || token !== sessionToken.value) return;
    statisticsBackground = new StatisticsBackground({
      client, token,
      repositories: () => statisticsRepositories.value.filter((repo, index) => !statisticsRepositoryCollapsed(statisticsPreferences.value, repo.full_name, index)).map(repo => repo.full_name),
      busy: () => busy.value || restoring.value || authBusy.value || logoutBusy.value || picker.value || editing.value !== null,
      allowed: () => client === api && token === sessionToken.value && !isDemo.value && currentView.value !== "statistics",
      collected: data => { if (run === statisticsBackgroundRun && client === api) statisticsCollected(data); },
    });
    statisticsBackground.start();
  }, () => undefined);
}
watch([sessionToken, () => user.value?.login, isDemo], restartStatisticsBackground);
// Statistics the view collected reach the board's work starts as soon as the board is back (#148).
watch(currentView, (view, previous) => { if (previous === "statistics" && view !== "statistics") statisticsBackground?.wake(); });
function handleRefreshShortcut(event: KeyboardEvent) {
  if ((!loggedIn.value && !publicMode.value) || isDemo.value || event.defaultPrevented || !isDataRefreshShortcut(event)) return;
  // Prevent document reload even while a fetch is already running.
  event.preventDefault();
  if (!event.repeat && !authBusy.value) void refresh(false, false, true);
}
function resumeStatusAudio(event: Event) {
  if (event.isTrusted && notificationSounds.value && notificationRepos.value.some(notificationsEnabled)) void statusPlayer.unlock();
}
// The header stays sticky (#145, #153); its measured height keeps anchor jumps clear of it.
const topbar = ref<HTMLElement | null>(null);
let topbarObserver: ResizeObserver | undefined;
onMounted(() => {
  if (topbar.value && typeof ResizeObserver !== "undefined") {
    topbarObserver = new ResizeObserver(() => {
      if (topbar.value) document.documentElement.style.setProperty("--topbar-height", `${topbar.value.offsetHeight}px`);
    });
    topbarObserver.observe(topbar.value);
  }
});
onUnmounted(() => topbarObserver?.disconnect());
onMounted(() => {
  sync.start();
  window.addEventListener("hashchange", navigateWorkspace);
  document.addEventListener("keydown", handleRefreshShortcut);
  document.addEventListener("pointerdown", resumeStatusAudio, { passive: true });
  document.addEventListener("keydown", resumeStatusAudio);
});

onUnmounted(() => {
  clearRepositoryHighlight();
  clearTimeout(activityTimer);
  clearTimeout(timeoutTimer);
  sync.stop();
  statisticsBackgroundRun++; statisticsBackground?.stop();
  window.removeEventListener("hashchange", navigateWorkspace);
  document.removeEventListener("keydown", handleRefreshShortcut);
  document.removeEventListener("pointerdown", resumeStatusAudio);
  document.removeEventListener("keydown", resumeStatusAudio);
  clearClosureFeedback();
});
onMounted(async () => {
  // A rejected handoff or OAuth link must not hide a saved session: remember its error,
  // restore the saved board as usual and show the error over it.
  let linkError = "";
  try {
    // Remove recognized credential fragments before authentication or network calls.
    let incoming: ReturnType<typeof consumeHandoff> = null;
    try { incoming = consumeHandoff(); } catch (e) { linkError = message(e); }
    if (incoming) {
      let remembered: string | null = null, vaultError: unknown;
      try { remembered = await loadToken(); } catch (e) { vaultError = e; }
      if (remembered === incoming.token || (!remembered && !vaultError)) {
        if (await connect(incoming.token, incoming) || !remembered) return;
        // The saved token itself failed to connect live; fall back to its cached board.
        linkError = error.value;
        savedSession.value = true;
        await connect(remembered, undefined, await readSnapshot(remembered));
        return;
      }
      savedSession.value = true;
      const snapshot = remembered ? await readSnapshot(remembered) : null;
      let confirmed = false, lookupError = "";
      try {
        const current = snapshot?.user.login ?? (remembered ? (await new GitHub(remembered).user().catch(() => null))?.login ?? null : null);
        confirmed = await confirmAccountSwitch(current, incoming.token);
      } catch (e) {
        lookupError = message(e);
      }
      if (confirmed) {
        if (await connect(incoming.token, incoming)) return;
        linkError = error.value;
      }
      if (remembered) await connect(remembered, undefined, snapshot);
      else if (!linkError) error.value = message(vaultError);
      if (lookupError && !error.value) error.value = lookupError;
      return;
    }
    // callback() scrubs ?code/?error from the address before its token exchange or any failure.
    let oauthToken: string | null = null;
    try { oauthToken = await callback(); } catch (e) { linkError ||= message(e); }
    if (oauthToken) {
      if (await connect(oauthToken)) return;
      linkError = error.value;
    }
    if (publicWorkspaceRemembered()) await openPublicWorkspace();
    else {
      const remembered = await loadToken();
      if (remembered) {
        savedSession.value = true;
        await connect(remembered, undefined, await readSnapshot(remembered));
      }
    }
  } catch (e) {
    if (e instanceof VaultError) savedSession.value = true;
    error.value = message(e);
  } finally {
    // A genuine restore error takes precedence; otherwise the link error stays visible.
    if (linkError && !error.value) error.value = linkError;
    restoring.value = false;
  }
});
</script>
<template>
  <aside class="sidebar">
    <a class="brand" href="." :aria-label="t('Issueflow startsida')"
      ><span class="brand-icon"><Layers3 :size="23" /></span
      ><span class="brand-copy"
        >issueflow<span class="brand-dot">.</span
        ><small>{{ t("AI-agenter · GitHub-issues") }}</small></span
      ></a
    ><span class="nav-caption">WORKSPACE</span>
    <nav class="workspace-navigation">
    <a class="nav-item" :class="{ active: currentView === 'overview' }" href="#overview" :aria-label="t('Översikt')" aria-describedby="overview-unread-count"
      :aria-current="workspaceOpen && currentView === 'overview' ? 'page' : undefined">
      <LayoutDashboard :size="18" /> {{ t("Översikt") }}
      <span id="overview-unread-count" class="nav-count" :title="t('{count} olästa händelser', { count: unreadOverviewCount })" :aria-label="t('{count} olästa händelser', { count: unreadOverviewCount })">{{ unreadOverviewCount }}</span>
    </a>
    <a v-if="workspaceOpen" class="nav-item statistics-nav" :class="{ active: currentView === 'statistics' }" href="#statistics"
      :aria-label="t('Statistik')" :title="t('Statistik')" :aria-current="currentView === 'statistics' ? 'page' : undefined">
      <Activity :size="18" /><span>{{ t("Statistik") }}</span>
    </a>
    </nav>
    <SidebarRepositories
      :statistics="currentView === 'statistics'"
      :repos="sidebarRepos"
      :repository-colors="workspaceRepositoryColors"
      :can-select="loggedIn || publicMode"
      :restoring="restoring && !workspaceOpen"
      @select="picker = true"
      @move="moveRepository"
      @reorder="reorderProject"
      @interest="refreshStaleRepository"
      @activate="activateSidebarRepository"
    />
    <SidebarVersion ref="sidebarVersion" :available="updateAvailable" :checked="updateChecked" :checking="updateChecking"
      @release-notes="openReleaseNotes()" @open-update="openUpdateDialog" />
    <a class="sidebar-footer" href="https://github.com/solwation/github-dashboard/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
      <Github :size="19" aria-hidden="true" />
      <span class="sidebar-credits">
        <span>Olof Wingren</span>
        <small class="sidebar-license-label">MIT License</small>
      </span>
      <ExternalLink class="sidebar-footer-open" :size="13" aria-hidden="true" />
    </a>
  </aside>
  <div class="workspace">
    <header ref="topbar" class="topbar">
      <div class="breadcrumb">
        <span class="breadcrumb-context">Workspace <i>/</i></span><strong>{{ currentView === "statistics" && workspaceOpen ? t("Statistik") : t("Översikt") }}</strong>
      </div>
      <nav class="mobile-navigation" :aria-label="t('Navigering')">
        <a href="#overview" :aria-label="t('Översikt')" :aria-current="workspaceOpen && currentView === 'overview' ? 'page' : undefined"><LayoutDashboard :size="18" /></a>
        <a v-if="workspaceOpen" href="#statistics" :aria-label="t('Statistik')" :aria-current="currentView === 'statistics' ? 'page' : undefined"><Activity :size="18" /></a>
        <button type="button" class="mobile-search-link" :aria-label="t('Sök issues')" :title="t('Sök issues')" @click="openIssueSearch"><Search :size="18" /></button>
        <button v-if="workspaceOpen && currentView === 'overview'" ref="mobileBoardNavigatorButton" type="button" class="mobile-search-link mobile-board-navigator-toggle"
          :aria-label="t('Hoppa till repository eller status')" :title="t('Hoppa till repository eller status')"
          aria-controls="mobile-board-navigator" :aria-expanded="mobileBoardNavigatorOpen"
          @click="mobileBoardNavigatorOpen = !mobileBoardNavigatorOpen" @keydown.esc.prevent="closeMobileBoardNavigator(true)"><ChevronDown :size="18" /></button>
      </nav>
      <div v-if="workspaceOpen && currentView === 'overview' && mobileBoardNavigatorOpen" id="mobile-board-navigator" class="mobile-board-navigator"
        role="group" :aria-label="t('Snabbnavigering mellan repositories och status')" @keydown.esc.prevent="closeMobileBoardNavigator(true)">
        <label v-if="splitByRepository" class="mobile-board-repository">
          <span>{{ t("Välj repository") }}</span>
          <select v-model="mobileNavigationRepository" :aria-label="t('Välj repository')">
            <option v-for="lane in orderedLanes" :key="lane.repo.full_name" :value="lane.repo.full_name">{{ lane.repo.full_name }}</option>
          </select>
        </label>
        <p class="mobile-board-navigator-caption">{{ splitByRepository ? t("Välj status") : t("Status i alla repositories") }}</p>
        <div class="mobile-board-statuses" role="group" :aria-label="t('Statusgrupper')">
          <button v-for="status in mobileNavigationStatuses" :key="status.key" type="button" class="mobile-board-status"
            :disabled="status.count === 0"
            :aria-label="t(status.count === 1 ? '{status}, {count} ärende' : '{status}, {count} ärenden', { status: status.label, count: status.count })"
            @click="navigateToBoardStatus(status.key)">
            <span>{{ status.label }}</span><span class="mobile-board-status-count">{{ status.count }}</span>
          </button>
        </div>
      </div>
      <div class="mobile-tools" :class="{ 'mobile-tools-open': mobileToolsOpen }">
      <button class="mobile-menu-button" aria-controls="mobile-tools-menu" :aria-expanded="mobileToolsOpen" @click="mobileToolsOpen = !mobileToolsOpen"><Menu :size="19" /><span class="mobile-menu-label">{{ t("Meny") }}</span></button>
      <div id="mobile-tools-menu" class="topbar-right">
        <LanguageSettings :repositories="sidebarRepos" @reorder="reorderProject" :notification-sounds="notificationSounds" @update:notification-sounds="setNotificationSounds" :timeout-enabled="timeoutSettings.timeoutEnabled" @update:timeout-enabled="setTimeoutEnabled" :timeout-overrun-percent="timeoutSettings.timeoutOverrunPercent" @update:timeout-overrun-percent="setTimeoutOverrunPercent" :column-limit="columnLimit" :can-edit-limit="workspaceOpen" @update:column-limit="setColumnLimit" :permissions="permissionReport" :permissions-session="generation" :permission-acknowledgements="permissionAcknowledgements" @update:permission-acknowledgements="setPermissionAcknowledgements" :permissions-checking="permissionsChecking" :can-check-permissions="loggedIn"
          :can-scan="loggedIn" @scan="scannerOpen = true" @open-updates="openUpdateDialog" @check-permissions="refreshPermissions()" @refresh-permissions="refreshPermissions(true)" />
        <InstallApp />
        <button
          v-if="user && sessionToken"
          class="button small handoff-button"
          :aria-label="t('Öppna på mobilen')"
          :title="t('Öppna på mobilen')"
          @click="handoffOpen = true"
        >
          <QrCode :size="16" /><span>{{ t("Öppna på mobilen") }}</span>
        </button>
        <span class="connection" :class="{ connected: loggedIn }" :title="connectionLabel"
          ><i :class="{ connected: loggedIn }" aria-hidden="true" /><span class="connection-label">{{ connectionLabel }}</span></span
        ><template v-if="!publicMode && (user || savedSession)"
          ><img v-if="user" :src="user.avatar_url" alt="" class="avatar" :title="`${user.login} · ${connectionLabel}`" /><span class="account-context"><span class="username" v-if="user">{{ user.login }}</span><span class="account-timezone">{{ accountTimeZone }}</span></span
          ><button
            class="icon-button"
            @click="logoutPrompt = true"
            :disabled="authBusy || restoring"
            :aria-label="t('Logga ut')"
            :title="t('Logga ut')"
          >
            <LogOut :size="17" /><span class="mobile-account-label">{{ t("Logga ut") }}</span></button></template
        ><template v-else-if="publicMode"><span class="account-context"><span class="account-timezone">{{ accountTimeZone }}</span></span><button class="button small" @click="logout">{{ t("Lämna publik vy") }}</button></template
        ><template v-else-if="isDemo"><span class="account-context"><span class="account-timezone">{{ accountTimeZone }}</span></span><button class="button small" @click="logout">
          {{ t("Till inloggning") }}
        </button></template>
      </div>
      </div>
    </header>
    <main :id="currentView === 'statistics' && workspaceOpen ? 'statistics' : 'overview'" tabindex="-1">
      <div v-if="cacheWarning" class="notice" role="status">{{ t("Innehållscachen kunde inte sparas. Översikten fungerar, men nästa start kan behöva hämta innehållet igen.") }} {{ t(cacheWarning) }}</div>
      <div
        v-if="notificationNotice && !editing"
        class="notice notification-notice"
        role="status"
      >
        <span>{{ notificationNotice }}</span
        ><button
          class="icon-button"
          :aria-label="t('Stäng notismeddelande')"
          @click="notificationNotice = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <div v-if="error" class="notice error" role="alert">
        {{ error
        }}<button
          class="icon-button"
          :aria-label="t('Stäng felmeddelande')"
          @click="error = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <div v-if="restoring && !workspaceOpen" class="startup-placeholder" aria-hidden="true"><span class="skeleton short" /><span class="skeleton" /><span class="skeleton" /></div>
      <template v-else-if="!workspaceOpen"
        ><div class="welcome">
          <span class="eyebrow"
            ><span class="repo-dot" />
            {{ t("DINA AGENTER. DITT FLÖDE.") }}</span
          >
          <h1>
            {{ t("Följ dina AI-agenter.") }}<br /><span>{{
              t("Via GitHub-issues.")
            }}</span>
          </h1>
          <p>
            {{
              t(
                "En samlad överblick över vad agenterna planerar, arbetar med och har slutfört i dina repositories. Fungerar även för issues du arbetar med själv.",
              )
            }}
          </p>
          <div class="welcome-actions">
            <button v-if="oauthReady" class="button primary" @click="oauth">
              <Github :size="19" /> {{ t("Logga in med GitHub") }}
              <ArrowRight :size="17" /></button
            ><button v-else class="button primary" @click="tokenPanel = true">
              <Github :size="19" /> {{ t("Anslut GitHub") }}
              <ArrowRight :size="17" /></button
            ><button class="button" :disabled="authBusy || restoring" @click="scannerOpen = true">
              <QrCode :size="19" />{{ t("Logga in med QR-kod") }}
            </button><button class="button" :disabled="authBusy || restoring" @click="openPublicWorkspace">{{ t("Följ publika repositories") }}</button><button class="button" @click="showDemo">
              {{ t("Utforska en demo") }} <ArrowRight :size="16" />
            </button>
          </div>
          <p class="privacy-note">
            {{
              t(
                "Dina issues hämtas direkt från GitHub. Inga projektdata sparas på en server.",
              )
            }}
          </p>
          <form
            v-if="tokenPanel"
            class="token-form"
            @submit.prevent="connect(tokenInput.trim())"
          >
            <label for="token">GitHub personal access token</label>
            <p>
              {{
                t(
                  "Använd en fine-grained token med läsrättighet till Issues och Metadata för de repositories du vill följa. Tokenen sparas krypterat i webbläsarens databas (IndexedDB) tills du loggar ut.",
                )
              }}
            </p>
            <p>
              {{
                t(
                  "För commit-information i privata projekt behövs även läsrättighet till Contents och Pull requests.",
                )
              }}
            </p>
            <input
              id="token"
              v-model="tokenInput"
              type="password"
              required
              autocomplete="off"
              spellcheck="false"
              placeholder="github_pat_…"
            /><button
              class="button primary"
              :disabled="authBusy || !tokenInput.trim()"
            >
              {{ authBusy ? t("Ansluter…") : t("Anslut konto") }}</button
            ><a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t("Skapa en token") }} <ExternalLink :size="13"
            /></a>
          </form>
          <button
            v-if="oauthReady && !tokenPanel"
            class="text-button"
            @click="tokenPanel = true"
          >
            {{ t("Använd en personal access token") }}
          </button>
        </div>
        <div class="intro-board" :aria-label="t('Så fungerar dashboarden')">
          <div v-for="(col, i) in columns" :key="col.key" class="intro-column">
            <span class="column-heading"
              ><i :class="col.key" />{{ col.title }}</span
            >
            <div class="illustration-card" :class="col.key">
              <span class="skeleton short" /><strong>{{
                [
                  t("Nästa stora idé"),
                  t("Något bra är på gång"),
                  t("Ännu ett steg framåt"),
                ][i]
              }}</strong
              ><span class="skeleton" /><span class="intro-tag">{{
                [t("Prioriterat & redo"), "◷ 1h 24m", t("✓ Klart för idag")][i]
              }}</span>
            </div>
            <span class="intro-description">{{
              [
                t("Ditt nästa steg, i rätt ordning."),
                t("Följ arbetet medan det händer."),
                t("Se vad du har åstadkommit."),
              ][i]
            }}</span>
          </div>
        </div></template
      >
      <template v-else>
        <StatisticsView :navigation="statisticsNavigation" v-if="currentView === 'statistics'" :client="api" :credential="sessionToken" :repositories="statisticsRepositories" v-model:preferences="statisticsPreferences" :demo="isDemo" :session="generation" />
        <div v-show="currentView === 'overview'">
        <section class="page-heading">
          <div>
            <div class="eyebrow">{{ t("DITT ARBETE, SAMLAT") }}</div>
            <h1>
              {{ t("Projektöversikt") }}<span class="heading-dot">.</span>
            </h1>
            <p>
              {{ t("Från backlog till klart. Håll koll på vad som rör sig.") }}
            </p>
          </div>
        </section>
        <p v-if="publicMode" class="notice">{{ t("Publik vy · Uppdateras manuellt") }}</p>
        <div v-if="isDemo" class="notice demo-notice">
          <span>{{
            t(
              "Du utforskar en demo med fiktiva projekt. Anslut GitHub för att se dina egna.",
            )
          }}</span
          ><button class="text-button" @click="logout">
            {{ t("Anslut konto") }} <ArrowRight :size="14" />
          </button>
        </div>
        <OverviewSummary :query="query" :repository-queries="activeRepositoryQueries" :counts="stats" :lanes="lanes" :rules="rules" :hide-coordination="hideCoordination"
          :live="!showingCache && !restoring && !lanes.some(lane => lane.loading)" :session="generation" :logged-in="loggedIn || publicMode"
          @choose-repositories="picker = true" />
        <!-- data-busy (#151): non-visual "sync finished" signal for tests; per-repository and combined headers show status. -->
        <div class="board-toolbar" :data-busy="busy ? 'true' : 'false'">
          <label id="issue-search" class="search"
            ><Search :size="17" /><input ref="issueSearch"
              v-model="query"
              :aria-label="t('Sök issues')"
              :placeholder="t('Sök issues, labels eller nummer…')" /></label
          ><label class="coord-toggle"
            ><input type="checkbox" v-model="hideCoordination" />
            {{ t("Dölj koordinationsärenden") }}</label
          ><label class="coord-toggle"><input type="checkbox" v-model="splitByRepository" />{{ t("Dela upp per repository") }}</label
          ><BoardModeToggle v-model:list="listMode" :label="t('Visningsläge för boarden')"
        /></div>
        <div v-if="loggedIn && syncError && !lanes.some(lane => lane.error === syncError)" class="notice error sync-error" role="alert">
          {{ syncError }} {{ t("Tidigare data visas om de finns.") }}
        </div>
        <div v-if="busy && !lanes.length" class="empty-state">
          <RefreshCw class="spinning" :size="25" />
          <h2>{{ t("Hämtar ditt flöde") }}</h2>
          <p>{{ t("Issues, labels och starttider hämtas från GitHub.") }}</p>
        </div>
        <div v-else-if="!lanes.length" class="empty-state">
          <Layers3 :size="32" />
          <h2>{{ t("Ge dina projekt en plats") }}</h2>
          <p>
            {{ t("Välj vilka repositories du vill följa i din översikt.") }}
          </p>
          <button class="button primary" @click="picker = true">
            <Plus :size="16" /> {{ t("Välj repositories") }}
          </button>
        </div>
        <p class="sr-only" role="status" aria-live="polite">{{ layoutAnnouncement }}</p>
        <p class="sr-only" role="status" aria-live="polite">{{ mobileNavigationAnnouncement }}</p>
        <template v-if="splitByRepository">
        <RepositorySection
          v-for="(lane, laneIndex) in orderedLanes"
          :key="lane.repo.id"
          :id="'repo-' + lane.repo.id"
          :collapsed="collapsedRepos.includes(lane.repo.full_name)"
        >
          <template #header>
            <span v-if="isDemo" class="lane-sync">
              <time v-if="repoSyncedAt[lane.repo.full_name]" :datetime="new Date(repoSyncedAt[lane.repo.full_name]!).toISOString()"
                :title="t('Senast uppdaterad {time}', { time: statusTime(repoSyncedAt[lane.repo.full_name]!) })"
                >{{ statusTime(repoSyncedAt[lane.repo.full_name]!) }}</time>
            </span>
            <button v-else-if="syncingRepos.has(lane.repo.full_name) || repoSyncedAt[lane.repo.full_name]" type="button" class="lane-sync"
              :class="{ syncing: syncingRepos.has(lane.repo.full_name) }" :aria-disabled="syncingRepos.has(lane.repo.full_name)"
              :aria-label="syncingRepos.has(lane.repo.full_name) ? t('Hämtar issues för {name}…', { name: lane.repo.full_name })
                : t('Senast uppdaterad {time} · Klicka för att uppdatera {name} nu', { time: statusTime(repoSyncedAt[lane.repo.full_name]!), name: lane.repo.full_name })"
              :data-tooltip="syncingRepos.has(lane.repo.full_name) ? t('Hämtar issues för {name}…', { name: lane.repo.full_name })
                : t('Senast uppdaterad {time} · Klicka för att uppdatera nu', { time: statusTime(repoSyncedAt[lane.repo.full_name]!) })"
              @click="refreshFromStatus(lane.repo.full_name)"
              ><span v-if="syncingRepos.has(lane.repo.full_name)" class="lane-sync-spinner" aria-hidden="true"
              /><time v-else :datetime="new Date(repoSyncedAt[lane.repo.full_name]!).toISOString()">{{ statusTime(repoSyncedAt[lane.repo.full_name]!) }}</time></button>
            <RepositoryHeading :repository="lane.repo" :collapsed="collapsedRepos.includes(lane.repo.full_name)"
              :controls="'lane-content-' + lane.repo.id" :toggle-name="lane.repo.name" @toggle="toggleCollapsed(lane.repo.full_name)">
              <template #badges><span v-if="!lane.loading" class="private-badge workflow-badge">{{ workflow(lane.labels) }}</span></template>
            </RepositoryHeading>
            <div class="lane-meta">
              <span v-if="!lane.loading && (!lane.error || lane.issues.length)" class="repository-issue-count">{{ laneIssues(lane).length }} issues</span>
              <span v-else-if="lane.loading" class="repository-issue-count">{{ t("Hämtar…") }}</span>
              <div class="repository-filter">
                <label class="sr-only" :for="'repository-filter-' + lane.repo.id">{{ t("Filtrera issues i {name}", { name: lane.repo.full_name }) }}</label>
                <div class="repository-search">
                  <Search :size="14" aria-hidden="true" />
                  <input :id="'repository-filter-' + lane.repo.id" v-model="repositoryQueries[lane.repo.full_name]"
                    :placeholder="t('Sök issues, labels eller nummer…')" />
                  <button class="icon-button repository-filter-clear" :disabled="!repositoryQueries[lane.repo.full_name]"
                    :aria-label="t('Rensa filtret för {name}', { name: lane.repo.full_name })"
                    :title="t('Rensa filtret för {name}', { name: lane.repo.full_name })"
                    @click="repositoryQueries[lane.repo.full_name] = ''"><X :size="13" aria-hidden="true" /></button>
                </div>
              </div>
              <div class="lane-actions">
              <button
                v-if="!isDemo"
                class="icon-button"
                @click="editRules(lane)"
                :aria-label="t('Repositoryegenskaper för ') + lane.repo.name"
                :title="t('Repositoryegenskaper')"
              >
                <Settings2 :size="16" />
              </button>
              </div>
            </div>
              <span v-if="!lane.loading && (!lane.error || lane.issues.length)" class="lane-summary" :aria-label="t('Sammanfattning för {name}', { name: lane.repo.name })">
                <span>{{ t('Backlog: {count}', { count: sidebarRepos[laneIndex]?.backlog || 0 }) }}</span>
                <span>{{ t('Pågående: {count}', { count: sidebarRepos[laneIndex]?.progress || 0 }) }}</span>
                <span>{{ t('Stängda senaste 30 dagarna: {count}', { count: sidebarRepos[laneIndex]?.closed || 0 }) }}</span>
              </span>
          </template>
          <div v-show="!collapsedRepos.includes(lane.repo.full_name)" :id="'lane-content-' + lane.repo.id">
          <p v-if="!lane.loading && !lane.error && (query || repositoryQueries[lane.repo.full_name]) && !laneIssues(lane).length" class="repository-filter-empty" role="status">
            {{ t("Inga issues i {name} matchar filtren.", { name: lane.repo.full_name }) }}
          </p>
          <div v-if="lane.error" class="notice error" role="alert">
            {{ lane.error }} {{ t("Tidigare data visas om de finns.") }}
          </div>
          <div v-if="lane.timerWarning" class="notice">
            {{
              t(
                "Vissa starttider kunde inte hämtas. Tidräknaren visas när historiken är tillgänglig.",
              )
            }}
          </div>
          <div v-if="lane.loading" class="repository-loading" role="status" aria-live="polite">
            <RefreshCw class="spinning" :size="21" aria-hidden="true" />
            {{ t("Hämtar issues för {name}…", { name: lane.repo.full_name }) }}
          </div>
          <div v-else-if="laneIndex < renderedLanes && (!lane.error || lane.issues.length)" class="swimlane" :class="{ 'list-mode': listMode }">
            <section
              v-for="col in columns"
              :key="col.key"
              :id="'board-' + lane.repo.id + '-' + col.key"
              tabindex="-1"
              :aria-label="t('{status} i {repository}', { status: mobileStatusLabel(col.key), repository: lane.repo.full_name })"
              class="board-column"
              :class="col.key"
            >
              <div class="column-header">
                <div class="column-heading">
                  <i :class="col.key" />{{ col.title
                  }}<span class="column-count">{{
                    items(lane, col.key).length
                  }}</span
                  ><ColumnEstimate v-if="col.key !== 'closed'" :groups="laneEstimateGroups.get(lane.repo.full_name) ?? []" :column="col.key as 'progress' | 'backlog'" />
                </div>
                <span class="column-hint">{{ col.hint }}</span>
              </div>
              <div class="cards">
                <ul v-if="listMode && items(lane, col.key).length" class="issue-rows">
                  <IssueRow
                    v-for="issue in items(lane, col.key).slice(0, shownLimit(lane.repo.full_name, col.key))"
                    :key="boardEntryKey({ lane, issue }, col.key)"
                    :id="issueDomId(lane.repo.full_name, issue.number)"
                    :issue="issue"
                    :repository="lane.repo.full_name"
                    :assigned-color="workspaceRepositoryColors[lane.repo.full_name]"
                    :rules="rules[lane.repo.full_name] || {}"
                    :timed-out="issueTimedOut(lane.repo.full_name, issue)"
                    :timeout-overrun-percent="timeoutSettings.timeoutOverrunPercent" :timeout-estimate-ms="timeoutEstimateMs(lane.repo.full_name, issue)"
                    :demo="isDemo"
                    :recent-move="activity.moved(lane.repo.full_name, issue, activityNow)"
                    :new-comments="activity.newComments(lane.repo.full_name, issue, activityNow)"
                    :celebrate="recentClosures.has(closureKey(lane.repo.full_name, issue))"
                    :load-relations="isDemo ? undefined : loaders(lane.repo.full_name)?.relations"
                    :load-comments="isDemo ? undefined : loaders(lane.repo.full_name)?.comments"
                    :relations-revision="relationsRevisions[lane.repo.full_name] ?? 0"
                    :navigation-revision="parentNavigationRevision"
                    :comments-session="generation"
                    @read="readIssue(lane.repo.full_name, issue)"
                    v-slot="{ inPopup }"
                  ><IssueCard v-bind="cardProps(lane, issue)" :row-details="!inPopup" show-time-explanation :default-expanded="true" @read="readIssue(lane.repo.full_name, issue)" @parent-select="revealParentIssue" @child-select="revealParentIssue" /></IssueRow>
                </ul>
                <template v-else-if="!listMode">
                <IssueCard
                  v-for="issue in items(lane, col.key).slice(0, shownLimit(lane.repo.full_name, col.key))"
                  :key="boardEntryKey({ lane, issue }, col.key)"
                  :id="issueDomId(lane.repo.full_name, issue.number)"
                  v-bind="cardProps(lane, issue)"
                  show-time-explanation
                  @read="readIssue(lane.repo.full_name, issue)"
                  @parent-select="revealParentIssue"
                  @child-select="revealParentIssue"
                />
                </template>
                <div v-if="!items(lane, col.key).length" class="column-empty">
                  <CircleCheck v-if="col.key === 'closed'" :size="20" /><Clock3
                    v-else-if="col.key === 'progress'"
                    :size="20"
                  /><Layers3 v-else :size="20" /><span>{{
                    query || repositoryQueries[lane.repo.full_name]
                      ? t("Inga issues matchar filtren")
                      : col.key === "progress"
                      ? t("Inget pågående arbete")
                      : col.key === "closed"
                        ? t("Inga stängda issues ännu")
                        : t("Backloggen är tom")
                  }}</span>
                </div>
                <button
                  v-if="
                    items(lane, col.key).length >
                    (shownLimit(lane.repo.full_name, col.key))
                  "
                  class="show-more"
                  @click="
                    visibleLimit[lane.repo.full_name + col.key] =
                      (shownLimit(lane.repo.full_name, col.key)) + initialLimit(lane.repo.full_name)
                  "
                >
                  {{ t("Visa fler") }} <ChevronDown :size="14" />
                </button>
              </div>
            </section>
          </div>
          </div>
        </RepositorySection>
        </template>
        <section v-else-if="orderedLanes.length" class="combined-board" :aria-label="t('Gemensam board')">
          <div class="combined-board-head">
          <details class="combined-repository-controls">
            <summary>{{ t("Repositoryinställningar") }}</summary>
            <p class="combined-limit-note">{{ t("Den gemensamma tavlan använder det globala antalet kort per kolumn. Visa fler lägger till lika många till.") }}</p>
            <div v-for="lane in orderedLanes" :key="lane.repo.full_name" class="combined-repository-control" :id="'repo-' + lane.repo.id">
              <span class="combined-repository-name"><i :style="{ backgroundColor: workspaceRepositoryColors[lane.repo.full_name] }" aria-hidden="true" />{{ lane.repo.full_name }}</span>
              <button v-if="!isDemo" class="icon-button" @click="editRules(lane)" :aria-label="t('Repositoryegenskaper för ') + lane.repo.name" :title="t('Repositoryegenskaper')"><Settings2 :size="16" /></button>
            </div>
          </details>
          <span v-if="isDemo" class="lane-sync combined-sync">
            <time v-if="refreshed" :datetime="new Date(refreshed).toISOString()"
              :title="t('Senast uppdaterad {time}', { time: statusTime(refreshed) })">{{ statusTime(refreshed) }}</time>
          </span>
          <button v-else-if="combinedSyncing || refreshed" type="button" class="lane-sync combined-sync"
            :class="{ syncing: combinedSyncing }" :aria-disabled="combinedSyncing"
            :aria-label="combinedSyncing ? t('Hämtar issues för den gemensamma boarden…')
              : t('Senast uppdaterad {time} · Klicka för att uppdatera alla repositories nu', { time: statusTime(refreshed!) })"
            :data-tooltip="combinedSyncing ? t('Hämtar issues för den gemensamma boarden…')
              : t('Senast uppdaterad {time} · Klicka för att uppdatera nu', { time: statusTime(refreshed!) })"
            @click="refreshFromStatus()"
            ><span v-if="combinedSyncing" class="lane-sync-spinner" aria-hidden="true"
            /><time v-else :datetime="new Date(refreshed!).toISOString()">{{ statusTime(refreshed!) }}</time></button>
          </div>
          <template v-for="lane in orderedLanes" :key="lane.repo.full_name">
            <p v-if="lane.loading" class="repository-loading" role="status"><RefreshCw class="spinning" :size="20" aria-hidden="true" />{{ t("Hämtar issues för {name}…", { name: lane.repo.full_name }) }}</p>
            <p v-if="lane.error" class="notice error" role="alert"><strong>{{ lane.repo.full_name }}</strong> {{ lane.error }} {{ t("Tidigare data visas om de finns.") }}</p>
            <p v-if="lane.timerWarning" class="notice"><strong>{{ lane.repo.full_name }}</strong> {{ t("Vissa starttider kunde inte hämtas. Tidräknaren visas när historiken är tillgänglig.") }}</p>
          </template>
          <div class="swimlane" :class="{ 'list-mode': listMode }">
            <section
              v-for="col in columns"
              :key="col.key"
              :id="'board-combined-' + col.key"
              tabindex="-1"
              :aria-label="t('{status} i alla repositories', { status: mobileStatusLabel(col.key) })"
              class="board-column"
              :class="col.key"
            >
              <div class="column-header">
                <div class="column-heading">
                  <i :class="col.key" />{{ col.title
                  }}<span v-if="combinedColumns[col.key]!.length || !orderedLanes.some(lane => lane.loading || lane.error)" class="column-count">{{
                    combinedColumns[col.key]!.length
                  }}</span
                  ><ColumnEstimate v-if="col.key !== 'closed'" :groups="combinedEstimateGroups" :column="col.key as 'progress' | 'backlog'" />
                </div>
                <span class="column-hint">{{ col.hint }}</span>
              </div>
              <div class="cards">
                <ul v-if="listMode && combinedColumns[col.key]!.length" class="issue-rows">
                  <IssueRow
                    v-for="{ lane, issue } in combinedColumns[col.key]!.slice(0, combinedLimit(col.key))"
                    :key="boardEntryKey({ lane, issue }, col.key)"
                    :id="issueDomId(lane.repo.full_name, issue.number)"
                    :issue="issue"
                    :repository="lane.repo.full_name"
                    show-repository
                    :assigned-color="workspaceRepositoryColors[lane.repo.full_name]"
                    :rules="rules[lane.repo.full_name] || {}"
                    :timed-out="issueTimedOut(lane.repo.full_name, issue)"
                    :timeout-overrun-percent="timeoutSettings.timeoutOverrunPercent" :timeout-estimate-ms="timeoutEstimateMs(lane.repo.full_name, issue)"
                    :demo="isDemo"
                    :recent-move="activity.moved(lane.repo.full_name, issue, activityNow)"
                    :new-comments="activity.newComments(lane.repo.full_name, issue, activityNow)"
                    :celebrate="recentClosures.has(closureKey(lane.repo.full_name, issue))"
                    :load-relations="isDemo ? undefined : loaders(lane.repo.full_name)?.relations"
                    :load-comments="isDemo ? undefined : loaders(lane.repo.full_name)?.comments"
                    :relations-revision="relationsRevisions[lane.repo.full_name] ?? 0"
                    :navigation-revision="parentNavigationRevision"
                    :comments-session="generation"
                    @read="readIssue(lane.repo.full_name, issue)"
                    v-slot="{ inPopup }"
                  ><IssueCard v-bind="cardProps(lane, issue, true)" :row-details="!inPopup" show-time-explanation :default-expanded="true" @read="readIssue(lane.repo.full_name, issue)" @parent-select="revealParentIssue" @child-select="revealParentIssue" /></IssueRow>
                </ul>
                <template v-else-if="!listMode">
                <IssueCard
                  v-for="{ lane, issue } in combinedColumns[col.key]!.slice(0, combinedLimit(col.key))"
                  :key="boardEntryKey({ lane, issue }, col.key)"
                  :id="issueDomId(lane.repo.full_name, issue.number)"
                  v-bind="cardProps(lane, issue, true)"
                  show-time-explanation
                  @read="readIssue(lane.repo.full_name, issue)"
                  @parent-select="revealParentIssue"
                  @child-select="revealParentIssue"
                />
                </template>
                <div v-if="!combinedColumns[col.key]!.length && !orderedLanes.some(lane => lane.loading || lane.error)" class="column-empty">
                  <CircleCheck v-if="col.key === 'closed'" :size="20" /><Clock3
                    v-else-if="col.key === 'progress'"
                    :size="20"
                  /><Layers3 v-else :size="20" /><span>{{
                    query
                      ? t("Inga issues matchar filtren")
                      : col.key === "progress"
                      ? t("Inget pågående arbete")
                      : col.key === "closed"
                        ? t("Inga stängda issues ännu")
                        : t("Backloggen är tom")
                  }}</span>
                </div>
                <button
                  v-if="
                    combinedColumns[col.key]!.length >
                    combinedLimit(col.key)
                  "
                  class="show-more"
                  @click="
                    combinedLimits[col.key] = combinedLimit(col.key) + columnLimit
                  "
                >
                  {{ t("Visa fler") }} <ChevronDown :size="14" />
                </button>
              </div>
            </section>
          </div>
        </section>
        <footer class="board-footer">
          <span
            ><Github :size="14" />
            {{ t("Dina repositories. Ditt arbetssätt.") }}</span
          ><span>{{
            isDemo
              ? t("Fiktiva exempeldata")
              : t("Läsande vy · ändra issues på GitHub")
          }}</span>
        </footer></div></template
      >
    </main>
  </div>
  <div v-if="picker" class="modal-backdrop" @click.self="picker = false">
    <section
      ref="pickerDialog"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
    >
      <div class="modal-heading">
        <div>
          <span class="eyebrow">{{ t("DIN ÖVERSIKT") }}</span>
          <h2 id="picker-title">{{ t("Välj repositories") }}</h2>
        </div>
        <button
          class="icon-button"
          @click="picker = false"
          :aria-label="t('Stäng')"
        >
          <X :size="20" />
        </button>
      </div>
      <p>
        {{ t("En swimlane per projekt. Ditt val sparas på den här enheten.") }}
      </p>
      <form v-if="publicMode" class="token-form" @submit.prevent="addPublicRepository">
        <label for="public-repository">{{ t("Publikt repository") }}</label>
        <input id="public-repository" v-model="publicRepoInput" :placeholder="t('ägare/repo eller https://github.com/ägare/repo')" required autocomplete="off" spellcheck="false" :disabled="publicRepoBusy" />
        <button class="button" :disabled="publicRepoBusy || !publicRepoInput.trim()">{{ publicRepoBusy ? t("Hämtar repository…") : t("Lägg till repository") }}</button>
        <p v-if="publicRepoError" class="error" role="alert">{{ publicRepoError }}</p>
      </form>
      <label class="search"
        ><Search :size="17" /><input
          v-model="repoQuery"
          autofocus
          :placeholder="t('Sök repositories…')"
          :aria-label="t('Sök repositories')"
      /></label>
      <div class="repo-options">
        <label v-for="repo in filteredRepos" :key="repo.id" class="repo-option"
          ><input
            type="checkbox"
            :checked="pendingSelected.includes(repo.full_name)"
            @change="toggleRepo(repo.full_name)"
          /><span
            ><strong>{{ repo.full_name }}</strong
            ><small>{{
              repo.description || t("Ingen beskrivning")
            }}</small></span
          ><span v-if="repo.private" class="private-badge">{{
            t("Privat")
          }}</span></label
        >
        <p v-if="!filteredRepos.length">
          {{ t("Inga repositories matchar sökningen.") }}
        </p>
      </div>
      <div class="modal-footer">
        <span>{{ pendingSelected.length }}{{ t(" valda") }}</span
        ><button class="button primary" @click="applyRepos">
          {{ t("Visa översikt") }} <ArrowRight :size="16" />
        </button>
      </div>
    </section>
  </div>
  <div v-if="editing" class="modal-backdrop" @click.self="applyRules">
    <form
      ref="rulesDialog"
      class="modal repository-properties"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      @submit.prevent="applyRules"
    >
      <div class="modal-heading">
        <h2 id="rules-title">{{ t("Repositoryegenskaper") }}</h2>
        <button
          type="button"
          class="icon-button"
          @click="applyRules"
          :aria-label="t('Stäng')"
        >
          <X :size="20" />
        </button>
      </div>
      <p>{{ editing }} · {{ t("Gäller bara din vy") }}</p>
      <button type="button" class="notification-toggle" role="switch"
        :aria-checked="notificationsEnabled(editing)" :aria-label="t('Notiser för ') + editing.split('/').pop()"
        :disabled="notificationPending !== null" :class="{ enabled: notificationsEnabled(editing) }"
        @click="toggleNotifications(editing)">
        <Bell v-if="notificationsEnabled(editing)" :size="15" /><BellOff v-else :size="15" />
        {{ t("Notiser") }} {{ notificationsEnabled(editing) ? t("på") : t("av") }}
      </button>
      <div v-if="notificationNotice" class="notice notification-notice" role="status">
        <span>{{ notificationNotice }}</span><button type="button" class="icon-button"
          :aria-label="t('Stäng notismeddelande')" @click="notificationNotice = ''"><X :size="16" /></button>
      </div>
      <h3>{{ t("Labelregler") }}</h3>
      <p>{{ t("Lämna tomt för automatisk detektering. Ange exakta labelnamn.") }}</p>
      <label
        v-for="field in [
          ['progress', t('Pågående arbete')],
          ['high', t('Hög prioritet')],
          ['medium', t('Medium prioritet')],
          ['low', t('Låg prioritet')],
        ] as const"
        :key="field[0]"
        class="rule-field"
        >{{ t(field[1])
        }}<input
          v-model="rules[editing]![field[0]]"
          :placeholder="t('Automatiskt')"
      /></label>
      <ColumnLimitField id="repository-column-limit" :model-value="repositoryColumnLimits[editing] ?? null"
        :inherit="columnLimit" @update:model-value="setRepositoryColumnLimit(editing!, $event)" />
      <div class="modal-footer">
        <span>{{ t("Gäller bara din vy") }}</span
        ><button class="button primary">{{ t("Spara och hämta igen") }}</button>
      </div>
    </form>
  </div>
  <VersionUpdate :open="updateAvailable && !updateDeferred" :seconds="updateSeconds" :counting="updateCounting"
    :applying="updateApplying" :error="updateError" :summary="updateSummary" :available-version="availableBuild"
    @install="appUpdate.reloadNow()" @defer="deferUpdate" @read-more="openReleaseNotes(newNoteDays)" />
  <UpdateDialog :open="updateDialogOpen" :available="updateAvailable" :applying="updateApplying" :error="updateError"
    :deferred="updateDeferred" :summary="updateSummary" :available-version="availableBuild"
    @close="updateDialogOpen = false" @install="appUpdate.reloadNow()" @read-more="openReleaseNotes(newNoteDays)" />
  <ReleaseNotes :open="releaseNotesOpen" :days="releaseNotesDays" @close="releaseNotesOpen = false" />
  <LogoutDialog
    :open="logoutPrompt"
    :busy="logoutBusy"
    @cancel="logoutPrompt = false"
    @confirm="confirmLogout"
  />
  <MobileHandoff
    v-if="handoffOpen && sessionToken"
    :token="sessionToken"
    :selected="selected"
    :rules="rules"
    :preferences="transferablePreferences"
    @close="handoffOpen = false"
    @scan="scannerOpen = true"
  />
  <ScanLogin v-if="scannerOpen" :mode="loggedIn ? 'preferences' : 'login'" @close="scannerOpen = false"
    @scanned="payload => void importScanned(payload)" />
  <AccountSwitchDialog :open="Boolean(accountSwitch)" :current="accountSwitch?.current ?? null"
    :incoming="accountSwitch?.incoming ?? ''" @cancel="answerAccountSwitch(false)" @confirm="answerAccountSwitch(true)" />
</template>

<style scoped>
/* The version section takes the free space so it sits directly above the footer. */
.sidebar-footer { margin-top: 0; }
.startup-placeholder { display: grid; gap: 20px; padding: 32px 0; max-width: 480px; opacity: .5; }
/* Counts sit before search; the action button keeps the same right edge for every count. */
.repository-issue-count { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
@media (max-width: 950px) {
  .repository-issue-count { display: none; }
}
.repository-filter { flex: 0 1 220px; min-width: 0; max-width: 100%; font-size: 11px; color: var(--muted); }
.repository-search { display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; padding-left: 8px; min-width: 0; }
.repository-search > svg { flex-shrink: 0; }
.repository-filter-clear { flex-shrink: 0; width: 30px; height: 30px; min-width: 30px; min-height: 30px; }
.repository-search input { width: 100%; min-width: 0; padding-block: 7px; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.repository-search:focus-within { outline: 2px solid var(--green); outline-offset: 2px; }
.repository-filter-empty { margin: 0; padding: 0 18px 14px; color: var(--muted); font-size: 13px; }

.repository-loading { display: flex; align-items: center; gap: 10px; padding: 30px 18px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.repository-loading svg { flex-shrink: 0; }
.combined-board { margin-bottom: 25px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); overflow: hidden; }
/* The sync status sits on the summary's line (#149), so it never wraps onto a row of its own. */
.combined-board-head { display: flex; align-items: flex-start; gap: 0 8px; border-bottom: 1px solid var(--line); }
.combined-board-head > .combined-sync { position: relative; flex: 0 0 auto; top: 0; right: 0; margin: 15px 15px 0 auto; height: 16px; line-height: 16px; }
.combined-repository-controls { flex: 1 1 0; min-width: 0; padding: 15px 18px; font-size: 12px; }
.combined-repository-controls summary { cursor: pointer; font-weight: 600; }
.combined-limit-note { color: var(--muted); font-size: 11px; line-height: 1.6; }
.combined-repository-control { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
.combined-repository-name { display: inline-flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 180px; overflow-wrap: anywhere; }
.combined-repository-name i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.repository-properties { overflow-wrap: anywhere; }
.repository-properties .modal-heading h2 { min-width: 0; }
.repository-properties .modal-heading > button { flex-shrink: 0; }
.repository-properties .modal-footer { flex-wrap: wrap; }
.repository-properties .modal-footer > button { margin-left: auto; }
.repository-navigation-highlight {
  outline: 2px solid var(--green);
  outline-offset: -2px;
  animation: repository-navigation-pulse 1.2s ease-out;
}
@keyframes repository-navigation-pulse {
  0%, 55% { outline-color: var(--green); }
  30%, 100% { outline-color: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .repository-navigation-highlight { animation: none; }
}
</style>
