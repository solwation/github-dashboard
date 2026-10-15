<script setup lang="ts">
import { ArrowDown, ArrowUp, GripVertical } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { projectDragType } from "../lib/project-layout";
const props = defineProps<{ name: string; fullName: string; index: number; total: number }>();
const emit = defineEmits<{ move: [direction: -1 | 1] }>();
const { t } = useLanguage();
function startDrag(event: DragEvent) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(projectDragType, props.fullName);
}
function keyMove(event: KeyboardEvent) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const direction = event.key === "ArrowUp" ? -1 : 1;
  if (props.index + direction >= 0 && props.index + direction < props.total) emit("move", direction);
}
</script>
<template>
  <div class="project-order-controls" role="group" :aria-label="t('Ordna {name}', { name })">
    <button class="project-drag-handle" type="button" draggable="true" @dragstart="startDrag" @keydown="keyMove"
      :aria-label="t('Ordna {name} med piltangenterna upp och ned, eller dra', { name })"
      :title="t('Dra för att ordna. Använd upp- och nedpilarna med tangentbordet.')">
      <GripVertical :size="16" aria-hidden="true" />
    </button>
    <button type="button" :disabled="index === 0" @click="emit('move', -1)" :aria-label="t('Flytta {name} upp', { name })"><ArrowUp :size="14" aria-hidden="true" /></button>
    <button type="button" :disabled="index === total - 1" @click="emit('move', 1)" :aria-label="t('Flytta {name} ned', { name })"><ArrowDown :size="14" aria-hidden="true" /></button>
  </div>
</template>
<style scoped>
.project-order-controls { display: flex; align-items: center; flex-shrink: 0; gap: 2px; }
button { display: grid; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #71817f; width: 27px; height: 30px; padding: 0; cursor: pointer; }
button:hover { background: #edf3f2; color: var(--green); }
button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
button:disabled { opacity: .3; cursor: default; }
.project-drag-handle { cursor: grab; }
.project-drag-handle:active { cursor: grabbing; }
@media (pointer: coarse), (max-width: 650px) { button { min-width: 44px; min-height: 44px; } }
</style>
