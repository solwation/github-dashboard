<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { ChevronDown, ChevronUp } from "@lucide/vue";
import IssueComments from "./IssueComments.vue";
import type { Issue, IssueComment } from "../lib/model";
import { useLanguage } from "../lib/i18n";
import { useMarkdown } from "../lib/lazy-markdown";

const props = defineProps<{ body?: string | null; comments?: number; newComments?: number; issue: Issue; demo?: boolean; defaultExpanded?: boolean; hideToggle?: boolean; loadComments?: (issue: Issue) => Promise<IssueComment[]>; commentsSession?: number }>();
const emit = defineEmits<{ read: [] }>();
function toggle() {
  expanded.value = !expanded.value;
  if (!expanded.value) return;
  emit("read");
}
const markdown = useMarkdown();
const { t } = useLanguage();
const expanded = ref(Boolean(props.defaultExpanded));
watch(() => props.defaultExpanded, value => { if (value) expanded.value = true; });
watch([expanded, () => props.body], ([open, body]) => { if (open && body?.trim()) void markdown.load(); }, { immediate: true });
const panelId = useId();
const count = computed(() => Math.max(0, Math.floor(props.comments ?? 0)));
const rendered = computed(() => expanded.value && markdown.renderer.value ? markdown.renderer.value(props.body) : "");
</script>
<template>
  <div class="issue-details">
    <div class="details-toolbar">
      <button v-if="!hideToggle" type="button" class="details-toggle" :aria-expanded="expanded" :aria-controls="panelId" @click="toggle">
        {{ expanded ? t("Visa mindre") : t("Läs mer") }}<ChevronUp v-if="expanded" :size="13" /><ChevronDown v-else :size="13" />
      </button>
      <IssueComments :issue="issue" :count="count" :new-comments="newComments" :load-comments="loadComments" :session="commentsSession" :demo="demo" @read="emit('read')" />
    </div>
    <section v-if="expanded" :id="panelId" class="details-panel" :aria-label="t('Beskrivning')">
      <template v-if="body?.trim()">
        <div v-if="markdown.renderer.value" class="issue-markdown" v-html="rendered" />
        <!-- Without the Markdown chunk (offline before it was cached), show the source as safe plain text. -->
        <p v-else-if="markdown.failed.value" class="issue-markdown plain-description">{{ body }}</p>
        <p v-else class="empty-description" role="status" aria-busy="true">{{ t("Hämtar beskrivning…") }}</p>
      </template>
      <p v-else class="empty-description">{{ t("Ingen beskrivning har lagts till.") }}</p>
    </section>
  </div>
</template>
<style scoped>
.issue-details { min-width: 0; margin-top: .7rem; }
.details-toolbar { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
.details-toolbar > :last-child { margin-left: auto; }
.details-toggle { display: inline-flex; align-items: center; gap: .3rem; padding: .2rem 0; border: 0; background: transparent; color: var(--green); cursor: pointer; font-size: .72rem; font-weight: 600; }
.details-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.details-panel { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--line); min-width: 0; max-width: 100%; }
.issue-markdown, .empty-description { font-size: .78rem; line-height: 1.6; overflow-wrap: anywhere; }
.empty-description { color: var(--muted); margin: 0; }
.plain-description { margin: 0; white-space: pre-wrap; }
.issue-markdown :deep(> :first-child) { margin-top: 0; }
.issue-markdown :deep(> :last-child) { margin-bottom: 0; }
.issue-markdown :deep(h1), .issue-markdown :deep(h2), .issue-markdown :deep(h3) { font-size: .95rem; line-height: 1.4; margin: .8rem 0 .4rem; }
.issue-markdown :deep(h4), .issue-markdown :deep(h5), .issue-markdown :deep(h6) { font-size: .85rem; }
.issue-markdown :deep(p) { margin: .5rem 0; }
.issue-markdown :deep(ul), .issue-markdown :deep(ol) { padding-left: 1.3rem; margin: .5rem 0; }
.issue-markdown :deep(pre) { max-width: 100%; overflow-x: auto; padding: .65rem; border-radius: .4rem; background: var(--code-bg); white-space: pre; overflow-wrap: normal; }
.issue-markdown :deep(code) { font-size: .72rem; background: var(--code-bg); border-radius: .2rem; }
.issue-markdown :deep(pre code) { background: transparent; }
.issue-markdown :deep(a) { color: var(--green); text-decoration: underline; }
.issue-markdown :deep(img) { max-width: 100%; height: auto; }
.issue-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.issue-markdown :deep(th), .issue-markdown :deep(td) { padding: .3rem; border: 1px solid var(--line); }
.issue-markdown :deep(blockquote) { padding-left: .6rem; margin-left: 0; border-left: 3px solid var(--line); color: var(--muted); }
.issue-markdown :deep(input[type="checkbox"]) { width: .8rem; height: .8rem; vertical-align: middle; accent-color: var(--green); }
</style>
