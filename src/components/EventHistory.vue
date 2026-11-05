<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { AlertTriangle, CircleAlert, Info, RefreshCw, X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { AppEvent } from "../lib/event-history";
const props = defineProps<{ open: boolean; events: AppEvent[]; errors: { repository: string; message: string }[]; showErrors: boolean }>();
const emit = defineEmits<{ close: []; seen: [ids: number[]]; retry: [repository: string] }>();
const { t, locale } = useLanguage();
const dialog = ref<HTMLDialogElement>();
const displayed = ref<AppEvent[]>([]);
let returnFocus: HTMLElement | null = null;
watch(() => props.open, async open => {
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A stable snapshot makes new arrivals visible in the header badge without marking them read.
    displayed.value = [...props.events].reverse();
    emit("seen", displayed.value.map(item => item.id));
  }
  await nextTick();
  if (open && !dialog.value?.open) dialog.value?.showModal();
  else if (!open && dialog.value?.open) {
    dialog.value.close();
    displayed.value = [];
    if (returnFocus?.isConnected) returnFocus.focus();
  }
});
function trapTab(event: KeyboardEvent) {
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])].filter(button => button.getClientRects().length);
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
function showLatest() {
  displayed.value = [...props.events].reverse();
  emit("seen", displayed.value.map(item => item.id));
}
const severityText = (severity: string) => t(severity === "error" ? "Fel" : severity === "warning" ? "Varning" : "Information");
</script>

<template>
  <dialog ref="dialog" class="event-history-dialog" aria-labelledby="event-history-title" @cancel.prevent="emit('close')" @keydown.tab="trapTab">
    <header class="event-history-heading">
      <h2 id="event-history-title">{{ t("Händelsehistorik") }}</h2>
      <button type="button" class="icon-button" autofocus :aria-label="t('Stäng händelsehistorik')" :title="t('Stäng händelsehistorik')" @click="emit('close')"><X :size="20" aria-hidden="true" /></button>
    </header>
    <section v-if="showErrors && errors.length" class="event-current-errors" :aria-label="t('Aktuella projektfel')">
      <h3>{{ t("Aktuella projektfel") }}</h3>
      <ul>
        <li v-for="item in errors" :key="item.repository" class="event-current-error">
          <strong>{{ item.repository }}</strong><p>{{ item.message }}</p>
          <button type="button" class="button small" @click="emit('retry', item.repository)"><RefreshCw :size="16" aria-hidden="true" />{{ t("Försök igen") }}</button>
        </li>
      </ul>
      <p>{{ t("Tidigare data visas om de finns.") }}</p>
    </section>
    <p class="event-history-description">{{ t("De senaste 100 händelserna. Nya händelser markeras som lästa när du visar dem.") }}</p>
    <button v-if="events.some(item => !displayed.some(shown => shown.id === item.id))" type="button" class="button event-show-latest" @click="showLatest">{{ t("Visa nya händelser") }}</button>
    <p v-if="!displayed.length">{{ t("Inga händelser ännu.") }}</p>
    <ol v-else class="event-history-list">
      <li v-for="item in displayed" :key="item.id" class="event-history-item" :data-severity="item.severity">
        <CircleAlert v-if="item.severity === 'error'" :size="20" aria-hidden="true" />
        <AlertTriangle v-else-if="item.severity === 'warning'" :size="20" aria-hidden="true" />
        <Info v-else :size="20" aria-hidden="true" />
        <div class="event-history-content">
          <div class="event-history-meta">
            <strong>{{ severityText(item.severity) }}</strong>
            <span v-if="item.repository" class="event-history-repository">{{ item.repository }}</span>
            <time :datetime="new Date(item.timestamp).toISOString()">{{ new Date(item.timestamp).toLocaleString(locale) }}</time>
          </div>
          <p>{{ item.message }}</p>
        </div>
      </li>
    </ol>
  </dialog>
</template>

<style scoped>
.event-history-dialog { width: min(42rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--space-4); background: var(--surface); color: var(--text); overflow: auto; }
.event-history-dialog::backdrop { background: var(--dialog-backdrop); }
.event-history-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
h2 { margin: 0; font-family: Manrope, sans-serif; font-size: 22px; }
h3 { margin: 0 0 var(--space-3); font-size: 14px; }
.event-history-description { color: var(--muted); font-size: 12px; margin: var(--space-2) 0; }
.event-history-list, .event-current-errors ul { list-style: none; padding: 0; margin: 0; }
.event-history-item { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: start; gap: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--line); }
.event-history-item > svg { color: var(--muted); }
.event-history-item[data-severity="error"] > svg { color: var(--accent-red); }
.event-history-item[data-severity="warning"] > svg { color: var(--accent-amber); }
.event-history-meta { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; column-gap: var(--space-2); font-size: 11px; }
.event-history-meta strong, .event-history-meta time { min-height: 20px; display: inline-flex; align-items: center; }
.event-history-meta time { grid-column: 3; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.event-history-content, .event-current-error { min-width: 0; overflow-wrap: anywhere; }
.event-history-repository { min-width: 0; font-size: 12px; line-height: 20px; color: var(--muted); }
.event-history-content p, .event-current-error p { margin: var(--space-2) 0 0; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
.event-history-content p { margin-top: var(--space-1); }
.event-current-errors { margin-top: var(--space-4); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--space-2); }
.event-current-error + .event-current-error { border-top: 1px solid var(--line); margin-top: var(--space-4); padding-top: var(--space-4); }
.event-current-error .button { margin-top: var(--space-3); }
.event-current-errors > p { margin: var(--space-4) 0 0; font-size: 12px; color: var(--muted); }
@media (pointer: coarse), (max-width: 650px), (max-width: 950px) and (max-height: 500px) { .event-history-dialog button { min-width: 44px; min-height: 44px; } }
@media (max-width: 650px) {
  .event-history-meta { grid-template-columns: minmax(0, 1fr) auto; }
  .event-history-meta time { grid-column: 2; grid-row: 1; }
  .event-history-repository { grid-column: 1 / -1; }
}
</style>
