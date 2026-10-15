<script setup lang="ts">
import { ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import { maxColumnLimit, validColumnLimit } from "../lib/column-limits";
const props = defineProps<{ id: string; modelValue: number | null; inherit?: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();
const { t } = useLanguage();
const draft = ref(String(props.modelValue ?? ""));
const invalid = ref(false);
watch(() => props.modelValue, value => { draft.value = String(value ?? ""); invalid.value = false; });
function update(event: Event) {
  draft.value = (event.target as HTMLInputElement).value;
  const value = draft.value === "" ? null : Number(draft.value);
  invalid.value = !(value === null && props.inherit !== undefined) && !validColumnLimit(value);
  if (!invalid.value) emit('update:modelValue', value);
}
</script>
<template>
  <div class="rule-field">
  <label :for="id">{{ t("Visa max work items per kolumn") }}</label>
  <input :id="id" type="number" min="1" :max="maxColumnLimit" step="1" inputmode="numeric"
    :required="inherit === undefined" :value="draft" :disabled="disabled" :aria-invalid="invalid"
    :aria-describedby="id + '-help' + (invalid ? ' ' + id + '-error' : '')"
    :placeholder="inherit === undefined ? undefined : t('Ärv global inställning ({count})', { count: inherit })"
    @input="update" />
  </div>
  <p :id="id + '-help'">{{ inherit === undefined ? t("Antal som visas först. Visa fler visar nästa omgång; kolumnens antal omfattar alla work items.") : t("Lämna tomt för att ärva den globala inställningen ({count}).", { count: inherit }) }}</p>
  <p v-if="invalid" :id="id + '-error'" role="alert">{{ t("Ange ett heltal mellan 1 och 100.") }}</p>
</template>
