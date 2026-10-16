<script setup lang="ts">
import { onMounted, ref, useId, watch } from "vue";
import { X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import BuildInfo from "./BuildInfo.vue";

// Manual update view, opened from Settings or the sidebar badge; focus returns to its opener.
const props = defineProps<{
  open: boolean;
  available: boolean;
  applying: boolean;
  error: string;
  deferred: boolean;
  /** Short improvement summary between installed and available version; empty hides it. */
  summary: string;
  availableVersion?: { builtAt: string | null; commit: string | null } | null;
}>();
const emit = defineEmits<{ close: []; install: []; "read-more": [] }>();
const { t } = useLanguage();
const titleId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
let opener: HTMLElement | null = null;
function sync(open: boolean) {
  const element = dialog.value;
  if (!element) return;
  if (open && !element.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
  } else if (!open && element.open) element.close();
}
watch(() => props.open, sync, { flush: "post" });
onMounted(() => sync(props.open));
function closed() {
  const target = opener;
  opener = null;
  emit("close");
  if (target?.isConnected) target.focus();
}
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="update-dialog" :aria-labelledby="titleId" @close="closed"
      @click="(event) => { if (event.target === dialog) dialog?.close(); }">
      <div class="update-heading">
        <h2 :id="titleId">{{ t("Automatiska uppdateringar") }}</h2>
        <button type="button" class="icon-button" :aria-label="t('Stäng')" autofocus @click="dialog?.close()"><X :size="20" /></button>
      </div>
      <p class="update-installed">{{ t("Installerad version:") }} <BuildInfo /></p>
      <section v-if="available" class="update-available" :aria-labelledby="titleId + '-new'">
        <h3 :id="titleId + '-new'">{{ t("Ny uppdatering tillgänglig") }}</h3>
        <p v-if="availableVersion" class="update-version">
          {{ t("Ny version:") }} <BuildInfo :built-at="availableVersion.builtAt" :commit="availableVersion.commit" />
        </p>
        <p v-if="summary" class="update-summary">{{ summary }}</p>
        <p v-if="deferred && !applying && !error" class="update-note">{{ t("Den automatiska frågan visas igen i morgon. Du kan installera uppdateringen nu.") }}</p>
        <div class="update-actions">
          <button v-if="summary" type="button" class="button" @click="emit('read-more')">{{ t("Läs mer") }}</button>
          <button type="button" class="button primary" :disabled="applying" @click="emit('install')">{{ t("Installera uppdateringen") }}</button>
        </div>
      </section>
      <p class="update-status" role="status">
        <template v-if="!available">{{ t("Du har den senaste versionen av Issueflow.") }}</template>
        <template v-else-if="error">{{ t(error) }}</template>
        <template v-else-if="applying">{{ t("Uppdaterar…") }}</template>
      </p>
      <p class="update-help">{{ t("Issueflow söker efter uppdateringar automatiskt. En synlig flik frågar först; en flik i bakgrunden uppdateras efter 10 sekunder. ”Inte nu” skjuter upp båda till nästa dag. Inloggning, inställningar och sparat innehåll behålls.") }}</p>
    </dialog>
  </Teleport>
</template>
<style scoped>
.update-dialog {
  box-sizing: border-box;
  width: min(32rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  max-height: min(90dvh, calc(100dvh - 2rem));
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line);
  border-radius: .8rem;
  padding: 1.2rem;
  color: var(--text, #273a3c);
  background: white;
}
.update-dialog::backdrop { background: #102b2a88; }
.update-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.update-heading h2 { margin: 0; font-size: 1rem; line-height: 1.5; }
.update-heading button { flex-shrink: 0; min-width: 44px; min-height: 44px; }
h3 { margin: 1rem 0 .25rem; font-size: .9375rem; }
p { font-size: .875rem; line-height: 1.5; margin: .5rem 0; overflow-wrap: anywhere; }
.update-installed, .update-version, .update-help, .update-note { color: var(--muted); }
.update-summary { white-space: pre-line; }
.update-available { border-top: 1px solid var(--line); margin-top: 1rem; }
.update-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
.update-help { font-size: .8125rem; border-top: 1px solid var(--line); padding-top: .75rem; margin-top: 1rem; }
</style>
