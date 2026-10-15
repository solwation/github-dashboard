<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";

const { t, locale } = useLanguage();
// These constants belong to this bundle, including when it is served offline.
const { builtAt, commit } = __BUILD_INFO__;
const builtDate = computed(() =>
  builtAt
    ? new Intl.DateTimeFormat(locale.value, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(builtAt))
    : null,
);
</script>

<template>
  <section class="build-info" :aria-label="t('Bygginformation')">
    <p v-if="builtAt">
      {{ t("Byggd") }}
      <time :datetime="builtAt" :title="builtAt">{{ builtDate }}</time>
    </p>
    <p v-else>{{ t("Utvecklingsläge") }}</p>
    <p>
      {{ t("Commit") }}
      <code v-if="commit" :title="commit">{{ commit.slice(0, 7) }}</code>
      <span v-else>{{ t("Okänd commit") }}</span>
    </p>
  </section>
</template>

<style scoped>
.build-info {
  margin-top: 1.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
.build-info p {
  margin: 0.25rem 0;
  font-size: inherit;
}
.build-info code {
  font-size: inherit;
}
</style>
