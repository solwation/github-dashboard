<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Download, X } from "@lucide/vue";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const prompt = ref<InstallPrompt | null>(null);
const standalone = ref(
  matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
);
const dialog = ref<HTMLDialogElement | null>(null);
function offered(event: Event) {
  event.preventDefault();
  prompt.value = event as InstallPrompt;
}
function installed() {
  standalone.value = true;
  prompt.value = null;
  dialog.value?.close();
}
async function install() {
  if (!prompt.value) {
    dialog.value?.showModal();
    return;
  }
  const current = prompt.value;
  prompt.value = null;
  try {
    await current.prompt();
    const choice = await current.userChoice;
    if (choice.outcome === "accepted") installed();
  } catch {
    dialog.value?.showModal();
  }
}
onMounted(() => {
  window.addEventListener("beforeinstallprompt", offered);
  window.addEventListener("appinstalled", installed);
});
onUnmounted(() => {
  window.removeEventListener("beforeinstallprompt", offered);
  window.removeEventListener("appinstalled", installed);
});
</script>
<template>
  <button
    v-if="!standalone"
    class="button small install-button"
    @click="install"
  >
    <Download :size="15" /><span>Installera app</span>
  </button>
  <dialog
    ref="dialog"
    class="modal native-modal"
    @click="
      (event) => {
        if (event.target === dialog) dialog?.close();
      }
    "
  >
    <div class="modal-heading">
      <h2>Installera Issueflow</h2>
      <button class="icon-button" aria-label="Stäng" @click="dialog?.close()">
        <X :size="20" />
      </button>
    </div>
    <p>
      I Chrome eller Edge: använd installationsikonen i adressfältet, eller välj
      <strong>Installera Issueflow</strong> i webbläsarens meny.
    </p>
    <p>
      På iPhone och iPad: öppna sidan i Safari, tryck <strong>Dela</strong> och
      välj <strong>Lägg till på hemskärmen</strong>. På Android finns
      installation i webbläsarens meny.
    </p>
    <p>
      Installationen öppnar dashboarden i ett eget appfönster. GitHub-data
      kräver internet; appskalet kan öppnas offline.
    </p>
    <div class="modal-footer">
      <span>Alternativen beror på din webbläsare.</span
      ><button class="button primary" @click="dialog?.close()">Klart</button>
    </div>
  </dialog>
</template>
