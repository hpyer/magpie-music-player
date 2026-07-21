<script setup lang="ts">
import AppModal from '../../../components/AppModal.vue';
import SearchResultItem from './SearchResultItem.vue';
import type { SongInfoSearchResult } from '../../../types/plugin';
import type { PluginOption } from '../../../types/ui';

defineProps<{
  activeSongInfoSearchPluginId: string;
  activeSongInfoSearchResults: Array<SongInfoSearchResult & { pluginId: string }>;
  closeIcon: string;
  isApplyingResult: boolean;
  songInfoSearchArtist: string;
  songInfoSearchPlugins: PluginOption[];
  songInfoSearchTitle: string;
  isOpen: boolean;
  isSearchingSongInfo: boolean;
  songInfoPluginLoadingIds: Set<string>;
}>();

defineEmits<{
  (event: 'apply-result', value: SongInfoSearchResult & { pluginId: string }): void;
  (event: 'close'): void;
  (event: 'search'): void;
  (event: 'update:activeSongInfoSearchPluginId', value: string): void;
  (event: 'update:songInfoSearchArtist', value: string): void;
  (event: 'update:songInfoSearchTitle', value: string): void;
}>();
</script>

<template>
  <AppModal
    :open="isOpen"
    title="查找歌曲信息"
    :close-icon="closeIcon"
    @close="$emit('close')"
  >
    <div class="lyric-search-panel song-info-search-panel search-modal-panel">
      <form class="lyric-search-form" @submit.prevent="$emit('search')">
        <input :value="songInfoSearchTitle" type="text" autocomplete="off" placeholder="歌曲名" @input="$emit('update:songInfoSearchTitle', ($event.target as HTMLInputElement).value)">
        <input :value="songInfoSearchArtist" type="text" autocomplete="off" placeholder="歌手名" @input="$emit('update:songInfoSearchArtist', ($event.target as HTMLInputElement).value)">
        <button type="submit" class="secondary-action-btn" :disabled="isSearchingSongInfo || (!songInfoSearchTitle.trim() && !songInfoSearchArtist.trim()) || !songInfoSearchPlugins.length">
          {{ isSearchingSongInfo ? '搜索中' : '搜索' }}
        </button>
      </form>

      <div class="search-plugin-layout">
        <aside v-if="songInfoSearchPlugins.length" class="search-plugin-tabs" role="tablist" aria-label="歌曲信息插件">
          <button
            v-for="plugin in songInfoSearchPlugins"
            :key="plugin.id"
            type="button"
            class="search-plugin-tab"
            :class="{ active: activeSongInfoSearchPluginId === plugin.id, loading: songInfoPluginLoadingIds.has(plugin.id) }"
            @click="$emit('update:activeSongInfoSearchPluginId', plugin.id)"
          >
            <span>{{ plugin.name }}</span>
            <span v-if="songInfoPluginLoadingIds.has(plugin.id)" class="tab-loading-dot" aria-hidden="true"></span>
          </button>
        </aside>

        <div class="song-info-result-list search-result-pane">
          <p v-if="!songInfoSearchPlugins.length" class="settings-empty">没有安装相关歌曲信息插件</p>
          <p v-else-if="songInfoPluginLoadingIds.has(activeSongInfoSearchPluginId)" class="settings-empty">正在查找歌曲信息</p>
          <p v-else-if="!activeSongInfoSearchResults.length" class="settings-empty">暂无歌曲信息结果</p>
          <SearchResultItem
            v-for="result in activeSongInfoSearchResults"
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
        <strong>正在应用歌曲信息</strong>
      </div>
    </div>
  </AppModal>
</template>
