<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Camera, ImagePlus, X } from "@lucide/vue";
import jsQR from "jsqr";
import { HandoffError, parseHandoffUrl, type HandoffPayload } from "../lib/handoff";
import { useLanguage } from "../lib/i18n";

const emit = defineEmits<{ close: []; scanned: [payload: HandoffPayload] }>();
defineProps<{ mode?: "login" | "preferences" }>();
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const scanning = ref(false);
const pending = ref(false);
const reading = ref(false);
const error = ref("");
const paused = ref(false);
let stream: MediaStream | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let closed = false;
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });

function stop() {
  generation++;
  if (timer) clearTimeout(timer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  if (video.value) video.value.srcObject = null;
  scanning.value = false;
  pending.value = false;
  canvas.width = canvas.height = 0;
}
function close() {
  if (closed) return;
  closed = true;
  stop();
  dialog.value?.close();
  emit("close");
}
function accept(value: string) {
  try {
    const payload = parseHandoffUrl(value, window.location.href);
    stop();
    closed = true;
    emit("scanned", payload);
  } catch (cause) {
    stop();
    error.value = cause instanceof HandoffError && cause.reason === "expired"
      ? t("QR-koden har gått ut. Skapa en ny kod på den andra enheten.")
      : t("QR-koden är ogiltig. Skanna en QR-kod från Issueflow på den andra enheten.");
  }
}
function decode(source: CanvasImageSource, width: number, height: number) {
  if (!context || !width || !height) return null;
  const scale = Math.min(1, 1280 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
  context.clearRect(0, 0, canvas.width, canvas.height);
  return result?.data;
}
function scanFrame() {
  if (!scanning.value || closed) return;
  try {
    const preview = video.value;
    if (preview && preview.readyState >= 2) {
      const value = decode(preview, preview.videoWidth, preview.videoHeight);
      if (value) { accept(value); return; }
    }
    timer = setTimeout(scanFrame, 250);
  } catch {
    stop();
    error.value = t("Kameran kunde inte läsa QR-koden. Försök igen eller välj en bild.");
  }
}
async function start() {
  stop();
  const attempt = generation;
  error.value = "";
  paused.value = false;
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = t("Kameraskanning stöds inte här. Välj en QR-bild eller ange PAT manuellt.");
    return;
  }
  pending.value = true;
  try {
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (closed || attempt !== generation || document.hidden) {
      next.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = next;
    video.value!.srcObject = next;
    await video.value!.play();
    if (closed || attempt !== generation) return;
    scanning.value = true;
    scanFrame();
  } catch (cause) {
    if (closed || attempt !== generation) return;
    stop();
    error.value = cause instanceof DOMException && cause.name === "NotAllowedError"
      ? t("Kameraåtkomst nekades. Tillåt kameran i appens inställningar eller välj en QR-bild.")
      : t("Kameran kunde inte startas. Försök igen eller välj en QR-bild.");
  } finally {
    if (attempt === generation) pending.value = false;
  }
}
async function readImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  stop();
  const attempt = generation;
  error.value = "";
  paused.value = false;
  reading.value = true;
  const url = URL.createObjectURL(file);
  try {
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) throw new Error();
    const image = new Image();
    image.src = url;
    await image.decode();
    if (closed || attempt !== generation) return;
    const value = decode(image, image.naturalWidth, image.naturalHeight);
    if (value) accept(value);
    else throw new Error();
  } catch {
    if (!closed && attempt === generation)
      error.value = t("Ingen QR-kod kunde läsas. Välj en tydlig bild på högst 12 MB.");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
    reading.value = false;
  }
}
function visibility() {
  if (document.hidden) { stop(); paused.value = true; }
}
onMounted(() => {
  dialog.value?.showModal();
  document.addEventListener("visibilitychange", visibility);
  void start();
});
onUnmounted(() => {
  closed = true;
  stop();
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <dialog ref="dialog" class="modal native-modal scanner-dialog" aria-labelledby="scanner-title"
    @cancel.prevent="close" @close="close" @click="event => { if (event.target === dialog) close(); }">
    <div class="modal-heading">
      <h2 id="scanner-title">{{ mode === 'preferences' ? t("Läs QR-kod") : t("Logga in med QR-kod") }}</h2>
      <button class="icon-button" :aria-label="t('Stäng')" @click="close"><X :size="20" /></button>
    </div>
    <p>{{ t("Visa en QR-kod i Issueflow på den andra enheten och skanna den här. Konto, inställningar och vy överförs utan att du behöver logga ut först.") }}</p>
    <video ref="video" autoplay muted playsinline :aria-label="t('Kameraförhandsvisning')" v-show="scanning || pending" />
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="paused">{{ t("Kameran pausades när appen lämnades. Starta den igen för att fortsätta.") }}</p>
    <p role="status">{{ pending ? t("Väntar på kameran…") : scanning ? t("Söker efter QR-kod…") : reading ? t("Läser QR-bild…") : '' }}</p>
    <div class="scan-actions">
      <button v-if="!scanning && !pending" class="button primary" :disabled="reading" @click="start"><Camera :size="17" />{{ t("Starta kameran") }}</button>
      <label class="button image-picker" :class="{ disabled: reading }"><ImagePlus :size="17" />{{ t("Välj QR-bild") }}
        <input type="file" accept="image/*" :aria-label="t('Välj QR-bild')" :disabled="reading" @change="readImage" />
      </label>
      <button class="button" @click="close">{{ t("Avbryt") }}</button>
    </div>
    <p class="scan-note">{{ t("Kamera och bilder läses bara på din enhet. Inloggningen sparas krypterat i appen.") }}</p>
  </dialog>
</template>
<style scoped>
.scanner-dialog { width: min(35rem, calc(100vw - 2rem)); }
p { line-height: 1.5; }
video { display: block; width: 100%; max-height: 42vh; object-fit: contain; background: #101827; border-radius: .75rem; }
.scan-actions { display: flex; flex-wrap: wrap; gap: .65rem; }
.image-picker { position: relative; overflow: hidden; }
.image-picker input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.image-picker:focus-within { outline: 2px solid #8094f9; outline-offset: 3px; }
.disabled { opacity: .5; }
.scan-note { font-size: .8rem; opacity: .8; }
</style>
