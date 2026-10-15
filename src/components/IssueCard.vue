<script setup lang="ts">
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
}>();
const col = computed(() => column(props.issue, props.rules));
const rank = computed(() => priority(props.issue, props.rules));
const visibleLabels = computed(() =>
  props.issue.labels.filter((l) => !/^priority\s*:/i.test(l.name)).slice(0, 4),
);
</script>
<template>
  <article class="issue-card" :class="col">
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
        :title="'Prioritet: ' + ['hög', 'medium', 'låg'][rank]"
        ><component :is="[ArrowUp, Minus, ArrowDown][rank]" :size="12" />{{
          ["Hög", "Medium", "Låg"][rank]
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
            ? 'Arbetslabel satt ' +
              new Date(issue.startedAt).toLocaleString('sv-SE')
            : 'Ingen säker starttid kunde hämtas'
        "
        ><Clock3 :size="13" />{{
          issue.startedAt ? duration(issue.startedAt, now) : "Starttid okänd"
        }}</span
      ><span v-else-if="col === 'closed'" class="closed-date"
        >Stängd
        {{
          new Date(issue.closed_at!).toLocaleDateString("sv-SE", {
            month: "short",
            day: "numeric",
          })
        }}</span
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
