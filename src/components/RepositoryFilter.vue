<script setup lang="ts">
import { Search, X } from "@lucide/vue";
import { nextTick, ref } from "vue";
import { useLanguage } from "../lib/i18n";

const props = defineProps<{ repository: string; id: string }>();
const query = defineModel<string>();
const { t } = useLanguage();
const open = ref(Boolean(query.value));
const input = ref<HTMLInputElement>();
const trigger = ref<HTMLButtonElement>();
async function toggle() {
  open.value = !open.value;
  if (open.value) { await nextTick(); input.value?.focus(); }
}
function close() { open.value = false; trigger.value?.focus(); }
</script>

<template>
  <div class="repository-filter" :class="{ 'is-open': open, 'has-query': query }" @keydown.esc.stop.prevent="close">
    <button ref="trigger" type="button" class="icon-button repository-filter-toggle"
      :aria-label="t('Filtrera issues i {name}', { name: props.repository })"
      :title="query ? t('Aktivt filter: {query}', { query }) : t('Filtrera issues i {name}', { name: props.repository })"
      :aria-expanded="open" :aria-controls="id" @click="toggle">
      <Search :size="16" aria-hidden="true" />
      <span v-if="query" class="repository-filter-indicator" aria-hidden="true" />
      <span v-if="query" class="sr-only">{{ t('Aktivt filter: {query}', { query }) }}</span>
    </button>
    <div v-show="open" class="repository-search">
      <input :id="id" ref="input" v-model="query"
        :aria-label="t('Filtrera issues i {name}', { name: props.repository })"
        :placeholder="t('Sök issues, labels eller nummer…')" />
      <button type="button" class="icon-button repository-filter-clear" :disabled="!query"
        :aria-label="t('Rensa filtret för {name}', { name: props.repository })"
        :title="t('Rensa filtret för {name}', { name: props.repository })" @click="query = ''; input?.focus()">
        <X :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.repository-filter { display: flex; align-items: center; flex: 0 0 auto; min-width: 0; max-width: 100%; gap: var(--space-1); color: var(--muted); }
.repository-filter.is-open { flex: 0 1 13rem; }
.repository-filter-toggle { position: relative; flex: 0 0 auto; }
.has-query .repository-filter-toggle { color: var(--green); background: var(--hover); box-shadow: inset 0 0 0 1px var(--green); }
.repository-filter-indicator { position: absolute; right: var(--space-1); top: var(--space-1); width: var(--space-1); height: var(--space-1); border-radius: 50%; background: currentColor; }
.repository-search { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; border: 1px solid var(--input-border); border-radius: var(--space-1); }
.repository-search input { width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; outline: none; }
.repository-search:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.repository-filter-clear { flex: 0 0 auto; }
@media (pointer: coarse), (max-width: 650px), (max-width: 950px) and (max-height: 500px) {
  .repository-filter-toggle, .repository-filter-clear { min-width: 44px; min-height: 44px; }
}
</style>
