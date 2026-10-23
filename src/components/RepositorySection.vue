<script setup lang="ts">
defineProps<{ collapsed?: boolean; headingClass?: string }>();
</script>

<template>
  <section class="repo-lane" :class="{ 'is-collapsed': collapsed }">
    <header class="lane-header" :class="headingClass"><slot name="header" /></header>
    <slot />
  </section>
</template>
