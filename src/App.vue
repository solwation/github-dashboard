<script setup lang="ts">
import { useLanguage } from "./lib/i18n";
const { t, locale, preference, setLanguage } = useLanguage();
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Activity,
  Bell,
  BellOff,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  Layers3,
  LayoutDashboard,
  LogOut,
  QrCode,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "@lucide/vue";
import LanguageSettings from "./components/LanguageSettings.vue";
import OverviewSummary from "./components/OverviewSummary.vue";
import ColumnLimitField from "./components/ColumnLimitField.vue";
import { defaultColumnLimit, effectiveColumnLimit, restoreColumnLimits } from "./lib/column-limits";
import VersionUpdate from "./components/VersionUpdate.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import SidebarVersion from "./components/SidebarVersion.vue";
import ReleaseNotes from "./components/ReleaseNotes.vue";
import { bundledReleaseNotes, fetchPublishedReleaseNotes, noteLanguage, notesSince, updateSummary as summarizeUpdate, type PublishedReleaseNotes, type ReleaseNoteDay } from "./lib/release-notes";
import { useAppUpdate } from "./composables/useAppUpdate";
import SidebarRepositories from "./components/SidebarRepositories.vue";
import { reconcileOrder, restoreLayout, moveProject } from "./lib/project-layout";
import { summarizeLanes } from "./lib/sidebar";
import { TimeoutTracker, DEFAULT_TIMEOUT_MINUTES, parseTimeoutMinutes, type TimeoutEntry } from "./lib/timeouts";
import { ActivityTracker } from "./lib/activity";
import { StatusSoundPlayer, StatusTransitionTracker } from "./lib/status-sounds";
import { createIssueSync } from "./lib/sync";
import { selectedLanes, RepositoryRequestQueue, RepositoryRequestCancelled } from "./lib/repository-selection";
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
import { readSnapshot, writeSnapshot, type ContentSnapshot } from "./lib/content-cache";
import { cacheFailureReason } from "./lib/cache-failure";
import { consumeHandoff, mergeHandoffPreferences, parseHandoffPreferences, type HandoffPreferences, type HandoffSettings } from "./lib/handoff";
import IssueCard from "./components/IssueCard.vue";
import Github from "./components/GithubIcon.vue";
import InstallApp from "./components/InstallApp.vue";
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
  isCoordination,
  sortedIssues,
  workflow,
  type Lane,
  type Issue,
  type Repo,
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
const lanes = ref<Lane[]>([]);
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
  collapsedRepos.value = collapsedRepos.value.includes(name)
    ? collapsedRepos.value.filter(repo => repo !== name) : [...collapsedRepos.value, name];
  save();
}
const rules = ref<Record<string, Rules>>({});
const editing = ref<string | null>(null);
const isDemo = ref(false);
const isStatisticsHash = () => /^#statistics(?:-repo-\d+)?$/.test(window.location.hash);
const currentView = ref(isStatisticsHash() ? "statistics" : "overview");
async function navigateWorkspace() {
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
watch(busy, (running) => {
  if (running) return;
  fullRefreshRunning = false;
  if (!refreshRequested) return;
  refreshRequested = false;
  void refresh();
});
const error = ref("");
const now = ref(Date.now());
const refreshed = ref<number | null>(null);
const showingCache = ref(false);
const cacheWarning = ref("");
async function persistContent() {
  if (!user.value || !sessionToken.value || !api || isDemo.value) return;
  const run = generation;
  try {
    await writeSnapshot(sessionToken.value, { user: user.value, repos: repos.value, lanes: lanes.value.filter(lane => !lane.loading),
      syncedAt: refreshed.value, responses: api.exportResponses(), timeoutAcknowledgements: timeoutTracker.exportAcknowledgements() });
    if (run === generation) cacheWarning.value = "";
  } catch (cause) { if (run === generation) cacheWarning.value = cacheFailureReason(cause); }
}
const syncError = ref("");
const lastSynced = new Map<string, number>();
const lastFullSynced = new Map<string, number>();
const query = ref("");
const repositoryQueries = ref<Record<string, string>>({});
const repoQuery = ref("");
const picker = ref(false);
const tokenPanel = ref(false);
const tokenInput = ref("");
const hideCoordination = ref(true);
const splitByRepository = ref(true);
const combinedLimits = ref<Record<string, number>>({});
const pendingSelected = ref<string[]>([]);
watch(picker, (open) => {
  if (open) pendingSelected.value = [...selected.value];
});
const visibleLimit = ref<Record<string, number>>({});
const columnLimit = ref(defaultColumnLimit);
const timeoutMinutes = ref(DEFAULT_TIMEOUT_MINUTES);
const timeoutTracker = new TimeoutTracker();
const timedOut = ref<TimeoutEntry[]>([]);
const timeoutRevision = ref(0);
function setTimeoutMinutes(minutes: number) {
  timeoutMinutes.value = parseTimeoutMinutes(minutes) ?? DEFAULT_TIMEOUT_MINUTES;
  save();
}
function ignoreTimeout(repo: string, issue: Issue) {
  if (!timeoutTracker.acknowledge(repo, issue)) return;
  // Local feedback must not wait for the timeout scan, which pauses during GitHub refresh.
  timedOut.value = timedOut.value.filter(entry => entry.repo !== repo || entry.issue.id !== issue.id);
  timeoutRevision.value++;
  void persistContent();
}
function issueTimedOut(repo: string, issue: Issue) {
  return timedOut.value.some(entry => entry.repo === repo && entry.issue.id === issue.id);
}
const repositoryColumnLimits = ref<Record<string, number>>({});
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
const relationsRevision = ref(0);
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
const notificationNotice = ref("");
const permission = ref(notificationPermission());
const notificationPending = ref<string | null>(null);
const recentClosures = ref(new Set<string>());
const closureTracker = new ClosureTracker();
const statusTracker = new StatusTransitionTracker();
const audioUnavailableText = "Ljud kunde inte aktiveras. Klicka eller tryck på en tangent i dashboarden för att försöka igen. Notiser fungerar fortfarande.";
// Background playback failures stay silent. Explain unavailable audio only when
// the user explicitly enables repository notifications below.
const statusPlayer = new StatusSoundPlayer();
const activity = new ActivityTracker();
const activityRevision = ref(0);
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
  const audioReady = statusPlayer.unlock();
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
      notificationNotice.value = t(
        "Notiser på för {repo}. Statusändringar spelar ljud och nya stängningar meddelas medan dashboarden är öppen. Webbläsaren kan fördröja uppdateringar i bakgrunden.",
        { repo },
      ) + (soundReady ? "" : " " + t(audioUnavailableText));
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
    notificationNotice.value = t(
      "Notiser kunde inte visas och har stängts av för {repo}. Kontrollera webbläsarens stöd och behörigheter.",
      { repo: lane.repo.name },
    );
  }
}
function closureFeedback(result: Lane[], fullSnapshot = true) {
  result = result.filter(lane => !lane.loading);
  relationsRevision.value++;
  activity.retain(selected.value);
  activity.update(result, rules.value, Date.now(), { discoverNew: fullSnapshot, observedAt: Object.fromEntries(lastSynced) });
  activityRevision.value++;
  permission.value = notificationPermission();
  statusTracker.retain(selected.value);
  statusPlayer.play(statusTracker.update(result, rules.value, notificationsEnabled, hideCoordination.value));
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
watch([lanes, rules, now, timeoutMinutes, timeoutRevision, showingCache, restoring, busy, hideCoordination], () => {
  if (busy.value) return;
  const result = timeoutTracker.scan(lanes.value, rules.value, timeoutMinutes.value, now.value,
    { notify: !showingCache.value && !restoring.value });
  timedOut.value = result.active.filter(entry => !hideCoordination.value || !isCoordination(entry.issue));
  for (const entry of result.newlyTimedOut) {
    if ((hideCoordination.value && isCoordination(entry.issue)) || !notificationsEnabled(entry.repo)) continue;
    const repo = lanes.value.find(lane => lane.repo.full_name === entry.repo)?.repo;
    if (repo) void notifyTimeout(repo, entry.issue).catch(() => {});
  }
}, { deep: true });
const loggedIn = computed(() => Boolean(user.value));
const connectionLabel = computed(() =>
  loggedIn.value ? t("GitHub anslutet") : isDemo.value ? t("Demoläge") : t("Ej ansluten"),
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
function laneIssues(lane: Lane) {
  return lane.issues.filter(
    (i) =>
      (!hideCoordination.value || !isCoordination(i)) &&
      matchesIssueFilters(i, query.value, repositoryQueries.value[lane.repo.full_name] || ""),
  );
}
function items(lane: Lane, key: string) {
  return sortedIssues(laneIssues(lane), key, rules.value[lane.repo.full_name]);
}
const combinedColumns = computed(() => Object.fromEntries(columns.value.map(col => [col.key, combinedItems(orderedLanes.value, col.key, rules.value, { query: query.value, repositoryQueries: repositoryQueries.value, hideCoordination: hideCoordination.value })])));
function combinedLimit(key: string) { return combinedLimits.value[key] ?? columnLimit.value; }
watch(columnLimit, () => { combinedLimits.value = {}; });
function commentsLoader(repo: string) {
  const client = api;
  const run = generation;
  return client ? async (issue: Issue) => {
    const result = await client.issueComments(repo, issue.number);
    if (client !== api || run !== generation) throw new Error("Session changed");
    return result;
  } : undefined;
}
function relationsLoader(repo: string) {
  const client = api;
  const run = generation;
  return client ? async (issue: Issue) => {
    const result = await client.issueRelations(repo, issue);
    if (client !== api || run !== generation) throw new Error("Session changed");
    return result;
  } : undefined;
}
function commitLoader(repo: string) {
  const client = api;
  const run = generation;
  return client
    ? async (issue: Issue) => {
        const result = await client.closingCommit(repo, issue);
        if (run !== generation || client !== api) throw new Error("Session changed");
        return result;
      }
    : undefined;
}
const sidebarRepos = computed(() => {
  activityRevision.value;
  return summarizeLanes(orderedLanes.value, rules.value, hideCoordination.value,
    (repo, issue) => activity.changedAt(repo, issue, now.value));
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
  notificationRepos: notificationRepos.value, language: preference.value,
  query: query.value, repositoryQueries: repositoryQueries.value, repoQuery: repoQuery.value,
  hideCoordination: hideCoordination.value, splitByRepository: splitByRepository.value, timeoutMinutes: timeoutMinutes.value,
  currentView: currentView.value as "overview" | "statistics", statistics: statisticsPreferences.value,
}));
function applyChosenPreferences(value: HandoffPreferences, preserveNavigation = false) {
  repositoryColors.value = value.repositoryColors ?? repositoryColors.value;
  projectOrder.value = value.projectOrder ?? projectOrder.value;
  collapsedRepos.value = value.collapsedRepos ?? collapsedRepos.value;
  columnLimit.value = value.columnLimit ?? columnLimit.value;
  repositoryColumnLimits.value = value.repositoryColumnLimits ?? repositoryColumnLimits.value;
  notificationRepos.value = value.notificationRepos ?? notificationRepos.value;
  if (value.language !== undefined) setLanguage(value.language);
  query.value = value.query ?? query.value;
  repositoryQueries.value = value.repositoryQueries ?? repositoryQueries.value;
  repoQuery.value = value.repoQuery ?? repoQuery.value;
  hideCoordination.value = value.hideCoordination ?? hideCoordination.value;
  splitByRepository.value = value.splitByRepository ?? splitByRepository.value;
  timeoutMinutes.value = value.timeoutMinutes ?? timeoutMinutes.value;
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
  save();
}
watch([query, repositoryQueries, repoQuery, hideCoordination, splitByRepository, currentView, statisticsPreferences, preference], () => save(), { deep: true });
function storageKey() {
  return `issueflow:${user.value?.login}`;
}
function save() {
  if (!user.value) return;
  repositoryColors.value = workspaceRepositoryColors.value;
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
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
        timeoutMinutes: timeoutMinutes.value,
      }),
    );
  } catch {
    /* App remains usable without storage. */
  }
}
function restorePreferences(available: Repo[]) {
    permissionAcknowledgements.value = [];
    repositoryColors.value = {};
    projectOrder.value = reconcileOrder([], available.map(repo => repo.full_name));
    collapsedRepos.value = [];
    columnLimit.value = defaultColumnLimit;
    timeoutMinutes.value = DEFAULT_TIMEOUT_MINUTES;
    repositoryColumnLimits.value = {};
    visibleLimit.value = {};
    combinedLimits.value = {};
    query.value = ""; repositoryQueries.value = {}; repoQuery.value = "";
    hideCoordination.value = true; splitByRepository.value = true; statisticsPreferences.value = {};
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (saved) {
        timeoutMinutes.value = parseTimeoutMinutes(saved.timeoutMinutes) ?? DEFAULT_TIMEOUT_MINUTES;
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
async function connect(token: string, imported?: HandoffSettings, cached?: ContentSnapshot | null) {
  if (authBusy.value) return;
  authBusy.value = true;
  error.value = "";
  try {
    if (imported && token === sessionToken.value && api && user.value && !isDemo.value) {
      const available = await api.repos();
      repos.value = available;
      applyImportedPreferences(imported, available);
      reconcileSelection();
      await refresh(false, true);
      return;
    }
    const next = new GitHub(token);
    if (cached) {
      generation++;
      next.restoreResponses(cached.responses);
      clearClosureFeedback();
      api = next;
      user.value = cached.user;
      sessionToken.value = token;
      repos.value = cached.repos;
      restorePreferences(cached.repos);
      timeoutTracker.restore(cached.timeoutAcknowledgements);
      lanes.value = cached.lanes.filter(lane => selected.value.includes(lane.repo.full_name));
      refreshed.value = cached.syncedAt;
      showingCache.value = true;
      activity.update(lanes.value, rules.value);
      for (const lane of lanes.value) closureTracker.update(lane);
    }
    const identity = await next.user();
    const available = await next.repos();
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
    } else restorePreferences(available);
    if (imported) applyImportedPreferences(imported, available);
    reconcileSelection();
    if (selected.value.length) await refresh(false, true);
    else { picker.value = true; showingCache.value = false; await persistContent(); }
    if (storageWarning) error.value = storageWarning;
  } catch (e) {
    error.value = message(e);
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
async function refresh(incremental = false, replacePending = false, manual = false) {
  if (!api) {
    refreshRequested = false;
    return;
  }
  if (busy.value && !replacePending) {
    if (manual && !fullRefreshRunning) refreshRequested = true;
    return;
  }
  refreshRequested = false;
  const client = api, run = generation, selection = selectionRevision;
  const current = () => run === generation && client === api && selection === selectionRevision;
  if (repositoryRequestClient !== client) {
    repositoryRequests.clear();
    repositoryRequestClient = client;
  }
  lanes.value = selectedLanes(lanes.value, repos.value, selected.value);
  if (!selected.value.length) {
    busy.value = false;
    showingCache.value = false;
    await persistContent();
    return;
  }
  busy.value = true;
  fullRefreshRunning = !incremental;
  error.value = "";
  const targets = repos.value.filter(repo => selected.value.includes(repo.full_name)).sort((a, b) =>
    Number(!!lanes.value.find(lane => lane.repo.full_name === b.full_name)?.loading) - Number(!!lanes.value.find(lane => lane.repo.full_name === a.full_name)?.loading));
  const result: Lane[] = [];
  let cursor = 0;
  try {
    if (!incremental) client.invalidateIssueRelations();
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (cursor < targets.length && current()) {
        const repo = targets[cursor++]!;
        try {
          const repoRules = { ...rules.value[repo.full_name] };
          const key = JSON.stringify([repo.full_name, Object.entries(repoRules).sort(([a], [b]) => a.localeCompare(b))]);
          const loaded = await repositoryRequests.run(key, async () => {
            if (run !== generation || client !== api || !selected.value.includes(repo.full_name)) throw new RepositoryRequestCancelled();
            const started = Date.now();
            const previous = lanes.value.find(lane => lane.repo.full_name === repo.full_name);
            const since = lastSynced.get(repo.full_name);
            const full = !incremental || !previous || previous.loading || previous.error || !since || (lastFullSynced.get(repo.full_name) || 0) <= started - 30 * 60000;
            const lane = full ? await client.lane(repo, repoRules) : await client.syncLane(previous!, repoRules, since!);
            return { lane, started, full };
          });
          if (!current() || !selected.value.includes(repo.full_name)) continue;
          lastSynced.set(repo.full_name, loaded.started);
          if (loaded.full) lastFullSynced.set(repo.full_name, loaded.started);
          result.push(loaded.lane);
          closureFeedback([loaded.lane]);
          lanes.value = lanes.value.map(lane => lane.repo.full_name === repo.full_name ? loaded.lane : lane);
        } catch (cause) {
          if (!current() || cause instanceof RepositoryRequestCancelled) continue;
          const old = lanes.value.find(lane => lane.repo.full_name === repo.full_name);
          if (!old || !selected.value.includes(repo.full_name)) continue;
          const failed = { ...old, loading: false, error: message(cause) };
          result.push(failed);
          lanes.value = lanes.value.map(lane => lane.repo.full_name === repo.full_name ? failed : lane);
        }
      }
    }));
    if (current()) {
      if (result.every(lane => !lane.error)) {
        refreshed.value = Date.now();
        showingCache.value = false;
      }
      await persistContent();
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
  await refresh(false, true);
}
function showDemo() {
  permissionAcknowledgements.value = [];
  repositoryColors.value = {};
  splitByRepository.value = true;
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
  splitByRepository.value = true;
  combinedLimits.value = {};
  repositoryQueries.value = {};
  picker.value = false;
  editing.value = null;
  refreshed.value = null;
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
  editing.value = lane.repo.full_name;
  rules.value[lane.repo.full_name] ||= {};
}
async function applyRules() {
  editing.value = null;
  save();
  await refresh();
}
let previousFocus: HTMLElement | null = null;
const modalOpen = computed(() => picker.value || Boolean(editing.value));
watch(modalOpen, async (open) => {
  if (open) {
    previousFocus = document.activeElement as HTMLElement;
    await nextTick();
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>(".modal button, .modal input")?.focus();
  } else {
    document.body.style.overflow = "";
    previousFocus?.focus();
  }
});
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab" || !modalOpen.value) return;
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".modal button:not(:disabled), .modal input, .modal a[href]",
    ),
  );
  const first = nodes[0],
    last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(() => document.addEventListener("keydown", trapFocus));
