<script setup lang="ts">
import { useLanguage } from "./lib/i18n";
const { t, locale } = useLanguage();
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
import ColumnLimitField from "./components/ColumnLimitField.vue";
import { defaultColumnLimit, effectiveColumnLimit, restoreColumnLimits } from "./lib/column-limits";
import VersionUpdate from "./components/VersionUpdate.vue";
import SidebarRepositories from "./components/SidebarRepositories.vue";
import { reconcileOrder, restoreLayout, moveProject } from "./lib/project-layout";
import { summarizeLanes } from "./lib/sidebar";
import { ActivityTracker } from "./lib/activity";
import { StatusSoundPlayer, StatusTransitionTracker } from "./lib/status-sounds";
import { createIssueSync } from "./lib/sync";
import { isDataRefreshShortcut } from "./lib/refresh-shortcuts";
import { matchesIssueFilters } from "./lib/issue-filter";
import LogoutDialog from "./components/LogoutDialog.vue";
import MobileHandoff from "./components/MobileHandoff.vue";
import ProblemReport from "./components/ProblemReport.vue";
const ScanLogin = defineAsyncComponent(() => import("./components/ScanLogin.vue"));
import { saveToken, loadToken, clearToken, VaultError } from "./lib/vault";
import { readSnapshot, writeSnapshot, type ContentSnapshot } from "./lib/content-cache";
import { cacheFailureReason } from "./lib/cache-failure";
import { consumeHandoff, type HandoffSettings } from "./lib/handoff";
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
const user = ref<{ login: string; avatar_url: string } | null>(null);
const lanes = ref<Lane[]>([]);
const repos = ref<Repo[]>([]);
const selected = ref<string[]>([]);
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
const busy = ref(false);
const error = ref("");
const now = ref(Date.now());
const refreshed = ref<number | null>(null);
const showingCache = ref(false);
const cacheWarning = ref("");
async function persistContent() {
  if (!user.value || !sessionToken.value || !api || isDemo.value) return;
  const run = generation;
  try {
    await writeSnapshot(sessionToken.value, { user: user.value, repos: repos.value, lanes: lanes.value,
      syncedAt: refreshed.value, responses: api.exportResponses() });
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
const pendingSelected = ref<string[]>([]);
watch(picker, (open) => {
  if (open) pendingSelected.value = [...selected.value];
});
const visibleLimit = ref<Record<string, number>>({});
const columnLimit = ref(defaultColumnLimit);
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
const commitProblems = ref(new Map<string, { repo: string; issue: Issue }>());
const commitRetry = ref(0);
const problemReport = ref<{ open: () => void } | null>(null);
const hideCommitNotice = ref(false);
try { hideCommitNotice.value = localStorage.getItem("issueflow:hide-commit-notice") === "true"; } catch { /* Optional preference. */ }
function setHideCommitNotice(value: boolean) {
  hideCommitNotice.value = value;
  try { localStorage.setItem("issueflow:hide-commit-notice", String(value)); } catch { /* Keep session preference. */ }
}
const activeCommitProblems = computed(() => [...commitProblems.value.values()].filter(problem =>
  lanes.value.some(lane => lane.repo.full_name === problem.repo && lane.issues.some(issue =>
    issue.id === problem.issue.id && issue.state === "closed" && issue.closed_at === problem.issue.closed_at)),
));
const notificationRepos = ref<string[]>([]);
const notificationNotice = ref("");
const permission = ref(notificationPermission());
const notificationPending = ref<string | null>(null);
const recentClosures = ref(new Set<string>());
const closureTracker = new ClosureTracker();
const statusTracker = new StatusTransitionTracker();
const audioUnavailableText = "Ljud kunde inte aktiveras. Klicka eller tryck på en tangent i dashboarden för att försöka igen. Notiser fungerar fortfarande.";
const statusPlayer = new StatusSoundPlayer(() => { notificationNotice.value = t(audioUnavailableText); });
const activity = new ActivityTracker();
const activityRevision = ref(0);
function readIssue(repo: string, issue: Issue) {
  activity.read(repo, issue);
  activityRevision.value++;
  save();
}
const celebrationTimers = new Set<ReturnType<typeof setTimeout>>();
function clearClosureFeedback() {
  statusTracker.clear();
  statusPlayer.clear();
  activity.clear();
  commitProblems.value.clear();
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
      notificationNotice.value = t(
        "Notiser på för {repo}. Statusändringar spelar ljud och nya stängningar meddelas medan dashboarden är öppen. Webbläsaren kan fördröja uppdateringar i bakgrunden.",
        { repo },
      );
      if (!(await audioReady) && run === generation) notificationNotice.value += " " + t(audioUnavailableText);
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
function closureFeedback(result: Lane[]) {
  activity.retain(selected.value);
  activity.update(result, rules.value);
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
const loggedIn = computed(() => Boolean(user.value));
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
function commentsLoader(repo: string) {
  const client = api;
  const run = generation;
  return client ? async (issue: Issue) => {
    const result = await client.issueComments(repo, issue.number);
    if (client !== api || run !== generation) throw new Error("Session changed");
    return result;
  } : undefined;
}
function commitLoader(repo: string) {
  const client = api;
  const run = generation;
  return client
    ? async (issue: Issue) => {
        const key = closureKey(repo, issue);
        try {
          const result = await client.closingCommit(repo, issue);
          if (run === generation) commitProblems.value.delete(key);
          return result;
        } catch (cause) {
          if (run === generation) commitProblems.value.set(key, { repo, issue });
          throw cause;
        }
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
function storageKey() {
  return `issueflow:${user.value?.login}`;
}
function save() {
  if (!user.value) return;
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        selected: selected.value,
        projectOrder: projectOrder.value,
        collapsedRepos: collapsedRepos.value,
        rules: rules.value,
        columnLimit: columnLimit.value,
        repositoryColumnLimits: repositoryColumnLimits.value,
        notificationRepos: notificationRepos.value,
        activityRead: activity.acknowledgements(),
      }),
    );
  } catch {
    /* App remains usable without storage. */
  }
}
function restorePreferences(available: Repo[]) {
    projectOrder.value = reconcileOrder([], available.map(repo => repo.full_name));
    collapsedRepos.value = [];
    columnLimit.value = defaultColumnLimit;
    repositoryColumnLimits.value = {};
    visibleLimit.value = {};
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (saved) {
        const limits = restoreColumnLimits(saved, available.map(repo => repo.full_name));
        columnLimit.value = limits.global;
        repositoryColumnLimits.value = limits.overrides;
        const layout = restoreLayout(saved, available.map(repo => repo.full_name));
        projectOrder.value = layout.order;
        collapsedRepos.value = layout.collapsed;
        activity.restore(saved.activityRead);
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
    if (!cached || cached.user.login !== identity.login) lanes.value = [];
    selected.value = [];
    rules.value = {};
    notificationRepos.value = [];
    if (!cached || cached.user.login !== identity.login) clearClosureFeedback();
    isDemo.value = false;
    tokenPanel.value = false;
    tokenInput.value = "";
    restorePreferences(available);
    if (imported) {
      const accessible = new Set(available.map((repo) => repo.full_name));
      selected.value = imported.selected.filter((name) => accessible.has(name));
      rules.value = Object.fromEntries(
        Object.entries(imported.rules).filter(([name]) => accessible.has(name)),
      );
      save();
    }
    lanes.value = lanes.value.filter(lane => selected.value.includes(lane.repo.full_name) && available.some(repo => repo.full_name === lane.repo.full_name));
    if (selected.value.length) await refresh();
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
async function refresh(incremental = false) {
  if (!api || busy.value) return;
  const client = api;
  const run = generation;
  busy.value = true;
  error.value = "";
  try {
    const result: Lane[] = [];
    // Fetch repositories in small batches, retaining a separate error per lane.
    for (const repo of repos.value.filter((r) =>
      selected.value.includes(r.full_name),
    )) {
      try {
        const started = Date.now();
        const previous = lanes.value.find(
          (lane) => lane.repo.full_name === repo.full_name,
        );
        const since = lastSynced.get(repo.full_name);
        result.push(
          incremental &&
            previous &&
            !previous.error &&
            since &&
            (lastFullSynced.get(repo.full_name) || 0) > started - 30 * 60000
            ? await client.syncLane(
                previous,
                rules.value[repo.full_name] || {},
                since,
              )
            : await client.lane(repo, rules.value[repo.full_name] || {}),
        );
        if (run === generation) {
          lastSynced.set(repo.full_name, started);
          if (
            !incremental ||
            !previous ||
            previous.error ||
            !since ||
            (lastFullSynced.get(repo.full_name) || 0) <= started - 30 * 60000
          )
            lastFullSynced.set(repo.full_name, started);
        }
      } catch (e) {
        const old = lanes.value.find(
          (l) => l.repo.full_name === repo.full_name,
        );
        result.push({
          ...old,
          repo,
          issues: old?.issues || [],
          labels: old?.labels || [],
          error: message(e),
        });
      }
    }
    if (run === generation) {
      closureTracker.retain(selected.value);
      closureFeedback(result);
      lanes.value = result;
      if (result.every(lane => !lane.error)) {
        refreshed.value = Date.now();
        showingCache.value = false;
      }
      await persistContent();
      if (incremental && result.some((lane) => lane.error))
        throw new Error(result.find((lane) => lane.error)!.error);
    }
  } finally {
    if (run === generation) busy.value = false;
  }
}
function toggleRepo(name: string) {
  pendingSelected.value = pendingSelected.value.includes(name)
    ? pendingSelected.value.filter((n) => n !== name)
    : [...pendingSelected.value, name];
}
async function applyRepos() {
  selected.value = [...pendingSelected.value];
  closureTracker.retain(selected.value);
  picker.value = false;
  save();
  await refresh();
}
function showDemo() {
  generation++;
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
    run = generation;
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
        while (cursor < tasks.length) {
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
    if (run === generation) {
      closureFeedback(result);
      lanes.value = result;
      if (!showingCache.value) refreshed.value = Date.now();
      await persistContent();
    }
    if (failure) throw failure;
  } finally {
    if (run === generation) busy.value = false;
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
  if (!event.repeat && !authBusy.value) void refresh();
}
function resumeStatusAudio(event: Event) {
  if (event.isTrusted && notificationRepos.value.some(notificationsEnabled)) void statusPlayer.unlock();
}
onMounted(() => {
  sync.start();
  document.addEventListener("keydown", handleRefreshShortcut);
  document.addEventListener("pointerdown", resumeStatusAudio, { passive: true });
  document.addEventListener("keydown", resumeStatusAudio);
});

onUnmounted(() => {
  clearInterval(tick);
  sync.stop();
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
      await connect(incoming.token, incoming);
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
        ><small>a github projekt dashboard</small></span
      ></a
    ><span class="nav-caption">WORKSPACE</span>
    <a class="nav-item active" href="#overview" :aria-label="t('Översikt')"
      :aria-current="loggedIn || isDemo ? 'page' : undefined">
      <LayoutDashboard :size="18" /> {{ t("Översikt") }}
      <span class="nav-count">{{ lanes.length }}</span>
    </a>
    <SidebarRepositories
      :repos="sidebarRepos"
      :now="now"
      :can-select="loggedIn"
      @select="picker = true"
      @move="moveRepository"
      @reorder="reorderProject"
    />
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
        Workspace <span>/</span><strong>{{ t("Översikt") }}</strong>
      </div>
      <div class="topbar-right">
        <LanguageSettings :column-limit="columnLimit" :can-edit-limit="loggedIn || isDemo" @update:column-limit="setColumnLimit" :can-view-problems="loggedIn" :problem-count="activeCommitProblems.length"
          @open-problems="problemReport?.open()" />
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
        <span class="connection"
          ><i :class="{ connected: loggedIn }" />{{
            loggedIn
              ? t("GitHub anslutet")
              : isDemo
                ? t("Demoläge")
                : t("Ej ansluten")
          }}</span
        ><template v-if="user || savedSession"
          ><img v-if="user" :src="user.avatar_url" alt="" class="avatar" /><span
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
    <main id="overview" tabindex="-1">
      <div v-if="cacheWarning" class="notice" role="status">{{ t("Innehållscachen kunde inte sparas. Översikten fungerar, men nästa start kan behöva hämta innehållet igen.") }} {{ t(cacheWarning) }}</div>
      <div v-if="activeCommitProblems.length && !hideCommitNotice" class="notice commit-notice" role="status">
        <span>{{ t("Commit-information saknas för {count} issues.", { count: activeCommitProblems.length }) }}</span>
        <button class="button small" @click="problemReport?.open()">{{ t("Läs mer") }}</button>
        <button class="button small" @click="setHideCommitNotice(true)">{{ t("Visa inte igen") }}</button>
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
      <template v-if="!loggedIn && !isDemo"
        ><div class="welcome">
          <span class="eyebrow"
            ><span class="repo-dot" />
            {{ t("MINDRE LETANDE. MER FRAMÅT.") }}</span
          >
          <h1>
            {{ t("Alla dina projekt.") }}<br /><span>{{
              t("Ett tydligt flöde.")
            }}</span>
          </h1>
          <p>
            {{
              t(
                "Från första idén till sista fixen. Följ dina GitHub-issues i en samlad vy som anpassar sig efter hur du jobbar.",
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
      <template v-else
        ><section class="page-heading">
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
        <section class="stats" :aria-label="t('Sammanfattning')">
          <div class="stat repository-stat">
            <span class="stat-icon repos"><Layers3 :size="20" /></span>
            <div>
              <span class="stat-label">Repositories</span
              ><strong
                >{{ lanes.length
                }}<small>{{ t("i din översikt") }}</small></strong
              >
            </div>
            <button
              v-if="loggedIn"
              class="icon-button repository-stat-action"
              :aria-label="t('Välj repositories')"
              :title="t('Välj repositories')"
              :disabled="busy"
              @click="picker = true"
            >
              <Plus :size="16" aria-hidden="true" />
            </button>
          </div>
          <div class="stat">
            <span class="stat-icon backlog"
              ><LayoutDashboard :size="20"
            /></span>
            <div>
              <span class="stat-label">{{ t("Öppna issues") }}</span
              ><strong
                >{{ stats.open }}<small>{{ t("att ta vidare") }}</small></strong
              >
            </div>
          </div>
          <div class="stat">
            <span class="stat-icon progress"><Activity :size="20" /></span>
            <div>
              <span class="stat-label">{{ t("Pågående") }}</span
              ><strong
                >{{ stats.progress }}<small>{{ t("just nu") }}</small></strong
              >
            </div>
          </div>
          <div class="stat">
            <span class="stat-icon closed"><CircleCheck :size="20" /></span>
            <div>
              <span class="stat-label">{{ t("Stängda") }}</span
              ><strong
                >{{ stats.closed
                }}<small>{{ t("senaste 30 dagarna") }}</small></strong
              >
            </div>
          </div>
        </section>
        <div class="board-toolbar">
          <label class="search"
            ><Search :size="17" /><input
              v-model="query"
              :aria-label="t('Sök issues')"
              :placeholder="t('Sök issues, labels eller nummer…')" /></label
          ><label class="coord-toggle"
            ><input type="checkbox" v-model="hideCoordination" />
            {{ t("Dölj koordinationsärenden") }}</label
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
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ lane.repo.name }}<ArrowRight :size="14" /></a
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
              <span class="lane-summary" :aria-label="t('Sammanfattning för {name}', { name: lane.repo.name })">
                <span>{{ t('Backlog: {count}', { count: sidebarRepos[laneIndex]?.backlog || 0 }) }}</span>
                <span>{{ t('Pågående: {count}', { count: sidebarRepos[laneIndex]?.progress || 0 }) }}</span>
                <span>{{ t('Stängda senaste 30 dagarna: {count}', { count: sidebarRepos[laneIndex]?.closed || 0 }) }}</span>
              </span>
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
              <span class="workflow-badge"
                ><Check :size="12" />{{ workflow(lane.labels) }}</span
              ><span>{{ laneIssues(lane).length }} issues</span
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
          </header>
          <div v-show="!collapsedRepos.includes(lane.repo.full_name)" :id="'lane-content-' + lane.repo.id">
          <div class="repository-filter">
            <label :for="'repository-filter-' + lane.repo.id">{{ t("Filtrera issues i {name}", { name: lane.repo.full_name }) }}</label>
            <div class="repository-filter-controls">
              <div class="repository-search">
                <Search :size="16" aria-hidden="true" />
                <input :id="'repository-filter-' + lane.repo.id" v-model="repositoryQueries[lane.repo.full_name]"
                  :placeholder="t('Sök issues, labels eller nummer…')" />
              </div>
              <button class="button small" :disabled="!repositoryQueries[lane.repo.full_name]"
                :aria-label="t('Rensa filtret för {name}', { name: lane.repo.full_name })"
                @click="repositoryQueries[lane.repo.full_name] = ''">{{ t("Rensa") }}</button>
            </div>
          </div>
          <p v-if="(query || repositoryQueries[lane.repo.full_name]) && !laneIssues(lane).length" class="repository-filter-empty" role="status">
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
                    issue.id +
                    (col.key === 'closed' ? issue.closed_at || '' : '')
                  "
                  :issue="issue"
                  :rules="rules[lane.repo.full_name] || {}"
                  :now="now"
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
        <footer class="board-footer">
          <span
            ><Github :size="14" />
            {{ t("Dina repositories. Ditt arbetssätt.") }}</span
          ><span>{{
            isDemo
              ? t("Fiktiva exempeldata")
              : t("Läsande vy · ändra issues på GitHub")
          }}</span>
        </footer></template
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
        ><button class="button primary" :disabled="busy" @click="applyRepos">
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
  <VersionUpdate />
  <ProblemReport v-if="loggedIn" ref="problemReport" :problems="activeCommitProblems"
    :hide-notice="hideCommitNotice" @update:hide-notice="setHideCommitNotice"
    @retry="commitRetry++" />
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
    @close="handoffOpen = false"
  />
  <ScanLogin v-if="scannerOpen" @close="scannerOpen = false"
    @scanned="payload => { scannerOpen = false; void connect(payload.token, payload); }" />
</template>

<style scoped>
.repository-filter { padding: 14px 18px; display: grid; gap: 7px; font-size: 12px; color: var(--muted); }
.repository-filter-controls { display: flex; gap: 8px; }
.repository-search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; width: min(100%, 420px); min-width: 0; }
.repository-search input { width: 100%; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.repository-search:focus-within { outline: 2px solid var(--green); outline-offset: 2px; }
.repository-filter-empty { margin: 0; padding: 0 18px 14px; color: var(--muted); font-size: 13px; }
</style>
