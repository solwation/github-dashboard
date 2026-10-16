<script setup lang="ts">
import { ref, useId } from "vue";
import { X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
const guideSource = __WORKFLOW_GUIDE__;
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const field = ref<HTMLTextAreaElement | null>(null);
const titleId = useId();
const fieldId = useId();
const copyState = ref<"idle" | "copied" | "manual">("idle");
function show() {
  copyState.value = "idle";
  dialog.value?.showModal();
}
async function copy() {
  try {
    await navigator.clipboard.writeText(guideSource);
    copyState.value = "copied";
  } catch {
    field.value?.focus();
    field.value?.select();
    copyState.value = "manual";
  }
}
</script>
<template>
  <div class="workflow-guide">
    <button ref="trigger" class="button small" aria-haspopup="dialog" @click="show">{{ t("Instruktioner för issueflödet") }}</button>
  </div>
  <Teleport to="body">
    <dialog ref="dialog" class="workflow-guide-dialog" :aria-labelledby="titleId" @close="trigger?.focus()">
      <div class="guide-heading">
        <h2 :id="titleId">{{ t("Instruktioner för issueflödet") }}</h2>
        <button class="icon-button" :aria-label="t('Stäng')" autofocus @click="dialog?.close()"><X :size="20" /></button>
      </div>
      <div class="guide-content">
        <label :for="fieldId">{{ t("Instruktioner (Markdown)") }}</label>
        <textarea :id="fieldId" ref="field" :value="guideSource" readonly rows="10" spellcheck="false" lang="en" />
        <div class="guide-actions">
          <button class="button small" @click="copy">{{ t("Kopiera instruktioner") }}</button>
        </div>
        <p class="copy-status" role="status">
          <template v-if="copyState === 'copied'">{{ t("Instruktionerna har kopierats.") }}</template>
          <template v-else-if="copyState === 'manual'">{{ t("Kopiera den markerade texten manuellt.") }}</template>
        </p>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.workflow-guide-dialog { box-sizing: border-box; width: min(40rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: min(90dvh, calc(100dvh - 2rem)); overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; padding: 1.2rem; color: var(--text, #273a3c); background: white; }
.workflow-guide-dialog[open] { display: flex; flex-direction: column; }
.workflow-guide-dialog::backdrop { background: #102b2a88; }
.guide-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-shrink: 0; }
.guide-heading h2 { margin: 0; font-size: .875rem; line-height: 1.5; }
.guide-heading button { flex-shrink: 0; min-width: 44px; min-height: 44px; }
.guide-content { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
label { display: block; font-size: .75rem; margin: .75rem 0 .4rem; }
textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; height: 12rem; min-height: 6rem; max-height: 45dvh; overflow: auto; padding: .625rem; border: 1px solid var(--line); border-radius: .4rem; font: .75rem/1.5 ui-monospace, monospace; }
.guide-actions { display: flex; margin-top: .75rem; }
.copy-status { min-height: 1.5em; margin: .5rem 0 0; font-size: .75rem; }
</style>
