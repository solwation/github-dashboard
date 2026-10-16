<script setup lang="ts">
// Round red count for notices. The owning button references it with aria-describedby.
defineProps<{ id: string; count: number; label: string }>();
</script>
<template>
  <span v-if="count > 0" :id="id" class="notice-badge" role="status" :aria-label="label">{{ count }}</span>
</template>
<style scoped>
.notice-badge { background: #b91c1c; color: white; border-radius: 50%; padding: 0; width: 1.375rem; height: 1.375rem; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: .75rem; font-weight: 700; }
</style>
