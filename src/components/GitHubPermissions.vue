<script setup lang="ts">
import { permissionDefinitions, type PermissionReport, type PermissionReason } from '../lib/permissions';
import { useLanguage } from '../lib/i18n';
const { t } = useLanguage();
defineProps<{ report: PermissionReport; checking?: boolean; canCheck?: boolean }>();
const emit = defineEmits<{ check: [] }>();
const reasons: Record<PermissionReason, string> = {
  'private-access': 'Bekräftad läsåtkomst till detta privata repository. Detta visar faktisk åtkomst, inte tokenens exakta tilldelning.',
  'public-access': 'Publika data kan läsas utan denna tilldelade rättighet. Tokenens rättighet är därför inte verifierad.',
  denied: 'GitHub nekar uttryckligen tokenens åtkomst. Kontrollera rättighet, repositoryurval och organisationens regler.',
  unverified: 'Åtkomsten kan inte verifieras ännu. Nätverksfel, API-gränser och otydliga svar räknas inte som saknade rättigheter.',
};
const statusLabels = { granted: 'Åtkomst bekräftad', missing: 'Åtkomst saknas', unknown: 'Ej verifierad' };
</script>
<template>
  <section class="permissions" aria-labelledby="github-permissions-title" :aria-busy="checking">
    <div class="permissions-heading">
      <h3 id="github-permissions-title">GitHub permissions</h3>
      <button class="button small" :disabled="checking || !canCheck" @click="emit('check')">{{ t(checking ? 'Kontrollerar rättigheter…' : 'Uppdatera kontrollen') }}</button>
    </div>
    <p>{{ t('Läsrättigheter styr vilka funktioner du kan använda. Saknad åtkomst döljer motsvarande information. Kontrollen ändrar ingenting på GitHub.') }}</p>
    <p>{{ t('Kontrollen gäller valda repositories. GitHub visar inte en fullständig lista över tokenens tilldelade rättigheter. Repositoryurval och organisationsregler kan också begränsa åtkomsten.') }}</p>
    <p v-if="!canCheck">{{ t('Logga in för att kontrollera GitHub-rättigheter.') }}</p>
    <p v-else-if="!report.some(entry => entry.repositories.length)">{{ t('Välj minst ett repository för att kontrollera åtkomsten.') }}</p>
    <article v-for="definition in permissionDefinitions" :key="definition.id" class="permission-entry">
      <h4>{{ definition.name }}: {{ t('Läs') }}</h4>
      <p>{{ t(definition.feature) }}</p>
      <ul v-if="report.find(entry => entry.permission === definition.id)?.repositories.length" class="permission-repositories">
        <li v-for="repository in report.find(entry => entry.permission === definition.id)!.repositories" :key="repository.repo">
          <span :class="['permission-status', repository.status]">
            <span aria-hidden="true">{{ repository.status === 'granted' ? '✓' : repository.status === 'missing' ? '✕' : '–' }}</span>
            {{ t(statusLabels[repository.status]) }}
          </span>
          <strong>{{ repository.repo }}</strong>
          <p>{{ t(reasons[repository.reason]) }}</p>
        </li>
      </ul>
      <p v-else class="permission-status unknown">{{ t('Ej verifierad') }}</p>
    </article>
  </section>
</template>
<style scoped>
.permissions { font-size: .8125rem; line-height: 1.5; margin-top: 1.5rem; border-top: 1px solid var(--border, #3c4352); padding-top: 1rem; }
.permissions-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; }
.permissions-heading h3 { margin: 0; font-size: .875rem; }
.permission-entry { padding-block: .5rem; }
.permission-entry h4 { margin-block: .5rem; font-size: .8125rem; }
.permission-repositories { padding-left: 1.2rem; }
.permission-repositories li { margin-block: .8rem; overflow-wrap: anywhere; }
.permission-status { display: block; font-weight: 600; margin-bottom: .3rem; }
.granted { color: #167047; }
.missing { color: #b91c1c; }
.unknown { color: var(--muted, #adb5c5); }
</style>
