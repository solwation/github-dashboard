<script setup lang="ts">
import { computed } from "vue";
import { Columns3, Rows3, SquareSplitVertical, StretchHorizontal } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { BoardGrouping } from "../lib/board-grouping";
const { t } = useLanguage();
/**
 * Grouping choice (#390): None, Split and Swimlanes share the board-mode toggle's segmented
 * pattern. Swimlanes are rows in Cards and columns in List, so its icon follows the mode.
 */
const props = defineProps<{ modelValue: BoardGrouping; list: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: BoardGrouping] }>();
const options = computed(() => [
  { value: "none" as const, label: t("Ingen"), hint: t("En gemensam board utan gruppering"), icon: StretchHorizontal },
  { value: "split" as const, label: t("Dela upp"), hint: t("En separat board per repository"), icon: SquareSplitVertical },
  { value: "swimlanes" as const, label: t("Simbanor"),
    hint: props.list ? t("En gemensam lista med en kolumn per repository") : t("En gemensam board med en rad per repository"),
    icon: props.list ? Columns3 : Rows3 },
]);
</script>
<template>
  <div class="board-grouping-toggle" role="group" :aria-label="t('Gruppering per repository')">
    <button v-for="option in options" :key="option.value" type="button" :aria-pressed="modelValue === option.value"
      :title="option.hint" @click="emit('update:modelValue', option.value)">
      <component :is="option.icon" :size="16" aria-hidden="true" /><span class="board-grouping-text">{{ option.label }}</span>
    </button>
  </div>
</template>
