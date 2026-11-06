<script setup lang="ts">
import ProjectIcon from "./ProjectIcon.vue";
import { estimateLabel } from "../lib/estimates";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { ArrowDown, ArrowUp, ArrowUpRight, Plus, Bug, ChevronDown, CircleCheck, CircleQuestionMark, Clock3, CornerDownRight, FileText, GitMerge, HandHelping, Hourglass, ListTree, MessageCircle, Minus, ShieldAlert, Star, Wrench, X } from "@lucide/vue";
import IssueComments from "./IssueComments.vue";
import IssuePoints from "./IssuePoints.vue";
import IssueTimeRemaining from "./IssueTimeRemaining.vue";
import IssueTimeEstimate from "./IssueTimeEstimate.vue";
import IssueWorkActivity from "./IssueWorkActivity.vue";
import IssueImplementationTime from "./IssueImplementationTime.vue";
import { useLanguage } from "../lib/i18n";
import { closedTimeLabel } from "../lib/time";
import { useIssueClock } from "../composables/useIssueClock";
import { useIssueRelations } from "../composables/useIssueRelations";
import { useRepositoryDisplayName } from "../composables/useRepositoryDisplayName";
import { repositoryColor, repositoryTextColor } from "../lib/repository-color";
import { issueType, issueTypeLabel, type IssueType } from "../lib/issue-type";
import { column, hidesWorkLabel, priority, type Issue, type IssueComment, type Rules } from "../lib/model";
import { useWorkTime } from "../composables/useWorkTime";
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
const repositoryStyle = computed(() => {
  if (!props.repository) return undefined;
  const color = props.assignedColor || repositoryColor(props.repository);
  return { "--repository-color": color, "--repository-on-color": repositoryTextColor(color) };
});
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
const titleTextId = "issue-row-title-" + useId();
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
const labelsContainer = ref<HTMLElement>();
const labelsWidth = ref(0);
let labelsObserver: ResizeObserver | undefined;
onMounted(() => {
  syncViewport();
  phoneViewport?.addEventListener("change", syncViewport);
  window.addEventListener("keydown", onKeydown);
  if (labelsContainer.value) {
    // ResizeObserver delivers the initial size after layout. Reading clientWidth for every
    // freshly mounted row interleaves DOM writes and forced layouts on large boards (#360).
    if (typeof ResizeObserver !== "undefined") {
      labelsObserver = new ResizeObserver(([entry]) => {
        if (entry) labelsWidth.value = Math.round(entry.contentRect.width);
      });
      labelsObserver.observe(labelsContainer.value);
    } else {
      labelsWidth.value = Math.round(labelsContainer.value.clientWidth);
    }
  }
  if (!("IntersectionObserver" in window)) { visible.value = true; return; }
  observer = new IntersectionObserver(([entry]) => { visible.value = Boolean(entry?.isIntersecting); });
  if (row.value) observer.observe(row.value);
});
onBeforeUnmount(() => {
  labelsObserver?.disconnect();
  unlockPage();
  phoneViewport?.removeEventListener("change", syncViewport);
  window.removeEventListener("keydown", onKeydown);
  observer?.disconnect();
});
const col = computed(() => column(props.issue, props.rules));
const now = useIssueClock(() => props.issue, () => col.value, () => visible.value, () => props.rules);
const work = useWorkTime(() => props.issue, () => props.rules, now);
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
let labelCanvas: HTMLCanvasElement | null = null;
function measureLabelWidth(text: string): number {
  if (typeof document === "undefined") return Math.min(224, text.length * 6 + 25);
  if (!labelCanvas) {
    labelCanvas = document.createElement("canvas");
  }
  const ctx = labelCanvas.getContext("2d");
  const textWidth = ctx
    ? (() => {
        ctx.font = '650 10px "DM Sans", system-ui, sans-serif';
        return ctx.measureText(text).width;
      })()
    : text.length * 5.8;
  return Math.min(Math.ceil(textWidth + 25), 224);
}
const allLabels = computed(() =>
  props.issue.labels.filter(
    (l) =>
      !/^priority\s*:/i.test(l.name) &&
      l !== typeLabel.value &&
      !hidesWorkLabel(col.value, l.name, props.rules)
  )
);
const partitionedLabels = computed(() => {
  const list = allLabels.value;
  if (!list.length) return { visible: [], hidden: [] };
  if (list.length === 1) return { visible: list, hidden: [] };

  const avail = labelsWidth.value;
  if (!avail) {
    const limit = expanded.value && !isPhone.value ? 4 : 2;
    return {
      visible: list.slice(0, limit),
      hidden: list.slice(limit),
    };
  }

  const GAP = 5;
  let totalAll = 0;
  for (let i = 0; i < list.length; i++) {
    totalAll += measureLabelWidth(list[i]!.name) + (i > 0 ? GAP : 0);
  }
  if (totalAll <= avail) {
    return { visible: list, hidden: [] };
  }

  const MORE_WIDTH = 28;
  let used = 0;
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const remainingCount = list.length - (count + 1);
    const moreWidth = remainingCount > 0 ? MORE_WIDTH + GAP : 0;
    const w = measureLabelWidth(list[i]!.name);
    const needed = (count > 0 ? GAP : 0) + w;
    if (used + needed + moreWidth <= avail) {
      used += needed;
      count++;
    } else {
      break;
    }
  }

  // Preserve the +N control when even a readable first label cannot share the line.
  if (count === 0 && avail >= MORE_WIDTH + GAP + 40) count = 1;

  return {
    visible: list.slice(0, count),
    hidden: list.slice(count),
  };
});
const visibleLabels = computed(() => partitionedLabels.value.visible);
const hiddenLabels = computed(() => partitionedLabels.value.hidden);
const hiddenLabelsTitle = computed(() => hiddenLabels.value.map((l) => l.name).join(", "));
const hiddenLabelsAria = computed(() =>
  t("{count} fler labels: {names}", {
    count: hiddenLabels.value.length,
    names: hiddenLabelsTitle.value,
  })
);
const pending = computed(() => col.value === "closed" && !!props.issue.pendingClosure);
const status = computed(() => pending.value ? t("Verifieras") : col.value === "closed" ? t("Stängda") : col.value === "progress" ? t("Pågående") : "Backlog");
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
    :data-repository="repository"
    :style="repositoryStyle"
    @click="rowClick"
    :class="[col, { expanded, 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove === true, 'unread-created': recentMove === 'created', 'issue-timeout': timeout, 'pending-closure': pending }]"
  >
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
      >#{{ issue.number }}<ArrowUpRight v-if="issue.number < 100000" :size="11" aria-hidden="true"
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
      ><IssueWorkActivity :issue="issue" :rules="rules" :now="now" compact /><span :id="titleTextId" class="row-title-text">{{ issue.title }}</span><ChevronDown :size="13" aria-hidden="true" class="row-chevron"
    /></button>
    </span>
    <span class="row-points"><IssuePoints :issue="issue" :repository="repository" :in-progress="col === 'progress'" :active="visible" /></span>
    <span v-if="isPhone" class="row-mobile-summary">
      <span v-if="col !== 'closed'" class="row-mobile-priority" :class="['high', 'medium', 'low'][rank]" role="img"
        :aria-label="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]">
        <component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" aria-hidden="true" />
      </span>
      <span v-if="showRepository" class="row-mobile-repository-slot"><span class="row-repository" :title="repository"><ProjectIcon :repository="repository" /><span class="row-repository-name" aria-hidden="true">{{ repositoryLabel }}</span><span class="sr-only">{{ repository }}</span></span></span>
      <!-- A moved row's highlighted border already shows the move on phones; screen readers still hear it (#275). -->
      <span v-if="recentMove === true" class="row-mobile-move-note sr-only">{{ t('Flyttad till {column}', { column: status }) }}</span>
      <button v-if="recentMove === 'created'" type="button" class="row-mobile-activity row-movement-marker" @click="emit('read')"
        :aria-label="t('Nyligen skapat i Backlog. Markera som läst')" :title="t('Skapat i Backlog')">
        <Plus :size="12" aria-hidden="true" />
      </button>
      <!-- #429: phones show unread comments on the row's comment control itself; no separate marker. -->
      <span v-if="progress" class="row-mobile-relation row-parent-badge"
        :title="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
        :aria-label="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })" role="img">
        <ListTree :size="12" aria-hidden="true" /><span>{{ progress.completed }}/{{ progress.total }}</span>
      </span>
      <span v-else-if="isSubtask && parentIssue" class="row-mobile-relation row-subtask-badge"
        :title="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })"
        :aria-label="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })" role="img">
        <CornerDownRight :size="12" aria-hidden="true" /><span aria-hidden="true">#{{ parentIssue.number }}</span>
      </span>
    </span>
    <span v-else class="row-meta">
      <span class="row-slot row-slot-priority"><span v-if="col !== 'closed'" class="priority" :class="['high', 'medium', 'low'][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" aria-hidden="true" />{{ [t("Hög"), "Medium", t("Låg")][rank] }}</span
      ></span>
      <span v-if="showRepository" class="row-slot row-slot-repository row-meta-repository"><span class="row-repository" :title="repository"><ProjectIcon :repository="repository" /><span class="row-repository-name" aria-hidden="true">{{ repositoryLabel }}</span><span class="sr-only">{{ repository }}</span></span></span>
      <span class="row-status-group"><span class="row-slot row-slot-status"><span class="row-status" :class="[col, { pending }]">{{ status }}</span></span><span class="row-slot row-slot-timeout"><span v-if="timeout && work.label.value" class="row-timeout"
        :title="t('Pågående i {duration}, över estimatet {estimate} plus {percent} %.', { duration: work.label.value, estimate: estimateLabel(timeoutEstimateMs ?? 0), percent: timeoutOverrunPercent ?? 25 })"
        >{{ t("Timeout") }}</span></span></span>
      <span v-if="isSubtask && parentIssue" class="row-marker row-subtask-badge"
        :title="t('Underärende till {parent} · {title}', { parent: (parentIssue.repository.toLowerCase() === repository.toLowerCase() ? '' : parentIssue.repository) + '#' + parentIssue.number, title: parentIssue.title })"
      >
        <CornerDownRight :size="12" aria-hidden="true" />
        <span class="row-subtask-text">{{ t("Subtask") }}</span>
      </span>
      <span v-if="progress" class="row-marker row-parent-badge"
        :title="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
        :aria-label="t('{completed} av {total} underärenden stängda', { completed: progress.completed, total: progress.total })"
      >
        <ListTree :size="12" aria-hidden="true" />
        <span>{{ progress.completed }}/{{ progress.total }}</span>
        <span class="row-parent-label">{{ t("klara") }}</span>
      </span>
      <span ref="labelsContainer" class="row-labels"><span v-for="label in visibleLabels" :key="label.name" class="label" :title="label.name"
        ><i :style="{ background: '#' + label.color }" /><span class="label-text">{{ label.name }}</span></span
      ><button v-if="hiddenLabels.length > 0" type="button" class="label label-more" :title="hiddenLabelsTitle" :aria-label="hiddenLabelsAria" @click.stop="setExpanded(true)"
        >+{{ hiddenLabels.length }}</button></span>
      <span class="row-activity"><span class="row-slot row-slot-movement"><button v-if="recentMove" type="button" class="row-marker row-movement-marker" @click="emit('read')"
        :aria-label="recentMove === 'created' ? t('Nyligen skapat i Backlog. Markera som läst') : t('Nyligen flyttad. Markera som läst')"
        :title="recentMove === 'created' ? t('Skapat i Backlog') : t('Flyttad till {column}', { column: status })"
        >{{ recentMove === "created" ? t("Ny") : t("Flyttad") }} <span aria-hidden="true">✓</span></button></span><span class="row-slot row-slot-comment"><button v-if="newComments && newComments > 0" type="button" class="row-marker row-comment-marker" @click="emit('read')"
        :aria-label="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })"
        :title="newComments === 1 ? t('1 ny kommentar. Markera som läst') : t('{count} nya kommentarer. Markera som läst', { count: newComments })"
        ><MessageCircle :size="12" aria-hidden="true" class="comment-icon-animated" /> +{{ newComments }} <span aria-hidden="true">✓</span></button></span></span>
    </span>
    <div class="row-comments" @click.stop>
      <IssueComments :show-new-badge="false" compact-count :described-by="titleTextId" :issue="issue" :count="Math.max(0, Math.floor(issue.comments ?? 0))" :new-comments="newComments" :load-comments="loadComments" :session="commentsSession" :demo="demo" @read="emit('read')" />
    </div>
    <span class="row-times">
    <span class="row-time">
      <time v-if="col === 'backlog' && Number.isFinite(Date.parse(issue.created_at))" class="backlog-age"
        :datetime="issue.created_at" :title="new Date(issue.created_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ backlogAge }}</time
      ><span v-else-if="col === 'backlog'" class="backlog-age">{{ t("Okänd ålder") }}</span
      ><span v-else-if="col === 'progress' && work.waiting.value" class="integration-wait" :title="work.waitingTitle.value"
        ><GitMerge :size="12" aria-hidden="true" /><span class="row-elapsed-label" aria-hidden="true">{{ t("Väntar") }}</span><span class="sr-only">{{ t("Väntar på integration") }}</span></span
      ><span v-else-if="col === 'progress'" class="timer" :title="work.timerTitle.value"
        ><Clock3 :size="12" aria-hidden="true" /><span class="row-elapsed-label">{{ work.label.value ?? t("Starttid okänd") }}</span></span
      ><span v-else-if="pending" class="pending-closure-badge" :title="t('Väntar på att GitHub bekräftar att issuet är stängt')"
        ><Hourglass :size="12" aria-hidden="true" /><span class="pending-closure-text">{{ t("Verifieras") }}</span></span
      ><time v-else-if="issue.closed_at" class="closed-date" :datetime="issue.closed_at"
        :title="new Date(issue.closed_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })"
        >{{ closedTimeLabel(issue.closed_at, now, locale) }}</time
      >
    </span>
    <span class="row-outcome">
      <template v-if="col === 'closed'"><IssueImplementationTime v-if="!pending" :issue="issue" :repository="repository" /></template>
      <IssueTimeRemaining v-else-if="col === 'progress'" :issue="issue" :repository="repository" :active="visible" />
      <IssueTimeEstimate v-else :issue="issue" :repository="repository" :active="visible" />
    </span>
    </span>
    <div v-if="expanded && !isPhone" :id="panelId" class="row-card">
      <div v-if="allLabels.length" class="row-expanded-labels" role="group" :aria-label="t('Labels')">
        <span
          v-for="label in allLabels"
          :key="label.name"
          class="label"
        >
          <i :style="{ background: '#' + label.color }" aria-hidden="true" />
          <span class="label-text">{{ label.name }}</span>
        </span>
      </div>
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
          <div v-if="allLabels.length" class="row-expanded-labels row-popup-labels" role="group" :aria-label="t('Labels')">
            <span
              v-for="label in allLabels"
              :key="label.name"
              class="label"
            >
              <i :style="{ background: '#' + label.color }" aria-hidden="true" />
              <span class="label-text">{{ label.name }}</span>
            </span>
          </div>
          <slot :in-popup="true" />
        </div>
      </div>
    </Teleport>
  </li>
