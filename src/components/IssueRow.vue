<script setup lang="ts">
import { estimateLabel } from "../lib/estimates";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { ArrowDown, ArrowUp, ArrowUpRight, Bug, ChevronDown, CircleCheck, CircleQuestionMark, Clock3, CornerDownRight, FileText, HandHelping, ListTree, MessageCircle, Minus, ShieldAlert, Star, Wrench, X } from "@lucide/vue";
import IssueComments from "./IssueComments.vue";
import IssuePoints from "./IssuePoints.vue";
import IssueTimeRemaining from "./IssueTimeRemaining.vue";
import { useLanguage } from "../lib/i18n";
import { backlogAgeLabel, closedTimeLabel } from "../lib/time";
import { useIssueClock } from "../composables/useIssueClock";
import { useIssueRelations } from "../composables/useIssueRelations";
import { useRepositoryDisplayName } from "../composables/useRepositoryDisplayName";
import { repositoryColor } from "../lib/repository-color";
import { issueType, issueTypeLabel, type IssueType } from "../lib/issue-type";
import { column, duration, isProgress, priority, type Issue, type IssueComment, type Rules } from "../lib/model";
import type { IssueRelations } from "../lib/issue-relations";
import type { ActivityMarker } from "../lib/activity";
const { t, locale } = useLanguage();

/**
 * One compact list row per issue (#127): the card's markers and time label without its details.
 * On desktop/tablet (> 650px), tapping the row expands its details in place with the description
 * already open (#154, #155). On phones (<= 650px), tapping opens a modal popup showing the full
 * IssueCard identical to card view (#155). The state is in-memory only.
 */
