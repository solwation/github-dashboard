<script setup lang="ts">
import { ref, watch } from "vue";
import ColumnLimitField from "./ColumnLimitField.vue";
import WorkflowGuide from "./WorkflowGuide.vue";
import BuildInfo from "./BuildInfo.vue";
import GitHubPermissions from "./GitHubPermissions.vue";
import { missingPermissionCount, type PermissionReport } from "../lib/permissions";
import { computed } from "vue";
import { Settings2, X } from "@lucide/vue";
import { useLanguage, type LanguagePreference } from "../lib/i18n";
const { t, preference, setLanguage } = useLanguage();
const props = withDefaults(defineProps<{ permissions?: PermissionReport; permissionsSession?: number; permissionsChecking?: boolean; canCheckPermissions?: boolean; columnLimit: number; canEditLimit: boolean }>(), { permissions: () => [] });
const acknowledgedMissing = ref(new Set<string>());
const permissionsOpen = ref(false);
const permissionKey = (permission: string, repo: string) => `${permission}:${repo}`;
const missingCount = computed(() => missingPermissionCount(props.permissions.map(entry => ({
  ...entry, repositories: entry.repositories.filter(repo => !acknowledgedMissing.value.has(permissionKey(entry.permission, repo.repo))),
}))));
function acknowledgePermissions() {
  permissionsOpen.value = true;
  const seen = new Set(acknowledgedMissing.value);
  for (const entry of props.permissions) for (const repo of entry.repositories) {
    if (repo.status === "missing") seen.add(permissionKey(entry.permission, repo.repo));
  }
  acknowledgedMissing.value = seen;
}
watch(() => props.permissionsSession, () => { acknowledgedMissing.value = new Set(); permissionsOpen.value = false; });
watch(() => props.permissions, () => {
  const seen = new Set(acknowledgedMissing.value);
  for (const entry of props.permissions) for (const repo of entry.repositories) {
    if (repo.status === "granted" || repo.reason === "public-access") seen.delete(permissionKey(entry.permission, repo.repo));
  }
  acknowledgedMissing.value = seen;
  if (permissionsOpen.value) acknowledgePermissions();
}, { deep: true });
const emit = defineEmits<{ checkPermissions: []; refreshPermissions: []; "update:columnLimit": [value: number | null] }>();
const dialog = ref<HTMLDialogElement | null>(null);
function change(event: Event) {
  setLanguage((event.target as HTMLSelectElement).value as LanguagePreference);
}
</script>
<template>
  <button
    class="button small"
    @click="dialog?.showModal(); emit('checkPermissions')"
    :aria-label="t('Inställningar')"
  >
    <Settings2 :size="15" /><span>{{ t("Inställningar") }}</span>
    <span v-if="missingCount" class="permissions-badge" role="status" :aria-label="t('{count} saknade GitHub-rättigheter', { count: missingCount })">{{ missingCount }}</span>
  </button>
  <dialog
    ref="dialog"
    class="modal native-modal"
    aria-labelledby="language-settings-title"
    @click="
      (event) => {
        if (event.target === dialog) dialog?.close();
      }
    "
  >
    <div class="modal-heading">
      <h2 id="language-settings-title">{{ t("Inställningar") }}</h2>
      <button
        class="icon-button"
        :aria-label="t('Stäng')"
        @click="dialog?.close()"
      >
        <X :size="20" />
      </button>
    </div>
    <label class="rule-field" for="language-preference">{{ t("Språk") }}</label>
    <select id="language-preference" :value="preference" @change="change">
      <option value="auto">{{ t("Automatiskt (webbläsarens språk)") }}</option>
      <option value="sv" lang="sv">Svenska</option>
      <option value="en" lang="en">English</option>
    </select>
    <p>{{ t("Språkvalet sparas på den här enheten.") }}</p>
    <ColumnLimitField id="global-column-limit" :model-value="columnLimit" :disabled="!canEditLimit"
      @update:model-value="emit('update:columnLimit', $event)" />
    <p v-if="!canEditLimit">{{ t("Logga in för att spara inställningen för ditt konto, eller prova i demoläget.") }}</p>
    <GitHubPermissions :report="permissions" :checking="permissionsChecking" :can-check="canCheckPermissions" @check="emit('refreshPermissions')" @opened="acknowledgePermissions" @closed="permissionsOpen = false" />
    <WorkflowGuide />
    <BuildInfo />
    <div class="modal-footer">
      <button class="button primary" @click="dialog?.close()">
        {{ t("Klart") }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.permissions-badge { background: #b91c1c; color: white; border-radius: 50%; padding: 0; width: 1.375rem; height: 1.375rem; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: .75rem; font-weight: 700; }
</style>