</template>

<style scoped>
.row-heading, .row-times { display: contents; }
.row-time { flex-wrap: nowrap; overflow: hidden; }
.row-time > * { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-elapsed-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* #429: the comment total is always visible, in a fixed slot at the end of line 2 (never behind the expansion). */
.row-comments { display: flex; align-items: center; justify-self: start; width: 3.5rem; min-width: 0; }
.row-comments :deep(.comment-count) { position: relative; max-width: 100%; min-height: var(--space-4); min-width: 0; gap: var(--space-1); padding: 0 var(--space-1); font-size: 10px; line-height: 1.4; }
/* Coarse pointers get a 44px hit area from a pseudo-element, so the row never grows. */
@media (pointer: coarse) {
  .row-comments :deep(.comment-count) { min-height: var(--space-4); min-width: 0; justify-content: flex-start; }
  .row-comments :deep(.comment-count)::after { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%); }
}
.row-comments :deep(.comment-count-value) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-mobile-summary { display: none; }
.row-points { display: flex; align-items: center; min-width: 0; }
.row-outcome { display: flex; align-items: center; justify-content: flex-start; min-width: 0; overflow: hidden; }
/* The fixed desktop time column truncates with its tooltip; phones size the outcome to its text instead. */
.row-outcome > * { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (min-width: 951px) {
  .row-outcome :deep(.issue-time-estimate),
  .row-outcome :deep(.implementation-time),
  .row-outcome :deep(.issue-time-remaining-label) {
    font-size: 10px; font-family: inherit; font-weight: inherit; font-style: normal; line-height: inherit;
  }
}
/* #426: one two-line row everywhere above phone width. A fixed left block holds the id badge
   (type icon inside) with SP directly under it, and the times stacked beside it: start/age or
   closed date on line 1, estimate/remaining/actual time on line 2. The title owns the rest of
   line 1; status, priority, labels and markers share line 2. */
.issue-row {
  /* Lead fits a badge up to #99999 with ↗ (longer numbers drop the arrow); times fit "Stängd 30 nov. 22:04". */
  --row-lead: 5.25rem; --row-times: 5.75rem;
  grid-template-columns: var(--row-lead) var(--row-times) minmax(0, 1fr) auto;
  grid-template-areas: "id time title title" "points outcome meta comments";
  align-items: center; gap: 0 var(--space-2); padding: var(--space-1) var(--space-2);
}
.row-id { grid-area: id; }
.row-title { grid-area: title; }
.row-points { grid-area: points; }
.row-time { grid-area: time; justify-self: stretch; justify-content: flex-start; text-align: left; }
.row-outcome { grid-area: outcome; }
.row-meta { grid-area: meta; }
.row-comments { grid-area: comments; }
.row-meta :deep(.row-repository), .row-meta :deep(.label), .row-meta :deep(.priority), .row-meta :deep(.row-status),
.row-meta :deep(.row-timeout), .row-meta :deep(.row-marker) { padding-block: 0; }
/* Narrow lists (many swimlanes, rail tablets): the times move to their own third line, still left-aligned. */
@container issue-list (max-width: 600px) {
  .issue-row { grid-template-columns: var(--row-lead) minmax(0, 1fr) 3.5rem; grid-template-areas: "id title title" "points meta comments" "times times times"; }
  .row-times { grid-area: times; display: flex; align-items: center; gap: var(--space-3); min-width: 0; overflow: hidden; }
  .row-time { flex: 0 1 auto; }
  .row-outcome { flex: 0 1 auto; }
}
@media (max-width: 650px), (pointer: coarse) and (max-width: 950px) and (max-height: 500px) {
  .issue-row {
    grid-template-columns: 3.2rem minmax(0, 1fr) minmax(0, 4.5rem) auto 2.75rem;
    grid-template-areas: "heading heading heading heading heading" "points meta time outcome comments";
    gap: 2px 6px; min-height: 56px; padding: 6px 8px;
  }
  /* Phones keep number and title on one line; SP opens line 2 directly under the number in a fixed slot. */
  .row-heading { grid-area: heading; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .row-heading > .row-id { flex-shrink: 0; }
  .row-heading > .row-title { flex: 1; }
  .row-times { display: contents; overflow: visible; }
  .row-comments { width: 2.75rem; }
  .row-comments :deep(.comment-count) { padding: 0; gap: 2px; }
  .row-points { justify-self: start; max-width: 100%; }
  .row-outcome { grid-area: outcome; justify-content: flex-end; overflow: visible; }
  .row-outcome > * { max-width: none; overflow: visible; }
  .row-title-text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; -webkit-line-clamp: unset; }
  .row-mobile-summary { grid-area: meta; display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; min-height: 24px; overflow: hidden; }
  .row-mobile-summary > * { flex: 0 0 auto; }
  .row-mobile-summary > .row-mobile-priority { order: 2; }
  .row-mobile-summary > .row-mobile-activity { order: 6; }
  .row-mobile-summary > .row-mobile-relation { order: 4; }
  .row-mobile-summary > .row-mobile-repository-slot { display: flex; align-items: center; order: 5; flex: 1 1 0; min-width: 0; max-width: 9rem; }
  .row-mobile-repository-slot > .row-repository { width: fit-content; max-width: 100%; padding: 1px 4px; font-size: 10px; }
  .row-mobile-relation { display: inline-flex; align-items: center; justify-content: center; gap: 2px; flex: 0 0 auto; min-width: 22px; height: 20px; padding: 0 3px; font-size: 10px; line-height: 1; white-space: nowrap; }
  .row-mobile-priority { display: inline-flex; }
  .row-mobile-priority.high { color: var(--accent-red, #b42332); }
  .row-mobile-activity { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 24px; height: 24px; padding: 0 3px; border: 0; border-radius: 4px; background: var(--marker-move-bg); color: var(--marker-move-text); font-size: 10px; cursor: pointer; }
  .row-mobile-activity:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
  .row-time { grid-area: time; justify-self: end; justify-content: flex-end; flex-wrap: nowrap; max-width: 4.5rem; overflow: hidden; font-size: 10px; }
  .row-time > .timer, .row-time > .integration-wait { flex: 1 1 auto; min-width: 0; }
}
@media (max-width: 360px), (pointer: coarse) and (max-width: 360px) {
  /* #429: a 2.75rem SP slot and 4px column gaps keep room for priority and the repository icon
     beside the comment slot. */
  .issue-row { grid-template-columns: 2.75rem minmax(0, 1fr) minmax(0, 2.75rem) auto 2.75rem; column-gap: var(--space-1); }
  .row-mobile-summary { gap: 1px; }
  .row-mobile-summary > .row-mobile-repository-slot { flex: 0 0 auto; }
  .row-mobile-repository-slot > .row-repository { padding: 1px; }
  .row-mobile-summary .row-repository-name { display: none; }
  .row-points :deep(.issue-points) { padding: 1px; }
  .row-mobile-priority svg { width: 9px; height: 9px; }
  .row-mobile-activity { padding: 0; }
  .row-time { max-width: 2.75rem; }
  /* Narrow phones keep the icon badge; the full status stays in screen-reader text and the card (#392). */
  .integration-wait .row-elapsed-label { display: none; }
  /* Narrow phones let the actual/forecast text keep its width rather than clipping it in a fixed 5rem slot. */
  .row-outcome { width: auto; max-width: none; overflow: visible; font-size: 10px; }
  .row-outcome .issue-time-estimate,
  .row-outcome :deep(.issue-time-remaining-label) { font-size: 10px; }
}
</style>
