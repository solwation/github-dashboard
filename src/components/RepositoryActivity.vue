<script setup lang="ts">
import { computed, useId } from "vue";
import { Activity } from "@lucide/vue";
import { locale, useLanguage } from "../lib/i18n";
import type { RepositoryActivity } from "../lib/repository-activity";
const props = defineProps<{ activities: RepositoryActivity[]; aggregate?: boolean }>();
const { t } = useLanguage();
const id = useId();
const label = computed(() => props.aggregate
  ? t("{count} med arbetsaktivitet", { count: props.activities.length })
  : props.activities[0]?.claimed && props.activities[0]?.coordination ? t("Orkesteraktivitet") : t("Arbetsaktivitet"));
</script>

<template>
  <span v-if="activities.length" class="repository-activity">
    <button type="button" class="repository-activity-trigger" :popovertarget="id" :title="t('Visa underlag: {activity}', { activity: label })" :aria-label="t('Visa underlag: {activity}', { activity: label })">
      <Activity :size="12" aria-hidden="true" /><span>{{ label }}</span>
    </button>
    <div :id="id" popover class="repository-activity-details" :aria-label="t('Observerad arbetsaktivitet')">
      <strong>{{ t("Observerad arbetsaktivitet") }}</strong>
      <p>{{ t("Öppna issues med arbetslabel och en GitHub-uppdatering senaste 60 minuterna. Kommentarer och metadata räknas; detta är en indikation, inte säker realtidsstatus.") }}</p>
      <ul>
        <li v-for="activity in activities" :key="activity.repository">
          <strong>{{ activity.repository }}</strong>
          <span>{{ t("{count} nyligen uppdaterade issues i arbete", { count: activity.issues }) }}</span>
          <span>{{ t("Senaste observerade ändring") }}: <time :datetime="new Date(activity.latestAt).toISOString()">{{ new Date(activity.latestAt).toLocaleString(locale) }}</time></span>
          <span v-if="activity.claimed">{{ t("Ägaranspråk finns på aktuellt arbete.") }}</span>
          <a v-if="activity.coordination" :href="activity.coordination.html_url" target="_blank" rel="noopener noreferrer">{{ t("Öppna samordningsissue") }} #{{ activity.coordination.number }}</a>
        </li>
      </ul>
      <p>{{ t("Agentantal visas inte: issues, ägaranspråk och sessioner identifierar inte enskilda körande agenter.") }}</p>
      <button type="button" class="button" :popovertarget="id" popovertargetaction="hide">{{ t("Stäng") }}</button>
    </div>
  </span>
</template>

<style scoped>
.repository-activity { display: inline-flex; flex: 0 0 auto; }
.repository-activity-trigger { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1); color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--space-1); font-size: 10px; line-height: 1.4; cursor: pointer; white-space: nowrap; }
.repository-activity-trigger svg { flex: 0 0 var(--icon-xs); color: var(--green); }
.repository-activity-trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.repository-activity-details { width: min(24rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); box-sizing: border-box; overflow: auto; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--space-2); background: var(--surface); color: var(--text); font-size: 12px; line-height: 1.5; }
.repository-activity-details strong { display: block; font-size: 12px; line-height: 1.5; }
.repository-activity-details p { margin: var(--space-3) 0; }
.repository-activity-details ul { list-style: none; padding: 0; margin: var(--space-3) 0; }
.repository-activity-details li { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) 0; overflow-wrap: anywhere; }
.repository-activity-details a { color: var(--green); display: inline-flex; align-items: center; min-height: 44px; }
.repository-activity-details .button { min-height: 44px; }
@media (pointer: coarse), (max-width: 650px), (max-width: 950px) and (max-height: 500px) { .repository-activity-trigger { min-height: 44px; min-width: 44px; } }
</style>
