<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { MessageCircle, X } from "@lucide/vue";
import CommentImages from "./CommentImages.vue";
import { useLanguage } from "../lib/i18n";
import { useMarkdown } from "../lib/lazy-markdown";
import { commentTimeLabel } from "../lib/time";
import type { Issue, IssueComment } from "../lib/model";

const props = defineProps<{
  issue: Issue;
  count: number;
  newComments?: number;
  demo?: boolean;
  loadComments?: (issue: Issue) => Promise<IssueComment[]>;
  session?: number;
}>();
const emit = defineEmits<{ read: [] }>();
const { t, locale } = useLanguage();
const hasNew = computed(() => Boolean(props.newComments && props.newComments > 0));
const buttonLabel = computed(() => {
  if (!hasNew.value) return t("{count} kommentarer", { count: props.count });
  return props.newComments === 1
    ? t("{count} kommentarer, 1 ny", { count: props.count })
    : t("{count} kommentarer, {unread} nya", { count: props.count, unread: props.newComments! });
});
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
const open = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
const state = ref<"loading" | "loaded" | "error">("loading");
const comments = ref<IssueComment[]>([]);
const markdown = useMarkdown();
// Comments wait for the lazily loaded Markdown renderer unless that chunk could not be loaded.
const renderPending = computed(() => !markdown.renderer.value && !markdown.failed.value);
let revision = 0;
const rendered = computed(() => [...comments.value].sort((a, b) => {
  const first = Date.parse(a.created_at), second = Date.parse(b.created_at);
  return (Number.isFinite(second) ? second : -Infinity) - (Number.isFinite(first) ? first : -Infinity) || 0;
}).map(comment => ({ ...comment, markdown: markdown.renderer.value?.(comment.body) })));
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
async function show() {
  if (open.value) return;
  now.value = Date.now();
  clock = setInterval(() => { now.value = Date.now(); }, 10000);
  open.value = true;
  await nextTick();
  if (!open.value) return;
  dialog.value?.showModal();
  emit("read");
  void markdown.load();
  void load();
}
// Lazy thumbnails grow while a native End scroll animates, so End would stop short of the newest content.
const commentsBody = ref<HTMLElement>();
let endObserver: ResizeObserver | undefined;
function scrollToEnd() {
  if (commentsBody.value) commentsBody.value.scrollTop = commentsBody.value.scrollHeight;
}
function releaseEnd() {
  endObserver?.disconnect();
  endObserver = undefined;
}
function bodyKeydown(event: KeyboardEvent) {
  if (event.key !== "End" || event.altKey || event.shiftKey || event.metaKey) { releaseEnd(); return; }
  const content = commentsBody.value?.firstElementChild;
  if (!content) return;
  event.preventDefault();
  scrollToEnd();
  releaseEnd();
  endObserver = new ResizeObserver(scrollToEnd);
  endObserver.observe(content);
}
function clear() {
  releaseEnd();
  clearInterval(clock);
  clock = undefined;
  revision++;
  open.value = false;
  comments.value = [];
}
function close() { clear(); dialog.value?.close(); }
watch([() => props.issue.id, () => props.issue.html_url, () => props.demo, () => props.session], close);
onBeforeUnmount(clear);
</script>
<template>
  <button
    type="button"
    class="comment-count"
    :class="{ 'has-new-comments': hasNew }"
    :aria-label="buttonLabel"
    aria-haspopup="dialog"
    @click="show"
  >
    <MessageCircle :size="13" aria-hidden="true" :class="['comment-icon', { 'comment-icon-animated': hasNew }]" />
    <span class="comment-count-value">{{ count }}</span>
    <span v-if="hasNew" class="new-comments-badge" aria-hidden="true">+{{ newComments }}</span>
  </button>
  <dialog ref="dialog" class="comments-dialog" :aria-labelledby="titleId" @cancel="clear" @close="clear">
    <template v-if="open">
      <div class="comments-heading">
        <h2 :id="titleId">{{ t('Kommentarer för #{number}', { number: issue.number }) }}</h2>
        <button type="button" class="close-comments" :aria-label="t('Stäng kommentarer')" :title="t('Stäng kommentarer')" autofocus @click="close"><X :size="20" /></button>
      </div>
      <p class="comments-issue-title">{{ issue.title }}</p>
      <div ref="commentsBody" class="comments-body" role="region" :aria-labelledby="titleId" tabindex="0"
        @keydown="bodyKeydown" @wheel.passive="releaseEnd" @pointerdown="releaseEnd" @touchstart.passive="releaseEnd">
        <p v-if="demo" class="comments-status">{{ t('Kommentarer visas inte i demon. Anslut GitHub för att läsa dina issuediskussioner.') }}</p>
        <div v-else aria-live="polite" :aria-busy="state === 'loading' || renderPending">
          <p v-if="state === 'loading' || (renderPending && comments.length)" class="comments-status">{{ t('Hämtar kommentarer…') }}</p>
          <div v-else-if="state === 'error'" class="comments-status">
            <p role="alert">{{ t('Kommentarerna kunde inte hämtas. Kontrollera anslutningen och din åtkomst till repot.') }}</p>
            <button type="button" class="retry-comments" @click="load">{{ t('Försök igen') }}</button>
          </div>
          <template v-else>
            <p v-if="!comments.length" class="comments-status">{{ t('Inga kommentarer ännu.') }}</p>
            <article v-for="comment in rendered" :key="comment.id" class="issue-comment">
              <div class="comment-meta">
                <strong>{{ comment.user?.login || t('Raderad användare') }}</strong>
                <time :datetime="Number.isFinite(Date.parse(comment.created_at)) ? comment.created_at : undefined"
                  :title="dateLabel(comment.created_at)" :aria-label="dateLabel(comment.created_at)" aria-live="off">{{ commentTimeLabel(comment.created_at, now, locale) }}</time>
                <a v-if="safeUrl(comment.html_url)" :href="safeUrl(comment.html_url)" target="_blank" rel="noopener noreferrer">{{ t('Visa på GitHub') }}</a>
              </div>
              <div v-if="comment.body?.trim() && comment.markdown !== undefined" class="comment-markdown"><CommentImages :html="comment.markdown" /></div>
              <p v-else-if="comment.body?.trim()" class="comment-markdown plain-comment">{{ comment.body }}</p>
              <p v-else class="comments-status">{{ t('Kommentaren saknar text.') }}</p>
            </article>
          </template>
        </div>
      </div>
    </template>
  </dialog>
