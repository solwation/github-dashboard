<script setup lang="ts">
import { useId } from "vue";
import { useLanguage } from "../lib/i18n";
import BuildInfo from "./BuildInfo.vue";

// The automatic prompt. State comes from the single controller in App.vue.
defineProps<{
  open: boolean;
  seconds: number;
  counting: boolean;
  applying: boolean;
  error: string;
  /** Short improvement summary between installed and available version; empty hides it. */
  summary: string;
  availableVersion?: { builtAt: string | null; commit: string | null } | null;
}>();
const emit = defineEmits<{ install: []; defer: []; "read-more": [] }>();
const { t } = useLanguage();
const titleId = useId();
</script>
<template>
  <aside v-if="open" class="version-update" role="status" aria-live="polite" :aria-labelledby="titleId">
    <div class="version-update-body">
      <strong :id="titleId">{{ t("En ny version av Issueflow finns tillgänglig.") }}</strong>
      <p v-if="availableVersion" class="version-update-build">
        {{ t("Ny version:") }} <BuildInfo :built-at="availableVersion.builtAt" :commit="availableVersion.commit" />
      </p>
      <p v-if="summary" class="version-update-summary">{{ summary }}</p>
      <p v-if="error">{{ t(error) }}</p>
      <p v-else-if="applying">{{ t("Uppdaterar…") }}</p>
      <p v-else-if="counting">{{ t("Uppdaterar automatiskt om {seconds} sekunder.", { seconds }) }}</p>
    </div>
    <div class="version-update-actions">
      <button v-if="summary" type="button" class="button" @click="emit('read-more')">{{ t("Läs mer") }}</button>
      <button type="button" class="button" :disabled="applying" @click="emit('defer')">{{ t("Inte nu") }}</button>
      <button type="button" class="button primary" :disabled="applying" @click="emit('install')">{{ t("Uppdatera nu") }}</button>
    </div>
  </aside>
</template>
<style scoped>
.version-update {
  position: fixed;
  z-index: 150;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(42rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  box-sizing: border-box;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--green, #147d69);
  border-radius: 0.9rem;
  background: #fff;
  color: #273a3c;
  padding: 1rem 1.25rem;
  box-shadow: 0 8px 32px #273a3c24;
}
.version-update-body { min-width: 0; }
.version-update p {
  margin: 0.3rem 0 0;
  font-size: 0.875rem;
}
.version-update-summary { white-space: pre-line; line-height: 1.5; overflow-wrap: anywhere; }
.version-update-build { color: var(--muted); }
.version-update-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}
@media (max-width: 540px) {
  .version-update {
    flex-direction: column;
    align-items: stretch;
    bottom: max(0.75rem, env(safe-area-inset-bottom));
    padding: 1rem;
  }
  .version-update-actions { justify-content: stretch; }
  .version-update-actions .button { flex: 1 1 auto; justify-content: center; }
}
</style>
