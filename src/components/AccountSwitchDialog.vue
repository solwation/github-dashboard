<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";

/** Confirms that credentials from a link or scan may replace a different saved sign-in. */
const props = defineProps<{ open: boolean; current: string | null; incoming: string }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement>();
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open && !dialog.value?.open) dialog.value?.showModal();
    else if (!open && dialog.value?.open) dialog.value.close();
  },
  { immediate: true },
);
function cancel(event?: Event) {
  event?.preventDefault();
  emit("cancel");
}
</script>

<template>
  <dialog
    ref="dialog"
    class="account-switch-dialog"
    aria-labelledby="account-switch-title"
    aria-describedby="account-switch-warning"
    @cancel="cancel"
  >
    <h2 id="account-switch-title">{{ t("Byta GitHub-konto?") }}</h2>
    <p id="account-switch-warning">
      {{ t("En inloggning vill ersätta den som är sparad i den här webbläsaren. Byter du tas den sparade token och dess cachade innehåll bort.") }}
    </p>
    <dl>
      <dt>{{ t("Sparat konto") }}</dt>
      <dd>{{ current ?? t("Okänt (den sparade inloggningen kunde inte läsas)") }}</dd>
      <dt>{{ t("Nytt konto") }}</dt>
      <dd>{{ incoming }}</dd>
    </dl>
    <div class="account-switch-actions">
      <button type="button" class="button" autofocus @click="cancel()">
        {{ t("Behåll sparat konto") }}
      </button>
      <button type="button" class="button primary" @click="emit('confirm')">
        {{ t("Byt konto") }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.account-switch-dialog {
  width: min(30rem, calc(100vw - 2rem));
  padding: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 1rem;
  color: inherit;
  background: var(--surface);
}
.account-switch-dialog::backdrop {
  background: rgb(0 0 0 / 65%);
}
h2 {
  margin-top: 0;
}
p {
  line-height: 1.6;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  margin: 1rem 0 0;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.account-switch-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
</style>
