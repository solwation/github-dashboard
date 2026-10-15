<script setup lang="ts">
import { ref } from "vue";
import { Settings2, X } from "@lucide/vue";
import { useLanguage, type LanguagePreference } from "../lib/i18n";
const { t, preference, setLanguage } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
function change(event: Event) {
  setLanguage((event.target as HTMLSelectElement).value as LanguagePreference);
}
</script>
<template>
  <button class="button small" @click="dialog?.showModal()" :aria-label="t('Inställningar')">
    <Settings2 :size="15" /><span>{{ t("Inställningar") }}</span>
  </button>
  <dialog ref="dialog" class="modal native-modal" aria-labelledby="language-settings-title" @click="event => { if (event.target === dialog) dialog?.close(); }">
    <div class="modal-heading">
      <h2 id="language-settings-title">{{ t("Inställningar") }}</h2>
      <button class="icon-button" :aria-label="t('Stäng')" @click="dialog?.close()"><X :size="20" /></button>
    </div>
    <label class="rule-field" for="language-preference">{{ t("Språk") }}
      <select id="language-preference" :value="preference" @change="change">
        <option value="auto">{{ t("Automatiskt (webbläsarens språk)") }}</option>
        <option value="sv" lang="sv">Svenska</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
    <p>{{ t("Språkvalet sparas på den här enheten.") }}</p>
    <div class="modal-footer"><button class="button primary" @click="dialog?.close()">{{ t("Klart") }}</button></div>
  </dialog>
</template>
