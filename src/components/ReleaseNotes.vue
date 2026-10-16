<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { bundledReleaseNotes, noteLanguage, type ReleaseNoteDay } from "../lib/release-notes";

const props = withDefaults(defineProps<{ open: boolean; days?: ReleaseNoteDay[] }>(), {
  days: () => bundledReleaseNotes,
});
const emit = defineEmits<{ close: [] }>();
const { t, locale } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
const issueBase = "https://github.com/solwation/github-dashboard/issues/";
let opener: HTMLElement | null = null;

const language = computed(() => noteLanguage(locale.value));
const dateFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: "full", timeZone: "UTC" }),
);
function formatDate(date: string) {
  const text = dateFormat.value.format(new Date(date + "T00:00:00Z"));
  return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1);
}

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    const element = dialog.value;
    if (!element) return;
    if (open && !element.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      closeButton.value?.focus();
    } else if (!open && element.open) element.close();
  },
  { immediate: true },
);
function closed() {
  const target = opener;
  opener = null;
  if (target?.isConnected) target.focus();
  if (props.open) emit("close");
}
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
});
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="release-notes-dialog" :aria-labelledby="titleId" @close="closed">
      <div class="release-notes-heading">
        <h2 :id="titleId">{{ t("Versionsnyheter") }}</h2>
        <button ref="closeButton" type="button" class="icon-button" :aria-label="t('Stäng versionsnyheter')" @click="dialog?.close()">
          <X :size="20" aria-hidden="true" />
        </button>
      </div>
      <div class="release-notes-content" tabindex="0" role="region" :aria-labelledby="titleId" :lang="language">
        <p v-if="!days.length" class="release-notes-empty">{{ t("Det finns inga versionsnyheter ännu.") }}</p>
        <article v-for="day in days" :key="day.date" class="release-notes-day" :aria-labelledby="`${titleId}-${day.date}`">
          <h3 :id="`${titleId}-${day.date}`"><time :datetime="day.date">{{ formatDate(day.date) }}</time></h3>
          <p class="release-notes-summary">{{ day.summary[language] }}</p>
          <ul>
            <li v-for="(section, index) in day.sections" :key="index">
              <p>{{ section.text[language] }}</p>
              <p v-if="section.issues.length" class="release-notes-issues">
                <span>{{ t("Issues:") }}</span>
                <template v-for="(issue, position) in section.issues" :key="issue">
                  <a :href="issueBase + issue" target="_blank" rel="noopener noreferrer" :aria-label="t('Issue #{number} på GitHub', { number: issue })">#{{ issue }}</a><template v-if="position < section.issues.length - 1">, </template>
                </template>
              </p>
            </li>
          </ul>
        </article>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.release-notes-dialog { box-sizing: border-box; width: min(44rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: min(90dvh, calc(100dvh - 2rem)); overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; padding: 1.2rem; color: var(--text, #273a3c); background: white; }
.release-notes-dialog[open] { display: flex; flex-direction: column; animation: release-notes-in .18s ease-out; }
.release-notes-dialog::backdrop { background: #102b2a88; }
.release-notes-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-shrink: 0; }
.release-notes-heading h2 { margin: 0; font-size: 1rem; line-height: 1.5; }
.release-notes-heading button { flex-shrink: 0; min-width: 44px; min-height: 44px; }
.release-notes-content { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; overflow-wrap: anywhere; }
.release-notes-content:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.release-notes-day { border-top: 1px solid var(--line); margin-top: 1rem; padding-top: .75rem; }
.release-notes-day:first-child { border-top: 0; margin-top: .25rem; padding-top: 0; }
h3 { margin: 0 0 .4rem; font-size: .875rem; line-height: 1.4; }
p { margin: .4rem 0; font-size: .875rem; line-height: 1.55; }
.release-notes-summary { font-weight: 600; }
ul { margin: .5rem 0 0; padding-left: 1.2rem; }
li { margin: .6rem 0; }
li p:first-child { margin-top: 0; }
.release-notes-issues { color: var(--muted); font-size: .75rem; margin-top: .15rem; }
.release-notes-issues span { margin-right: .3rem; }
.release-notes-empty { color: var(--muted); }
@keyframes release-notes-in { from { opacity: 0; transform: translateY(.5rem); } to { opacity: 1; transform: none; } }
@media (max-width: 650px) {
  .release-notes-dialog { width: calc(100vw - 1rem); max-width: calc(100vw - 1rem); max-height: calc(100dvh - 1rem); padding: .9rem; }
}
@media (prefers-reduced-motion: reduce) {
  .release-notes-dialog[open] { animation: none; }
}
</style>
