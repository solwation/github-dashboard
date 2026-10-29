<script setup lang="ts">
import { ref, useId } from "vue";
import { useLanguage } from "../lib/i18n";
/** Adds someone else's public repository; `add` resolves null on success or the error text to show. */
const props = defineProps<{ add: (input: string) => Promise<string | null> }>();
const { t } = useLanguage();
const id = useId();
const input = ref("");
const busy = ref(false);
const error = ref("");
async function submit() {
  if (busy.value || !input.value.trim()) return;
  busy.value = true; error.value = "";
  const result = await props.add(input.value);
  busy.value = false;
  if (result === null) input.value = ""; else error.value = result;
}
</script>
<template>
  <form class="external-form" @submit.prevent="submit">
    <label :for="id">{{ t("Lägg till någon annans publika repository") }}</label>
    <div class="external-form-row">
      <input :id="id" v-model="input" :placeholder="t('ägare/repo eller https://github.com/ägare/repo')" autocomplete="off" spellcheck="false" :disabled="busy" :aria-describedby="error ? id + '-error' : undefined" :aria-invalid="error ? true : undefined" />
      <button class="button" :disabled="busy || !input.trim()">{{ busy ? t("Hämtar repository…") : t("Lägg till repository") }}</button>
    </div>
    <p v-if="error" :id="id + '-error'" class="external-form-error" role="alert">{{ error }}</p>
  </form>
</template>
<style scoped>
.external-form { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.external-form label { font-size: 12px; font-weight: 600; }
.external-form-row { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: stretch; }
.external-form input { flex: 1 1 12rem; min-width: 0; border: 1px solid var(--input-border); border-radius: 5px; padding: var(--space-2) var(--space-3); font-size: 12px; }
.external-form button { flex: 0 0 auto; }
.external-form-error { margin: 0; font-size: 11px; line-height: 1.5; color: var(--accent-red, #b3261e); overflow-wrap: anywhere; }
@media (pointer: coarse) {
  .external-form input, .external-form button { min-height: 44px; font-size: 14px; }
}
</style>
