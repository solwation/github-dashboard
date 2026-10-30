<script setup lang="ts">
import { ref, watch } from "vue";
import { DEFAULT_TIMEOUT_OVERRUN_PERCENT, MAX_TIMEOUT_OVERRUN_PERCENT, parseTimeoutOverrunPercent } from "../lib/timeouts";
import RepositoryOrderDialog from "./RepositoryOrderDialog.vue";
import type { SidebarRepository } from "../lib/sidebar";
import type { RepositoryVisibility } from "../lib/repository-visibility";
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
const props = withDefaults(defineProps<{ repositories?: SidebarRepository[]; visibility?: Record<string, RepositoryVisibility>; hideInactive?: boolean; addExternal?: (input: string) => Promise<string | null>; permissions?: PermissionReport; permissionsSession?: number; permissionAcknowledgements?: string[]; permissionsChecking?: boolean; canCheckPermissions?: boolean; columnLimit: number; canEditLimit: boolean; canScan?: boolean; timeoutEnabled?: boolean; timeoutOverrunPercent?: number; notificationSounds?: boolean }>(), { repositories: () => [], permissions: () => [], permissionAcknowledgements: () => [], timeoutEnabled: true, timeoutOverrunPercent: DEFAULT_TIMEOUT_OVERRUN_PERCENT, notificationSounds: true });
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
const emit = defineEmits<{ removeExternal: [name: string]; toggleVisibility: [name: string]; "update:hideInactive": [value: boolean]; reorder: [source: string, target: string]; scan: []; openUpdates: []; checkPermissions: []; refreshPermissions: []; "update:permissionAcknowledgements": [value: string[]]; "update:columnLimit": [value: number | null]; "update:timeoutEnabled": [value: boolean]; "update:timeoutOverrunPercent": [value: number]; "update:notificationSounds": [value: boolean] }>();
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
    <Settings2 :size="16" aria-hidden="true" /><span>{{ t("Inställningar") }}</span>
    <NoticeBadge id="settings-notices" :count="settingsNotices" :label="t('{count} saknade GitHub-rättigheter', { count: settingsNotices })" />
  </button>
  <dialog
    ref="dialog"
    class="modal native-modal settings-dialog"
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
        <X :size="20" aria-hidden="true" />
      </button>
    </div>
    <div class="settings-grid">
      <section class="settings-section settings-wide" aria-labelledby="appearance-settings-title">
        <h3 id="appearance-settings-title">{{ t("Utseende") }}</h3>
        <div class="settings-section-fields">
          <div class="settings-field">
            <label for="language-preference">{{ t("Språk") }}</label>
            <select id="language-preference" :value="preference" aria-describedby="language-preference-help" @change="change">
              <option value="auto">{{ t("Automatiskt (webbläsarens språk)") }}</option>
              <option value="sv" lang="sv">Svenska</option>
              <option value="en" lang="en">English</option>
            </select>
            <p id="language-preference-help">{{ t("Språkvalet sparas på den här enheten.") }}</p>
          </div>
          <div class="settings-field">
            <label for="theme-preference">{{ t("Tema") }}</label>
            <select id="theme-preference" :value="themePreference" aria-describedby="theme-preference-help" @change="changeTheme">
              <option value="auto">{{ t("Auto (systemets tema)") }}</option>
              <option value="light">{{ t("Ljust") }}</option>
              <option value="dark">{{ t("Mörkt") }}</option>
            </select>
            <p id="theme-preference-help">{{ t("Auto följer enhetens ljusa eller mörka läge. Temavalet sparas på den här enheten.") }}</p>
          </div>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="board-settings-title">
        <h3 id="board-settings-title">{{ t("Board") }}</h3>
        <div class="settings-field">
          <ColumnLimitField id="global-column-limit" :model-value="columnLimit" :disabled="!canEditLimit"
            @update:model-value="emit('update:columnLimit', $event)" />
          <p v-if="!canEditLimit">{{ t("Logga in för att spara inställningen för ditt konto, eller prova i demoläget.") }}</p>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="notification-settings-title">
        <h3 id="notification-settings-title">{{ t("Notiser") }}</h3>
        <div class="settings-field">
          <label class="settings-toggle" for="notification-sounds">
            <input id="notification-sounds" type="checkbox" :checked="notificationSounds" :disabled="!canEditLimit" aria-describedby="notification-sounds-help"
              @change="emit('update:notificationSounds', ($event.target as HTMLInputElement).checked)" />
            <span>{{ t("Notifikationsljud") }}</span>
          </label>
          <p id="notification-sounds-help">{{ t("Spelar ljud för repositories där notiser är på. Övriga notiser påverkas inte.") }}</p>
        </div>
      </section>
      <section class="settings-section settings-wide" aria-labelledby="time-settings-title">
        <h3 id="time-settings-title">{{ t("Tidsestimat") }}</h3>
        <div class="settings-section-fields">
          <label class="settings-toggle" for="issue-timeout-enabled">
            <input id="issue-timeout-enabled" type="checkbox" :checked="timeoutEnabled" :disabled="!canEditLimit" aria-describedby="issue-timeout-help"
              @change="emit('update:timeoutEnabled', ($event.target as HTMLInputElement).checked)" />
            <span>{{ t("Varna när pågående arbete överskrider estimatet") }}</span>
          </label>
          <div class="settings-field">
            <label for="issue-timeout-overrun">{{ t("Tillåten överskridning (%)") }}</label>
            <input id="issue-timeout-overrun" type="number" min="0" :max="MAX_TIMEOUT_OVERRUN_PERCENT" step="1" required
              :value="timeoutOverrunPercent" :disabled="!canEditLimit || !timeoutEnabled" aria-describedby="issue-timeout-help" @change="changeTimeout" />
          </div>
          <p id="issue-timeout-help" class="settings-wide">{{ t("Varnar först efter uppskattad totaltid plus tillåten procent. Kräver känd starttid och tillräcklig historik. Standard: 25 %.") }}</p>
        </div>
      </section>
    </div>
    <div class="settings-actions">
      <RepositoryOrderDialog v-if="repositories.length || addExternal" :repos="repositories" :visibility="visibility" :hide-inactive="hideInactive" @toggle-visibility="name => emit('toggleVisibility', name)" @update:hide-inactive="value => emit('update:hideInactive', value)" :add-external="addExternal" @remove-external="name => emit('removeExternal', name)" @reorder="(source, target) => emit('reorder', source, target)" />
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
.settings-dialog { width: 640px; max-width: calc(100% - var(--space-8)); max-height: calc(100dvh - var(--space-8)); padding: var(--space-4); border-radius: var(--space-3); }
.settings-dialog .modal-heading { gap: var(--space-3); margin-bottom: var(--space-3); }
.settings-dialog h2 { margin: 0; }
.settings-grid, .settings-section-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); }
.settings-wide { grid-column: 1 / -1; }
.settings-section { min-width: 0; padding-top: var(--space-3); border-top: 1px solid var(--line); }
.settings-section h3 { margin: 0 0 var(--space-2); font-size: 12px; line-height: 1.4; font-weight: 700; }
.settings-field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.settings-field > label, .settings-field :deep(.rule-field label) { font-size: 12px; line-height: 1.4; }
.settings-field :deep(.rule-field) { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; }
.settings-dialog select#language-preference,
.settings-dialog select#theme-preference,
.settings-dialog .settings-field :deep(input[type="number"]) { width: 100%; min-width: 0; min-height: 36px; margin: 0; padding: var(--space-2); border: 1px solid var(--input-border); border-radius: var(--space-1); background: var(--surface); color: var(--text); font: inherit; font-size: 12px; line-height: 1.4; }
.settings-dialog :deep(select:focus-visible),
.settings-dialog :deep(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.settings-dialog p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
.settings-field :deep(p) { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
.settings-field :deep(p[role="alert"]) { color: var(--accent-red); }
.settings-toggle { display: flex; align-items: center; align-self: start; gap: var(--space-2); min-height: 44px; cursor: pointer; font-size: 12px; line-height: 1.4; }
.settings-toggle input { width: var(--space-5); height: var(--space-5); flex: 0 0 var(--space-5); margin: 0; padding: 0; accent-color: var(--green); }
.settings-toggle:has(input:disabled) { cursor: default; }
.settings-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); border-top: 1px solid var(--line); margin-top: var(--space-3); padding-top: var(--space-3); }
.settings-actions > .button,
.settings-actions :deep(.repository-order-open),
.settings-actions :deep(.permissions-open),
.settings-actions :deep(.workflow-guide > .button) { width: 100%; min-height: 36px; padding: var(--space-2); white-space: normal; font-size: 12px; }
.settings-dialog .modal-footer { justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); }
.settings-dialog .modal-footer .button { min-height: 36px; }
@media (pointer: coarse) {
  .settings-dialog select#language-preference,
  .settings-dialog select#theme-preference,
  .settings-dialog .settings-field :deep(input[type="number"]),
  .settings-actions > .button,
  .settings-actions :deep(.repository-order-open),
  .settings-actions :deep(.permissions-open),
  .settings-actions :deep(.workflow-guide > .button),
  .settings-dialog .modal-footer .button { min-height: 44px; }
}
@media (max-width: 650px), (max-width: 950px) and (max-height: 500px) {
  .settings-grid, .settings-section-fields, .settings-actions { grid-template-columns: minmax(0, 1fr); }
  .settings-dialog { max-width: calc(100% - var(--space-4)); max-height: calc(100dvh - var(--space-4)); }
}
</style>
