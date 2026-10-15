<script setup lang="ts">
import { computed, ref } from "vue";
import { useLanguage } from "../lib/i18n";
const { t } = useLanguage();
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
    <h3 id="workflow-guide-title">{{ t("Instruktioner för issueflödet") }}</h3>
    <p>{{ t("Dela den publika guiden med din AI-assistent eller lägg den i ditt projekt. Ingen inloggning krävs.") }}</p>
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
  </section>
</template>
<style scoped>
.workflow-guide { border-top: 1px solid var(--line); margin-top: 1.25rem; padding-top: 1rem; }
h3 { margin: 0; font-size: 1rem; }
p { line-height: 1.5; font-size: .875rem; }
.guide-url { display: block; overflow-wrap: anywhere; font-size: .875rem; margin: .75rem 0; }
label { display: block; font-size: .875rem; margin-bottom: .4rem; }
textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; min-height: 5rem; font: inherit; font-size: .875rem; line-height: 1.5; }
.guide-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
.copy-status { min-height: 1.5em; margin: .5rem 0 0; }
</style>