const props = defineProps<{
  issue: Issue;
  rules: Rules;
  repository: string;
  showRepository?: boolean;
  assignedColor?: string;
  demo?: boolean;
  celebrate?: boolean;
  recentMove?: ActivityMarker;
  newComments?: number;
  timedOut?: boolean;
  timeoutOverrunPercent?: number;
  timeoutEstimateMs?: number;
  loadRelations?: (issue: Issue) => Promise<IssueRelations | null>;
  relationsRevision?: number;
  commentsSession?: number;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
}>();
const emit = defineEmits<{ read: [] }>();
const repositoryLabel = useRepositoryDisplayName(() => props.repository);
const row = ref<HTMLElement>();
const visible = ref(false);
const toggle = ref<HTMLButtonElement>();
const popupClose = ref<HTMLButtonElement>();
const expanded = ref(false);
const isPhone = ref(typeof window !== "undefined" && window.innerWidth <= 650);
const panelId = "issue-row-card-" + useId();
function syncViewport() {
  if (typeof window !== "undefined") isPhone.value = window.innerWidth <= 650;
}
function setExpanded(value: boolean, refocus = false) {
  syncViewport();
  expanded.value = value;
  if (value) {
    emit("read");
    if (isPhone.value) void nextTick(() => popupClose.value?.focus());
  }
  if (refocus) void nextTick(() => toggle.value?.focus());
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !event.defaultPrevented && expanded.value && isPhone.value) {
    event.preventDefault();
    setExpanded(false, true);
  }
}
/** Pointer taps anywhere on the row's empty areas toggle too; links and buttons keep their own action. */
function rowClick(event: MouseEvent) {
  const target = event.target as Element | null;
  if (target?.closest("a, button, .row-card, .row-popup-backdrop")) return;
  setExpanded(!expanded.value);
}
let observer: IntersectionObserver | undefined;
onMounted(() => {
  syncViewport();
  window.addEventListener("resize", syncViewport);
  window.addEventListener("keydown", onKeydown);
  if (!("IntersectionObserver" in window)) { visible.value = true; return; }
  observer = new IntersectionObserver(([entry]) => { visible.value = Boolean(entry?.isIntersecting); });
  if (row.value) observer.observe(row.value);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncViewport);
  window.removeEventListener("keydown", onKeydown);
  observer?.disconnect();
});
const col = computed(() => column(props.issue, props.rules));
const now = useIssueClock(() => props.issue, () => col.value, () => visible.value);
const rank = computed(() => priority(props.issue, props.rules));
// Same type icon as the card, and the label it stands for is not repeated as a chip (#197, #199).
const typeIcons = { bug: Bug, security: ShieldAlert, feature: Star, docs: FileText, question: CircleQuestionMark, help: HandHelping, chore: Wrench };
const type = computed<IssueType | null>(() => issueType(props.issue.labels));
const typeLabel = computed(() => issueTypeLabel(props.issue.labels));
const typeTitle = computed(() => {
  if (!type.value) return undefined;
  const name = {
    bug: t("Bugg"), security: t("Säkerhet"), feature: t("Funktion"), docs: t("Dokumentation"),
    question: t("Fråga"), help: t("Hjälp sökes"), chore: t("Underhåll"),
  }[type.value];
  return t("Typ: {type}", { type: name }) + (col.value === "closed" ? " · " + t("Stängd") : "");
});
const labels = computed(() => props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name) && l !== typeLabel.value && !(col.value === "progress" && isProgress(l.name, props.rules))).slice(0, expanded.value && !isPhone.value ? 4 : 3));
const status = computed(() => col.value === "closed" ? t("Stängda") : col.value === "progress" ? t("Pågående") : "Backlog");
const timeout = computed(() => props.timedOut && col.value === "progress");
const { progress, isSubtask, parent: parentIssue } = useIssueRelations(
  () => props.issue,
  () => visible.value,
  () => props.loadRelations,
  () => props.commentsSession,
  () => props.relationsRevision,
  () => props.demo,
);
</script>
<template>
  <li
    ref="row"
    class="issue-row"
    :style="{ '--repository-color': assignedColor || repositoryColor(repository) }"
    @click="rowClick"
    :class="[col, { expanded, 'has-repository': showRepository, 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove === true, 'unread-created': recentMove === 'created', 'issue-timeout': timeout }]"
  >
    <span v-if="showRepository" class="row-repository" :title="repository"><i aria-hidden="true" /><span class="row-repository-name" aria-hidden="true">{{ repositoryLabel }}</span><span class="sr-only">{{ repository }}</span></span>
    <span class="row-id"
      ><span v-if="type" class="type-circle" :class="'type-' + type" :title="typeTitle" role="img" :aria-label="typeTitle"
        ><component :is="typeIcons[type]" :size="10" aria-hidden="true" /><CircleCheck v-if="col === 'closed'" class="type-closed" :size="8" aria-hidden="true"
      /></span
      ><span v-else class="type-slot" aria-hidden="true" /><a
      :href="demo ? undefined : issue.html_url"
      :aria-disabled="demo || undefined"
      target="_blank"
      rel="noopener noreferrer"
      class="issue-number row-number"
      :aria-label="t('Öppna #{number} på GitHub', { number: issue.number })"
      :title="t('Öppna #{number} på GitHub', { number: issue.number })"
      @click="emit('read')" @auxclick="emit('read')"
      >#{{ issue.number }}<ArrowUpRight :size="11" aria-hidden="true"
    /></a></span>
    <button
      ref="toggle"
      type="button"
      class="row-title"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      :title="issue.title"
      @click="setExpanded(!expanded)"
      ><span class="row-title-text">{{ issue.title }}</span><ChevronDown :size="13" aria-hidden="true" class="row-chevron"
    /></button>
    <span class="row-meta">
      <IssuePoints :issue="issue" :repository="repository" :in-progress="col === 'progress'" :active="visible" />
      <span v-if="isSubtask && parentIssue" class="row-marker row-subtask-badge"
        :title="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })"
      >
        <CornerDownRight :size="10" aria-hidden="true" />
        <span class="row-subtask-text">{{ t("Subtask") }}</span>
      </span>
      <span v-if="progress" class="row-marker row-parent-badge"
        :title="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
        :aria-label="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
      >
        <ListTree :size="11" aria-hidden="true" />
        <span>{{ progress.completed }}/{{ progress.total }}</span>
        <span class="row-parent-label">{{ t("klara") }}</span>
      </span>
      <span class="row-slot row-slot-comment"><button v-if="newComments && newComments > 0" type="button" class="row-marker row-comment-marker" @click="emit('read')"
        :aria-label="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })"
        :title="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })"
        ><MessageCircle :size="11" aria-hidden="true" class="comment-icon-animated" /> +{{ newComments }} <span aria-hidden="true">✓</span></button></span
      ><span class="row-status-group"><span class="row-slot row-slot-movement"><button v-if="recentMove" type="button" class="row-marker row-movement-marker" @click="emit('read')"
        :aria-label="recentMove === 'created' ? t('Nyligen skapat i Backlog. Markera som läst') : t('Nyligen flyttad. Markera som läst')"
        :title="recentMove === 'created' ? t('Skapat i Backlog') : t('Flyttad till {column}', { column: status })"
        >{{ recentMove === "created" ? t("Ny") : t("Flyttad") }} <span aria-hidden="true">✓</span></button></span
      ><span class="row-slot row-slot-status"><span class="row-status" :class="col">{{ status }}</span></span></span
      ><span v-if="timeout && issue.startedAt" class="row-timeout"
        :title="t('Pågående i {duration}, över estimatet {estimate} plus {percent} %.', { duration: duration(issue.startedAt, now), estimate: estimateLabel(timeoutEstimateMs ?? 0), percent: timeoutOverrunPercent ?? 25 })"
        >{{ t("Timeout") }}</span
      ><span class="row-slot row-slot-priority"><span v-if="col !== 'closed'" class="priority" :class="['high', 'medium', 'low'][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="11" aria-hidden="true" />{{ [t("Hög"), "Medium", t("Låg")][rank] }}</span
      ></span><span v-for="label in labels" :key="label.name" class="label" :title="label.name"
        ><i :style="{ background: '#' + label.color }" /><span class="label-text">{{ label.name }}</span></span
      >
    </span>
    <div class="row-comments" @click.stop>
      <IssueComments :issue="issue" :count="Math.max(0, Math.floor(issue.comments ?? 0))" :new-comments="newComments" :load-comments="loadComments" :session="commentsSession" :demo="demo" @read="emit('read')" />
    </div>
    <span class="row-time">
      <time v-if="col === 'backlog' && Number.isFinite(Date.parse(issue.created_at))" class="backlog-age"
        :datetime="issue.created_at" :title="new Date(issue.created_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ backlogAgeLabel(issue.created_at, now, locale) }}</time
      ><span v-else-if="col === 'backlog'" class="backlog-age">{{ t("Okänd ålder") }}</span
      ><span v-else-if="col === 'progress'" class="timer"
        :title="issue.startedAt ? t('Arbetslabel satt ') + new Date(issue.startedAt).toLocaleString(locale) : t('Ingen säker starttid kunde hämtas')"
        ><Clock3 :size="12" aria-hidden="true" />{{ issue.startedAt ? duration(issue.startedAt, now) : t("Starttid okänd") }}</span
      ><time v-else-if="issue.closed_at" class="closed-date" :datetime="issue.closed_at"
        :title="new Date(issue.closed_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ closedTimeLabel(issue.closed_at, now, locale) }}</time
      >
      <IssueTimeRemaining v-if="col === 'progress'" :issue="issue" :repository="repository" :active="visible" />
    </span>
    <div v-if="expanded && !isPhone" :id="panelId" class="row-card">
      <slot :in-popup="false" />
      <button type="button" class="row-close" @click="setExpanded(false, true)"><X :size="13" aria-hidden="true" />{{ t("Stäng") }}</button>
    </div>
    <Teleport to="body">
      <div v-if="expanded && isPhone" class="modal-backdrop row-popup-backdrop" @click.self="setExpanded(false, true)">
        <div :id="panelId" class="row-popup" role="dialog" aria-modal="true" :aria-label="issue.title">
          <button
            ref="popupClose"
            type="button"
            class="row-popup-close"
            :aria-label="t('Stäng')"
            :title="t('Stäng')"
            @click="setExpanded(false, true)"
          >
            <X :size="20" aria-hidden="true" />
          </button>
          <slot :in-popup="true" />
        </div>
      </div>
    </Teleport>
  </li>
