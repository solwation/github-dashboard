<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { MessageCircle, X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";
import type { Issue, IssueComment } from "../lib/model";

const props = defineProps<{
  issue: Issue;
  count: number;
  demo?: boolean;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
  session?: number;
}>();
const emit = defineEmits<{ read: [] }>();
const { t, locale } = useLanguage();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
const open = ref(false);
const state = ref<"loading" | "loaded" | "error">("loading");
const comments = ref<IssueComment[]>([]);
let revision = 0;
const rendered = computed(() => comments.value.map(comment => ({ ...comment, markdown: renderMarkdown(comment.body) })));
function safeUrl(value: string) {
  try { const url = new URL(value); return url.origin === "https://github.com" ? url.href : undefined; }
  catch { return undefined; }
}
function dateLabel(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale.value) : t("Okänd tid");
}
async function load() {
  const current = ++revision;
  comments.value = [];
  state.value = "loading";
  if (props.demo) { state.value = "loaded"; return; }
  try {
    if (!props.loadComments) throw new Error("Unavailable");
    const result = await props.loadComments(props.issue);
    if (!open.value || current !== revision) return;
    comments.value = result;
    state.value = "loaded";
  } catch {
    if (open.value && current === revision) state.value = "error";
  }
}
function show() {
  dialog.value?.showModal();
  open.value = true;
  emit("read");
  void load();
}
function clear() {
  revision++;
  open.value = false;
  comments.value = [];
}
function close() { clear(); dialog.value?.close(); }
watch(() => [props.issue.id, props.issue.html_url, props.demo, props.session], close);
onBeforeUnmount(clear);
</script>
<template>
  <button type="button" class="comment-count" :aria-label="t('{count} kommentarer', { count })" aria-haspopup="dialog" @click="show">
    <MessageCircle :size="13" aria-hidden="true" />{{ count }}
  </button>
  <dialog ref="dialog" class="comments-dialog" :aria-labelledby="titleId" @cancel="clear" @close="clear">
    <template v-if="open">
      <div class="comments-heading">
        <h2 :id="titleId">{{ t('Kommentarer för #{number}', { number: issue.number }) }}</h2>
        <button type="button" class="close-comments" :aria-label="t('Stäng kommentarer')" autofocus @click="close"><X :size="20" /></button>
      </div>
      <p class="comments-issue-title">{{ issue.title }}</p>
      <p v-if="demo" class="comments-status">{{ t('Kommentarer visas inte i demon. Anslut GitHub för att läsa dina issuediskussioner.') }}</p>
      <div v-else aria-live="polite" :aria-busy="state === 'loading'">
        <p v-if="state === 'loading'" class="comments-status">{{ t('Hämtar kommentarer…') }}</p>
        <div v-else-if="state === 'error'" class="comments-status">
          <p role="alert">{{ t('Kommentarerna kunde inte hämtas. Kontrollera anslutningen och din åtkomst till repot.') }}</p>
          <button type="button" class="retry-comments" @click="load">{{ t('Försök igen') }}</button>
        </div>
        <template v-else>
          <p v-if="!comments.length" class="comments-status">{{ t('Inga kommentarer ännu.') }}</p>
          <article v-for="comment in rendered" :key="comment.id" class="issue-comment">
            <div class="comment-meta">
              <strong>{{ comment.user?.login || t('Raderad användare') }}</strong>
              <time :datetime="comment.created_at">{{ dateLabel(comment.created_at) }}</time>
              <a v-if="safeUrl(comment.html_url)" :href="safeUrl(comment.html_url)" target="_blank" rel="noopener noreferrer">{{ t('Visa på GitHub') }}</a>
            </div>
            <div v-if="comment.body?.trim()" class="comment-markdown" v-html="comment.markdown" />
            <p v-else class="comments-status">{{ t('Kommentaren saknar text.') }}</p>
          </article>
        </template>
      </div>
    </template>
  </dialog>
</template>
<style scoped>
.comment-count { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem; border: 0; background: transparent; color: var(--muted); font-size: .72rem; font-variant-numeric: tabular-nums; cursor: pointer; min-height: 32px; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.comments-dialog { box-sizing: border-box; width: min(44rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); overflow-y: auto; border: 1px solid var(--line); border-radius: .8rem; padding: 1.2rem; color: #273a3c; background: white; }
.comments-dialog::backdrop { background: #102b2a88; }
.comments-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
h2 { font-size: 1rem; line-height: 1.5; margin: .4rem 0; }
.close-comments { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; background: transparent; border-radius: .4rem; cursor: pointer; }
.comments-issue-title { margin: 0 0 1rem; overflow-wrap: anywhere; color: var(--muted); font-size: .85rem; }
.comments-status { font-size: .85rem; line-height: 1.6; color: var(--muted); }
.retry-comments { border: 1px solid var(--line); border-radius: .4rem; padding: .6rem .8rem; background: white; color: var(--green); cursor: pointer; }
.issue-comment { min-width: 0; padding: 1rem 0; border-top: 1px solid var(--line); }
.comment-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .8rem; font-size: .72rem; overflow-wrap: anywhere; }
.comment-meta time { color: var(--muted); }
.comment-meta a, .comment-markdown :deep(a) { color: var(--green); text-decoration: underline; }
.comment-markdown { font-size: .85rem; line-height: 1.65; overflow-wrap: anywhere; }
.comment-markdown :deep(h1), .comment-markdown :deep(h2), .comment-markdown :deep(h3) { font-size: 1rem; }
.comment-markdown :deep(h4), .comment-markdown :deep(h5), .comment-markdown :deep(h6) { font-size: .9rem; }
.comment-markdown :deep(pre) { max-width: 100%; overflow-x: auto; padding: .7rem; background: #f1f5f4; white-space: pre; overflow-wrap: normal; border-radius: .4rem; }
.comment-markdown :deep(code) { font-size: .78rem; background: #f1f5f4; }
.comment-markdown :deep(img) { max-width: 100%; height: auto; }
.comment-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.comment-markdown :deep(th), .comment-markdown :deep(td) { border: 1px solid var(--line); padding: .3rem; }
.comment-markdown :deep(blockquote) { margin-left: 0; padding-left: .7rem; border-left: 3px solid var(--line); color: var(--muted); }
@media (pointer: coarse) {
  .comment-count { min-height: 44px; min-width: 44px; justify-content: center; }
}
</style>
