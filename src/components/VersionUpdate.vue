<script setup lang="ts">
import { useAppUpdate } from "../composables/useAppUpdate";
import { useLanguage } from "../lib/i18n";
const { available, seconds, applying, error, reloadNow } = useAppUpdate();
const { t } = useLanguage();
</script>
<template>
  <aside v-if="available" class="version-update" role="status" aria-live="polite" aria-atomic="true">
    <div>
      <strong>{{ t('En ny version av Issueflow finns tillgänglig.') }}</strong>
      <p v-if="error">{{ t(error) }}</p>
      <p v-else-if="applying">{{ t('Uppdaterar…') }}</p>
      <p v-else>{{ t('Uppdaterar automatiskt om {seconds} sekunder.', { seconds }) }}</p>
    </div>
    <button class="button primary" :disabled="applying" @click="reloadNow">{{ t('Uppdatera nu') }}</button>
  </aside>
</template>
<style scoped>
.version-update { position: fixed; z-index: 150; bottom: 1rem; left: 50%; transform: translateX(-50%); width: min(42rem, calc(100vw - 2rem)); box-sizing: border-box; display: flex; gap: 1rem; align-items: center; justify-content: space-between; border: 1px solid var(--green, #147d69); border-radius: .9rem; background: #fff; color: #273a3c; padding: 1rem 1.25rem; box-shadow: 0 8px 32px #273a3c24; }
.version-update p { margin: .3rem 0 0; font-size: .875rem; }
.version-update button { flex-shrink: 0; }
@media (max-width: 540px) { .version-update { flex-direction: column; align-items: stretch; bottom: max(.75rem, env(safe-area-inset-bottom)); padding: 1rem; } }
</style>
