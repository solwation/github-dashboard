<script setup lang="ts">
import IssueRelationsView from "./IssueRelations.vue";
import type { IssueRelations } from "../lib/issue-relations";
import IssueDetails from "./IssueDetails.vue";
import { backlogAgeLabel, closedTimeLabel } from "../lib/time";
import { useLanguage } from "../lib/i18n";
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
} from "@lucide/vue";
import {
  column,
  duration,
  priority,
  type Issue,
  type IssueComment,
  type Rules,
} from "../lib/model";
const props = defineProps<{
  issue: Issue;
  now: number;
  rules: Rules;
  demo?: boolean;
  celebrate?: boolean;
  repository?: string;
  loadRelations?: (issue: Issue) => Promise<IssueRelations | null>;
  relationsRevision?: number;
  loadCommit?: (issue: Issue) => Promise<ClosingCommit | null>;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
  commentsSession?: number;
  commitRetry?: number;
  recentMove?: ActivityMarker;
  timedOut?: boolean;
  timeoutMinutes?: number;
}>();
const emit = defineEmits<{ read: []; ignoreTimeout: [] }>();
const card = ref<HTMLElement>();
const visible = ref(false);
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
const rank = computed(() => priority(props.issue, props.rules));
const visibleLabels = computed(() =>
  props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name)).slice(0, 4),
);
</script>
<template>
  <article
    ref="card"
    class="issue-card"
    :class="[col, { 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove === true, 'unread-created': recentMove === 'created', 'issue-timeout': timedOut && col === 'progress' }]"
  >
    <button v-if="recentMove" class="movement-marker" @click="emit('read')"
      :aria-label="recentMove === 'created' ? t('Nyligen skapat i Backlog. Markera som läst') : t('Nyligen flyttad. Markera som läst')">
      {{ recentMove === 'created' ? t('Skapat i Backlog') : t('Flyttad till {column}', { column: col === 'closed' ? t('Stängda') : col === 'progress' ? t('Pågående') : 'Backlog' }) }}
      <span aria-hidden="true">✓</span>
    </button>
    <span v-if="repository" class="card-repository" :style="{ '--repository-color': repositoryColor(repository) }" :title="repository"><i aria-hidden="true" />{{ repository }}</span>
    <div class="card-top">
      <span class="issue-number"
        ><CircleCheck v-if="col === 'closed'" :size="13" /><Circle
          v-else
          :size="13"
        />
        #{{ issue.number }}</span
      ><span
        class="priority"
        :class="['high', 'medium', 'low'][rank]"
        :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" />{{
          [t("Hög"), "Medium", t("Låg")][rank]
        }}</span
      >
    </div>
    <a
      :href="demo ? undefined : issue.html_url"
      :aria-disabled="demo || undefined"
      target="_blank"
      rel="noopener noreferrer"
      class="issue-title"
      @click="emit('read')" @auxclick="emit('read')"
      >{{ issue.title }}<ArrowUpRight :size="13"
    /></a>
    <div class="labels">
      <span
        v-for="label in visibleLabels"
        :key="label.name"
        class="label"
        :title="label.name"
        ><i :style="{ background: '#' + label.color }" />{{ label.name }}</span
      >
    </div>
    <IssueRelationsView v-if="repository && !demo" :issue="issue" :repository="repository" :visible="visible"
      :load="loadRelations" :session="commentsSession" :revision="relationsRevision" />
    <IssueDetails :body="issue.body" :issue="issue" :comments="issue.comments" :load-comments="loadComments" :comments-session="commentsSession" :demo="demo" @read="emit('read')" />
    <div v-if="timedOut && col === 'progress' && issue.startedAt" class="timeout-warning">
      <p>{{ t("Timeout: pågående i {duration}, över gränsen {minutes} min.", { duration: duration(issue.startedAt, now), minutes: timeoutMinutes ?? 30 }) }}</p>
      <button type="button" class="timeout-acknowledge" :aria-label="t('Ignorera timeout för #{number}', { number: issue.number })" @click="emit('ignoreTimeout')">{{ t("Ignorera timeout") }}</button>
    </div>
    <div class="card-bottom">
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
      ><span class="assignees"
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
.card-repository { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin-bottom: 9px; padding: 3px 7px; border: 1px solid color-mix(in srgb, var(--repository-color) 25%, white); border-radius: 5px; background: color-mix(in srgb, var(--repository-color) 8%, white); color: #273a3c; font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
.card-repository i { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--repository-color); }

.backlog-age {
  font-size: 9px;
  color: #87929a;
}
.issue-card.unread-move { border-color: #2875ba; box-shadow: 0 0 0 2px #2875ba55; background: #f1f8ff; }
.issue-card.unread-created { border-color: #39885b; box-shadow: 0 0 0 2px #39885b33; background: #edf8f0; }
.issue-card.issue-timeout { border-color: #b42332; background: #fff1f2; box-shadow: 0 0 0 2px #b4233233; }
.timeout-warning { color: #9f1c2a; font-size: .75rem; line-height: 1.5; }
.timeout-warning p { margin: .7rem 0 .4rem; }
.timeout-acknowledge { border: 1px solid #b42332; border-radius: .35rem; background: white; color: #9f1c2a; padding: .4rem .6rem; min-height: 44px; cursor: pointer; font-size: inherit; }
.timeout-acknowledge:focus-visible { outline: 2px solid #b42332; outline-offset: 2px; }
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
  background: white;
  padding: 0.15rem 0.4rem;
  font-size: inherit;
}
</style>
