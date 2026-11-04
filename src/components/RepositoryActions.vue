<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from "vue";
import { Ellipsis, Eye, EyeOff, Globe, Lock, SquareArrowOutUpRight } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { SidebarRepository } from "../lib/sidebar";
const props = defineProps<{ repository: SidebarRepository; hidden: boolean; canToggle: boolean }>();
const emit = defineEmits<{ toggleVisibility: [] }>();
const { t } = useLanguage();
const id = "repository-actions-" + useId();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
let initialFocusLast = false;
const menuItems = () => [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(item => !item.hasAttribute("disabled"));
function position() {
  if (!open.value || !menu.value || !trigger.value) return;
  const row = trigger.value.closest(".sidebar-repository-row")!.getBoundingClientRect();
  const box = menu.value.getBoundingClientRect();
  const gutter = parseFloat(getComputedStyle(trigger.value).getPropertyValue("--space-2")) || 8;
  const left = Math.max(gutter, Math.min(row.right + gutter, innerWidth - box.width - gutter));
  const top = Math.max(gutter, Math.min(row.top, innerHeight - box.height - gutter));
  menu.value.style.left = left + "px"; menu.value.style.top = top + "px";
}
function close(refocus = false) {
  open.value = false;
  window.removeEventListener("resize", anchorMoved); document.removeEventListener("scroll", anchorMoved, true);
  if (menu.value?.matches(":popover-open")) menu.value.hidePopover();
  if (refocus) trigger.value?.focus();
}
async function toggled() {
  open.value = menu.value?.matches(":popover-open") ?? false;
  if (open.value) {
    window.addEventListener("resize", anchorMoved); document.addEventListener("scroll", anchorMoved, true);
    position(); await nextTick(); (initialFocusLast ? menuItems().at(-1) : menuItems()[0])?.focus(); initialFocusLast = false;
  } else { window.removeEventListener("resize", anchorMoved); document.removeEventListener("scroll", anchorMoved, true); }
}
function move(delta: number | "first" | "last") {
  const items = menuItems(), at = items.indexOf(document.activeElement as HTMLElement);
  items[delta === "first" ? 0 : delta === "last" ? items.length - 1 : (at + delta + items.length) % items.length]?.focus();
}
function onMenuKey(event: KeyboardEvent) {
  const keys: Record<string, number | "first" | "last"> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
  if (event.key in keys) { event.preventDefault(); move(keys[event.key]!); }
  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  else if (event.key === "Tab") close();
}
function onRootKey(event: KeyboardEvent) {
  if (event.key === "Escape" && menu.value?.matches(":popover-open")) { event.preventDefault(); event.stopPropagation(); close(true); }
}
function onTriggerKey(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault(); initialFocusLast = event.key === "ArrowUp";
  if (menu.value?.matches(":popover-open")) move(initialFocusLast ? "last" : "first"); else menu.value?.showPopover();
}
function focusLeft(event: FocusEvent) {
  const target = event.relatedTarget;
  if (target instanceof Node && !menu.value?.contains(target) && target !== trigger.value) close();
}
function visibility() { close(true); emit("toggleVisibility"); }
// Top-layer menus cannot be clipped by the sidebar scroller. Dismiss if their anchor moves.
function anchorMoved(event: Event) { if (event.target instanceof Node && menu.value?.contains(event.target)) return; if (open.value) close(); }
onBeforeUnmount(() => { close(); window.removeEventListener("resize", anchorMoved); document.removeEventListener("scroll", anchorMoved, true); });
</script>
<template>
  <div class="repository-actions" @keydown="onRootKey">
    <button ref="trigger" type="button" class="repository-actions-trigger" :popovertarget="id" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id"
      :aria-label="t('Åtgärder för {name}', { name: repository.fullName })" :title="t('Åtgärder för {name}', { name: repository.fullName })" @keydown="onTriggerKey">
      <span class="repository-actions-cue"><Ellipsis :size="16" aria-hidden="true" /></span>
    </button>
    <div :id="id" ref="menu" popover="auto" class="repository-actions-menu" role="menu" :aria-label="t('Åtgärder för {name}', { name: repository.fullName })" @toggle="toggled" @keydown="onMenuKey" @focusout="focusLeft">
      <strong class="repository-actions-name">{{ repository.fullName }}</strong>
      <span v-if="repository.private && !repository.pagesUrl" class="repo-visibility" :aria-label="t('Privat repository')"><Lock :size="16" aria-hidden="true" />{{ t("Privat repository") }}</span>
      <a class="repo-github" role="menuitem" :aria-label="t('Öppna {repo} på GitHub', { repo: repository.fullName })" :href="`https://github.com/${repository.fullName}`" target="_blank" rel="noopener" :title="t('Öppna {repo} på GitHub', { repo: repository.fullName })" @click="close(true)"><SquareArrowOutUpRight :size="16" aria-hidden="true" />{{ t("Öppna {repo} på GitHub", { repo: repository.fullName }) }}</a>
      <a v-if="repository.pagesUrl" class="repo-pages" role="menuitem" :aria-label="t('Öppna GitHub Pages för {repo}', { repo: repository.fullName })" :href="repository.pagesUrl" target="_blank" rel="noopener" :title="t('Öppna GitHub Pages för {repo}', { repo: repository.fullName })" @click="close(true)"><Globe :size="16" aria-hidden="true" />{{ t("Öppna GitHub Pages för {repo}", { repo: repository.fullName }) }}</a>
      <button v-if="canToggle" type="button" class="repo-board-toggle" role="menuitem" @click="visibility"><component :is="hidden ? Eye : EyeOff" :size="16" aria-hidden="true" />{{ t(hidden ? "Visa {name} i innehållsvyn" : "Dölj {name} i innehållsvyn", { name: repository.fullName }) }}</button>
      <slot />
    </div>
  </div>
</template>
<style scoped>
.repository-actions { position: absolute; inset: 0 auto auto 0; width: var(--sidebar-project-icon-size); height: var(--sidebar-project-icon-size); }
.repository-actions-trigger { position: relative; width: 100%; height: 100%; padding: 0; border: 0; border-radius: var(--space-1); background: transparent; color: var(--text); cursor: pointer; opacity: 0; }
.repository-actions-trigger[aria-expanded="true"], .repository-actions-trigger:focus-visible { opacity: 1; }
.repository-actions-trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.repository-actions-cue { position: absolute; right: 0; top: 0; width: var(--icon-md); height: var(--icon-md); display: grid; place-items: center; border: 1px solid var(--line); border-radius: var(--space-1); background: var(--surface); }
.repository-actions-menu { position: fixed; inset: auto; margin: 0; width: min(20rem, calc(100vw - var(--space-4))); max-height: calc(100dvh - var(--space-4)); overflow: auto; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--space-2); background: var(--surface); color: var(--text); box-shadow: 0 var(--space-2) var(--space-6) color-mix(in srgb, var(--text) 15%, transparent); }
.repository-actions-name { display: block; padding: var(--space-2); font-size: 12px; overflow-wrap: anywhere; }
.repo-visibility { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); font-size: 12px; color: var(--muted); }
.repository-actions-menu [role="menuitem"] { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 44px; padding: var(--space-2); border: 0; border-radius: var(--space-1); background: transparent; color: var(--text); font: inherit; font-size: 13px; line-height: 1.5; text-align: left; text-decoration: none; overflow-wrap: anywhere; }
.repository-actions-menu [role="menuitem"]:hover, .repository-actions-menu [role="menuitem"]:focus-visible { background: var(--hover); outline: 2px solid var(--focus); outline-offset: -2px; }
.repository-actions-menu svg { flex: 0 0 var(--icon-sm); }
@media (pointer: coarse), (hover: none) { .repository-actions-trigger { opacity: 1; } .repository-actions-menu [role="menuitem"] { font-size: 14px; } }
</style>
