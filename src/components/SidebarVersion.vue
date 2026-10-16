<script setup lang="ts">
import { ref, useId } from "vue";
import { useLanguage } from "../lib/i18n";
import BuildInfo from "./BuildInfo.vue";

defineProps<{ available: boolean }>();
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
</script>

<template>
  <section class="sidebar-version" :class="{ 'has-update': available }" :aria-labelledby="titleId">
    <div class="sidebar-version-heading">
      <span :id="titleId" class="sidebar-version-caption">{{ t("Version") }}</span>
      <button v-if="available" ref="badge" type="button" class="sidebar-version-badge" aria-haspopup="dialog"
        :aria-label="t('Ny uppdatering tillgänglig')" :title="t('Ny uppdatering tillgänglig')" @click="emit('open-update')">
        <span aria-hidden="true">!</span>
      </button>
    </div>
    <p class="sidebar-version-build"><BuildInfo /></p>
    <button type="button" class="sidebar-version-notes" @click="emit('release-notes')">{{ t("Versionsnyheter") }}</button>
  </section>
</template>

<style scoped>
.sidebar-version {
  margin-top: auto;
  padding: 16px 3px 14px;
  border-top: 1px solid var(--line);
  color: #6c797e;
  font-size: 11px;
  min-width: 0;
}
.sidebar-version-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.sidebar-version-caption { font-size: 10px; letter-spacing: 1.2px; font-weight: 700; text-transform: uppercase; color: #909b9f; }
.sidebar-version-build { margin: 4px 0 8px; font-size: 11px; color: var(--muted); }
.sidebar-version-notes {
  border: 0; background: transparent; padding: 4px 0; min-height: 24px;
  color: var(--green); font: inherit; font-weight: 600; cursor: pointer; text-align: left;
}
.sidebar-version-notes:hover { text-decoration: underline; }
.sidebar-version-badge {
  display: inline-grid; place-items: center; flex-shrink: 0;
  width: 24px; height: 24px; min-width: 24px; padding: 0; border: 0; border-radius: 50%;
  background: #b91c1c; color: #fff; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer;
}
.sidebar-version-badge:focus-visible, .sidebar-version-notes:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
/* Collapsed and phone sidebars keep only the update badge reachable. */
@media (max-width: 950px) {
  .sidebar-version { display: none; padding: 12px 0 0; border-top: 0; }
  .sidebar-version.has-update { display: block; }
  .sidebar-version-caption, .sidebar-version-build, .sidebar-version-notes { display: none; }
  .sidebar-version-heading { justify-content: center; }
  .sidebar-version-badge { width: 28px; height: 28px; }
}
@media (max-width: 650px) {
  .sidebar-version { margin: 0 0 0 8px; padding: 0; flex-shrink: 0; }
}
</style>
