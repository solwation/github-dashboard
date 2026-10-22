<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useLanguage } from "../lib/i18n";

const props = defineProps<{ html: string }>();
const { t } = useLanguage();
const viewer = ref<HTMLDialogElement>();
const viewport = ref<HTMLElement>();
const selected = ref<{ src: string; alt: string }>();
const natural = ref({ width: 0, height: 0 });
const zoom = ref(1);
const size = ref({ width: 1, height: 1 });
let opener: HTMLElement | undefined;
let observer: ResizeObserver | undefined;
const fit = computed(() => Math.min(1, size.value.width / (natural.value.width || 1), size.value.height / (natural.value.height || 1)));
const imageWidth = computed(() => natural.value.width * fit.value * zoom.value);
const html = computed(() => {
  const document = new DOMParser().parseFromString(props.html, "text/html");
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.querySelector("img")) continue;
    try {
      const url = new URL(link.href);
      const attachment = url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
      if (!["https:", "http:"].includes(url.protocol) || (!attachment && !/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(url.pathname))) continue;
      if (url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) url.searchParams.set("raw", "true");
      const img = document.createElement("img");
      img.src = url.href;
      img.classList.add("direct-image-preview");
      img.alt = link.textContent || t("Bild");
      link.after(img);
    } catch { /* Ordinary links remain ordinary links. */ }
  }
  for (const img of document.querySelectorAll("img")) {
    img.classList.add("comment-thumbnail");
    img.setAttribute("role", "button");
    img.setAttribute("tabindex", "0");
    img.setAttribute("aria-haspopup", "dialog");
    img.setAttribute("aria-label", t("Öppna bild: {name}", { name: img.alt || t("Bild") }));
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
  }
  return document.body.innerHTML;
});
async function activate(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof HTMLImageElement) || !event.target.classList.contains("comment-thumbnail")) return;
  if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  opener = event.target;
  selected.value = { src: event.target.src, alt: event.target.alt };
  natural.value = { width: event.target.naturalWidth, height: event.target.naturalHeight };
  zoom.value = 1;
  await nextTick();
  viewer.value?.showModal();
  observer?.disconnect();
  observer = new ResizeObserver(() => {
    if (viewport.value) size.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight };
  });
  if (viewport.value) observer.observe(viewport.value);
}
function clear() {
  observer?.disconnect();
  pointers.clear();
  selected.value = undefined;
  opener?.focus();
}
function close() { viewer.value?.close(); clear(); }
function changeZoom(value: number) { zoom.value = Math.max(1, Math.min(Math.max(8, 1 / fit.value), value)); }
const pointers = new Map<number, { x: number; y: number }>();
function pointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  viewport.value?.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
}
function pointerMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId);
  if (!previous || !viewport.value) return;
  const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
  if (other) {
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    if (before > 0) changeZoom(zoom.value * Math.hypot(event.clientX - other.x, event.clientY - other.y) / before);
  } else {
    viewport.value.scrollLeft -= event.clientX - previous.x;
    viewport.value.scrollTop -= event.clientY - previous.y;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
}
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div @click="activate" @keydown="activate" @error.capture="($event.target as HTMLElement).classList.add('preview-failed')" v-html="html" />
  <dialog ref="viewer" class="comment-image-viewer" :aria-label="t('Bildvisare')" @close="clear" @keydown.esc.stop.prevent="close">
    <template v-if="selected">
      <div class="image-toolbar">
        <button type="button" :aria-label="t('Zooma ut')" :disabled="zoom <= 1" @click="changeZoom(zoom / 1.5)">−</button>
        <output :aria-label="t('Zoomnivå')">{{ Math.round(fit * zoom * 100) }}%</output>
        <button type="button" :aria-label="t('Zooma in')" @click="changeZoom(zoom * 1.5)">+</button>
        <button type="button" @click="zoom = 1">{{ t('Anpassa') }}</button>
        <button type="button" @click="zoom = 1 / fit">{{ t('Originalstorlek') }}</button>
        <button type="button" class="close-image" autofocus @click="close">{{ t('Stäng bild') }}</button>
      </div>
      <div ref="viewport" class="image-viewport" tabindex="0" :aria-label="t('Bild, dra för att panorera')"
        @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointers.delete($event.pointerId)" @pointercancel="pointers.delete($event.pointerId)"
        @wheel.ctrl.prevent="changeZoom(zoom * ($event.deltaY < 0 ? 1.15 : 1 / 1.15))">
        <div class="image-canvas">
          <img :src="selected.src" :alt="selected.alt" :style="{ width: imageWidth ? `${imageWidth}px` : undefined }" draggable="false" referrerpolicy="no-referrer"
            @load="natural = { width: ($event.target as HTMLImageElement).naturalWidth, height: ($event.target as HTMLImageElement).naturalHeight }" />
        </div>
      </div>
    </template>
  </dialog>
</template>
<style scoped>
:deep(.comment-thumbnail) { display: inline-block; width: auto; height: auto; box-sizing: border-box; max-width: min(240px, calc(100% - 1rem)); max-height: 160px; object-fit: contain; vertical-align: middle; margin: .4rem; border: 1px solid var(--line); border-radius: .4rem; cursor: zoom-in; }
:deep(.direct-image-preview) { display: block; margin: .4rem 0; }
:deep(.comment-thumbnail:focus-visible), button:focus-visible, .image-viewport:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
:deep(.preview-failed) { display: none; }
.comment-image-viewer { box-sizing: border-box; width: calc(100vw - 1rem); height: calc(100dvh - 1rem); max-width: none; max-height: none; padding: .5rem; border: 1px solid var(--line); border-radius: .6rem; background: var(--surface); color: var(--text); overflow: hidden; }
.comment-image-viewer[open] { display: flex; flex-direction: column; gap: .5rem; }
.comment-image-viewer::backdrop { background: #000b; }
.image-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; flex-shrink: 0; }
.image-toolbar button { min-height: 44px; min-width: 44px; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: .4rem; color: var(--text); background: var(--surface); cursor: pointer; }
.image-toolbar output { min-width: 3rem; text-align: center; font-variant-numeric: tabular-nums; }
.close-image { margin-left: auto; }
.image-viewport { min-height: 0; flex: 1; overflow: auto; touch-action: none; cursor: grab; }
.image-viewport:active { cursor: grabbing; }
.image-canvas { display: flex; align-items: center; justify-content: center; width: max-content; min-width: 100%; min-height: 100%; }
.image-canvas img { display: block; max-width: none; flex-shrink: 0; user-select: none; }
</style>
