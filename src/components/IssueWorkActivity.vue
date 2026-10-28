<script setup lang="ts">
import { computed } from "vue";
import { TriangleAlert } from "@lucide/vue";
import { inactiveWork } from "../lib/work-activity";
import { duration, type Issue, type Rules } from "../lib/model";
import { useLanguage } from "../lib/i18n";

const props = defineProps<{ issue: Issue; rules: Rules; now: number; compact?: boolean }>();
const { t } = useLanguage();
const activity = computed(() => inactiveWork(props.issue, props.rules, props.now));
const description = computed(() => activity.value ? t("Möjligen avstannat. Ingen synlig aktivitet på ärendet på {duration}. Agenten kan ha fastnat eller kopplats från. Arbete kan också pågå utan GitHub-uppdateringar; kontrollera agenten eller samordningstråden.", {
  duration: duration(new Date(activity.value.lastActivityMs).toISOString(), props.now),
}) : "");
</script>

<template>
  <span v-if="activity" class="work-inactivity" :class="{ compact }" role="img" :aria-label="description" :title="description">
    <TriangleAlert :size="12" aria-hidden="true" />
    <span v-if="!compact">{{ t("Möjligen avstannat") }} · {{ t("{duration} utan synlig aktivitet", { duration: duration(new Date(activity.lastActivityMs).toISOString(), now) }) }}</span>
  </span>
</template>

<style scoped>
.work-inactivity { display: flex; align-items: center; gap: var(--space-1); color: var(--timeout-text); font-size: 11px; line-height: 1.5; margin-top: var(--space-2); overflow-wrap: anywhere; }
.work-inactivity svg { flex: 0 0 var(--icon-xs); }
.work-inactivity.compact { display: inline-flex; flex: 0 0 var(--icon-xs); margin: 0; }
</style>
