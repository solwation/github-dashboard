<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";
const guideSource = __WORKFLOW_GUIDE__;
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const titleId = useId();
const fieldId = useId();
function show() {
  copyState.value = "idle";
  dialog.value?.showModal();
}
const guideHtml = computed(() => renderMarkdown(guideSource));
const guideUrl = new URL("ISSUEFLOW.md", new URL(import.meta.env.BASE_URL, window.location.href)).href;
const reference = computed(() => t("Läs och följ instruktionerna på {url} när du arbetar med issues i det här projektet.", { url: guideUrl }));
const field = ref<HTMLTextAreaElement | null>(null);
const copyState = ref<"idle" | "copied" | "manual">("idle");
async function copy() {
  try {
    await navigator.clipboard.writeText(reference.value);
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
      <div class="guide-content" tabindex="0" role="region" :aria-labelledby="titleId">
        <p>{{ t("ISSUEFLOW.md är en guide för dig och din AI-assistent. Den beskriver hur status, prioritet och labels på GitHub-issues används i dashboarden. Läs guiden här, eller kopiera hänvisningen till assistenten och följ instruktionerna i ditt projekt.") }}</p>
        <div class="workflow-document" lang="en" v-html="guideHtml" />
        <a class="guide-url" :href="guideUrl" target="_blank" rel="noopener noreferrer">{{ guideUrl }}</a>
        <label :for="fieldId">{{ t("Hänvisning för din AI-assistent") }}</label>
        <textarea :id="fieldId" ref="field" :value="reference" readonly rows="3" spellcheck="false" />
        <div class="guide-actions">
          <button class="button small" @click="copy">{{ t("Kopiera hänvisning") }}</button>
          <a class="button small" :href="guideUrl" download="ISSUEFLOW.md">{{ t("Ladda ned ISSUEFLOW.md") }}</a>
        </div>
        <p class="copy-status" role="status">
          <template v-if="copyState === 'copied'">{{ t("Hänvisningen har kopierats.") }}</template>
          <template v-else-if="copyState === 'manual'">{{ t("Kopiera den markerade hänvisningen manuellt.") }}</template>
        </p>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.workflow-guide-dialog { box-sizing: border-box; width: min(60rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: min(90dvh, calc(100dvh - 2rem)); overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; padding: 1.2rem; color: var(--text, #273a3c); background: white; }
.workflow-guide-dialog[open] { display: flex; flex-direction: column; }
.workflow-guide-dialog::backdrop { background: #102b2a88; }
.guide-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-shrink: 0; }
.guide-heading h2 { margin: 0; font-size: .875rem; line-height: 1.5; }
.guide-heading button { flex-shrink: 0; min-width: 44px; min-height: 44px; }
.guide-content { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.guide-content:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
p { line-height: 1.5; font-size: .875rem; }
.guide-url { display: block; overflow-wrap: anywhere; font-size: .875rem; margin: .75rem 0; }
label { display: block; font-size: .875rem; margin-bottom: .4rem; }
textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; min-height: 5rem; font: inherit; font-size: .875rem; line-height: 1.5; }
.guide-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
.copy-status { min-height: 1.5em; margin: .5rem 0 0; }
.workflow-document { border: 1px solid var(--line); border-radius: .5rem; padding: .75rem; font-size: .8125rem; line-height: 1.6; overflow-wrap: anywhere; }
.workflow-document :deep(h1) { font-size: 1rem; line-height: 1.4; margin: 0 0 .75rem; }
.workflow-document :deep(h2) { font-size: .875rem; line-height: 1.4; margin: 1.1rem 0 .5rem; }
.workflow-document :deep(p) { font-size: inherit; line-height: inherit; margin: .5rem 0; }
.workflow-document :deep(ul), .workflow-document :deep(ol) { padding-left: 1.25rem; }
.workflow-document :deep(li) { margin: .4rem 0; }
.workflow-document :deep(table) { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .75rem; }
.workflow-document :deep(th), .workflow-document :deep(td) { padding: .4rem; border: 1px solid var(--line); text-align: left; vertical-align: top; }
.workflow-document :deep(code) { font-size: .9em; white-space: break-spaces; }
.workflow-document :deep(pre) { white-space: pre-wrap; }
.workflow-document :deep(img) { max-width: 100%; }
</style>
