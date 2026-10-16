<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";

// Without props this shows the running bundle, including when it is served offline.
const props = defineProps<{ builtAt?: string | null; commit?: string | null }>();
const { t, locale } = useLanguage();
const builtAt = computed(() => (props.builtAt === undefined ? __BUILD_INFO__.builtAt : props.builtAt));
const commit = computed(() => (props.commit === undefined ? __BUILD_INFO__.commit : props.commit));
const builtDate = computed(() =>
  builtAt.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }).format(new Date(builtAt.value))
    : null,
);
</script>

<template>
  <span class="build-identity">
    <time v-if="builtAt" :datetime="builtAt" :title="builtAt">{{ builtDate }}</time>
    <span v-else>{{ t("Utvecklingsläge") }}</span>
    <code v-if="commit" :title="commit">{{ commit.slice(0, 7) }}</code>
    <span v-else>{{ t("Okänd commit") }}</span>
  </span>
</template>

<style scoped>
.build-identity { display: inline-flex; flex-wrap: wrap; gap: 0 .4em; overflow-wrap: anywhere; }
.build-identity code { font-size: inherit; }
</style>
