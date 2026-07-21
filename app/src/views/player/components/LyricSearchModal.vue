<script setup lang="ts">
import AppModal from '../../../components/AppModal.vue';
import SearchResultItem from './SearchResultItem.vue';
import type { LyricSearchResult } from '../../../types/plugin';
import type { PluginOption } from '../../../types/ui';

defineProps<{
  activeLyricSearchPluginId: string;
  activeLyricSearchResults: Array<LyricSearchResult & { pluginId: string }>;
  closeIcon: string;
  isApplyingResult: boolean;
  isOpen: boolean;
  isSearchingLyrics: boolean;
  lyricPluginLoadingIds: Set<string>;
  lyricSearchArtist: string;
  lyricSearchPlugins: PluginOption[];
  lyricSearchTitle: string;
}>();

defineEmits<{
  (event: 'apply-result', value: LyricSearchResult & { pluginId: string }): void;
  (event: 'close'): void;
  (event: 'search'): void;
  (event: 'update:activeLyricSearchPluginId', value: string): void;
  (event: 'update:lyricSearchArtist', value: string): void;
  (event: 'update:lyricSearchTitle', value: string): void;
}>();
</script>

<template>
  <AppModal
    :open="isOpen"
    title="查找歌词"
    :close-icon="closeIcon"
    @close="$emit('close')"
  >
    <div class="lyric-search-panel search-modal-panel">
      <form class="lyric-search-form" @submit.prevent="$emit('search')">
        <input :value="lyricSearchTitle" type="text" autocomplete="off" placeholder="歌曲名" @input="$emit('update:lyricSearchTitle', ($event.target as HTMLInputElement).value)">
        <input :value="lyricSearchArtist" type="text" autocomplete="off" placeholder="歌手名" @input="$emit('update:lyricSearchArtist', ($event.target as HTMLInputElement).value)">
        <button type="submit" class="secondary-action-btn" :disabled="isSearchingLyrics || !lyricSearchTitle.trim() || !lyricSearchPlugins.length">
          {{ isSearchingLyrics ? '搜索中' : '搜索' }}
        </button>
      </form>

      <div class="search-plugin-layout">
        <aside v-if="lyricSearchPlugins.length" class="search-plugin-tabs" role="tablist" aria-label="歌词插件">
          <button
            v-for="plugin in lyricSearchPlugins"
            :key="plugin.id"
            type="button"
            class="search-plugin-tab"
            :class="{ active: activeLyricSearchPluginId === plugin.id, loading: lyricPluginLoadingIds.has(plugin.id) }"
            @click="$emit('update:activeLyricSearchPluginId', plugin.id)"
          >
            <span>{{ plugin.name }}</span>
            <span v-if="lyricPluginLoadingIds.has(plugin.id)" class="tab-loading-dot" aria-hidden="true"></span>
          </button>
        </aside>

        <div class="lyric-result-list search-result-pane">
          <p v-if="!lyricSearchPlugins.length" class="settings-empty">没有安装相关歌词插件</p>
          <p v-else-if="lyricPluginLoadingIds.has(activeLyricSearchPluginId)" class="settings-empty">正在查找歌词</p>
          <p v-else-if="!activeLyricSearchResults.length" class="settings-empty">暂无歌词结果</p>
          <SearchResultItem
            v-for="result in activeLyricSearchResults"
            :key="`${result.pluginId}:${result.id}`"
            :album="result.album"
            :artist="result.artist"
            :disabled="isApplyingResult"
            :image="result.thumbnail || result.imageUrl || result.cover"
            :title="result.title"
            @select="$emit('apply-result', result)"
          />
        </div>
      </div>

      <div v-if="isApplyingResult" class="search-apply-overlay" aria-live="polite">
        <span class="search-apply-spinner" aria-hidden="true"></span>
        <strong>正在应用歌词</strong>
      </div>
    </div>
  </AppModal>
</template>
