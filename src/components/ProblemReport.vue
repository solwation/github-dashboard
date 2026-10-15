<script setup lang="ts">
import { ref } from "vue";
import { X } from "@lucide/vue";
import type { Issue } from "../lib/model";
import { useLanguage } from "../lib/i18n";
defineProps<{ problems: { repo: string; issue: Issue }[]; hideNotice: boolean }>();
const emit = defineEmits<{ "update:hideNotice": [value: boolean]; retry: [] }>();
const { t } = useLanguage();
const dialog = ref<HTMLDialogElement | null>(null);
function open() { dialog.value?.showModal(); }
defineExpose({ open });
</script>
<template>
  <dialog ref="dialog" class="modal native-modal problem-report" aria-labelledby="problem-report-title"
    @click="event => { if (event.target === dialog) dialog?.close(); }">
    <div class="modal-heading"><h2 id="problem-report-title">{{ t("Problemrapport") }}</h2>
      <button class="icon-button" :aria-label="t('Stäng')" @click="dialog?.close()"><X :size="20" /></button>
    </div>
    <template v-if="problems.length">
      <h3>{{ t("Commit-information saknas för {count} issues.", { count: problems.length }) }}</h3>
      <p>{{ t("Issues visas som vanligt. Commit-information kan saknas på grund av tokenbehörigheter, API-gränser eller nätverksfel. Kontrollera läsrättighet till Contents och Pull requests om problemet kvarstår.") }}</p>
      <ul><li v-for="problem in problems" :key="problem.issue.html_url">
        <a :href="problem.issue.html_url" target="_blank" rel="noopener noreferrer">{{ problem.repo }} #{{ problem.issue.number }} — {{ problem.issue.title }}</a>
      </li></ul>
      <p>{{ t("Rapporten gäller kontrollerade issues i den här sessionen. Ny kontroll görs för synliga kort; övriga kontrolleras när de visas.") }}</p>
      <button class="button" @click="emit('retry')">{{ t("Försök igen") }}</button>
    </template>
    <p v-else>{{ t("Inga rapporterade problem med commit-information i den här sessionen.") }}</p>
    <label class="notice-preference"><input type="checkbox" :checked="!hideNotice"
      @change="emit('update:hideNotice', !($event.target as HTMLInputElement).checked)" />{{ t("Visa notiser om problem med commit-information") }}</label>
    <p>{{ t("Problemrapporten finns alltid här även när notisen är dold. Bara ditt notisval sparas på enheten.") }}</p>
    <div class="modal-footer"><button class="button primary" @click="dialog?.close()">{{ t("Klart") }}</button></div>
  </dialog>
</template>
<style scoped>
.problem-report { width: min(40rem, calc(100vw - 2rem)); }
p { line-height: 1.5; }
ul { padding-left: 1.25rem; max-height: 35vh; overflow: auto; }
li { margin: .6rem 0; overflow-wrap: anywhere; }
.notice-preference { display: flex; align-items: center; gap: .5rem; margin-top: 1.25rem; }
.notice-preference input { width: auto; }
</style>
