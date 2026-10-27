<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { ExternalLink } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import BuildInfo from "./BuildInfo.vue";

const props = defineProps<{ available: boolean; checked?: boolean; checking?: boolean }>();
const emit = defineEmits<{ "release-notes": []; "open-update": [] }>();
const { t, locale } = useLanguage();
const status = computed(() => props.available ? t("Uppdatering tillgänglig") : props.checking ? t("Kontrollerar version…") : props.checked ? t("Senaste versionen") : t("Versionen är inte kontrollerad"));
const details = computed(() => [
  t("Klicka för att visa versionsnyheter"),
  __BUILD_INFO__.builtAt ? new Intl.DateTimeFormat(locale.value, { dateStyle: "full", timeStyle: "long" }).format(new Date(__BUILD_INFO__.builtAt)) : t("Utvecklingsläge"),
  __BUILD_INFO__.commit || t("Okänd commit"), status.value,
].join(" · "));
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
    role="region" tabindex="0" :title="details"
    @click="emit('release-notes')" @keydown.enter="openNotesFromKeyboard" @keydown.space="openNotesFromKeyboard">
    <div class="sidebar-version-heading">
      <span :id="titleId" class="sidebar-version-caption">{{ t("Version") }}</span>
      <p class="sidebar-version-build"><BuildInfo /></p>
      <button v-if="available" ref="badge" type="button" class="sidebar-version-badge" aria-haspopup="dialog"
        :aria-label="t('Ny uppdatering tillgänglig')" :title="t('Ny uppdatering tillgänglig')" @click.stop="emit('open-update')">
        <span aria-hidden="true">!</span>
      </button>
      <ExternalLink class="sidebar-version-open" :size="12" aria-hidden="true" />
    </div>
    <p class="sidebar-version-status" :class="available ? 'is-update' : checking ? 'is-checking' : checked ? 'is-current' : 'is-unchecked'" role="status">
      <svg v-if="available" class="sidebar-version-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5" fill="currentColor" /></svg>
      <svg v-else-if="!checking && checked" class="sidebar-version-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>{{ status }}</span>
    </p>
  </section>
</template>

<style scoped>
.sidebar-version {
  margin-top: auto;
  flex: 0 0 auto;
  padding: var(--space-1) var(--space-2);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  min-width: 0;
  cursor: pointer;
  border-radius: var(--space-1);
  transition: background-color .15s ease, color .15s ease;
}
.sidebar-version:hover { background: var(--hover); }
.sidebar-version:hover .sidebar-version-caption { color: var(--green); }
.sidebar-version:hover .sidebar-version-build { color: var(--text); }
.sidebar-version:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.sidebar-version-heading { display: flex; align-items: center; gap: var(--space-2); min-height: var(--space-6); }
.sidebar-version-open { flex-shrink: 0; }
.sidebar-version-caption { margin-right: auto; font-size: 10px; letter-spacing: 1.2px; font-weight: 700; text-transform: uppercase; color: var(--faint); transition: color .15s ease; }
.sidebar-version-build { min-width: 0; margin: 0; font-size: 11px; color: var(--muted); transition: color .15s ease; }
.sidebar-version-build :deep(.build-identity) { display: flex; flex-wrap: nowrap; }
/* Full build date and update state remain accessible and in the region tooltip;
   Settings > Automatic updates also shows the complete build identity. */
.sidebar-version-build :deep(.build-identity > :not(code)), .sidebar-version-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.sidebar-version-status { margin: 0; }
.sidebar-version-badge {
  display: inline-grid; place-items: center; flex-shrink: 0;
  width: var(--space-6); height: var(--space-6); min-width: var(--space-6); padding: 0; border: 0; border-radius: 50%;
  background: var(--timeout-text); color: var(--on-timeout); font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer;
}
.sidebar-version-badge:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* Collapsed and phone sidebars keep only the update badge reachable. */
@media (max-width: 950px) {
  .sidebar-version { display: none; padding: var(--space-3) 0 0; border-top: 0; cursor: default; border-radius: 0; }
  .sidebar-version:hover { background: transparent; }
  .sidebar-version.has-update { display: block; }
  .sidebar-version-caption, .sidebar-version-build, .sidebar-version-status, .sidebar-version-open { display: none; }
  .sidebar-version-heading { justify-content: center; }
  .sidebar-version-badge { width: var(--space-8); height: var(--space-8); cursor: pointer; }
}
@media (max-width: 650px) {
  .sidebar-version { margin: 0 0 0 var(--space-2); padding: 0; flex-shrink: 0; }
}
@media (pointer: coarse) {
  .sidebar-version, .sidebar-version-badge { min-height: 44px; }
  .sidebar-version-badge { min-width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-version, .sidebar-version-caption, .sidebar-version-build { transition: none; }
}
</style>
