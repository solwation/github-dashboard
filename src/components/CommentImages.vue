<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import {
  extractCommentImages,
  fileLoaderKey,
  imageDocument,
  imageGalleryKey,
  type DetectedImage,
} from "../lib/comment-images";

const props = defineProps<{
  html: string;
  repository?: string;
  contentClass?: string;
  gallerySource?: string;
}>();

const { t } = useLanguage();
const viewer = ref<HTMLDialogElement>();
const viewport = ref<HTMLElement>();
const selected = ref<{ src: string; alt: string }>();
const natural = ref({ width: 0, height: 0 });
const zoom = ref(1);
const fitted = ref(true);
const size = ref({ width: 1, height: 1 });
let opener: HTMLElement | undefined;
let observer: ResizeObserver | undefined;

const fit = computed(() => Math.min(size.value.width / (natural.value.width || 1), size.value.height / (natural.value.height || 1)));
const scale = computed(() => fitted.value ? fit.value : zoom.value);
const minimumScale = computed(() => Math.min(.1, fit.value));
const imageSize = computed(() => natural.value.width && natural.value.height ? {
  width: `${natural.value.width * scale.value}px`,
  height: `${natural.value.height * scale.value}px`,
} : undefined);

function measureViewport() {
  if (viewport.value) size.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight };
}

async function fitImage() {
  measureViewport();
  fitted.value = true;
  await nextTick();
  viewport.value?.scrollTo(0, 0);
}

function originalSize() { fitted.value = false; zoom.value = 1; }

const galleryContext = inject(imageGalleryKey, undefined);
const fileLoader = inject(fileLoaderKey, undefined);

const cleanHtml = ref("");
const detected = ref<DetectedImage[]>([]);
const loadedUrls = ref<Record<string, string>>({});
const loadingPaths = ref<Record<string, boolean>>({});
const failedPaths = ref<Record<string, boolean>>({});

function updateImages() {
  const result = extractCommentImages(props.html, t);
  cleanHtml.value = result.cleanHtml;
  detected.value = result.images;

  for (const item of result.images) {
    if (item.path && !loadedUrls.value[item.path] && !loadingPaths.value[item.path] && !failedPaths.value[item.path]) {
      if (props.repository && fileLoader) {
        loadingPaths.value = { ...loadingPaths.value, [item.path]: true };
        fileLoader(props.repository, item.path).then(dataUrl => {
          const nextLoading = { ...loadingPaths.value };
          delete nextLoading[item.path!];
          loadingPaths.value = nextLoading;
          if (dataUrl) {
            loadedUrls.value = { ...loadedUrls.value, [item.path!]: dataUrl };
          } else {
            failedPaths.value = { ...failedPaths.value, [item.path!]: true };
          }
        }).catch(() => {
          const nextLoading = { ...loadingPaths.value };
          delete nextLoading[item.path!];
          loadingPaths.value = nextLoading;
          failedPaths.value = { ...failedPaths.value, [item.path!]: true };
        });
      }
    }
  }
}

watch([() => props.html, () => props.repository], updateImages, { immediate: true });

export interface CarouselItem {
  key: string;
  name: string;
  alt: string;
  src?: string;
  loading: boolean;
  failed: boolean;
}

const carouselImages = computed<CarouselItem[]>(() => {
  return detected.value
    .filter(item => !item.isInline)
    .map(item => {
      const src = item.src || (item.path ? loadedUrls.value[item.path] : undefined);
      const loading = Boolean(item.path && loadingPaths.value[item.path]);
      const failed = Boolean(item.path && failedPaths.value[item.path]);
      return {
        key: item.key,
        name: item.name,
        alt: item.alt,
        src,
        loading,
        failed,
      };
    }).filter(item => item.src || item.loading);
});

const gallery = ref<{ src: string; alt: string }[]>([]);
const index = ref(0);

async function navigate(delta: number) {
  const next = index.value + delta;
  if (next < 0 || next >= gallery.value.length) return;
  index.value = next;
  selected.value = gallery.value[next];
  natural.value = { width: 0, height: 0 };
  zoom.value = 1;
  pointers.clear();
  swipe = undefined;
  await fitImage();
  const focused = document.activeElement;
  if (viewer.value?.open && (!viewer.value.contains(focused) || (focused instanceof HTMLButtonElement && focused.disabled))) {
    viewport.value?.focus({ preventScroll: true });
  }
}

function keydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  void navigate(event.key === "ArrowLeft" ? -1 : 1);
}

function openCarousel(idx: number, event: MouseEvent | KeyboardEvent) {
  const readyItems = carouselImages.value.filter(i => Boolean(i.src)).map(i => ({ src: i.src!, alt: i.alt || i.name }));
  const clickedItem = carouselImages.value[idx];
  const targetIndex = clickedItem?.src ? readyItems.findIndex(i => i.src === clickedItem.src) : idx;
  const button = (event.currentTarget as HTMLElement) || undefined;
  if (!readyItems.length) return;
  opener = button;
  gallery.value = readyItems;
  index.value = Math.max(0, targetIndex);
  selected.value = readyItems[index.value];
  natural.value = { width: 0, height: 0 };
  fitted.value = true;
  zoom.value = 1;
  void nextTick(() => {
    viewer.value?.showModal();
    observer?.disconnect();
    measureViewport();
    observer = new ResizeObserver(measureViewport);
    if (viewport.value) observer.observe(viewport.value);
  });
}

async function activate(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return;
  const image = event.target instanceof HTMLImageElement && event.target.classList.contains("comment-thumbnail") ? event.target : undefined;
  const link = event.target.closest<HTMLAnchorElement>("a[data-image-src]");
  if (!image && !link) return;
  event.preventDefault();
  event.stopPropagation();
  opener = image ?? link!;
  const target = image ?? link!.nextElementSibling as HTMLImageElement;
  const localIndex = [...target.parentElement!.closest("[data-image-content]")!.querySelectorAll("img")].indexOf(target);
  const sources = galleryContext
    ? [{ key: "description", html: galleryContext.description.value }, ...galleryContext.comments.value]
    : [{ key: props.gallerySource ?? "local", html: props.html }];
  // Snapshot only this issue's already available content, keeping duplicate images distinct.
  const groups = sources.map(source => ({
    key: source.key,
    images: [...imageDocument(source.html, t).querySelectorAll("img")].map(img => ({ src: img.src, alt: img.alt || t("Bild") })),
  }));
  gallery.value = groups.flatMap(group => group.images);
  let offset = 0;
  for (const group of groups) {
    if (group.key === props.gallerySource) break;
    offset += group.images.length;
  }
  index.value = galleryContext ? offset + Math.max(0, localIndex) : Math.max(0, localIndex);
  selected.value = gallery.value[index.value] ?? { src: target.src, alt: target.alt || t("Bild") };
  natural.value = { width: target.naturalWidth, height: target.naturalHeight };
  fitted.value = true;
  zoom.value = 1;
  await nextTick();
  viewer.value?.showModal();
  observer?.disconnect();
  measureViewport();
  observer = new ResizeObserver(measureViewport);
  if (viewport.value) observer.observe(viewport.value);
}

function clear() {
  observer?.disconnect();
  pointers.clear();
  swipe = undefined;
  gallery.value = [];
  selected.value = undefined;
  opener?.focus();
}

function close() { viewer.value?.close(); clear(); }
function dialogClosed() {
  if (!viewer.value?.open) clear();
}

function changeZoom(value: number) {
  zoom.value = Math.max(minimumScale.value, Math.min(Math.max(8, fit.value), value));
  fitted.value = false;
}

let swipe: { id: number; x: number; y: number } | undefined;
const pointers = new Map<number, { x: number; y: number }>();
function pointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (pointers.size || event.pointerType !== "touch" || !fitted.value) swipe = undefined;
  else swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  viewport.value?.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
}

function pointerMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId);
  if (!previous || !viewport.value) return;
  const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
  if (other) {
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    if (before > 0) changeZoom(scale.value * Math.hypot(event.clientX - other.x, event.clientY - other.y) / before);
  } else {
    viewport.value.scrollLeft -= event.clientX - previous.x;
    viewport.value.scrollTop -= event.clientY - previous.y;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
}

