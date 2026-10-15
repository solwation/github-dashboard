<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Activity,
  Bell,
  BellOff,
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  ExternalLink,
  Layers3,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "@lucide/vue";
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
  type Repo,
  type Rules,
} from "./lib/model";
const user = ref<{ login: string; avatar_url: string } | null>(null);
const lanes = ref<Lane[]>([]);
const repos = ref<Repo[]>([]);
const selected = ref<string[]>([]);
const rules = ref<Record<string, Rules>>({});
const editing = ref<string | null>(null);
const isDemo = ref(false);
const busy = ref(false);
const error = ref("");
const now = ref(Date.now());
const refreshed = ref<number | null>(null);
const query = ref("");
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
const authBusy = ref(false);
const notificationRepos = ref<string[]>([]);
const notificationNotice = ref("");
const permission = ref(notificationPermission());
const notificationPending = ref<string | null>(null);
const recentClosures = ref(new Set<string>());
const closureTracker = new ClosureTracker();
const celebrationTimers = new Set<ReturnType<typeof setTimeout>>();
function clearClosureFeedback() {
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
    notificationRepos.value = notificationRepos.value.filter(
      (name) => name !== repo,
    );
    save();
    return;
  }
  const run = generation;
  notificationPending.value = repo;
  try {
    const result = await requestNotifications();
    if (run !== generation) return;
    permission.value = result;
    if (result === "granted") {
      if (!notificationRepos.value.includes(repo))
        notificationRepos.value.push(repo);
      save();
      notificationNotice.value = `Notiser på för ${repo}. Nya stängningar meddelas medan dashboarden är öppen, även i en bakgrundsflik. Webbläsaren kan fördröja uppdateringar i bakgrunden.`;
    } else {
      notificationNotice.value =
        result === "unsupported"
          ? "Den här webbläsaren stöder inte notiser här. Använd en datorwebbläsare med HTTPS."
          : result === "denied"
            ? "Notiser är blockerade. Tillåt notiser för den här webbplatsen i webbläsarens inställningar och försök igen."
            : "Notiser aktiverades inte. Du kan försöka igen med klockan vid projektet.";
    }
  } catch {
    if (run === generation)
      notificationNotice.value =
        "Webbläsaren kunde inte aktivera notiser. Kontrollera webbplatsens behörigheter.";
  } finally {
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
    notificationNotice.value =
      "Notiser kunde inte visas och har stängts av för " +
      lane.repo.name +
      ". Kontrollera webbläsarens stöd och behörigheter.";
  }
}
function closureFeedback(result: Lane[]) {
  permission.value = notificationPermission();
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
const columns = [
  { key: "backlog", title: "Backlog", hint: "Högst prioritet först" },
  { key: "progress", title: "In progress", hint: "Tid sedan arbetet startade" },
  { key: "closed", title: "Closed", hint: "Senaste 30 dagarna · nyast först" },
];
function laneIssues(lane: Lane) {
  return lane.issues.filter(
    (i) =>
      (!hideCoordination.value || !isCoordination(i)) &&
      (!query.value ||
        `${i.title} #${i.number} ${i.labels.map((l) => l.name).join(" ")}`
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  );
}
function items(lane: Lane, key: string) {
  return sortedIssues(laneIssues(lane), key, rules.value[lane.repo.full_name]);
}
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
        rules: rules.value,
        notificationRepos: notificationRepos.value,
      }),
    );
  } catch {
    /* App remains usable without storage. */
  }
}
async function connect(token: string) {
  if (authBusy.value) return;
  authBusy.value = true;
  error.value = "";
  try {
    const next = new GitHub(token);
    const identity = await next.user();
    const available = await next.repos();
    generation++;
    api = next;
    user.value = identity;
    repos.value = available;
    lanes.value = [];
    selected.value = [];
    rules.value = {};
    notificationRepos.value = [];
    clearClosureFeedback();
    isDemo.value = false;
    tokenPanel.value = false;
    tokenInput.value = "";
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (saved) {
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
    if (selected.value.length) await refresh();
    else picker.value = true;
  } catch (e) {
    error.value = message(e);
  } finally {
    authBusy.value = false;
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "Något gick fel. Försök igen.";
}
async function refresh() {
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
        result.push(await client.lane(repo, rules.value[repo.full_name] || {}));
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
      refreshed.value = Date.now();
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
  lanes.value = demo();
  refreshed.value = Date.now();
  error.value = "";
}
function logout() {
  generation++;
  clearClosureFeedback();
  notificationRepos.value = [];
  notificationPending.value = null;
  api = null;
  user.value = null;
  lanes.value = [];
  repos.value = [];
  selected.value = [];
  rules.value = {};
  isDemo.value = false;
  busy.value = false;
  error.value = "";
  query.value = "";
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
const poll = setInterval(() => {
  if (
    (!document.hidden ||
      (notificationPermission() === "granted" &&
        selected.value.some((repo) =>
          notificationRepos.value.includes(repo),
        ))) &&
    loggedIn.value &&
    !picker.value &&
    !editing.value
  )
    void refresh();
}, 60000);
onUnmounted(() => {
  clearInterval(tick);
  clearInterval(poll);
  clearClosureFeedback();
});
onMounted(async () => {
  try {
    const token = await callback();
    if (token) await connect(token);
  } catch (e) {
    error.value = message(e);
  }
});
</script>
<template>
  <aside class="sidebar">
    <a class="brand" href="." aria-label="Issueflow startsida"
      ><span class="brand-icon"><Layers3 :size="23" /></span
      ><span>issueflow<span class="brand-dot">.</span></span></a
    ><span class="nav-caption">WORKSPACE</span>
    <div class="nav-item active">
      <LayoutDashboard :size="18" /> Översikt
      <span class="nav-count">{{ lanes.length }}</span>
    </div>
    <div class="sidebar-projects">
      <span class="nav-caption">REPOSITORIES</span
      ><button
        v-if="loggedIn"
        class="sidebar-add"
        @click="picker = true"
        aria-label="Välj repositories"
      >
        <Plus :size="16" /></button
      ><a
        v-for="lane in lanes"
        :key="lane.repo.id"
        class="repo-nav"
        :href="'#repo-' + lane.repo.id"
        ><span class="repo-dot" />{{ lane.repo.name }}</a
      >
      <p v-if="!lanes.length" class="sidebar-empty">Dina projekt börjar här.</p>
    </div>
    <div class="sidebar-footer">
      <Github :size="19" />
      <div>Byggt för ditt flöde<small>Drivs av GitHub Issues</small></div>
      <ExternalLink :size="13" />
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="breadcrumb">
        Workspace <span>/</span><strong>Översikt</strong>
      </div>
      <div class="topbar-right">
        <InstallApp />
        <span class="connection"
          ><i :class="{ connected: loggedIn }" />{{
            loggedIn ? "GitHub anslutet" : isDemo ? "Demoläge" : "Ej ansluten"
          }}</span
        ><template v-if="user"
          ><img :src="user.avatar_url" alt="" class="avatar" /><span
            class="username"
            >{{ user.login }}</span
          ><button
            class="icon-button"
            @click="logout"
            aria-label="Logga ut"
            title="Logga ut"
          >
            <LogOut :size="17" /></button></template
        ><button v-else-if="isDemo" class="button small" @click="logout">
          Till inloggning
        </button>
      </div>
    </header>
    <main>
      <div
        v-if="notificationNotice"
        class="notice notification-notice"
        role="status"
      >
        <span>{{ notificationNotice }}</span
        ><button
          class="icon-button"
          aria-label="Stäng notismeddelande"
          @click="notificationNotice = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <div v-if="error" class="notice error" role="alert">
        {{ error
        }}<button
          class="icon-button"
          aria-label="Stäng felmeddelande"
          @click="error = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <template v-if="!loggedIn && !isDemo"
        ><div class="welcome">
          <span class="eyebrow"
            ><span class="repo-dot" /> MINDRE LETANDE. MER FRAMÅT.</span
          >
          <h1>Alla dina projekt.<br /><span>Ett tydligt flöde.</span></h1>
          <p>
            Från första idén till sista fixen. Följ dina GitHub-issues i en
            samlad vy som anpassar sig efter hur du jobbar.
          </p>
          <div class="welcome-actions">
            <button v-if="oauthReady" class="button primary" @click="oauth">
              <Github :size="19" /> Logga in med GitHub
              <ArrowRight :size="17" /></button
            ><button v-else class="button primary" @click="tokenPanel = true">
              <Github :size="19" /> Anslut GitHub
              <ArrowRight :size="17" /></button
            ><button class="button" @click="showDemo">
              Utforska en demo <ArrowRight :size="16" />
            </button>
          </div>
          <p class="privacy-note">
            Dina issues hämtas direkt från GitHub. Inga projektdata sparas på en
            server.
          </p>
          <form
            v-if="tokenPanel"
            class="token-form"
            @submit.prevent="connect(tokenInput.trim())"
          >
            <label for="token">GitHub personal access token</label>
            <p>
              Använd en fine-grained token med läsrättighet till Issues och
              Metadata för de repositories du vill följa. Tokenen finns bara i
              minnet tills du lämnar sidan.
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
              {{ authBusy ? "Ansluter…" : "Anslut konto" }}</button
            ><a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              >Skapa en token <ExternalLink :size="13"
            /></a>
          </form>
          <button
            v-if="oauthReady && !tokenPanel"
            class="text-button"
            @click="tokenPanel = true"
          >
            Använd en personal access token
          </button>
        </div>
        <div class="intro-board" aria-label="Så fungerar dashboarden">
          <div v-for="(col, i) in columns" :key="col.key" class="intro-column">
            <span class="column-heading"
              ><i :class="col.key" />{{ col.title }}</span
            >
            <div class="illustration-card" :class="col.key">
              <span class="skeleton short" /><strong>{{
                [
                  "Nästa stora idé",
                  "Något bra är på gång",
                  "Ännu ett steg framåt",
                ][i]
              }}</strong
              ><span class="skeleton" /><span class="intro-tag">{{
                ["Prioriterat & redo", "◷ 1h 24m", "✓ Klart för idag"][i]
              }}</span>
            </div>
            <span class="intro-description">{{
              [
                "Ditt nästa steg, i rätt ordning.",
                "Följ arbetet medan det händer.",
                "Se vad du har åstadkommit.",
              ][i]
            }}</span>
          </div>
        </div></template
      >
      <template v-else
        ><section class="page-heading">
          <div>
            <div class="eyebrow">DITT ARBETE, SAMLAT</div>
            <h1>Projektöversikt<span class="heading-dot">.</span></h1>
            <p>Från backlog till klart. Håll koll på vad som rör sig.</p>
          </div>
          <div class="heading-actions">
            <button class="button" :disabled="busy || isDemo" @click="refresh">
              <RefreshCw :size="15" :class="{ spinning: busy }" />{{
                busy ? "Hämtar…" : "Uppdatera"
              }}</button
            ><button
              v-if="loggedIn"
              class="button primary"
              :disabled="busy"
              @click="picker = true"
            >
              <Plus :size="16" /> Välj repositories
            </button>
          </div>
        </section>
        <div v-if="isDemo" class="notice demo-notice">
          <span
            >Du utforskar en demo med fiktiva projekt. Anslut GitHub för att se
            dina egna.</span
          ><button class="text-button" @click="logout">
            Anslut konto <ArrowRight :size="14" />
          </button>
        </div>
        <section class="stats" aria-label="Sammanfattning">
          <div class="stat">
            <span class="stat-icon repos"><Layers3 :size="20" /></span>
            <div>
              <span class="stat-label">Repositories</span
              ><strong>{{ lanes.length }}<small>i din översikt</small></strong>
            </div>
          </div>
          <div class="stat">
            <span class="stat-icon backlog"
              ><LayoutDashboard :size="20"
            /></span>
            <div>
              <span class="stat-label">Öppna issues</span
              ><strong>{{ stats.open }}<small>att ta vidare</small></strong>
            </div>
          </div>
          <div class="stat">
            <span class="stat-icon progress"><Activity :size="20" /></span>
            <div>
              <span class="stat-label">Pågående</span
              ><strong>{{ stats.progress }}<small>just nu</small></strong>
            </div>
          </div>
          <div class="stat">
            <span class="stat-icon closed"><CircleCheck :size="20" /></span>
            <div>
              <span class="stat-label">Stängda</span
              ><strong
                >{{ stats.closed }}<small>senaste 30 dagarna</small></strong
              >
            </div>
          </div>
        </section>
        <div class="board-toolbar">
          <label class="search"
            ><Search :size="17" /><input
              v-model="query"
              aria-label="Sök issues"
              placeholder="Sök issues, labels eller nummer…" /></label
          ><label class="coord-toggle"
            ><input type="checkbox" v-model="hideCoordination" /> Dölj
            koordinationsärenden</label
          ><span class="updated"
            ><i />{{
              refreshed
                ? "Uppdaterad " +
                  new Date(refreshed).toLocaleTimeString("sv-SE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Väntar på data"
            }}<span v-if="loggedIn"> · varje minut</span></span
          >
        </div>
        <div v-if="busy && !lanes.length" class="empty-state">
          <RefreshCw class="spinning" :size="25" />
          <h2>Hämtar ditt flöde</h2>
          <p>Issues, labels och starttider hämtas från GitHub.</p>
        </div>
        <div v-else-if="!lanes.length" class="empty-state">
          <Layers3 :size="32" />
          <h2>Ge dina projekt en plats</h2>
          <p>Välj vilka repositories du vill följa i din översikt.</p>
          <button class="button primary" @click="picker = true">
            <Plus :size="16" /> Välj repositories
          </button>
        </div>
        <section
          v-for="lane in lanes"
          :key="lane.repo.id"
          class="repo-lane"
          :id="'repo-' + lane.repo.id"
        >
          <header class="lane-header">
            <div class="lane-title">
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
                  ><span v-if="lane.repo.private" class="private-badge"
                    >Privat</span
                  >
                </h2>
                <span class="repo-owner"
                  >{{ lane.repo.owner.login }} <span> / </span>
                  {{ lane.repo.description || "GitHub repository" }}</span
                >
              </div>
            </div>
            <div class="lane-meta">
              <button
                v-if="!isDemo"
                class="notification-toggle"
                role="switch"
                :aria-checked="notificationsEnabled(lane.repo.full_name)"
                :aria-label="'Notiser för ' + lane.repo.name"
                :title="
                  notificationsEnabled(lane.repo.full_name)
                    ? 'Stäng av notiser om stängda issues'
                    : 'Slå på notiser om stängda issues'
                "
                :disabled="notificationPending !== null"
                :class="{ enabled: notificationsEnabled(lane.repo.full_name) }"
                @click="toggleNotifications(lane.repo.full_name)"
              >
                <Bell
                  v-if="notificationsEnabled(lane.repo.full_name)"
                  :size="15"
                /><BellOff v-else :size="15" /><span
                  >Notiser
                  {{
                    notificationsEnabled(lane.repo.full_name) ? "på" : "av"
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
                :aria-label="'Anpassa labels för ' + lane.repo.name"
                title="Anpassa labels"
              >
                <Settings2 :size="16" />
              </button>
            </div>
          </header>
          <div v-if="lane.error" class="notice error" role="alert">
            {{ lane.error }} Tidigare data visas om de finns.
          </div>
          <div v-if="lane.timerWarning" class="notice">
            Vissa starttider kunde inte hämtas. Tidräknaren visas när historiken
            är tillgänglig.
          </div>
          <p class="mobile-swipe-hint">
            Svep för Backlog, In progress och Closed →
          </p>
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
                    visibleLimit[lane.repo.full_name + col.key] || 6,
                  )"
                  :key="
                    issue.id +
                    (col.key === 'closed' ? issue.closed_at || '' : '')
                  "
                  :issue="issue"
                  :rules="rules[lane.repo.full_name] || {}"
                  :now="now"
                  :demo="isDemo"
                  :celebrate="
                    recentClosures.has(closureKey(lane.repo.full_name, issue))
                  "
                />
                <div v-if="!items(lane, col.key).length" class="column-empty">
                  <CircleCheck v-if="col.key === 'closed'" :size="20" /><Clock3
                    v-else-if="col.key === 'progress'"
                    :size="20"
                  /><Layers3 v-else :size="20" /><span>{{
                    col.key === "progress"
                      ? "Inget pågående arbete"
                      : col.key === "closed"
                        ? "Inga stängda issues ännu"
                        : "Backloggen är tom"
                  }}</span>
                </div>
                <button
                  v-if="
                    items(lane, col.key).length >
                    (visibleLimit[lane.repo.full_name + col.key] || 6)
                  "
                  class="show-more"
                  @click="
                    visibleLimit[lane.repo.full_name + col.key] =
                      (visibleLimit[lane.repo.full_name + col.key] || 6) + 20
                  "
                >
                  Visa fler <ChevronDown :size="14" />
                </button>
              </div>
            </section>
          </div>
        </section>
        <footer class="board-footer">
          <span><Github :size="14" /> Dina repositories. Ditt arbetssätt.</span
          ><span>{{
            isDemo
              ? "Fiktiva exempeldata"
              : "Läsande vy · ändra issues på GitHub"
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
          <span class="eyebrow">DIN ÖVERSIKT</span>
          <h2 id="picker-title">Välj repositories</h2>
        </div>
        <button class="icon-button" @click="picker = false" aria-label="Stäng">
          <X :size="20" />
        </button>
      </div>
      <p>En swimlane per projekt. Ditt val sparas på den här enheten.</p>
      <label class="search"
        ><Search :size="17" /><input
          v-model="repoQuery"
          autofocus
          placeholder="Sök repositories…"
          aria-label="Sök repositories"
      /></label>
      <div class="repo-options">
        <label v-for="repo in filteredRepos" :key="repo.id" class="repo-option"
          ><input
            type="checkbox"
            :checked="pendingSelected.includes(repo.full_name)"
            @change="toggleRepo(repo.full_name)"
          /><span
            ><strong>{{ repo.full_name }}</strong
            ><small>{{ repo.description || "Ingen beskrivning" }}</small></span
          ><span v-if="repo.private" class="private-badge">Privat</span></label
        >
        <p v-if="!filteredRepos.length">Inga repositories matchar sökningen.</p>
      </div>
      <div class="modal-footer">
        <span>{{ pendingSelected.length }} valda</span
        ><button class="button primary" :disabled="busy" @click="applyRepos">
          Visa översikt <ArrowRight :size="16" />
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
        <h2 id="rules-title">Anpassa labels</h2>
        <button
          type="button"
          class="icon-button"
          @click="applyRules"
          aria-label="Stäng"
        >
          <X :size="20" />
        </button>
      </div>
      <p>
        {{ editing }} · Lämna tomt för automatisk detektering. Ange exakta
        labelnamn.
      </p>
      <label
        v-for="field in [
          ['progress', 'Pågående arbete'],
          ['high', 'Hög prioritet'],
          ['medium', 'Medium prioritet'],
          ['low', 'Låg prioritet'],
        ] as const"
        :key="field[0]"
        class="rule-field"
        >{{ field[1]
        }}<input v-model="rules[editing]![field[0]]" placeholder="Automatiskt"
      /></label>
      <div class="modal-footer">
        <span>Gäller bara din vy</span
        ><button class="button primary">Spara och hämta igen</button>
      </div>
    </form>
  </div>
</template>
