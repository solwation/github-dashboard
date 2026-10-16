<script setup lang="ts">
import { computed, ref } from "vue";
import { useLanguage } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";
import guideSource from "../../public/ISSUEFLOW.md?raw";
const { t } = useLanguage();
const expanded = ref(false);
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
  <section class="workflow-guide" aria-labelledby="workflow-guide-title">
    <details @toggle="expanded = ($event.target as HTMLDetailsElement).open">
      <summary :aria-expanded="expanded"><h3 id="workflow-guide-title">{{ t("Instruktioner för issueflödet") }}</h3></summary>
      <div class="guide-content">
    <p>{{ t("ISSUEFLOW.md är en guide för dig och din AI-assistent. Den beskriver hur status, prioritet och labels på GitHub-issues används i dashboarden. Läs guiden här, eller kopiera hänvisningen till assistenten och följ instruktionerna i ditt projekt.") }}</p>
    <div class="workflow-document" lang="en" v-html="guideHtml" />
    <a class="guide-url" :href="guideUrl" target="_blank" rel="noopener noreferrer">{{ guideUrl }}</a>
    <label for="workflow-guide-reference">{{ t("Hänvisning för din AI-assistent") }}</label>
    <textarea id="workflow-guide-reference" ref="field" :value="reference" readonly rows="3" spellcheck="false" />
    <div class="guide-actions">
      <button class="button small" @click="copy">{{ t("Kopiera hänvisning") }}</button>
      <a class="button small" :href="guideUrl" download="ISSUEFLOW.md">{{ t("Ladda ned ISSUEFLOW.md") }}</a>
    </div>
    <p class="copy-status" role="status">
      <template v-if="copyState === 'copied'">{{ t("Hänvisningen har kopierats.") }}</template>
      <template v-else-if="copyState === 'manual'">{{ t("Kopiera den markerade hänvisningen manuellt.") }}</template>
    </p>
      </div>
    </details>
  </section>
</template>
<style scoped>
.workflow-guide { border-top: 1px solid var(--line); margin-top: 1.25rem; padding-top: 1rem; }
summary { cursor: pointer; font-size: .875rem; }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: .25rem; }
h3 { display: inline; margin: 0; font-size: .875rem; font-weight: 600; }
.guide-content { min-width: 0; }
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
