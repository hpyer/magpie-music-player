<script setup lang="ts">
import type { LyricLine, ParsedLyric } from '../../../types/ui';

defineProps<{
  activeLyricIndex: number;
  currentSongExists: boolean;
  isSearchingLyrics: boolean;
  lyricLines: LyricLine[];
  parsedLyric: ParsedLyric;
}>();

defineEmits<{
  (event: 'open-lyric-search'): void;
}>();
</script>

<template>
  <div class="lyrics-panel" :class="{ 'is-synced': parsedLyric.isSynced }">
    <div class="lyrics-toolbar">
      <button type="button" class="mini-action-btn" :disabled="!currentSongExists || isSearchingLyrics" @click="$emit('open-lyric-search')">
        {{ isSearchingLyrics ? '查找中' : '查找歌词' }}
      </button>
    </div>
    <div class="lyrics-list">
      <p
        v-for="(line, index) in lyricLines"
        :key="`${line.time ?? 'plain'}-${line.text}-${index}`"
        :data-lyric-index="index"
        class="lyric-line"
        :class="{
          active: parsedLyric.isSynced && activeLyricIndex === index,
          passed: parsedLyric.isSynced && activeLyricIndex > index,
        }"
      >
        {{ line.text }}
      </p>
    </div>
  </div>
</template>
