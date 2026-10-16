<script setup lang="ts">
import { ref, watch } from "vue";
import { DEFAULT_TIMEOUT_MINUTES, MAX_TIMEOUT_MINUTES, parseTimeoutMinutes } from "../lib/timeouts";
import ColumnLimitField from "./ColumnLimitField.vue";
import WorkflowGuide from "./WorkflowGuide.vue";
import GitHubPermissions from "./GitHubPermissions.vue";
import NoticeBadge from "./NoticeBadge.vue";
import { missingPermissionCount, type PermissionReport } from "../lib/permissions";
import { computed } from "vue";
import { Settings2, X } from "@lucide/vue";
import { useLanguage, type LanguagePreference } from "../lib/i18n";
const { t, preference, setLanguage } = useLanguage();
const props = withDefaults(defineProps<{ permissions?: PermissionReport; permissionsSession?: number; permissionsChecking?: boolean; canCheckPermissions?: boolean; columnLimit: number; canEditLimit: boolean; canScan?: boolean; timeoutMinutes?: number }>(), { permissions: () => [], timeoutMinutes: DEFAULT_TIMEOUT_MINUTES });
const acknowledgedMissing = ref(new Set<string>());
const permissionsOpen = ref(false);
const permissionKey = (permission: string, repo: string) => `${permission}:${repo}`;
const missingCount = computed(() => missingPermissionCount(props.permissions.map(entry => ({
  ...entry, repositories: entry.repositories.filter(repo => !acknowledgedMissing.value.has(permissionKey(entry.permission, repo.repo))),
}))));
// Notices per Settings submenu; the Settings button shows their total.
const submenuNotices = computed(() => ({ permissions: missingCount.value }));
const settingsNotices = computed(() => Object.values(submenuNotices.value).reduce((total, count) => total + count, 0));
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
const emit = defineEmits<{ scan: []; openUpdates: []; checkPermissions: []; refreshPermissions: []; "update:columnLimit": [value: number | null]; "update:timeoutMinutes": [value: number] }>();
function changeTimeout(event: Event) {
  const input = event.target as HTMLInputElement;
  const minutes = parseTimeoutMinutes(input.value);
  input.setCustomValidity(minutes === null ? t("Ange ett heltal mellan 1 och 10080 minuter.") : "");
  if (minutes !== null) emit("update:timeoutMinutes", minutes);
  else input.reportValidity();
}

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
    :aria-describedby="settingsNotices ? 'settings-notices' : undefined"
  >
    <Settings2 :size="15" /><span>{{ t("Inställningar") }}</span>
    <NoticeBadge id="settings-notices" :count="settingsNotices" :label="t('{count} saknade GitHub-rättigheter', { count: settingsNotices })" />
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
    <label class="rule-field" for="issue-timeout-minutes">{{ t("Tidsgräns för pågående issues (minuter)") }}</label>
    <input id="issue-timeout-minutes" type="number" min="1" :max="MAX_TIMEOUT_MINUTES" step="1" required
      :value="timeoutMinutes" :disabled="!canEditLimit" aria-describedby="issue-timeout-help" @change="changeTimeout" />
    <p id="issue-timeout-help">{{ t("Efter tidsgränsen markeras pågående issues som problematiska. Okänd starttid ger ingen varning. Standard: 30 minuter.") }}</p>
    <div class="settings-actions">
      <GitHubPermissions :report="permissions" :notices="submenuNotices.permissions" :checking="permissionsChecking" :can-check="canCheckPermissions" @check="emit('refreshPermissions')" @opened="acknowledgePermissions" @closed="permissionsOpen = false" />
      <WorkflowGuide />
      <button class="button small" aria-haspopup="dialog" @click="emit('openUpdates')">{{ t("Automatiska uppdateringar") }}</button>
      <button v-if="canScan" class="button small" aria-haspopup="dialog" @click="dialog?.close(); emit('scan')">{{ t("Läs QR-kod") }}</button>
    </div>
    <div class="modal-footer">
      <button class="button primary" @click="dialog?.close()">
        {{ t("Klart") }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.settings-actions { display: grid; gap: .625rem; border-top: 1px solid var(--line); margin-top: 1.25rem; padding-top: 1rem; }
.settings-actions > .button,
.settings-actions :deep(.permissions-open),
.settings-actions :deep(.workflow-guide > .button) { width: 100%; white-space: normal; }
</style>