function pointerUp(event: PointerEvent) {
  const gesture = swipe;
  pointers.delete(event.pointerId);
  swipe = undefined;
  if (event.type === "pointercancel" || !gesture || gesture.id !== event.pointerId || !fitted.value) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) void navigate(dx < 0 ? 1 : -1);
}

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div data-image-content :class="contentClass" @click="activate" @keydown="activate" @error.capture="($event.target as HTMLElement).classList.add('preview-failed')" v-html="cleanHtml" />
  <!-- Carousel for collected and mentioned images (#442) -->
  <div v-if="carouselImages.length" class="comment-image-carousel" role="region" :aria-label="t('Omnämnda bilder')">
    <div class="carousel-header">
      <ImageIcon :size="14" aria-hidden="true" />
      <span>{{ t('Bilder ({count})', { count: carouselImages.length }) }}</span>
    </div>
    <div class="carousel-track" tabindex="0" :aria-label="t('Bildlista, bläddra horisontellt')">
      <button
        v-for="(item, idx) in carouselImages"
        :key="item.key"
        type="button"
        class="carousel-thumb-button"
        :aria-label="t('Öppna bild: {name}', { name: item.name })"
        :disabled="!item.src"
        @click="openCarousel(idx, $event)"
      >
        <span class="carousel-thumb-preview">
          <img
            v-if="item.src"
            :src="item.src"
            :alt="item.alt"
            class="carousel-thumb-img comment-thumbnail"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
          <span v-else-if="item.loading" class="carousel-thumb-loading" role="status">
            <span class="thumb-spinner" aria-hidden="true">…</span>
            <span class="sr-only">{{ t('Hämtar bild…') }}</span>
          </span>
        </span>
        <span class="carousel-thumb-caption" :title="item.name">{{ item.name }}</span>
      </button>
    </div>
  </div>
  <dialog ref="viewer" class="comment-image-viewer" :aria-label="t('Bildvisare')" @close="dialogClosed" @keydown.esc.stop.prevent="close" @keydown="keydown">
    <template v-if="selected">
      <div class="image-toolbar">
        <button type="button" :aria-label="t('Zooma ut')" :title="t('Zooma ut')" :disabled="scale <= minimumScale" @click="changeZoom(scale / 1.5)">−</button>
        <output :aria-label="t('Zoomnivå')">{{ Math.round(scale * 100) }}%</output>
        <button type="button" :aria-label="t('Zooma in')" :title="t('Zooma in')" @click="changeZoom(scale * 1.5)">+</button>
        <button type="button" @click="fitImage">{{ t('Anpassa') }}</button>
        <button type="button" :aria-label="t('Originalstorlek')" @click="originalSize"><span class="label-full">{{ t('Originalstorlek') }}</span><span class="label-short" aria-hidden="true">1:1</span></button>
        <button type="button" class="close-image" :aria-label="t('Stäng bild')" :title="t('Stäng bild')" autofocus @click="close"><X :size="20" aria-hidden="true" /></button>
      </div>
      <div ref="viewport" class="image-viewport" tabindex="0" :aria-label="t('Bild, dra för att panorera')"
        @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp"
        @wheel.ctrl.prevent="changeZoom(scale * ($event.deltaY < 0 ? 1.15 : 1 / 1.15))">
        <div class="image-canvas">
          <img :key="index" :src="selected.src" :alt="selected.alt" :style="imageSize" draggable="false" referrerpolicy="no-referrer"
            @load="natural = { width: ($event.target as HTMLImageElement).naturalWidth, height: ($event.target as HTMLImageElement).naturalHeight }" />
        </div>
      </div>
      <nav v-if="gallery.length > 1" class="image-navigation" :aria-label="t('Bildnavigering')">
        <button type="button" :aria-label="t('Föregående bild')" :title="t('Föregående bild')" :disabled="index === 0" @click="navigate(-1)"><ChevronLeft :size="20" aria-hidden="true" /></button>
        <output aria-live="polite" aria-atomic="true">{{ t('Bild {current} av {total}', { current: index + 1, total: gallery.length }) }}</output>
        <button type="button" :aria-label="t('Nästa bild')" :title="t('Nästa bild')" :disabled="index === gallery.length - 1" @click="navigate(1)"><ChevronRight :size="20" aria-hidden="true" /></button>
      </nav>
    </template>
  </dialog>
</template>

<style scoped>
:deep(.comment-thumbnail) { display: inline-block; width: auto; height: auto; box-sizing: border-box; max-width: min(240px, calc(100% - 1rem)); max-height: 160px; object-fit: contain; vertical-align: middle; margin: .4rem; border: 1px solid var(--line); border-radius: .4rem; cursor: zoom-in; }
:deep(.direct-image-preview) { display: block; margin: .4rem 0; }
:deep(.comment-thumbnail:focus-visible), button:focus-visible, .image-viewport:focus-visible, .carousel-track:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
:deep(.preview-failed) { display: none; }
.comment-image-viewer { box-sizing: border-box; width: calc(100vw - 1rem); height: calc(100dvh - 1rem); max-width: none; max-height: none; padding: .5rem; border: 1px solid var(--line); border-radius: .6rem; background: var(--surface); color: var(--text); overflow: hidden; }
.comment-image-viewer[open] { display: flex; flex-direction: column; gap: .5rem; }
.comment-image-viewer::backdrop { background: #000b; }
.image-toolbar { display: flex; flex-wrap: nowrap; align-items: center; gap: .3rem; flex-shrink: 0; min-width: 0; }
.image-toolbar button, .image-navigation button { min-height: 44px; min-width: 44px; padding: .4rem .6rem; white-space: nowrap; flex-shrink: 0; border: 1px solid var(--line); border-radius: .4rem; color: var(--text); background: var(--surface); cursor: pointer; }
.image-toolbar output, .image-navigation output { min-width: 3rem; text-align: center; font-variant-numeric: tabular-nums; }
.close-image { display: inline-grid; place-items: center; margin-left: auto; padding: 0; }
.label-short { display: none; }

@media (max-width: 480px) {
  .comment-image-viewer { width: 100vw; height: 100dvh; border: 0; border-radius: 0;
    padding: max(.5rem, env(safe-area-inset-top)) max(.5rem, env(safe-area-inset-right)) max(.5rem, env(safe-area-inset-bottom)) max(.5rem, env(safe-area-inset-left)); }
  .image-toolbar { gap: .15rem; }
  .image-toolbar button, .image-navigation button { padding: .4rem .35rem; }
  .image-toolbar output { min-width: 2.4rem; font-size: .75rem; }
  .label-full { display: none; }
  .label-short { display: inline; }
}
.image-navigation { display: flex; align-items: center; justify-content: center; gap: var(--space-3); flex-shrink: 0; }
.image-navigation button { display: inline-grid; place-items: center; padding: var(--space-2); }
.image-navigation output { font-size: 13px; }
.image-navigation button:disabled { color: var(--muted); cursor: default; }
.image-viewport { min-height: 0; flex: 1; overflow: auto; scrollbar-gutter: stable both-edges; touch-action: none; cursor: grab; }
.image-viewport:active { cursor: grabbing; }
.image-canvas { display: flex; align-items: center; justify-content: center; width: max-content; min-width: 100%; min-height: 100%; }
.image-canvas img { display: block; max-width: none; flex-shrink: 0; user-select: none; }

/* Comment image carousel (#442) */
.comment-image-carousel {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--line);
}
.carousel-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.carousel-track {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding: 2px 2px var(--space-1);
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.carousel-thumb-button {
  flex: 0 0 auto;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  max-width: 140px;
  text-align: center;
  transition: border-color 0.15s ease;
}
.carousel-thumb-button:hover:not(:disabled) {
  border-color: var(--green);
}
.carousel-thumb-button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 1px;
}
.carousel-thumb-button:disabled {
  cursor: default;
  opacity: 0.7;
}
.carousel-thumb-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 80px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  overflow: hidden;
}
:root[data-theme="dark"] .carousel-thumb-preview {
  background: rgba(255, 255, 255, 0.05);
}
.carousel-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  margin: 0 !important;
}
.carousel-thumb-caption {
  font-size: 11px;
  line-height: 1.2;
  color: var(--muted);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.carousel-thumb-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--muted);
  animation: pulse 1.2s infinite ease-in-out;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .carousel-thumb-loading {
    animation: none;
  }
}
</style>
