<script setup lang="ts">
import { ref, watch } from "vue";
import { DEFAULT_TIMEOUT_OVERRUN_PERCENT, MAX_TIMEOUT_OVERRUN_PERCENT, parseTimeoutOverrunPercent } from "../lib/timeouts";
import RepositoryOrderDialog from "./RepositoryOrderDialog.vue";
import type { SidebarRepository } from "../lib/sidebar";
import ColumnLimitField from "./ColumnLimitField.vue";
import WorkflowGuide from "./WorkflowGuide.vue";
import GitHubPermissions from "./GitHubPermissions.vue";
import NoticeBadge from "./NoticeBadge.vue";
import { permissionProblemKey, reconcilePermissionAcknowledgements } from "../lib/permission-acknowledgements";
import { missingPermissionCount, type PermissionReport } from "../lib/permissions";
import { computed } from "vue";
import { Settings2, X } from "@lucide/vue";
import { useLanguage, type LanguagePreference } from "../lib/i18n";
import { useTheme, type ThemePreference } from "../lib/theme";
const { t, preference, setLanguage } = useLanguage();
const { preference: themePreference, setTheme } = useTheme();
const props = withDefaults(defineProps<{ repositories?: SidebarRepository[]; permissions?: PermissionReport; permissionsSession?: number; permissionAcknowledgements?: string[]; permissionsChecking?: boolean; canCheckPermissions?: boolean; columnLimit: number; canEditLimit: boolean; canScan?: boolean; timeoutEnabled?: boolean; timeoutOverrunPercent?: number; notificationSounds?: boolean }>(), { repositories: () => [], permissions: () => [], permissionAcknowledgements: () => [], timeoutEnabled: true, timeoutOverrunPercent: DEFAULT_TIMEOUT_OVERRUN_PERCENT, notificationSounds: true });
const acknowledgedMissing = computed(() => new Set(props.permissionAcknowledgements));
const permissionsOpen = ref(false);
const missingCount = computed(() => missingPermissionCount(props.permissions.map(entry => ({
  ...entry, repositories: entry.repositories.filter(repo => !acknowledgedMissing.value.has(permissionProblemKey(entry.permission, repo.repo))),
}))));
// Notices per Settings submenu; the Settings button shows their total.
const submenuNotices = computed(() => ({ permissions: missingCount.value }));
const settingsNotices = computed(() => Object.values(submenuNotices.value).reduce((total, count) => total + count, 0));
function acknowledgePermissions() {
  permissionsOpen.value = true;
  const next = reconcilePermissionAcknowledgements(props.permissionAcknowledgements, props.permissions, true);
  if (JSON.stringify(next) !== JSON.stringify(props.permissionAcknowledgements)) emit("update:permissionAcknowledgements", next);
}
watch(() => props.permissionsSession, () => { permissionsOpen.value = false; });
watch(() => props.permissions, () => {
  if (permissionsOpen.value) acknowledgePermissions();
}, { deep: true });
const emit = defineEmits<{ reorder: [source: string, target: string]; scan: []; openUpdates: []; checkPermissions: []; refreshPermissions: []; "update:permissionAcknowledgements": [value: string[]]; "update:columnLimit": [value: number | null]; "update:timeoutEnabled": [value: boolean]; "update:timeoutOverrunPercent": [value: number]; "update:notificationSounds": [value: boolean] }>();
function changeTimeout(event: Event) {
  const input = event.target as HTMLInputElement;
  const percent = parseTimeoutOverrunPercent(input.value);
  input.setCustomValidity(percent === null ? t("Ange ett heltal mellan 0 och 1000 procent.") : "");
  if (percent !== null) emit("update:timeoutOverrunPercent", percent);
  else input.reportValidity();
}

const dialog = ref<HTMLDialogElement | null>(null);
function change(event: Event) {
  setLanguage((event.target as HTMLSelectElement).value as LanguagePreference);
}
function changeTheme(event: Event) {
  setTheme((event.target as HTMLSelectElement).value as ThemePreference);
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
        :title="t('Stäng')"
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
    <label class="rule-field" for="theme-preference">{{ t("Tema") }}</label>
    <select id="theme-preference" :value="themePreference" aria-describedby="theme-preference-help" @change="changeTheme">
      <option value="auto">{{ t("Auto (systemets tema)") }}</option>
      <option value="light">{{ t("Ljust") }}</option>
      <option value="dark">{{ t("Mörkt") }}</option>
    </select>
    <p id="theme-preference-help">{{ t("Auto följer enhetens ljusa eller mörka läge. Temavalet sparas på den här enheten.") }}</p>
    <label class="rule-field" for="notification-sounds">{{ t("Notifikationsljud") }}</label>
    <select id="notification-sounds" :value="String(notificationSounds)" :disabled="!canEditLimit" aria-describedby="notification-sounds-help"
      @change="emit('update:notificationSounds', ($event.target as HTMLSelectElement).value === 'true')">
      <option value="true">{{ t("på") }}</option>
      <option value="false">{{ t("av") }}</option>
    </select>
    <p id="notification-sounds-help">{{ t("Spelar ljud för repositories där notiser är på. Övriga notiser påverkas inte.") }}</p>
    <ColumnLimitField id="global-column-limit" :model-value="columnLimit" :disabled="!canEditLimit"
      @update:model-value="emit('update:columnLimit', $event)" />
    <p v-if="!canEditLimit">{{ t("Logga in för att spara inställningen för ditt konto, eller prova i demoläget.") }}</p>
    <label class="rule-field timeout-toggle" for="issue-timeout-enabled"><input id="issue-timeout-enabled" type="checkbox" :checked="timeoutEnabled" :disabled="!canEditLimit"
      @change="emit('update:timeoutEnabled', ($event.target as HTMLInputElement).checked)" /> {{ t("Varna när pågående arbete överskrider estimatet") }}</label>
    <label class="rule-field" for="issue-timeout-overrun">{{ t("Tillåten överskridning (%)") }}</label>
    <input id="issue-timeout-overrun" type="number" min="0" :max="MAX_TIMEOUT_OVERRUN_PERCENT" step="1" required
      :value="timeoutOverrunPercent" :disabled="!canEditLimit || !timeoutEnabled" aria-describedby="issue-timeout-help" @change="changeTimeout" />
    <p id="issue-timeout-help">{{ t("Varnar först efter uppskattad totaltid plus tillåten procent. Kräver känd starttid och tillräcklig historik. Standard: 25 %.") }}</p>
    <div class="settings-actions">
      <RepositoryOrderDialog v-if="repositories.length" :repos="repositories" @reorder="(source, target) => emit('reorder', source, target)" />
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
.timeout-toggle { display: flex; align-items: center; gap: .65rem; min-height: 44px; line-height: 1.5; }
.timeout-toggle input { width: 20px; height: 20px; flex-shrink: 0; margin: 0; padding: 0; }
.settings-actions { display: grid; gap: .625rem; border-top: 1px solid var(--line); margin-top: 1.25rem; padding-top: 1rem; }
.settings-actions > .button,
.settings-actions :deep(.repository-order-open),
.settings-actions :deep(.permissions-open),
.settings-actions :deep(.workflow-guide > .button) { width: 100%; white-space: normal; }
</style>