</template>

<style scoped>
.row-comments { display: none; min-width: 0; }
/* Keep title and both time values readable; metadata gets its own line until all columns fit. */
@media (min-width: 951px) {
  @container issue-list (max-width: 849px) {
    .issue-row { grid-template-columns: 4.6rem minmax(0, 1fr) 14rem; }
    .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 1fr) 14rem; }
    .row-meta { grid-column: 1 / -1; grid-row: 2; }
  }
}
@container issue-list (min-width: 850px) {
  .issue-row { grid-template-columns: 4.6rem minmax(0, 1fr) 5.4rem 14rem; }
  .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 1fr) 5.4rem 14rem; }
  .row-meta { grid-column: 1 / -1; grid-row: 2; }
  .row-comments { display: block; }
}
@container issue-list (min-width: 1100px) {
  .issue-row:not(.has-repository) { grid-template-columns: 4.6rem minmax(0, 2.2fr) minmax(32.4rem, 1.4fr) 5.4rem 14rem; }
  .issue-row:not(.has-repository) .row-meta { grid-column: auto; grid-row: auto; }
}
@container issue-list (min-width: 1250px) {
  .issue-row { grid-template-columns: 4.6rem minmax(0, 2.2fr) minmax(32.4rem, 1.4fr) 5.4rem 14rem; }
  .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 2.2fr) minmax(32.4rem, 1.4fr) 5.4rem 14rem; }
  .row-meta { grid-column: auto; grid-row: auto; }
}
</style>