onUnmounted(() => document.removeEventListener("keydown", trapFocus));
const tick = setInterval(() => (now.value = Date.now()), 1000);
async function refreshActive() {
  if (!api || busy.value) return;
  const client = api,
    run = generation,
    selection = selectionRevision;
  const current = () => run === generation && client === api && selection === selectionRevision;
  busy.value = true;
  const result = lanes.value.map((lane) => ({
    ...lane,
    issues: [...lane.issues],
  }));
  let failure: unknown = null;
  const tasks = result.flatMap((lane) =>
    lane.issues
      .filter(
        (issue) =>
          column(issue, rules.value[lane.repo.full_name]) === "progress" &&
          (!hideCoordination.value || !isCoordination(issue)),
      )
      .map((issue) => ({ lane, issue })),
  );
  let cursor = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(3, tasks.length) }, async () => {
        while (cursor < tasks.length && current()) {
          const { lane, issue } = tasks[cursor++]!;
          try {
            const updated = await client.activeIssue(
              lane.repo,
              issue,
              rules.value[lane.repo.full_name] || {},
            );
            const index = lane.issues.findIndex(
              (item) => item.id === updated.id,
            );
            if (index >= 0) lane.issues[index] = updated;
            lane.timerWarning = lane.issues.some(
              (item) =>
                column(item, rules.value[lane.repo.full_name]) === "progress" &&
                item.timerError,
            );
          } catch (cause) {
            lane.error = message(cause);
            failure = cause;
          }
        }
      }),
    );
    if (current()) {
      closureFeedback(result, false);
      lanes.value = result;
      if (!showingCache.value) refreshed.value = Date.now();
      await persistContent();
    }
    if (failure && current()) throw failure;
  } finally {
    if (current()) busy.value = false;
  }
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
  hasActiveIssues: () =>
    lanes.value.some((lane) =>
      lane.issues.some(
        (issue) =>
          column(issue, rules.value[lane.repo.full_name]) === "progress" &&
          (!hideCoordination.value || !isCoordination(issue)),
      ),
    ),
  refreshActive,
  reconcile: () => refresh(true),
  retryAfterMs: () => api?.retryAfterMs(),
  onError: (cause) => {
    syncError.value = message(cause);
  },
  onSuccess: () => {
    syncError.value = "";
  },
});
function handleRefreshShortcut(event: KeyboardEvent) {
  if (!loggedIn.value || isDemo.value || event.defaultPrevented || !isDataRefreshShortcut(event)) return;
  // Prevent document reload even while a fetch is already running.
  event.preventDefault();
  if (!event.repeat && !authBusy.value) void refresh(false, false, true);
}
function resumeStatusAudio(event: Event) {
  if (event.isTrusted && notificationRepos.value.some(notificationsEnabled)) void statusPlayer.unlock();
}
onMounted(() => {
  sync.start();
  window.addEventListener("hashchange", navigateWorkspace);
  document.addEventListener("keydown", handleRefreshShortcut);
  document.addEventListener("pointerdown", resumeStatusAudio, { passive: true });
  document.addEventListener("keydown", resumeStatusAudio);
});

