<script setup lang="ts">
import type { MediaItem } from '../../../types/plugin';
import type { PluginOption } from '../../../types/ui';

defineProps<{
  activeMusicSearchPluginId: string;
  activeMusicSearchResults: MediaItem[];
  isMediaCacheAllowed: (media: MediaItem) => boolean;
  isCachingNetworkSongId: string | null;
  isSearchingNetworkMusic: boolean;
  musicSearchPlugins: PluginOption[];
  networkSearchQuery: string;
}>();

defineEmits<{
  (event: 'add-network-song', value: MediaItem): void;
  (event: 'cache-network-song', value: MediaItem): void;
  (event: 'play-network-song', value: MediaItem): void;
  (event: 'search-network-music'): void;
  (event: 'update:activeMusicSearchPluginId', value: string): void;
  (event: 'update:networkSearchQuery', value: string): void;
}>();

const songInitial = (song: MediaItem) => {
  return (song.title || song.artist || '?').trim().charAt(0).toUpperCase() || '?';
};
</script>

<template>
  <div class="search-panel">
    <form class="network-search-bar standalone" @submit.prevent="$emit('search-network-music')">
      <input
        :value="networkSearchQuery"
        type="search"
        autocomplete="off"
        placeholder="搜索网络歌曲"
        @input="$emit('update:networkSearchQuery', ($event.target as HTMLInputElement).value)"
      >
      <button type="submit" class="secondary-action-btn" :disabled="isSearchingNetworkMusic || !networkSearchQuery.trim()">
        {{ isSearchingNetworkMusic ? '搜索中' : '搜索' }}
      </button>
    </form>

    <div v-if="musicSearchPlugins.length" class="plugin-result-tabs">
      <button
        v-for="plugin in musicSearchPlugins"
        :key="plugin.id"
        type="button"
        class="result-tab"
        :class="{ active: activeMusicSearchPluginId === plugin.id }"
        @click="$emit('update:activeMusicSearchPluginId', plugin.id)"
      >
        {{ plugin.name }}
      </button>
    </div>

    <div class="search-result-body">
      <p v-if="!musicSearchPlugins.length" class="settings-empty">没有安装相关搜索歌曲插件</p>
      <p v-else-if="isSearchingNetworkMusic" class="settings-empty">正在搜索歌曲</p>
      <div v-else-if="activeMusicSearchResults.length" class="song-list">
        <div
          v-for="song in activeMusicSearchResults"
          :key="`${song.sourceId}:${song.id}`"
          class="song-row network-song-row"
          @dblclick="$emit('play-network-song', song)"
        >
          <span class="song-index">网</span>
          <span class="song-cover" :title="song.album || song.title">
            <img v-if="song.cover" :src="song.cover" alt="" aria-hidden="true">
            <span v-else>{{ songInitial(song) }}</span>
          </span>
          <span class="song-copy">
            <strong>{{ song.title }}</strong>
            <small>{{ song.artist || 'Unknown Artist' }}</small>
          </span>
          <div class="network-song-actions">
            <button type="button" class="mini-action-btn" @click.stop="$emit('play-network-song', song)">播放</button>
            <button type="button" class="mini-action-btn" @click.stop="$emit('add-network-song', song)">加入</button>
            <button
              type="button"
              class="mini-action-btn"
              :disabled="isCachingNetworkSongId === song.id || !isMediaCacheAllowed(song)"
              :title="isMediaCacheAllowed(song) ? '缓存' : '该来源未允许缓存'"
              @click.stop="$emit('cache-network-song', song)"
            >
              {{ isCachingNetworkSongId === song.id ? '缓存中' : '缓存' }}
            </button>
          </div>
        </div>
      </div>
      <p v-else class="settings-empty">暂无搜索结果</p>
    </div>
  </div>
</template>
