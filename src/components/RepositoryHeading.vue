<script setup lang="ts">
import ProjectIcon from "./ProjectIcon.vue";
import { ArrowRight, ChevronDown, ChevronRight } from "@lucide/vue";
import type { Repo } from "../lib/model";
import { useLanguage } from "../lib/i18n";
withDefaults(defineProps<{
  repository: Repo;
  collapsed?: boolean;
  collapsible?: boolean;
  controls: string;
  headingId?: string;
  label?: string;
  toggleName?: string;
  toggleClass?: string;
}>(), { collapsible: true });
const emit = defineEmits<{ toggle: [] }>();
const { t } = useLanguage();
</script>

<template>
  <div class="lane-title">
    <button v-if="collapsible !== false" type="button" class="collapse-project icon-button" :class="toggleClass"
      :aria-label="t(collapsed ? 'Expandera {name}' : 'Kollapsa {name}', { name: toggleName || repository.full_name })"
      :title="t(collapsed ? 'Expandera {name}' : 'Kollapsa {name}', { name: toggleName || repository.full_name })"
      :aria-expanded="!collapsed" :aria-controls="controls" @click="emit('toggle')">
      <ChevronRight v-if="collapsed" :size="16" aria-hidden="true" /><ChevronDown v-else :size="16" aria-hidden="true" />
    </button>
    <ProjectIcon :repository="repository.full_name" :size="20" />
    <div>
      <h2 :id="headingId">
        <a :href="repository.html_url" :title="repository.full_name" :aria-label="repository.full_name" target="_blank" rel="noopener noreferrer"><span class="repository-name-text">{{ label || repository.name }}</span><ArrowRight :size="12" aria-hidden="true" /></a>
        <span v-if="repository.private || $slots.badges" class="repository-badges"><span v-if="repository.private" class="private-badge">{{ t("Privat") }}</span><slot name="badges" /></span>
      </h2>
      <span class="repo-owner" :title="repository.description || repository.owner.login">{{ repository.owner.login }} <span> / </span>{{ repository.description || "GitHub repository" }}</span>
    </div>
  </div>
</template>
