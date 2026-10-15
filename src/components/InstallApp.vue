<script setup lang="ts">
import { useLanguage } from "../lib/i18n";
const { t, locale } = useLanguage();
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
    <Download :size="15" /><span>{{ t("Installera app") }}</span>
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
      <h2>{{ t("Installera Issueflow") }}</h2>
      <button class="icon-button" :aria-label="t('Stäng')" @click="dialog?.close()">
        <X :size="20" />
      </button>
    </div>
    <p>
      {{ t("I Chrome eller Edge: använd installationsikonen i adressfältet, eller välj") }}
      <strong>{{ t("Installera Issueflow") }}</strong> {{ t("i webbläsarens meny.") }}
    </p>
    <p>
      {{ t("På iPhone och iPad: öppna sidan i Safari, tryck") }} <strong>{{ t("Dela") }}</strong> {{ t("och välj") }} <strong>{{ t("Lägg till på hemskärmen") }}</strong>{{ t(". På Android finns installation i webbläsarens meny.") }}
    </p>
    <p>
      {{ t("Installationen öppnar dashboarden i ett eget appfönster. GitHub-data kräver internet; appskalet kan öppnas offline.") }}
    </p>
    <div class="modal-footer">
      <span>{{ t("Alternativen beror på din webbläsare.") }}</span
      ><button class="button primary" @click="dialog?.close()">{{ t("Klart") }}</button>
    </div>
  </dialog>
</template>
