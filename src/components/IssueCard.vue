<script setup lang="ts">
import IssueRelationsView from "./IssueRelations.vue";
import type { IssueRelations } from "../lib/issue-relations";
import IssueDetails from "./IssueDetails.vue";
import IssuePoints from "./IssuePoints.vue";
import { backlogAgeLabel, closedTimeLabel } from "../lib/time";
import { useIssueClock } from "../composables/useIssueClock";
import { useLanguage } from "../lib/i18n";
import { issueType, issueTypeLabel, type IssueType } from "../lib/issue-type";
const { t, locale } = useLanguage();
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { repositoryColor } from "../lib/repository-color";
import type { ClosingCommit } from "../lib/commits";
import type { ActivityMarker } from "../lib/activity";
import {
  ArrowUpRight,
  Clock3,
  CircleCheck,
  Circle,
  ArrowUp,
  Minus,
  ArrowDown,
  CornerDownRight,
  ListTree,
  Bug,
  Star,
  FileText,
  CircleQuestionMark,
  HandHelping,
  Wrench,
  ShieldAlert,
} from "@lucide/vue";
import { useIssueRelations } from "../composables/useIssueRelations";
import {
  column,
  duration,
  isProgress,
  priority,
  type Issue,
  type IssueComment,
  type Rules,
} from "../lib/model";
const props = defineProps<{
  issue: Issue;
  rules: Rules;
  demo?: boolean;
  celebrate?: boolean;
  repository?: string;
  showRepository?: boolean;
  assignedColor?: string;
  defaultExpanded?: boolean;
  rowDetails?: boolean;
  loadRelations?: (issue: Issue) => Promise<IssueRelations | null>;
  relationsRevision?: number;
  loadCommit?: (issue: Issue) => Promise<ClosingCommit | null>;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
  commentsSession?: number;
  commitRetry?: number;
  recentMove?: ActivityMarker;
  newComments?: number;
  timedOut?: boolean;
  timeoutMinutes?: number;
}>();
const emit = defineEmits<{ read: [] }>();
const card = ref<HTMLElement>();
const visible = ref(false);
const { progress, isSubtask, parent } = useIssueRelations(
  () => props.issue,
  () => visible.value,
  () => props.loadRelations,
  () => props.commentsSession,
  () => props.relationsRevision,
  () => props.demo,
);
const commit = ref<ClosingCommit | null>(null);
const commitState = ref<"idle" | "loading" | "loaded" | "error">("idle");
let observer: IntersectionObserver | undefined;
let revision = 0;
async function loadClosingCommit() {
  if (
    !visible.value ||
    props.demo ||
    !props.loadCommit ||
    props.issue.state !== "closed" ||
    !props.issue.closed_at ||
    commitState.value === "loading" ||
    commitState.value === "loaded"
  )
    return;
  const current = ++revision;
  commitState.value = "loading";
  try {
    const result = await props.loadCommit(props.issue);
    if (current !== revision) return;
    commit.value = result;
    commitState.value = "loaded";
  } catch {
    if (current === revision) commitState.value = "error";
  }
}
watch(
  [
    () => props.issue.id,
    () => props.issue.html_url,
    () => props.issue.state,
    () => props.issue.closed_at,
    () => props.demo,
    () => props.commentsSession,
  ],
  () => {
    revision++;
    commit.value = null;
    commitState.value = "idle";
    void loadClosingCommit();
  },
);
watch(visible, (value) => {
  if (value && commitState.value === "idle") void loadClosingCommit();
});
watch(() => props.commitRetry, () => {
  if (commitState.value === "error") {
    commitState.value = "idle";
    void loadClosingCommit();
  }
});
onMounted(() => {
  if (!("IntersectionObserver" in window)) {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(([entry]) => {
    visible.value = Boolean(entry?.isIntersecting);
  });
  if (card.value) observer.observe(card.value);
});
onBeforeUnmount(() => {
  revision++;
  observer?.disconnect();
});
const col = computed(() => column(props.issue, props.rules));
// The card's own clock: per second only while its label shows seconds, and only while on screen (#120).
const now = useIssueClock(() => props.issue, () => col.value, () => visible.value);
const typeIcons = { bug: Bug, security: ShieldAlert, feature: Star, docs: FileText, question: CircleQuestionMark, help: HandHelping, chore: Wrench };
const type = computed<IssueType | null>(() => issueType(props.issue.labels));
// The label the type icon stands for is not repeated as a chip on the card (#197).
const typeLabel = computed(() => issueTypeLabel(props.issue.labels));
const typeTitle = computed(() => {
  if (!type.value) return undefined;
  const name = {
    bug: t("Bugg"), security: t("Säkerhet"), feature: t("Funktion"), docs: t("Dokumentation"),
    question: t("Fråga"), help: t("Hjälp sökes"), chore: t("Underhåll"),
  }[type.value];
  return t("Typ: {type}", { type: name }) + (col.value === "closed" ? " · " + t("Stängd") : "");
});
const rank = computed(() => priority(props.issue, props.rules));
const visibleLabels = computed(() =>
  props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name) && l !== typeLabel.value && !(col.value === "progress" && isProgress(l.name, props.rules))).slice(0, 4),
);
</script>
<template>
  <article
    ref="card"
    class="issue-card"
    :style="repository ? { '--repository-color': assignedColor || repositoryColor(repository) } : undefined"
    :class="[col, { 'row-details-card': rowDetails, 'has-repository': !!repository && !rowDetails, 'just-closed': celebrate && col === 'closed' && !rowDetails, 'unread-move': recentMove === true && !rowDetails, 'unread-created': recentMove === 'created' && !rowDetails, 'issue-timeout': timedOut && col === 'progress' && !rowDetails }]"
  >
    <button v-if="recentMove && !rowDetails" class="movement-marker" @click="emit('read')"
      :aria-label="recentMove === 'created' ? t('Nyligen skapat i Backlog. Markera som läst') : t('Nyligen flyttad. Markera som läst')">
      {{ recentMove === 'created' ? t('Skapat i Backlog') : t('Flyttad till {column}', { column: col === 'closed' ? t('Stängda') : col === 'progress' ? t('Pågående') : 'Backlog' }) }}
      <span aria-hidden="true">✓</span>
    </button>
    <div v-if="!rowDetails" class="card-top">
      <div class="card-top-main">
      <span class="issue-number"
        ><span v-if="type" class="type-circle" :class="'type-' + type" :title="typeTitle" role="img" :aria-label="typeTitle"
          ><component :is="typeIcons[type]" :size="10" aria-hidden="true" /><CircleCheck v-if="col === 'closed'" class="type-closed" :size="8" aria-hidden="true"
        /></span
        ><template v-else><CircleCheck v-if="col === 'closed'" :size="13" /><Circle
          v-else
          :size="13"
        /></template>
        #{{ issue.number }}</span
      >
      <IssuePoints :issue="issue" />
      <span v-if="(repository && showRepository) || visibleLabels.length" class="labels">
        <span v-if="repository && showRepository" class="card-repository" :title="repository"><i aria-hidden="true" /><span class="card-repository-name">{{ repository }}</span></span>
        <span
          v-for="label in visibleLabels"
          :key="label.name"
          class="label"
          :title="label.name"
          ><i :style="{ background: '#' + label.color }" /><span class="label-text">{{ label.name }}</span></span
        >
      </span>
      </div>
      <div class="card-top-meta">
        <span v-if="isSubtask && parent" class="subtask-badge"
          :title="t('Underärende till {parent} · {title}', { parent: (parent.repository.toLowerCase() === (repository || '').toLowerCase() ? '' : parent.repository) + '#' + parent.number, title: parent.title })"
        >
          <CornerDownRight :size="10" aria-hidden="true" />{{ t("Subtask") }}
        </span>
        <span v-if="progress" class="parent-task-badge"
          :title="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
          :aria-label="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
        >
          <ListTree :size="11" aria-hidden="true" />{{ progress.completed }}/{{ progress.total }} {{ t("klara") }}
        </span>
        <span
          class="priority"
          :class="['high', 'medium', 'low'][rank]"
          :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
          ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" />{{
            [t("Hög"), "Medium", t("Låg")][rank]
          }}</span
        >
      </div>
    </div>
    <a
      v-if="!rowDetails"
      :href="demo ? undefined : issue.html_url"
      :aria-disabled="demo || undefined"
      target="_blank"
      rel="noopener noreferrer"
      class="issue-title"
      @click="emit('read')" @auxclick="emit('read')"
      >{{ issue.title }}<ArrowUpRight :size="13"
    /></a>
    <IssueRelationsView v-if="repository && !demo" :issue="issue" :repository="repository" :visible="visible"
      :load="loadRelations" :session="commentsSession" :revision="relationsRevision" />
    <IssueDetails :hide-toggle="rowDetails" :body="issue.body" :issue="issue" :comments="issue.comments" :new-comments="newComments" :default-expanded="defaultExpanded" :load-comments="loadComments" :comments-session="commentsSession" :demo="demo" @read="emit('read')" />
    <div v-if="timedOut && col === 'progress' && issue.startedAt" class="timeout-warning">
      <p>{{ t("Timeout: pågående i {duration}, över gränsen {minutes} min.", { duration: duration(issue.startedAt, now), minutes: timeoutMinutes ?? 30 }) }}</p>
    </div>
    <div v-if="!rowDetails || issue.assignees.length" class="card-bottom">
      <template v-if="!rowDetails">
      <time v-if="col === 'backlog' && Number.isFinite(Date.parse(issue.created_at))" class="backlog-age"
        :datetime="issue.created_at" :title="new Date(issue.created_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })">
        {{ backlogAgeLabel(issue.created_at, now, locale) }}
      </time>
      <span v-else-if="col === 'backlog'" class="backlog-age">{{ t("Okänd ålder") }}</span>
      <span
        v-else-if="col === 'progress'"
        class="timer"
        :title="
          issue.startedAt
            ? t('Arbetslabel satt ') +
              new Date(issue.startedAt).toLocaleString(locale)
            : t('Ingen säker starttid kunde hämtas')
        "
        ><Clock3 :size="13" />{{
          issue.startedAt ? duration(issue.startedAt, now) : t("Starttid okänd")
        }}</span
      ><time
        v-else-if="col === 'closed' && issue.closed_at"
        class="closed-date"
        :datetime="issue.closed_at"
        :title="
          new Date(issue.closed_at).toLocaleString(locale, {
            dateStyle: 'full',
            timeStyle: 'long',
          })
        "
        >{{ closedTimeLabel(issue.closed_at, now, locale) }}</time
      ></template><span class="assignees"
        ><img
          v-for="person in issue.assignees.slice(0, 3)"
          :key="person.login"
          :src="person.avatar_url"
          :alt="person.login"
          :title="person.login"
          width="22"
          height="22"
      /></span>
    </div>
    <div
      v-if="col === 'closed' && !demo && loadCommit && (commitState === 'loading' || (commitState === 'loaded' && commit))"
      class="closing-commit"
      aria-live="polite"
    >
      <span v-if="commitState === 'loading'">{{
        t("Hämtar stängande commit…")
      }}</span>
      <template v-else-if="commitState === 'loaded' && commit">
        <a
          :href="commit.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="commit.sha || undefined"
        >
          {{
            commit.kind === "pull-request"
              ? t("Mergad PR #{number}", {
                  number: commit.pullRequestNumber ?? "",
                })
              : t("Stängande commit")
          }}
          <code v-if="commit.sha">{{ commit.sha.slice(0, 7) }}</code
          ><ArrowUpRight :size="12" />
        </a>
        <span
          v-if="commit.additions !== null || commit.deletions !== null"
          class="commit-diff"
          :aria-label="t('Ändrade rader')"
        >
          <span v-if="commit.additions !== null" class="additions"
            >+{{ commit.additions }}</span
          >
          <span v-if="commit.deletions !== null" class="deletions"
            >−{{ commit.deletions }}</span
          >
        </span>
      </template>
    </div>
  </article>
