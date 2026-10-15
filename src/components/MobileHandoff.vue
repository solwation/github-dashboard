<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { X } from "@lucide/vue";
import QRCode from "qrcode";
import type { Rules } from "../lib/model";
import { createHandoffUrl } from "../lib/handoff";
import { useLanguage } from "../lib/i18n";

const props = defineProps<{ token: string; selected: string[]; rules: Record<string, Rules> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
const qr = ref("");
const expiresAt = ref(0);
const now = ref(Date.now());
const error = ref(false);
const generating = ref(false);
const seconds = computed(() => Math.max(0, Math.ceil((expiresAt.value - now.value) / 1000)));
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let closed = false;
function clearSecret() {
  generation++;
  qr.value = "";
  generating.value = false;
}
function close() {
  if (closed) return;
  closed = true;
  clearSecret();
  if (timer) clearInterval(timer);
  dialog.value?.close();
  emit("close");
}
async function generate() {
  clearSecret();
  const attempt = generation;
  error.value = false;
  generating.value = true;
  try {
    now.value = Date.now();
    const handoff = createHandoffUrl(window.location.origin + window.location.pathname, {
      token: props.token, selected: props.selected, rules: props.rules,
    }, now.value);
    expiresAt.value = handoff.expiresAt;
    const image = await QRCode.toDataURL(handoff.url, { width: 640, margin: 4, errorCorrectionLevel: "L", color: { dark: "#101827", light: "#ffffff" } });
    if (!closed && attempt === generation && Date.now() < expiresAt.value) qr.value = image;
  } catch {
    if (!closed && attempt === generation) error.value = true;
  } finally {
    if (attempt === generation) generating.value = false;
  }
}
onMounted(() => {
  dialog.value?.showModal();
  void generate();
  timer = setInterval(() => {
    now.value = Date.now();
    if (expiresAt.value && seconds.value === 0) clearSecret();
  }, 1000);
});
onUnmounted(() => {
  closed = true;
  clearSecret();
  if (timer) clearInterval(timer);
});
</script>
<template>
  <dialog ref="dialog" class="modal native-modal handoff-dialog" aria-labelledby="handoff-title" @cancel.prevent="close" @close="close" @click="(event) => { if (event.target === dialog) close(); }">
    <div class="modal-heading">
      <h2 id="handoff-title">{{ t('Öppna på mobilen') }}</h2>
      <button class="icon-button" :aria-label="t('Stäng')" @click="close"><X :size="20" /></button>
    </div>
    <p>{{ t('Skanna QR-koden med mobilens kamera för att öppna Issueflow med samma GitHub-token, projekt och labelinställningar.') }}</p>
    <p class="handoff-warning">{{ t('Alla som skannar koden får din tokens GitHub-behörigheter. Visa den bara för din egen mobil. Koden innehåller din token.') }}</p>
    <div class="handoff-code" aria-live="polite">
      <img v-if="qr" :src="qr" :alt="t('QR-kod för att logga in på mobilen')" width="640" height="640" />
      <p v-else-if="generating">{{ t('Skapar QR-kod…') }}</p>
      <p v-else-if="error" role="alert">{{ t('QR-koden kunde inte skapas. Prova att välja färre projekt eller färre labelinställningar.') }}</p>
      <p v-else>{{ t('QR-koden har gått ut. Skapa en ny för att fortsätta.') }}</p>
    </div>
    <p v-if="qr" class="handoff-countdown">{{ t('Koden accepteras i {seconds} sekunder till.', { seconds }) }}</p>
    <p class="handoff-note">{{ t('Överföringen accepteras i fem minuter. Den är inte engångsbaserad. Att stänga dialogen tar bort koden här, men återkallar inte din GitHub-token eller kopior av länken.') }}</p>
    <div class="modal-footer">
      <button v-if="!qr && !generating" class="button" @click="generate">{{ t('Skapa ny QR-kod') }}</button>
      <button class="button primary" @click="close">{{ t('Klart') }}</button>
    </div>
  </dialog>
</template>
<style scoped>
.handoff-dialog { width: min(34rem, calc(100vw - 2rem)); }
.handoff-dialog p { line-height: 1.5; }
.handoff-warning { padding: .75rem; border: 1px solid #d69a45; border-radius: .6rem; background: #b46e1617; }
.handoff-code { display: grid; place-items: center; min-height: 8rem; }
.handoff-code img { width: min(100%, 22rem); height: auto; background: white; border-radius: .5rem; }
.handoff-countdown, .handoff-note { font-size: .8rem; opacity: .8; }
.handoff-dialog .modal-footer { justify-content: flex-end; gap: .75rem; }
@media (max-width: 480px) { .handoff-dialog { padding: 1rem; } }
</style>
