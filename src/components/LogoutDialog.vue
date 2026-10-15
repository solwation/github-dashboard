<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";

const props = defineProps<{ open: boolean; busy?: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement>();
watch(() => props.open, async (open) => {
  await nextTick();
  if (open && !dialog.value?.open) dialog.value?.showModal();
  else if (!open && dialog.value?.open) dialog.value.close();
}, { immediate: true });
function cancel(event?: Event) {
  event?.preventDefault();
  if (!props.busy) emit("cancel");
}
</script>

<template>
  <dialog ref="dialog" class="logout-dialog" aria-labelledby="logout-title" aria-describedby="logout-warning" :aria-busy="busy" @cancel="cancel">
    <h2 id="logout-title">{{ t("Logga ut?") }}</h2>
    <p id="logout-warning">{{ t("Din sparade GitHub-token (PAT) tas bort från den här webbläsaren när du loggar ut. Du behöver ange den igen nästa gång du loggar in.") }}</p>
    <div class="logout-actions">
      <button type="button" class="button" :disabled="busy" autofocus @click="cancel()">{{ t("Avbryt") }}</button>
      <button type="button" class="button primary" :disabled="busy" @click="emit('confirm')">{{ t("Logga ut och ta bort token") }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.logout-dialog { width: min(30rem, calc(100vw - 2rem)); padding: 1.5rem; border: 1px solid var(--line); border-radius: 1rem; color: inherit; background: #fff; }
.logout-dialog::backdrop { background: rgb(0 0 0 / 65%); }
h2 { margin-top: 0; }
p { line-height: 1.6; }
.logout-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: .75rem; margin-top: 1.5rem; }
</style>