onUnmounted(() => {
  clearInterval(tick);
  sync.stop();
  window.removeEventListener("hashchange", navigateWorkspace);
  document.removeEventListener("keydown", handleRefreshShortcut);
  document.removeEventListener("pointerdown", resumeStatusAudio);
  document.removeEventListener("keydown", resumeStatusAudio);
  clearClosureFeedback();
});
onMounted(async () => {
  try {
    // Remove recognized credential fragments before authentication or network calls.
    const incoming = consumeHandoff();
    if (incoming) {
      let remembered: string | null = null, vaultError: unknown;
      try { remembered = await loadToken(); } catch (e) { vaultError = e; }
      if (remembered === incoming.token || (!remembered && !vaultError)) {
        await connect(incoming.token, incoming);
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
      if (confirmed) await connect(incoming.token, incoming);
      else if (remembered) await connect(remembered, undefined, snapshot);
      else error.value = message(vaultError);
      if (lookupError && !error.value) error.value = lookupError;
      return;
    }
    const oauthToken = await callback();
    if (oauthToken) {
      await connect(oauthToken);
      return;
    }
    const remembered = await loadToken();
    if (remembered) {
      savedSession.value = true;
      await connect(remembered, undefined, await readSnapshot(remembered));
    }
  } catch (e) {
    if (e instanceof VaultError) savedSession.value = true;
    error.value = message(e);
  } finally {
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
    <a class="nav-item" :class="{ active: currentView === 'overview' }" href="#overview" :aria-label="t('Översikt')"
      :aria-current="(loggedIn || isDemo) && currentView === 'overview' ? 'page' : undefined">
      <LayoutDashboard :size="18" /> {{ t("Översikt") }}
      <span class="nav-count">{{ lanes.length }}</span>
    </a>
    <a v-if="loggedIn || isDemo" class="nav-item statistics-nav" :class="{ active: currentView === 'statistics' }" href="#statistics"
      :aria-label="t('Statistik')" :title="t('Statistik')" :aria-current="currentView === 'statistics' ? 'page' : undefined">
      <Activity :size="18" /><span>{{ t("Statistik") }}</span>
    </a>
    </nav>
    <SidebarRepositories
      :statistics="currentView === 'statistics'"
      :repos="sidebarRepos"
      :repository-colors="workspaceRepositoryColors"
      :now="now"
      :can-select="loggedIn"
      :restoring="restoring && !loggedIn && !isDemo"
      @select="picker = true"
      @move="moveRepository"
      @reorder="reorderProject"
    />
    <SidebarVersion ref="sidebarVersion" :available="updateAvailable" :checked="updateChecked" :checking="updateChecking"
      @release-notes="openReleaseNotes()" @open-update="openUpdateDialog" />
    <div class="sidebar-footer">
      <Github :size="19" aria-hidden="true" />
      <div>
        <a href="https://github.com/solwation" target="_blank" rel="noopener noreferrer">Olof Wingren</a>
        <small><a href="https://github.com/solwation/github-dashboard/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a></small>
      </div>
      <ExternalLink :size="13" aria-hidden="true" />
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="breadcrumb">
        Workspace <span>/</span><strong>{{ currentView === "statistics" && (loggedIn || isDemo) ? t("Statistik") : t("Översikt") }}</strong>
      </div>
      <div class="topbar-right">
        <LanguageSettings :timeout-minutes="timeoutMinutes" @update:timeout-minutes="setTimeoutMinutes" :column-limit="columnLimit" :can-edit-limit="loggedIn || isDemo" @update:column-limit="setColumnLimit" :permissions="permissionReport" :permissions-session="generation" :permission-acknowledgements="permissionAcknowledgements" @update:permission-acknowledgements="setPermissionAcknowledgements" :permissions-checking="permissionsChecking" :can-check-permissions="loggedIn"
          :can-scan="loggedIn" @scan="scannerOpen = true" @open-updates="openUpdateDialog" @check-permissions="refreshPermissions()" @refresh-permissions="refreshPermissions(true)" />
        <InstallApp />
        <button
          v-if="user && sessionToken"
          class="button small handoff-button"
          :aria-label="t('Öppna på mobilen')"
          :title="t('Öppna på mobilen')"
          @click="handoffOpen = true"
        >
          <QrCode :size="16" /><span>{{ t("Mobil") }}</span>
        </button>
        <span class="connection" :class="{ connected: loggedIn }" :title="connectionLabel"
          ><i :class="{ connected: loggedIn }" aria-hidden="true" /><span class="connection-label">{{ connectionLabel }}</span></span
        ><template v-if="user || savedSession"
          ><img v-if="user" :src="user.avatar_url" alt="" class="avatar" :title="`${user.login} · ${connectionLabel}`" /><span
            class="username"
            v-if="user"
            >{{ user.login }}</span
          ><button
            class="icon-button"
            @click="logoutPrompt = true"
            :disabled="authBusy || restoring"
            :aria-label="t('Logga ut')"
            :title="t('Logga ut')"
          >
            <LogOut :size="17" /></button></template
        ><button v-else-if="isDemo" class="button small" @click="logout">
          {{ t("Till inloggning") }}
        </button>
      </div>
    </header>
    <main :id="currentView === 'statistics' && (loggedIn || isDemo) ? 'statistics' : 'overview'" tabindex="-1">
      <div v-if="cacheWarning" class="notice" role="status">{{ t("Innehållscachen kunde inte sparas. Översikten fungerar, men nästa start kan behöva hämta innehållet igen.") }} {{ t(cacheWarning) }}</div>
      <div v-if="timedOut.length" class="notice timeout-notices" role="status">
        <div v-for="entry in timedOut" :key="entry.key">
          <span>{{ t("Timeout för {repo} #{number}: {title}", { repo: entry.repo, number: entry.issue.number, title: entry.issue.title }) }}</span>
          <button class="button small" @click="ignoreTimeout(entry.repo, entry.issue)">{{ t("Ignorera timeout") }}</button>
        </div>
      </div>
      <div
        v-if="notificationNotice"
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
      <div v-if="restoring && !loggedIn && !isDemo" class="startup-placeholder" aria-hidden="true"><span class="skeleton short" /><span class="skeleton" /><span class="skeleton" /></div>
      <template v-else-if="!loggedIn && !isDemo"
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
            </button><button class="button" @click="showDemo">
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
        <StatisticsView v-if="currentView === 'statistics'" :client="api" :credential="sessionToken" :repositories="orderedLanes.map(lane => lane.repo)" v-model:preferences="statisticsPreferences" :demo="isDemo" :session="generation" />
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
        <OverviewSummary :query="query" :repository-queries="repositoryQueries" :counts="stats" :lanes="lanes" :rules="rules" :hide-coordination="hideCoordination"
          :live="!showingCache && !restoring && !lanes.some(lane => lane.loading)" :session="generation" :now="now" :logged-in="loggedIn"
          @choose-repositories="picker = true" />
        <div class="board-toolbar">
          <label class="search"
            ><Search :size="17" /><input
              v-model="query"
              :aria-label="t('Sök issues')"
              :placeholder="t('Sök issues, labels eller nummer…')" /></label
          ><label class="coord-toggle"
            ><input type="checkbox" v-model="hideCoordination" />
            {{ t("Dölj koordinationsärenden") }}</label
          ><label class="coord-toggle"><input type="checkbox" v-model="splitByRepository" />{{ t("Dela upp per repository") }}</label
          ><span class="updated" role="status" aria-live="polite" :aria-busy="busy"
            ><i />{{
              busy
                ? t("Hämtar…")
                : refreshed
                ? t("Uppdaterad ") +
                  new Date(refreshed).toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : t("Väntar på data")
            }}<span
              v-if="loggedIn"
              :title="
                syncError ||
                t(
                  'Pågående ärenden kontrolleras var 15:e sekund; projekt synkas mer sällan.',
                )
              "
              >{{ t(" · adaptiv synk") }}</span
            ></span
          >
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
        <template v-if="splitByRepository">
        <section
          v-for="(lane, laneIndex) in orderedLanes"
          :key="lane.repo.id"
          class="repo-lane"
          :id="'repo-' + lane.repo.id"
          :class="{ 'is-collapsed': collapsedRepos.includes(lane.repo.full_name) }"
        >
          <header class="lane-header">
            <div class="lane-title">
              <button class="collapse-project icon-button" @click="toggleCollapsed(lane.repo.full_name)"
                :aria-label="t(collapsedRepos.includes(lane.repo.full_name) ? 'Expandera {name}' : 'Kollapsa {name}', { name: lane.repo.name })"
                :aria-expanded="!collapsedRepos.includes(lane.repo.full_name)" :aria-controls="'lane-content-' + lane.repo.id">
                <ChevronRight v-if="collapsedRepos.includes(lane.repo.full_name)" :size="18" /><ChevronDown v-else :size="18" />
              </button>
              <span class="repo-avatar">{{
                lane.repo.name.slice(0, 2).toUpperCase()
              }}</span>
              <div>
                <h2>
                  <a
                    :href="lane.repo.html_url"
                    :title="lane.repo.name"
                    target="_blank"
                    rel="noopener noreferrer"
                    ><span class="repository-name-text">{{ lane.repo.name }}</span><ArrowRight :size="14" /></a
                  ><span v-if="lane.repo.private" class="private-badge">{{
                    t("Privat")
                  }}</span>
                </h2>
                <span class="repo-owner"
                  >{{ lane.repo.owner.login }} <span> / </span>
                  {{ lane.repo.description || "GitHub repository" }}</span
                >
              </div>
            </div>
            <div class="lane-meta">
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
                class="notification-toggle"
                role="switch"
                :aria-checked="notificationsEnabled(lane.repo.full_name)"
                :aria-label="t('Notiser för ') + lane.repo.name"
                :title="
                  notificationsEnabled(lane.repo.full_name)
                    ? t('Stäng av notiser om stängda issues')
                    : t('Slå på notiser om stängda issues')
                "
                :disabled="notificationPending !== null"
                :class="{ enabled: notificationsEnabled(lane.repo.full_name) }"
                @click="toggleNotifications(lane.repo.full_name)"
              >
                <Bell
                  v-if="notificationsEnabled(lane.repo.full_name)"
                  :size="15"
                /><BellOff v-else :size="15" /><span
                  >{{ t("Notiser") }}
                  {{
                    notificationsEnabled(lane.repo.full_name)
                      ? t("på")
                      : t("av")
                  }}</span
                >
              </button>
              <span v-if="!lane.loading" class="workflow-badge"
                ><Check :size="12" />{{ workflow(lane.labels) }}</span
              ><span v-if="!lane.loading && (!lane.error || lane.issues.length)">{{ laneIssues(lane).length }} issues</span><span v-else-if="lane.loading">{{ t("Hämtar…") }}</span
              ><button
                v-if="!isDemo"
                class="icon-button"
                @click="editRules(lane)"
                :aria-label="t('Anpassa labels för ') + lane.repo.name"
                :title="t('Anpassa labels')"
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
          </header>
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
          <div v-else-if="!lane.error || lane.issues.length" class="swimlane">
            <section
              v-for="col in columns"
              :key="col.key"
              class="board-column"
              :class="col.key"
            >
              <div class="column-header">
                <div class="column-heading">
                  <i :class="col.key" />{{ col.title
                  }}<span class="column-count">{{
                    items(lane, col.key).length
                  }}</span>
                </div>
                <span class="column-hint">{{ col.hint }}</span>
              </div>
              <div class="cards">
                <IssueCard
                  v-for="issue in items(lane, col.key).slice(
                    0,
                    shownLimit(lane.repo.full_name, col.key),
                  )"
                  :key="
                    boardEntryKey({ lane, issue }, col.key)
                  "
                  :issue="issue"
                  :repository="lane.repo.full_name"
                  :assigned-color="workspaceRepositoryColors[lane.repo.full_name]"
                  :load-relations="isDemo ? undefined : relationsLoader(lane.repo.full_name)"
                  :relations-revision="relationsRevision"
                  :rules="rules[lane.repo.full_name] || {}"
                  :now="now"
                  :timed-out="issueTimedOut(lane.repo.full_name, issue)"
                  :timeout-minutes="timeoutMinutes"
                  @ignore-timeout="ignoreTimeout(lane.repo.full_name, issue)"
                  :load-commit="
                    isDemo ? undefined : commitLoader(lane.repo.full_name)
                  "
                  :demo="isDemo"
                  :load-comments="isDemo ? undefined : commentsLoader(lane.repo.full_name)"
                  :comments-session="generation"
                  :commit-retry="commitRetry"
                  :recent-move="activity.moved(lane.repo.full_name, issue, now)"
                  @read="readIssue(lane.repo.full_name, issue)"
                  :celebrate="
                    recentClosures.has(closureKey(lane.repo.full_name, issue))
                  "
                />
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
        </section>
        </template>
        <section v-else-if="orderedLanes.length" class="combined-board" :aria-label="t('Gemensam board')">
          <details class="combined-repository-controls">
            <summary>{{ t("Repositoryfilter och inställningar") }}</summary>
            <p class="combined-limit-note">{{ t("Den gemensamma tavlan använder det globala antalet kort per kolumn. Visa fler lägger till lika många till.") }}</p>
            <div v-for="lane in orderedLanes" :key="lane.repo.full_name" class="combined-repository-control" :id="'repo-' + lane.repo.id">
              <span class="combined-repository-name"><i :style="{ backgroundColor: workspaceRepositoryColors[lane.repo.full_name] }" aria-hidden="true" />{{ lane.repo.full_name }}</span>
              <div class="repository-filter">
                <label class="sr-only" :for="'combined-filter-' + lane.repo.id">{{ t("Filtrera issues i {name}", { name: lane.repo.full_name }) }}</label>
                <div class="repository-search"><Search :size="14" aria-hidden="true" /><input :id="'combined-filter-' + lane.repo.id" v-model="repositoryQueries[lane.repo.full_name]" :placeholder="t('Sök issues, labels eller nummer…')" />
                  <button class="icon-button repository-filter-clear" :disabled="!repositoryQueries[lane.repo.full_name]" :aria-label="t('Rensa filtret för {name}', { name: lane.repo.full_name })" @click="repositoryQueries[lane.repo.full_name] = ''"><X :size="13" aria-hidden="true" /></button>
                </div>
              </div>
              <button v-if="!isDemo" class="notification-toggle" role="switch" :aria-checked="notificationsEnabled(lane.repo.full_name)" :aria-label="t('Notiser för ') + lane.repo.name" :disabled="notificationPending !== null" :class="{ enabled: notificationsEnabled(lane.repo.full_name) }" @click="toggleNotifications(lane.repo.full_name)"><Bell v-if="notificationsEnabled(lane.repo.full_name)" :size="15" /><BellOff v-else :size="15" />{{ t("Notiser") }} {{ notificationsEnabled(lane.repo.full_name) ? t("på") : t("av") }}</button>
              <button v-if="!isDemo" class="icon-button" @click="editRules(lane)" :aria-label="t('Anpassa labels för ') + lane.repo.name"><Settings2 :size="16" /></button>
            </div>
          </details>
          <template v-for="lane in orderedLanes" :key="lane.repo.full_name">
            <p v-if="lane.loading" class="repository-loading" role="status"><RefreshCw class="spinning" :size="20" aria-hidden="true" />{{ t("Hämtar issues för {name}…", { name: lane.repo.full_name }) }}</p>
            <p v-if="lane.error" class="notice error" role="alert"><strong>{{ lane.repo.full_name }}</strong> {{ lane.error }} {{ t("Tidigare data visas om de finns.") }}</p>
            <p v-if="lane.timerWarning" class="notice"><strong>{{ lane.repo.full_name }}</strong> {{ t("Vissa starttider kunde inte hämtas. Tidräknaren visas när historiken är tillgänglig.") }}</p>
          </template>
          <div class="swimlane">
            <section
              v-for="col in columns"
              :key="col.key"
              class="board-column"
              :class="col.key"
            >
              <div class="column-header">
                <div class="column-heading">
                  <i :class="col.key" />{{ col.title
                  }}<span v-if="combinedColumns[col.key]!.length || !orderedLanes.some(lane => lane.loading || lane.error)" class="column-count">{{
                    combinedColumns[col.key]!.length
                  }}</span>
                </div>
                <span class="column-hint">{{ col.hint }}</span>
              </div>
              <div class="cards">
                <IssueCard
                  v-for="{ lane, issue } in combinedColumns[col.key]!.slice(0, combinedLimit(col.key))"
                  :key="boardEntryKey({ lane, issue }, col.key)"
                  :issue="issue"
                  :repository="lane.repo.full_name"
                  :assigned-color="workspaceRepositoryColors[lane.repo.full_name]"
                  :load-relations="isDemo ? undefined : relationsLoader(lane.repo.full_name)"
                  :relations-revision="relationsRevision"
                  :rules="rules[lane.repo.full_name] || {}"
                  :now="now"
                  :timed-out="issueTimedOut(lane.repo.full_name, issue)"
                  :timeout-minutes="timeoutMinutes"
                  @ignore-timeout="ignoreTimeout(lane.repo.full_name, issue)"
                  :load-commit="
                    isDemo ? undefined : commitLoader(lane.repo.full_name)
                  "
                  :demo="isDemo"
                  :load-comments="isDemo ? undefined : commentsLoader(lane.repo.full_name)"
                  :comments-session="generation"
                  :commit-retry="commitRetry"
                  :recent-move="activity.moved(lane.repo.full_name, issue, now)"
                  @read="readIssue(lane.repo.full_name, issue)"
                  :celebrate="
                    recentClosures.has(closureKey(lane.repo.full_name, issue))
                  "
                />
                <div v-if="!combinedColumns[col.key]!.length && !orderedLanes.some(lane => lane.loading || lane.error)" class="column-empty">
                  <CircleCheck v-if="col.key === 'closed'" :size="20" /><Clock3
                    v-else-if="col.key === 'progress'"
                    :size="20"
                  /><Layers3 v-else :size="20" /><span>{{
                    query || orderedLanes.some(lane => repositoryQueries[lane.repo.full_name])
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
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
      @keydown.esc="picker = false"
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
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      @submit.prevent="applyRules"
      @keydown.esc="applyRules"
    >
      <div class="modal-heading">
        <h2 id="rules-title">{{ t("Anpassa labels") }}</h2>
        <button
          type="button"
          class="icon-button"
          @click="applyRules"
          :aria-label="t('Stäng')"
        >
          <X :size="20" />
        </button>
      </div>
      <p>
        {{ editing }}
        {{
          t("· Lämna tomt för automatisk detektering. Ange exakta labelnamn.")
        }}
      </p>
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
.repository-filter { flex: 0 1 220px; min-width: 0; max-width: 100%; font-size: 11px; color: var(--muted); }
.repository-search { display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; padding-left: 8px; min-width: 0; }
.repository-search > svg { flex-shrink: 0; }
.repository-filter-clear { flex-shrink: 0; width: 30px; height: 30px; min-width: 30px; min-height: 30px; }
.repository-search input { width: 100%; min-width: 0; padding-block: 7px; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.repository-search:focus-within { outline: 2px solid var(--green); outline-offset: 2px; }
.repository-filter-empty { margin: 0; padding: 0 18px 14px; color: var(--muted); font-size: 13px; }

.repository-loading { display: flex; align-items: center; gap: 10px; padding: 30px 18px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.repository-loading svg { flex-shrink: 0; }
.combined-board { margin-bottom: 25px; border: 1px solid var(--line); border-radius: 10px; background: white; overflow: hidden; }
.combined-repository-controls { padding: 15px 18px; border-bottom: 1px solid var(--line); font-size: 12px; }
.combined-repository-controls summary { cursor: pointer; font-weight: 600; }
.combined-limit-note { color: var(--muted); font-size: 11px; line-height: 1.6; }
.combined-repository-control { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
.combined-repository-name { display: inline-flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 180px; overflow-wrap: anywhere; }
.combined-repository-name i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.combined-repository-control .repository-filter { flex: 1 1 200px; }
</style>
