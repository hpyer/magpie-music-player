<script setup lang="ts">
defineProps<{
  album?: string;
  artist?: string;
  disabled?: boolean;
  image?: string;
  title: string;
}>();

defineEmits<{
  (event: 'select'): void;
}>();
</script>

<template>
  <button
    type="button"
    class="search-result-item"
    :disabled="disabled"
    @click="$emit('select')"
  >
    <span class="search-result-thumb">
      <img v-if="image" :src="image" alt="" aria-hidden="true">
      <span v-else class="search-result-placeholder" aria-hidden="true">{{ title.slice(0, 1) || '?' }}</span>
    </span>
    <span class="search-result-copy">
      <strong>{{ title }}</strong>
      <span v-if="artist" class="search-result-meta search-result-artist">
        <span class="search-result-meta-label">艺人</span>
        <span>{{ artist }}</span>
      </span>
      <small v-if="album" class="search-result-meta search-result-album">
        <span class="search-result-meta-label">专辑</span>
        <span>{{ album }}</span>
      </small>
    </span>
  </button>
</template>
