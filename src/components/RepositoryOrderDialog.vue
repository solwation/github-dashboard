<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { ArrowDown, ArrowUp, X } from "@lucide/vue";
import RepositoryOrderControls from "./RepositoryOrderControls.vue";
import { projectDragType } from "../lib/project-layout";
import type { SidebarRepository } from "../lib/sidebar";
import ExternalRepositoryForm from "./ExternalRepositoryForm.vue";
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";
const props = defineProps<{ repos: SidebarRepository[]; addExternal?: (input: string) => Promise<string | null> }>();
const emit = defineEmits<{ reorder: [source: string, target: string]; removeExternal: [name: string] }>();
// Two groups with their own order; a repository never moves between them.
const groups = computed(() => [
  { key: "own", repos: props.repos.filter(repo => !repo.external), heading: "" },
  { key: "external", repos: props.repos.filter(repo => repo.external), heading: "Andras publika projekt" },
].filter(group => group.repos.length));
const groupOf = (name: string) => props.repos.find(repo => repo.fullName === name)?.external ? "external" : "own";
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const announcement = ref("");
const titleId = useId();
const helpId = useId();
async function reorder(source: string, target: string) {
  if (source === target) return;
  const focused = document.activeElement as HTMLButtonElement | null;
  const row = focused?.closest("[data-repository]");
  if (groupOf(source) !== groupOf(target)) return;
  emit("reorder", source, target);
  await nextTick();
  const group = props.repos.filter(repo => Boolean(repo.external) === (groupOf(source) === "external"));
  announcement.value = t("{name} flyttad till plats {position} av {total}", {
    name: props.repos.find(repo => repo.fullName === source)?.name ?? source,
    position: group.findIndex(repo => repo.fullName === source) + 1,
    total: group.length,
  });
  // A move can disable the focused boundary button. Keep keyboard focus on its row.
  if (focused?.disabled) row?.querySelector<HTMLButtonElement>(".project-drag-handle")?.focus({ preventScroll: true });
}
function move(list: SidebarRepository[], index: number, direction: -1 | 1) {
  const source = list[index];
  const target = list[index + direction];
  if (source && target) void reorder(source.fullName, target.fullName);
}
function drop(event: DragEvent, target: string) {
  const source = event.dataTransfer?.getData(projectDragType);
  if (source) void reorder(source, target);
}
</script>
<template>
  <button ref="trigger" class="button small repository-order-open" aria-haspopup="dialog" @click="announcement = ''; dialog?.showModal()">{{ t("Ordna repositories") }}</button>
  <Teleport to="body">
    <dialog ref="dialog" class="repository-order-dialog" :aria-labelledby="titleId" :aria-describedby="helpId" @close="trigger?.focus()"
      @click="event => { if (event.target === dialog) dialog?.close(); }">
      <div class="order-heading">
        <h2 :id="titleId">{{ t("Ordna repositories") }}</h2>
        <button class="icon-button" :aria-label="t('Stäng')" :title="t('Stäng')" autofocus @click="dialog?.close()"><X :size="20" /></button>
      </div>
      <p :id="helpId">{{ t("Dra i handtaget eller använd upp- och nedknapparna. Ordningen sparas direkt.") }}</p>
      <div class="repository-order-list">
        <section v-for="group in groups" :key="group.key" :aria-labelledby="group.heading ? titleId + '-' + group.key : undefined">
          <h3 v-if="group.heading" :id="titleId + '-' + group.key" class="order-group-heading">{{ t(group.heading) }}</h3>
          <ol>
            <li v-for="(repo, index) in group.repos" :key="repo.fullName" :data-repository="repo.fullName" @dragover.prevent @drop.prevent="drop($event, repo.fullName)">
              <RepositoryOrderControls :name="repo.name" :full-name="repo.fullName" :index="index" :total="group.repos.length" @move="move(group.repos, index, $event)" @reorder="reorder" />
              <span class="order-repository-name">{{ repo.fullName }}</span>
              <button class="icon-button" :disabled="index === 0" :aria-label="t('Flytta {name} upp', { name: repo.name })" :title="t('Flytta {name} upp', { name: repo.name })" @click="move(group.repos, index, -1)"><ArrowUp :size="18" /></button>
              <button class="icon-button" :disabled="index === group.repos.length - 1" :aria-label="t('Flytta {name} ned', { name: repo.name })" :title="t('Flytta {name} ned', { name: repo.name })" @click="move(group.repos, index, 1)"><ArrowDown :size="18" /></button>
              <button v-if="repo.external" class="icon-button" :aria-label="t('Ta bort {name}', { name: repo.name })" :title="t('Ta bort {name}', { name: repo.name })" @click="emit('removeExternal', repo.fullName)"><X :size="18" /></button>
            </li>
          </ol>
        </section>
        <ExternalRepositoryForm v-if="addExternal" :add="addExternal" />
      </div>
      <span class="sr-only" role="status">{{ announcement }}</span>
      <div class="order-footer"><button class="button primary" @click="dialog?.close()">{{ t("Klart") }}</button></div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.repository-order-dialog { box-sizing: border-box; width: min(36rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; padding: 1rem; color: var(--text); background: var(--surface); }
.repository-order-dialog[open] { display: flex; flex-direction: column; }
.repository-order-dialog::backdrop { background: #102b2a88; }
.order-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-shrink: 0; }
h2 { margin: 0; font-size: 1rem; }
p { font-size: .8rem; line-height: 1.5; }
.repository-order-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 0; }
ol { margin: 0; padding: 0; list-style: none; }
.order-group-heading { margin: var(--space-4) 0 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
li { display: flex; align-items: center; gap: .25rem; padding: .4rem 0; border-bottom: 1px solid var(--line); }
.order-repository-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: .8rem; }
.icon-button { flex-shrink: 0; width: 44px; height: 44px; }
.icon-button:disabled { opacity: .3; cursor: default; }
.order-footer { display: flex; justify-content: flex-end; margin-top: 1rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