</template>

<style scoped>
.card-top-meta { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
.subtask-badge, .parent-task-badge {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  padding: .15rem .45rem;
  border-radius: .3rem;
  font-size: .68rem;
  font-weight: 600;
  line-height: 1.3;
}
.subtask-badge {
  background: var(--hover, #edf0f2);
  color: var(--muted, #627179);
}
.parent-task-badge {
  color: var(--green, #147d69);
  background: color-mix(in srgb, var(--green) 12%, var(--surface));
}
:root[data-theme="dark"] .parent-task-badge {
  color: var(--accent-green, #3fbc9c);
  background: var(--tint-green, #173a2b);
}
.issue-card.has-repository { position: relative; }
.issue-card.has-repository::after { content: ""; position: absolute; top: 6px; bottom: 6px; right: 0; width: 3px; border-radius: 3px; background: var(--repository-color); pointer-events: none; }
.card-repository { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-width: 0; padding: 1px 6px; border: 1px solid color-mix(in srgb, var(--repository-color) 50%, white); border-radius: 5px; background: color-mix(in srgb, var(--repository-color) 18%, white); color: var(--text); font-size: 9px; line-height: 1.4; }
.card-repository-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-repository i { width: 9px; height: 9px; flex-shrink: 0; border-radius: 50%; background: var(--repository-color); }

.backlog-age {
  font-size: 9px;
  color: #87929a;
}
.issue-card.unread-move { border-color: #2875ba; box-shadow: 0 0 0 2px #2875ba55; background: #f1f8ff; }
.issue-card.unread-created { border-color: #39885b; box-shadow: 0 0 0 2px #39885b33; background: #edf8f0; }
.issue-card.issue-timeout { border-color: #b42332; background: #fff1f2; box-shadow: 0 0 0 2px #b4233233; }
.timeout-warning { color: #9f1c2a; font-size: .75rem; line-height: 1.5; }
.timeout-warning p { margin: .7rem 0 .4rem; }
.movement-marker { display: flex; width: 100%; justify-content: space-between; align-items: center; gap: .4rem; border: 0; border-radius: .35rem; padding: .35rem .5rem; margin-bottom: .6rem; background: #dcecff; color: #175b96; font-size: .72rem; font-weight: 700; cursor: pointer; }
.movement-marker:focus-visible { outline: 2px solid #175b96; outline-offset: 2px; }
.unread-created .movement-marker { background: #d8efde; color: #1c6239; }
.unread-created .movement-marker:focus-visible { outline-color: #1c6239; }
.closing-commit {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.65rem;
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.5;
}
.closing-commit a {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
  text-decoration: underline;
  text-underline-offset: 0.15rem;
}
.closing-commit code {
  font-size: 0.7rem;
}
.commit-diff {
  display: inline-flex;
  gap: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.additions {
  color: #147d69;
}
.deletions {
  color: #ab3434;
}
.closing-commit button {
  border: 1px solid var(--line);
  border-radius: 0.3rem;
  background: var(--surface);
  padding: 0.15rem 0.4rem;
  font-size: inherit;
}
</style>
