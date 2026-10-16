<script setup lang="ts">
import IssueDetails from "./IssueDetails.vue";
import { backlogAgeLabel, closedTimeLabel } from "../lib/time";
import { useLanguage } from "../lib/i18n";
const { t, locale } = useLanguage();
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { ClosingCommit } from "../lib/commits";
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
  loadCommit?: (issue: Issue) => Promise<ClosingCommit | null>;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
  commentsSession?: number;
  commitRetry?: number;
  recentMove?: boolean;
}>();
const emit = defineEmits<{ read: [] }>();
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
    :class="[col, { 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove }]"
  >
    <button v-if="recentMove" class="movement-marker" @click="emit('read')"
      :aria-label="t('Nyligen flyttad. Markera som läst')">
      {{ t('Flyttad till {column}', { column: col === 'closed' ? t('Stängda') : col === 'progress' ? t('Pågående') : 'Backlog' }) }}
      <span aria-hidden="true">✓</span>
    </button>
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
    <IssueDetails :body="issue.body" :issue="issue" :comments="issue.comments" :load-comments="loadComments" :comments-session="commentsSession" :demo="demo" @read="emit('read')" />
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
.backlog-age {
  font-size: 9px;
  color: #87929a;
}
.issue-card.unread-move { border-color: #2875ba; box-shadow: 0 0 0 2px #2875ba55; background: #f1f8ff; }
.movement-marker { display: flex; width: 100%; justify-content: space-between; align-items: center; gap: .4rem; border: 0; border-radius: .35rem; padding: .35rem .5rem; margin-bottom: .6rem; background: #dcecff; color: #175b96; font-size: .72rem; font-weight: 700; cursor: pointer; }
.movement-marker:focus-visible { outline: 2px solid #175b96; outline-offset: 2px; }
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
