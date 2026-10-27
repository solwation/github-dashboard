<script setup lang="ts">
import { ref, useId } from "vue";
import { ExternalLink } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import BuildInfo from "./BuildInfo.vue";

defineProps<{ available: boolean; checked?: boolean; checking?: boolean }>();
const emit = defineEmits<{ "release-notes": []; "open-update": [] }>();
const { t } = useLanguage();
const titleId = useId();
const badge = ref<HTMLButtonElement | null>(null);
/** Focuses the update badge when it is rendered and visible; returns whether it did. */
function focusBadge() {
  const element = badge.value;
  if (!element || !element.getClientRects().length) return false;
  element.focus();
  return document.activeElement === element;
}
defineExpose({ focusBadge });
function openNotesFromKeyboard(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  emit("release-notes");
}
</script>

<template>
  <section class="sidebar-version" :class="{ 'has-update': available }" :aria-labelledby="titleId"
    role="region" tabindex="0" :title="t('Klicka för att visa versionsnyheter')"
    @click="emit('release-notes')" @keydown.enter="openNotesFromKeyboard" @keydown.space="openNotesFromKeyboard">
    <div class="sidebar-version-heading">
      <span :id="titleId" class="sidebar-version-caption">{{ t("Version") }}</span>
      <button v-if="available" ref="badge" type="button" class="sidebar-version-badge" aria-haspopup="dialog"
        :aria-label="t('Ny uppdatering tillgänglig')" :title="t('Ny uppdatering tillgänglig')" @click.stop="emit('open-update')">
        <span aria-hidden="true">!</span>
      </button>
      <ExternalLink class="sidebar-version-open" :size="12" aria-hidden="true" />
    </div>
    <p class="sidebar-version-build"><BuildInfo /></p>
    <p class="sidebar-version-status" :class="available ? 'is-update' : checking ? 'is-checking' : checked ? 'is-current' : 'is-unchecked'" role="status">
      <svg v-if="available" class="sidebar-version-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5" fill="currentColor" /></svg>
      <svg v-else-if="!checking && checked" class="sidebar-version-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>{{ available ? t("Uppdatering tillgänglig") : checking ? t("Kontrollerar version…") : checked ? t("Senaste versionen") : t("Versionen är inte kontrollerad") }}</span>
    </p>
  </section>
</template>

<style scoped>
.sidebar-version {
  margin-top: auto;
  /* Same inset as .sidebar-footer below, so both open icons share one right edge (#304). */
  padding: var(--space-3) var(--space-2);
  margin-inline: -5px;
  border-top: 1px solid var(--line);
  color: #6c797e;
  font-size: 11px;
  min-width: 0;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color .15s ease, color .15s ease;
}
.sidebar-version:hover {
  background: #edf5f2;
}
:root[data-theme="dark"] .sidebar-version:hover {
  background: rgba(255, 255, 255, 0.06);
}
.sidebar-version:hover .sidebar-version-caption {
  color: var(--green);
}
.sidebar-version:hover .sidebar-version-build {
  color: var(--text);
}
.sidebar-version:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
.sidebar-version-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.sidebar-version-open { flex-shrink: 0; }
.sidebar-version-caption { margin-right: auto; font-size: 10px; letter-spacing: 1.2px; font-weight: 700; text-transform: uppercase; color: var(--faint); transition: color .15s ease; }
.sidebar-version-build { margin: 4px 0 8px; font-size: 11px; color: var(--muted); transition: color .15s ease; }
.sidebar-version-status { display: flex; align-items: center; gap: 5px; margin: 0; overflow-wrap: anywhere; }
.sidebar-version-icon { flex-shrink: 0; }
.sidebar-version-status.is-current { color: var(--green); font-weight: 600; }
.sidebar-version-status.is-update { color: #b91c1c; font-weight: 600; }
:root[data-theme="dark"] .sidebar-version-status.is-update { color: var(--accent-red); }
.sidebar-version-badge {
  display: inline-grid; place-items: center; flex-shrink: 0;
  width: 24px; height: 24px; min-width: 24px; padding: 0; border: 0; border-radius: 50%;
  background: #b91c1c; color: #fff; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer;
}
.sidebar-version-badge:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
/* Collapsed and phone sidebars keep only the update badge reachable. */
@media (max-width: 950px) {
  .sidebar-version { display: none; padding: 12px 0 0; margin-inline: 0; border-top: 0; cursor: default; border-radius: 0; }
  .sidebar-version:hover { background: transparent; }
  .sidebar-version.has-update { display: block; }
  .sidebar-version-caption, .sidebar-version-build, .sidebar-version-status, .sidebar-version-open { display: none; }
  .sidebar-version-heading { justify-content: center; }
  .sidebar-version-badge { width: 28px; height: 28px; cursor: pointer; }
}
@media (max-width: 650px) {
  .sidebar-version { margin: 0 0 0 8px; padding: 0; flex-shrink: 0; }
}
</style>
