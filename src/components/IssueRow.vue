<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowDown, ArrowUp, ArrowUpRight, Clock3, Minus } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { backlogAgeLabel, closedTimeLabel } from "../lib/time";
import { useIssueClock } from "../composables/useIssueClock";
import { repositoryColor } from "../lib/repository-color";
import { column, duration, priority, type Issue, type Rules } from "../lib/model";
import type { ActivityMarker } from "../lib/activity";
const { t, locale } = useLanguage();

/** One compact list row per issue (#127): the card's markers and time label without its details. */
const props = defineProps<{
  issue: Issue;
  rules: Rules;
  repository: string;
  showRepository?: boolean;
  assignedColor?: string;
  demo?: boolean;
  celebrate?: boolean;
  recentMove?: ActivityMarker;
  timedOut?: boolean;
  timeoutMinutes?: number;
}>();
const emit = defineEmits<{ read: [] }>();
const row = ref<HTMLElement>();
const visible = ref(false);
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (!("IntersectionObserver" in window)) { visible.value = true; return; }
  observer = new IntersectionObserver(([entry]) => { visible.value = Boolean(entry?.isIntersecting); });
  if (row.value) observer.observe(row.value);
});
onBeforeUnmount(() => observer?.disconnect());
const col = computed(() => column(props.issue, props.rules));
const now = useIssueClock(() => props.issue, () => col.value, () => visible.value);
const rank = computed(() => priority(props.issue, props.rules));
const labels = computed(() => props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name)).slice(0, 3));
const status = computed(() => col.value === "closed" ? t("Stängda") : col.value === "progress" ? t("Pågående") : "Backlog");
const timeout = computed(() => props.timedOut && col.value === "progress");
</script>
<template>
  <li
    ref="row"
    class="issue-row"
    :style="{ '--repository-color': assignedColor || repositoryColor(repository) }"
    :class="[col, { 'has-repository': showRepository, 'just-closed': celebrate && col === 'closed', 'unread-move': recentMove === true, 'unread-created': recentMove === 'created', 'issue-timeout': timeout }]"
  >
    <span v-if="showRepository" class="row-repository" :title="repository"><i aria-hidden="true" /><span>{{ repository }}</span></span>
    <span class="issue-number row-number">#{{ issue.number }}</span>
    <a
      :href="demo ? undefined : issue.html_url"
      :aria-disabled="demo || undefined"
      target="_blank"
      rel="noopener noreferrer"
      class="row-title"
      :title="issue.title"
      @click="emit('read')" @auxclick="emit('read')"
      >{{ issue.title }}<ArrowUpRight :size="12" aria-hidden="true"
    /></a>
    <span class="row-meta">
      <button v-if="recentMove" type="button" class="row-marker" @click="emit('read')"
        :aria-label="recentMove === 'created' ? t('Nyligen skapat i Backlog. Markera som läst') : t('Nyligen flyttad. Markera som läst')"
        :title="recentMove === 'created' ? t('Skapat i Backlog') : t('Flyttad till {column}', { column: status })"
        >{{ recentMove === "created" ? t("Ny") : t("Flyttad") }} <span aria-hidden="true">✓</span></button
      ><span class="row-status" :class="col">{{ status }}</span
      ><span v-if="timeout && issue.startedAt" class="row-timeout"
        :title="t('Timeout: pågående i {duration}, över gränsen {minutes} min.', { duration: duration(issue.startedAt, now), minutes: timeoutMinutes ?? 30 })"
        >{{ t("Timeout") }}</span
      ><span v-if="col !== 'closed'" class="priority" :class="['high', 'medium', 'low'][rank]" :title="t('Prioritet: ') + [t('hög'), 'medium', t('låg')][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="11" aria-hidden="true" />{{ [t("Hög"), "Medium", t("Låg")][rank] }}</span
      ><span v-for="label in labels" :key="label.name" class="label" :title="label.name"
        ><i :style="{ background: '#' + label.color }" />{{ label.name }}</span
      >
    </span>
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
    </span>
  </li>
</template>
