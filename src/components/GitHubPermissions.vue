<script setup lang="ts">
import { ref } from "vue";
import { X } from "@lucide/vue";
import NoticeBadge from "./NoticeBadge.vue";
import { permissionDefinitions, type PermissionReport, type PermissionReason } from '../lib/permissions';
import { useLanguage } from '../lib/i18n';
const { t } = useLanguage();
defineProps<{ report: PermissionReport; checking?: boolean; canCheck?: boolean; notices?: number }>();
const emit = defineEmits<{ check: []; opened: []; closed: [] }>();
const dialog = ref<HTMLDialogElement>();
const reasons: Record<PermissionReason, string> = {
  'private-access': 'Bekräftad läsåtkomst till detta privata repository. Detta visar faktisk åtkomst, inte tokenens exakta tilldelning.',
  'public-access': 'Publika data kan läsas utan denna tilldelade rättighet. Tokenens rättighet är därför inte verifierad.',
  denied: 'GitHub nekar uttryckligen tokenens åtkomst. Kontrollera rättighet, repositoryurval och organisationens regler.',
  unverified: 'Åtkomsten kan inte verifieras ännu. Nätverksfel, API-gränser och otydliga svar räknas inte som saknade rättigheter.',
};
const statusLabels = { granted: 'Åtkomst bekräftad', missing: 'Åtkomst saknas', unknown: 'Ej verifierad' };
</script>
<template>
  <button class="button small permissions-open" aria-label="GitHub permissions" :aria-describedby="notices ? 'permissions-notices' : undefined"
    @click="dialog?.showModal(); emit('opened'); emit('check')">
    GitHub permissions
    <NoticeBadge id="permissions-notices" :count="notices ?? 0" :label="t('{count} saknade GitHub-rättigheter', { count: notices ?? 0 })" />
  </button>
  <dialog ref="dialog" class="permissions-dialog" aria-labelledby="github-permissions-title" @close="emit('closed')"
    @click="event => { if (event.target === dialog) dialog?.close(); }">
    <div class="permissions-heading">
      <h2 id="github-permissions-title">GitHub permissions</h2>
      <button class="icon-button" :aria-label="t('Stäng')" autofocus @click="dialog?.close()"><X :size="20" /></button>
    </div>
    <div class="permissions-content" :aria-busy="checking">
      <p>{{ t('Läsrättigheter styr vilka funktioner du kan använda. Saknad åtkomst döljer motsvarande information. Kontrollen ändrar ingenting på GitHub.') }}</p>
      <p>{{ t('Kontrollen gäller valda repositories. GitHub visar inte en fullständig lista över tokenens tilldelade rättigheter. Repositoryurval och organisationsregler kan också begränsa åtkomsten.') }}</p>
      <p v-if="checking" role="status">{{ t('Kontrollerar rättigheter…') }}</p>
      <p v-if="!canCheck">{{ t('Logga in för att kontrollera GitHub-rättigheter.') }}</p>
      <p v-else-if="!report.some(entry => entry.repositories.length)">{{ t('Välj minst ett repository för att kontrollera åtkomsten.') }}</p>
      <div class="permissions-table-scroll" tabindex="0" role="region" :aria-label="t('Översikt över GitHub-rättigheter')">
        <table class="permissions-table">
          <thead><tr><th scope="col">{{ t('Rättighet') }}</th><th scope="col">{{ t('Funktioner i dashboarden') }}</th><th scope="col">{{ t('Åtkomst per repository') }}</th></tr></thead>
          <tbody>
            <tr v-for="definition in permissionDefinitions" :key="definition.id" class="permission-entry">
              <th scope="row">{{ definition.name }}: {{ t('Läs') }}</th>
              <td>{{ t(definition.feature) }}</td>
              <td>
                <ul v-if="report.find(entry => entry.permission === definition.id)?.repositories.length" class="permission-repositories">
                  <li v-for="repository in report.find(entry => entry.permission === definition.id)!.repositories" :key="repository.repo">
                    <strong>{{ repository.repo }}</strong>
                    <span :class="['permission-status', repository.reason === 'public-access' ? 'public-read' : repository.status]">
                      <span aria-hidden="true">{{ repository.status === 'granted' || repository.reason === 'public-access' ? '✓' : repository.status === 'missing' ? '✕' : '–' }}</span>
                      {{ t(repository.reason === 'public-access' ? 'Publik läsåtkomst' : statusLabels[repository.status]) }}
                    </span>
                    <p>{{ t(reasons[repository.reason]) }}</p>
                  </li>
                </ul>
                <span v-else class="permission-status unknown">{{ t('Ej verifierad') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </dialog>
</template>
<style scoped>
.permissions-dialog { box-sizing: border-box; width: min(72rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); padding: 1.25rem; border: 1px solid var(--line); border-radius: .8rem; background: white; color: #273a3c; overflow: hidden; }
.permissions-dialog[open] { display: flex; flex-direction: column; }
.permissions-dialog::backdrop { background: #152d3a60; backdrop-filter: blur(3px); }
.permissions-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-shrink: 0; }
.permissions-heading h2 { font-size: 1rem; margin: 0; }
.permissions-content { min-height: 0; overflow-y: auto; font-size: .8125rem; line-height: 1.6; }
.permissions-content > p { max-width: 65rem; }
.permissions-table-scroll { margin-top: 1rem; overflow-x: auto; }
.permissions-table { width: 100%; min-width: 40rem; border-collapse: collapse; table-layout: fixed; }
.permissions-table th, .permissions-table td { border: 1px solid var(--line); padding: .8rem; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.permissions-table thead { background: #f1f6f4; }
.permissions-table th:first-child { width: 17%; }
.permissions-table th:nth-child(2) { width: 28%; }
.permission-repositories { padding: 0; margin: 0; list-style: none; }
.permission-repositories li + li { margin-top: .8rem; padding-top: .8rem; border-top: 1px solid var(--line); }
.permission-repositories p { margin: .25rem 0 0; }
.permission-status { display: block; font-weight: 600; margin-block: .25rem; }
.granted, .public-read { color: #167047; }
.missing { color: #b91c1c; }
.unknown { color: var(--muted, #61727b); }
.permissions-table-scroll:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
</style>