</template>
<style scoped>
.comment-count { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem; border: 0; background: transparent; color: var(--muted); font-size: .72rem; font-variant-numeric: tabular-nums; cursor: pointer; min-height: 32px; border-radius: .4rem; }
.comment-count.has-new-comments { color: var(--green); font-weight: 600; }
.comment-icon { flex-shrink: 0; transition: transform .2s ease; }
.comment-icon-animated {
  animation: comment-bounce 1.6s ease-in-out infinite;
  color: var(--green);
}
.new-comments-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: .65rem;
  font-weight: 700;
  line-height: 1;
  padding: .12rem .35rem;
  border-radius: 999px;
  background: var(--green);
  color: #fff;
  letter-spacing: -.02em;
}
:root[data-theme="dark"] .new-comments-badge {
  color: #102b2a;
}
@keyframes comment-bounce {
  0%, 100% { transform: translateY(0) scale(1); }
  20% { transform: translateY(-2.5px) scale(1.18); }
  40% { transform: translateY(0) scale(1); }
  60% { transform: translateY(-1px) scale(1.08); }
}
@media (prefers-reduced-motion: reduce) {
  .comment-icon-animated {
    animation: none;
  }
}
button:focus-visible, a:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.comments-dialog { box-sizing: border-box; width: min(44rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; padding: 1.2rem; color: var(--text); background: var(--surface); }
.comments-dialog[open] { display: flex; flex-direction: column; }
.comments-body { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.comments-body:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.comments-dialog::backdrop { background: #102b2a88; }
.comments-heading { flex-shrink: 0; min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
h2 { overflow-wrap: anywhere; min-width: 0; font-size: 1rem; line-height: 1.5; margin: .4rem 0; }
.close-comments { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; background: transparent; border-radius: .4rem; cursor: pointer; }
.comments-issue-title { flex-shrink: 0; margin: 0 0 1rem; overflow-wrap: anywhere; color: var(--muted); font-size: .85rem; }
.comments-status { font-size: .85rem; line-height: 1.6; color: var(--muted); }
.retry-comments { border: 1px solid var(--line); border-radius: .4rem; padding: .6rem .8rem; background: var(--surface); color: var(--green); cursor: pointer; }
.issue-comment { min-width: 0; padding: 1rem 0; border-top: 1px solid var(--line); }
.comment-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .8rem; font-size: .72rem; overflow-wrap: anywhere; }
.comment-meta time { color: var(--muted); }
.comment-meta a, .comment-markdown :deep(a) { color: var(--green); text-decoration: underline; }
.comment-markdown { font-size: .85rem; line-height: 1.65; overflow-wrap: anywhere; }
.plain-comment { white-space: pre-wrap; }
.comment-markdown :deep(h1), .comment-markdown :deep(h2), .comment-markdown :deep(h3) { font-size: 1rem; }
.comment-markdown :deep(h4), .comment-markdown :deep(h5), .comment-markdown :deep(h6) { font-size: .9rem; }
.comment-markdown :deep(pre) { box-sizing: border-box; max-width: 100%; overflow-x: auto; padding: .7rem; background: var(--code-bg); white-space: pre; overflow-wrap: normal; border-radius: .4rem; }
.comment-markdown :deep(code) { font-size: .78rem; background: var(--code-bg); }
.comment-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.comment-markdown :deep(th), .comment-markdown :deep(td) { border: 1px solid var(--line); padding: .3rem; }
.comment-markdown :deep(blockquote) { margin-left: 0; padding-left: .7rem; border-left: 3px solid var(--line); color: var(--muted); }
@media (pointer: coarse) {
  .comment-count { min-height: 44px; min-width: 44px; justify-content: center; }
}
</style>
