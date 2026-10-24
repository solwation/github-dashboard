<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useLanguage } from "../lib/i18n";
import { COLUMN_SORT_OPTIONS, type ColumnSort } from "../lib/model";
const { t } = useLanguage();
/** Column sort menu (#286): the hint under the column title opens a small menu of that column's orders. */
const props = defineProps<{ column: string; modelValue: ColumnSort }>();
const emit = defineEmits<{ "update:modelValue": [value: ColumnSort] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const labels = (): Record<string, Record<string, { label: string; hint?: string }>> => ({
  backlog: {
    default: { label: t("Högst prioritet först") }, lowest: { label: t("Lägst prioritet först") },
    oldest: { label: t("Äldst först") }, newest: { label: t("Nyast först") },
  },
  progress: {
    default: { label: t("Längst pågående först"), hint: t("Tid sedan arbetet startade") },
    recent: { label: t("Senast startad först") }, priority: { label: t("Prioritet") },
  },
  closed: {
    default: { label: t("Nyast stängd först"), hint: t("Senaste 30 dagarna · nyast först") },
    oldest: { label: t("Äldst stängd först") }, priority: { label: t("Prioritet") },
  },
});
function optionLabel(sort: ColumnSort) { return labels()[props.column]![sort]!.label; }
function hint() { const o = labels()[props.column]![props.modelValue]!; return o.hint ?? o.label; }
const options = () => COLUMN_SORT_OPTIONS[props.column] ?? [];
const items = () => [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
function onOutside(event: Event) { if (!root.value?.contains(event.target as Node)) close(false); }
function close(refocus: boolean) {
  open.value = false;
  document.removeEventListener("pointerdown", onOutside, true);
  if (refocus) trigger.value?.focus();
}
async function show(focusIndex = Math.max(0, options().indexOf(props.modelValue))) {
  open.value = true;
  document.addEventListener("pointerdown", onOutside, true);
  await nextTick();
  items()[focusIndex]?.focus();
}
function toggle() { open.value ? close(true) : void show(); }
function choose(sort: ColumnSort) { emit("update:modelValue", sort); close(true); }
function move(delta: number | "first" | "last") {
  const all = items(), at = all.indexOf(document.activeElement as HTMLElement);
  all[delta === "first" ? 0 : delta === "last" ? all.length - 1 : (at + delta + all.length) % all.length]?.focus();
}
function onTriggerKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); void show(event.key === "ArrowUp" ? options().length - 1 : undefined); }
}
function onMenuKey(event: KeyboardEvent) {
  const keys: Record<string, number | "first" | "last"> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
  if (event.key in keys) { event.preventDefault(); move(keys[event.key]!); }
  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  else if (event.key === "Tab") close(false);
}
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutside, true));
</script>
<template>
  <div ref="root" class="column-sort">
    <button ref="trigger" type="button" class="column-hint column-sort-button" aria-haspopup="menu" :aria-expanded="open"
      :aria-label="t('Sortering: {order}', { order: hint() })" :title="t('Välj sortering')" @click="toggle" @keydown="onTriggerKey">
      <span>{{ hint() }}</span><ChevronDown :size="12" aria-hidden="true" />
    </button>
    <div v-if="open" ref="menu" class="column-sort-menu" role="menu" :aria-label="t('Sortering')" @keydown="onMenuKey">
      <button v-for="sort in options()" :key="sort" type="button" role="menuitemradio" :aria-checked="sort === modelValue"
        :tabindex="-1" @click="choose(sort)">{{ optionLabel(sort) }}</button>
    </div>
  </div>
</template>
