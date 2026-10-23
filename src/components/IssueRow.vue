<script setup lang="ts">
import { estimateLabel } from "../lib/estimates";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { ArrowDown, ArrowUp, ArrowUpRight, Plus, Bug, ChevronDown, CircleCheck, CircleQuestionMark, Clock3, CornerDownRight, FileText, HandHelping, ListTree, MessageCircle, Minus, ShieldAlert, Star, Wrench, X } from "@lucide/vue";
import IssueComments from "./IssueComments.vue";
import IssuePoints from "./IssuePoints.vue";
import IssueTimeRemaining from "./IssueTimeRemaining.vue";
import IssueTimeEstimate from "./IssueTimeEstimate.vue";
import IssueImplementationTime from "./IssueImplementationTime.vue";
import { useLanguage } from "../lib/i18n";
import { closedTimeLabel } from "../lib/time";
import { useIssueClock } from "../composables/useIssueClock";
import { useIssueRelations } from "../composables/useIssueRelations";
import { useRepositoryDisplayName } from "../composables/useRepositoryDisplayName";
import { repositoryColor } from "../lib/repository-color";
import { issueType, issueTypeLabel, type IssueType } from "../lib/issue-type";
import { column, duration, hidesProgressLabel, isProgress, priority, type Issue, type IssueComment, type Rules } from "../lib/model";
import type { IssueRelations } from "../lib/issue-relations";
import type { ActivityMarker } from "../lib/activity";
const { t, locale } = useLanguage();

