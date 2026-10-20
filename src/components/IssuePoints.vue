<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";
import { approximatePoints } from "../lib/story-points";
import type { Issue } from "../lib/model";

const props = defineProps<{ issue: Issue }>();
const { t } = useLanguage();
const points = computed(() => approximatePoints(props.issue));
const label = computed(() => t("Uppskattade story points: cirka {points}", { points: points.value }));
</script>

<template>
  <span class="issue-points" role="img" :aria-label="label"
    :title="label + '. ' + t('Grov storlek på skalan 1/2/3/5/8/13. En entydig poängetikett används först, annars en lokal uppskattning från titel och beskrivning. Inte uppmätt komplexitet.')"
  >≈ {{ points }} SP</span>
</template>
