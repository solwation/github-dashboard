<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { GripVertical } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { projectDragType } from "../lib/project-layout";
const props = defineProps<{ name: string; fullName: string; index: number; total: number }>();
const emit = defineEmits<{ move: [direction: -1 | 1]; reorder: [source: string, target: string] }>();
const { t } = useLanguage();
function startDrag(event: DragEvent) {
  if (pointer) { event.preventDefault(); return; }
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
// Native HTML drag handles mouse input; pointer capture provides actual touch dragging.
const dragging = ref(false);
let pointer: { id: number; startX: number; startY: number; x: number; y: number; handle: HTMLElement } | null = null;
let scrollFrame = 0;
function touchStart(event: PointerEvent) {
  if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, handle };
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(event.pointerId);
}
function autoScroll() {
  if (!pointer || !dragging.value) return;
  const list = pointer.handle.closest<HTMLElement>(".sidebar-projects, .repository-order-list");
  if (list) {
    const bounds = list.getBoundingClientRect();
    const edge = Math.min(48, bounds.height / 4);
    const speed = pointer.y < bounds.top + edge ? -Math.ceil((bounds.top + edge - pointer.y) / 5)
      : pointer.y > bounds.bottom - edge ? Math.ceil((pointer.y - bounds.bottom + edge) / 5) : 0;
    if (speed) list.scrollBy(0, speed);
  }
  scrollFrame = requestAnimationFrame(autoScroll);
}
function touchMove(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (!dragging.value && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 6) {
    dragging.value = true;
    scrollFrame = requestAnimationFrame(autoScroll);
  }
  if (dragging.value) event.preventDefault();
}
function finishTouch(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const target = dragging.value
    ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-repository]")?.dataset.repository : undefined;
  cancelTouch();
  if (target && target !== props.fullName) emit("reorder", props.fullName, target);
}
function cancelTouch() {
  const previous = pointer;
  pointer = null;
  dragging.value = false;
  cancelAnimationFrame(scrollFrame);
  if (previous?.handle.hasPointerCapture(previous.id)) previous.handle.releasePointerCapture(previous.id);
}
onBeforeUnmount(cancelTouch);
</script>
<template>
  <div class="project-order-controls">
    <button class="project-drag-handle" :class="{ dragging }" type="button" draggable="true"
      @dragstart="startDrag" @keydown="keyMove" @pointerdown="touchStart" @pointermove="touchMove"
      @pointerup="finishTouch" @pointercancel="cancelTouch" @lostpointercapture="cancelTouch"
      :aria-label="t('Ordna {name} med piltangenterna upp och ned, eller dra', { name })"
      :title="t('Dra för att ordna. Använd upp- och nedpilarna med tangentbordet.')">
      <GripVertical :size="16" aria-hidden="true" />
    </button>
  </div>
</template>
<style scoped>
.project-order-controls { display: flex; align-items: center; flex-shrink: 0; }
.project-drag-handle { display: grid; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #8b9997; width: 22px; height: 32px; padding: 0; cursor: grab; touch-action: none; user-select: none; }
.project-drag-handle:hover, .project-drag-handle.dragging { background: #edf3f2; color: #526c66; }
.project-drag-handle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.project-drag-handle:active { cursor: grabbing; }
@media (pointer: coarse), (max-width: 650px) { .project-drag-handle { width: 32px; min-height: 44px; } }
</style>
