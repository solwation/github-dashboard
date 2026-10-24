<script setup lang="ts">
import { LayoutGrid, List } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
const { t } = useLanguage();
/** Card/list switch (#127): two toggle buttons whose pressed state shows the active mode. */
defineProps<{ list: boolean; label: string }>();
const emit = defineEmits<{ "update:list": [value: boolean] }>();
</script>
<template>
  <div class="board-mode-toggle" role="group" :aria-label="label">
    <button type="button" :aria-pressed="!list" :title="t('Kort')" @click="emit('update:list', false)">
      <LayoutGrid :size="16" aria-hidden="true" /><span class="board-mode-text">{{ t("Kort") }}</span>
    </button>
    <button type="button" :aria-pressed="list" :title="t('Lista')" @click="emit('update:list', true)">
      <List :size="16" aria-hidden="true" /><span class="board-mode-text">{{ t("Lista") }}</span>
    </button>
  </div>
</template>