/**
 * One compact list row per issue (#127): the card's markers and time label without its details.
 * Desktop/tablet rows expand details in place (#154, #155). Narrow viewports and short touch
 * viewports use compact phone rows and open the full IssueCard in a popup (#155, #236).
 * The media query below matches the compact CSS rules, including landscape phones.
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
  navigationRevision?: number;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
}>();
const emit = defineEmits<{ read: [] }>();
const repositoryLabel = useRepositoryDisplayName(() => props.repository);
const row = ref<HTMLElement>();
const visible = ref(false);
const toggle = ref<HTMLButtonElement>();
const popupClose = ref<HTMLButtonElement>();
const expanded = ref(false);
const phoneViewport = typeof window === "undefined" ? null : window.matchMedia(
  "(max-width: 650px), (pointer: coarse) and (max-width: 950px) and (max-height: 500px)",
);
const isPhone = ref(phoneViewport?.matches ?? false);
const panelId = "issue-row-card-" + useId();
let lockedScrollY = 0;
let lockedBodyStyle = "";
let inertElements: Array<{ element: HTMLElement; inert: boolean }> = [];
function lockPage() {
  lockedScrollY = window.scrollY;
  lockedBodyStyle = document.body.getAttribute("style") ?? "";
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = "100%";
  inertElements = Array.from(document.body.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.classList.contains("row-popup-backdrop"))
    .map(element => ({ element, inert: element.inert }));
  inertElements.forEach(({ element }) => { element.inert = true; });
}
function unlockPage() {
  if (!lockedBodyStyle && !inertElements.length) return;
  if (lockedBodyStyle) document.body.setAttribute("style", lockedBodyStyle);
  else document.body.removeAttribute("style");
  inertElements.forEach(({ element, inert }) => { element.inert = inert; });
  inertElements = [];
  window.scrollTo(0, lockedScrollY);
  lockedBodyStyle = "";
}
function syncViewport() {
  const wasPhone = isPhone.value;
  isPhone.value = phoneViewport?.matches ?? false;
  if (wasPhone && !isPhone.value && expanded.value) {
    expanded.value = false;
    unlockPage();
    void nextTick(() => toggle.value?.focus({ preventScroll: true }));
  }
}
function setExpanded(value: boolean, refocus = false) {
  syncViewport();
  expanded.value = value;
  if (value) {
    emit("read");
    if (isPhone.value) void nextTick(() => { lockPage(); popupClose.value?.focus(); });
  } else if (isPhone.value) {
    unlockPage();
  }
  if (refocus) void nextTick(() => toggle.value?.focus({ preventScroll: true }));
}
watch(() => props.navigationRevision, () => {
  if (expanded.value && isPhone.value) setExpanded(false);
});
function onKeydown(event: KeyboardEvent) {
  if (!expanded.value || !isPhone.value) return;
  if (event.key === "Tab") {
    const popup = document.getElementById(panelId);
    const controls = popup ? Array.from(popup.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null) : [];
    if (!controls.length) { event.preventDefault(); popupClose.value?.focus(); return; }
    if (event.shiftKey && (document.activeElement === controls[0] || !popup?.contains(document.activeElement))) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !popup?.contains(document.activeElement))) { event.preventDefault(); controls[0]?.focus(); }
  }
  if (event.key === "Escape" && !event.defaultPrevented) {
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
  phoneViewport?.addEventListener("change", syncViewport);
  window.addEventListener("keydown", onKeydown);
  if (!("IntersectionObserver" in window)) { visible.value = true; return; }
  observer = new IntersectionObserver(([entry]) => { visible.value = Boolean(entry?.isIntersecting); });
  if (row.value) observer.observe(row.value);
});
onBeforeUnmount(() => {
  unlockPage();
  phoneViewport?.removeEventListener("change", syncViewport);
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
const labels = computed(() => props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name) && l !== typeLabel.value && !(hidesProgressLabel(col.value) && isProgress(l.name, props.rules))).slice(0, expanded.value && !isPhone.value ? 4 : 3));
const status = computed(() => col.value === "closed" ? t("Stängda") : col.value === "progress" ? t("Pågående") : "Backlog");
const timeout = computed(() => props.timedOut && col.value === "progress");
const backlogAge = computed(() => {
  const created = Date.parse(props.issue.created_at);
  if (!Number.isFinite(created) || !Number.isFinite(now.value)) return t("Okänd ålder");
  const seconds = Math.floor(Math.abs(now.value - created) / 1000);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 60 ? [seconds, "second"]
    : seconds < 3600 ? [Math.floor(seconds / 60), "minute"]
    : seconds < 86400 ? [Math.floor(seconds / 3600), "hour"]
    : seconds < 30 * 86400 ? [Math.floor(seconds / 86400), "day"]
    : seconds < 365 * 86400 ? [Math.floor(seconds / (30 * 86400)), "month"]
    : [Math.floor(seconds / (365 * 86400)), "year"];
  return new Intl.RelativeTimeFormat(locale.value, { numeric: "always", style: "narrow" })
    .format(created <= now.value ? -amount : amount, unit);
});
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
    tabindex="-1"
    :style="{ '--repository-color': assignedColor || repositoryColor(repository) }"
    @click="rowClick"
    :class="[col, { expanded, 'has-repository': showRepository, 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove === true, 'unread-created': recentMove === 'created', 'issue-timeout': timeout }]"
  >
    <span v-if="showRepository && !isPhone" class="row-repository" :title="repository"><i aria-hidden="true" /><span class="row-repository-name" aria-hidden="true">{{ repositoryLabel }}</span><span class="sr-only">{{ repository }}</span></span>
    <span class="row-heading">
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
    /></a>
    </span>
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
    </span>
    <span v-if="isPhone" class="row-mobile-summary">
      <span v-if="col !== 'closed'" class="row-mobile-priority" :class="['high', 'medium', 'low'][rank]" role="img"
        :aria-label="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]">
        <component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" aria-hidden="true" />
      </span>
      <IssuePoints :issue="issue" :repository="repository" :in-progress="col === 'progress'" :active="visible" />
      <span v-if="showRepository" class="row-repository" :title="repository"><i aria-hidden="true" /><span class="row-repository-name" aria-hidden="true">{{ repositoryLabel }}</span><span class="sr-only">{{ repository }}</span></span>
      <!-- A moved row's highlighted border already shows the move on phones; screen readers still hear it (#275). -->
      <span v-if="recentMove === true" class="row-mobile-move-note sr-only">{{ t('Flyttad till {column}', { column: status }) }}</span>
      <button v-if="recentMove === 'created'" type="button" class="row-mobile-activity row-movement-marker" @click="emit('read')"
        :aria-label="t('Nyligen skapat i Backlog. Markera som läst')" :title="t('Skapat i Backlog')">
        <Plus :size="12" aria-hidden="true" />
      </button>
      <button v-if="newComments && newComments > 0" type="button" class="row-mobile-activity row-comment-marker" @click="emit('read')"
        :aria-label="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })"
        :title="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })">
        <MessageCircle :size="12" aria-hidden="true" /><span>{{ newComments }}</span>
      </button>
      <span v-if="progress" class="row-mobile-relation row-parent-badge"
        :title="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
        :aria-label="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })" role="img">
        <ListTree :size="11" aria-hidden="true" /><span>{{ progress.completed }}/{{ progress.total }}</span>
      </span>
      <span v-else-if="isSubtask && parentIssue" class="row-mobile-relation row-subtask-badge"
        :title="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })"
        :aria-label="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })" role="img">
        <CornerDownRight :size="11" aria-hidden="true" /><span aria-hidden="true">#{{ parentIssue.number }}</span>
      </span>
    </span>
    <span v-else class="row-meta">
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
      ><span class="row-slot row-slot-timeout"><span v-if="timeout && issue.startedAt" class="row-timeout"
        :title="t('Pågående i {duration}, över estimatet {estimate} plus {percent} %.', { duration: duration(issue.startedAt, now), estimate: estimateLabel(timeoutEstimateMs ?? 0), percent: timeoutOverrunPercent ?? 25 })"
        >{{ t("Timeout") }}</span></span
      ><span class="row-slot row-slot-status"><span class="row-status" :class="col">{{ status }}</span></span></span
      ><span class="row-slot row-slot-priority"><span v-if="col !== 'closed'" class="priority" :class="['high', 'medium', 'low'][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="11" aria-hidden="true" />{{ [t("Hög"), "Medium", t("Låg")][rank] }}</span
      ></span><span class="row-labels"><span v-for="label in labels" :key="label.name" class="label" :title="label.name"
        ><i :style="{ background: '#' + label.color }" /><span class="label-text">{{ label.name }}</span></span
      ></span>
    </span>
    <div v-if="!isPhone" class="row-comments" @click.stop>
      <IssueComments :issue="issue" :count="Math.max(0, Math.floor(issue.comments ?? 0))" :new-comments="newComments" :load-comments="loadComments" :session="commentsSession" :demo="demo" @read="emit('read')" />
    </div>
    <span class="row-time">
      <time v-if="col === 'backlog' && Number.isFinite(Date.parse(issue.created_at))" class="backlog-age"
        :datetime="issue.created_at" :title="new Date(issue.created_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ backlogAge }}</time
      ><span v-else-if="col === 'backlog'" class="backlog-age">{{ t("Okänd ålder") }}</span
      ><span v-else-if="col === 'progress'" class="timer"
        :title="issue.startedAt ? t('Arbetslabel satt ') + new Date(issue.startedAt).toLocaleString(locale) : t('Ingen säker starttid kunde hämtas')"
        ><Clock3 :size="12" aria-hidden="true" /><span class="row-elapsed-label">{{ issue.startedAt ? duration(issue.startedAt, now) : t("Starttid okänd") }}</span></span
      ><time v-else-if="issue.closed_at" class="closed-date" :datetime="issue.closed_at"
        :title="new Date(issue.closed_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ closedTimeLabel(issue.closed_at, now, locale) }}</time
      >
    </span>
    <span class="row-outcome">
      <IssueImplementationTime v-if="col === 'closed'" :issue="issue" :repository="repository" />
      <IssueTimeRemaining v-else-if="col === 'progress'" :issue="issue" :repository="repository" :active="visible" />
      <IssueTimeEstimate v-else :issue="issue" :repository="repository" :active="visible" />
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
.row-heading { display: contents; }
.row-time { flex-wrap: nowrap; overflow: hidden; }
.row-time > * { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-elapsed-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row-comments { display: none; min-width: 0; }
.row-mobile-summary { display: none; }
.row-outcome { display: flex; align-items: center; justify-content: flex-end; min-width: 0; grid-column: -2 / -1; }
@media (min-width: 951px) {
  .row-outcome :deep(.issue-time-estimate),
  .row-outcome :deep(.implementation-time),
  .row-outcome :deep(.issue-time-remaining-label) {
    font-size: 10px; font-family: inherit; font-weight: inherit; font-style: normal; line-height: inherit;
  }
}
@media (min-width: 951px) {
  .issue-row { grid-template-columns: 4.6rem minmax(0, 2.2fr) minmax(0, 1.4fr) 6rem 7.25rem; }
  .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 2.2fr) minmax(0, 1.4fr) 6rem 7.25rem; }
}
/* Keep title and both time values readable; metadata gets its own line until all columns fit. */
@media (min-width: 951px) {
  @container issue-list (max-width: 849px) {
    .issue-row { grid-template-columns: 4.6rem minmax(0, 1fr) 6rem 7.25rem; }
    .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 1fr) 6rem 7.25rem; }
    .row-meta { grid-column: 1 / -1; grid-row: 2; }
  }
}
@container issue-list (min-width: 850px) {
  .issue-row { grid-template-columns: 4.6rem minmax(0, 1fr) 5.4rem 6rem 7.25rem; }
  .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 1fr) 5.4rem 6rem 7.25rem; }
  .row-meta { grid-column: 1 / -1; grid-row: 2; }
  .row-comments { display: block; }
}
@container issue-list (min-width: 1100px) {
  .issue-row:not(.has-repository) { grid-template-columns: 4.6rem minmax(0, 2.2fr) minmax(37.1rem, 1.4fr) 5.4rem 6rem 7.25rem; }
  .issue-row:not(.has-repository) .row-meta { grid-column: auto; grid-row: auto; }
}
@container issue-list (min-width: 1250px) {
  .issue-row { grid-template-columns: 4.6rem minmax(0, 2.2fr) minmax(37.1rem, 1.4fr) 5.4rem 6rem 7.25rem; }
  .issue-row.has-repository { grid-template-columns: minmax(7rem, .55fr) 4.6rem minmax(0, 2.2fr) minmax(37.1rem, 1.4fr) 5.4rem 6rem 7.25rem; }
  .row-meta { grid-column: auto; grid-row: auto; }
}
@media (min-width: 651px) and (max-width: 950px) {
  .issue-row { grid-template-columns: auto minmax(0, 1fr) auto 7.25rem; grid-template-areas: "number title title title" "meta meta meta meta" "time time time outcome"; }
  .issue-row.has-repository { grid-template-areas: "repo repo repo repo" "number title title title" "meta meta meta meta" "time time time outcome"; }
  .row-outcome { grid-area: outcome; }
}
@media (max-width: 650px), (pointer: coarse) and (max-width: 950px) and (max-height: 500px) {
  .issue-row, .issue-row.has-repository {
    grid-template-columns: minmax(0, 1fr) minmax(0, 4.5rem) auto;
    grid-template-areas: "heading heading heading" "meta time outcome";
    gap: 2px 6px; min-height: 56px; padding: 6px 8px;
  }
  .row-heading { grid-area: heading; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .row-heading > .row-id { flex-shrink: 0; }
  .row-heading > .row-title { flex: 1; }
  .row-outcome { grid-area: outcome; }
  .row-title-text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; -webkit-line-clamp: unset; }
  .row-mobile-summary { grid-area: meta; display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; min-height: 24px; overflow: hidden; }
  .row-mobile-summary > * { flex: 0 0 auto; }
  .row-mobile-summary > .row-repository { order: 4; flex: 1 1 0; }
  .row-mobile-summary > .row-mobile-priority { order: 2; }
  .row-mobile-summary > .issue-points { order: 3; }
  .row-mobile-summary > .row-mobile-activity { order: 1; }
  .row-mobile-summary > .row-mobile-relation { order: 4; }
  .row-mobile-summary > .row-repository { order: 5; grid-area: auto; min-width: 0; padding: 1px 4px; font-size: 9px; }
  .row-mobile-relation { display: inline-flex; align-items: center; justify-content: center; gap: 2px; flex: 0 0 auto; min-width: 22px; height: 20px; padding: 0 3px; font-size: 9px; line-height: 1; white-space: nowrap; }
  .row-mobile-priority { display: inline-flex; }
  .row-mobile-priority.high { color: var(--accent-red, #b42332); }
  .row-mobile-activity { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 24px; height: 24px; padding: 0 3px; border: 0; border-radius: 4px; background: #dcecff; color: #175b96; font-size: 9px; cursor: pointer; }
  .row-mobile-activity:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
  .row-time { grid-area: time; justify-self: end; flex-wrap: nowrap; max-width: 4.5rem; overflow: hidden; font-size: 10px; }
  .row-time > .timer { flex: 1 1 auto; min-width: 0; }
  .row-time > * { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@media (max-width: 360px), (pointer: coarse) and (max-width: 360px) {
  .issue-row, .issue-row.has-repository {
    grid-template-columns: minmax(0, 1fr) minmax(0, 2.75rem) auto;
    grid-template-areas: "heading heading heading" "meta time outcome";
    min-height: 56px;
  }
  .row-mobile-summary { gap: 1px; }
  .row-mobile-summary > .row-repository { flex: 0 0 auto; padding: 1px; }
  .row-mobile-summary .row-repository-name { display: none; }
  .row-mobile-summary > .issue-points { padding: 1px; font-size: 7px; }
  .row-mobile-priority svg { width: 9px; height: 9px; }
  .row-mobile-activity { padding: 0; }
  .row-time { max-width: 2.75rem; }
  .row-outcome { width: 5rem; max-width: 5rem; overflow: hidden; font-size: 8px; }
  .row-outcome .issue-time-estimate,
  .row-outcome :deep(.issue-time-remaining-label) { font-size: 8px; }
}
</style>
