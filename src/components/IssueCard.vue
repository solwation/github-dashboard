<script setup lang="ts">
import { useLanguage } from "../lib/i18n";
const { t, locale } = useLanguage();
import { computed } from "vue";
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
  type Rules,
} from "../lib/model";
const props = defineProps<{
  issue: Issue;
  now: number;
  rules: Rules;
  demo?: boolean;
  celebrate?: boolean;
}>();
const col = computed(() => column(props.issue, props.rules));
const rank = computed(() => priority(props.issue, props.rules));
const visibleLabels = computed(() =>
  props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name)).slice(0, 4),
);
</script>
<template>
  <article
    class="issue-card"
    :class="[col, { 'just-closed': celebrate && col === 'closed' }]"
  >
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
    <div v-if="col !== 'backlog' || issue.assignees.length" class="card-bottom">
      <span
        v-if="col === 'progress'"
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
        >{{ t("Stängd") }}
        {{
          new Date(issue.closed_at).toLocaleString(locale, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        }}</time
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
  </article>
</template>
