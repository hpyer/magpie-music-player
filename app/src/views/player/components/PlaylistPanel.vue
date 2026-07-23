<script setup lang="ts">
import AppSelect, { type AppSelectOption } from '../../../components/AppSelect.vue';
import type { MediaItem } from '../../../types/plugin';

const props = defineProps<{
  addIcon: string;
  canEditCurrentPlaylist: boolean;
  currentMediaKey: string;
  currentPlaylistId: string | null;
  editIcon: string;
  favoriteSongKeys: string[];
  heartIcon: string;
  heartOutlineIcon: string;
  isScanning: boolean;
  playlistHasScanSource: boolean;
  playlistSelectOptions: AppSelectOption[];
  scanStatusLabel: string;
  scanningPlaylistId: string | null;
  searchIcon: string;
  songs: MediaItem[];
  trashIcon: string;
}>();

defineEmits<{
  (event: 'edit-playlist'): void;
  (event: 'create-playlist'): void;
  (event: 'open-song-info-search', value: MediaItem): void;
  (event: 'play-song', value: MediaItem): void;
  (event: 'remove-song', value: MediaItem): void;
  (event: 'scan-current-playlist'): void;
  (event: 'switch-playlist', value: string): void;
  (event: 'toggle-song-favorite', value: MediaItem): void;
}>();

const formatTime = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remain = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remain.toString().padStart(2, '0')}`;
};

const songInitial = (song: MediaItem) => {
  return (song.title || song.artist || '?').trim().charAt(0).toUpperCase() || '?';
};

const favoriteSongKey = (song: MediaItem) => `${song.sourceId}:${song.id}`;
const isFavoriteSong = (song: MediaItem) => props.favoriteSongKeys.includes(favoriteSongKey(song));
</script>

<template>
  <div class="playlist-panel">
    <div class="panel-toolbar">
      <AppSelect
        :model-value="currentPlaylistId"
        :options="playlistSelectOptions"
        placeholder="请选择播放列表"
        aria-label="播放列表"
        @select="$emit('switch-playlist', $event)"
      />
      <button class="panel-icon-btn" title="新建播放列表" aria-label="新建播放列表" @click="$emit('create-playlist')">
        <img class="svg-icon" :src="addIcon" alt="" aria-hidden="true">
      </button>
      <button class="panel-icon-btn" title="编辑播放列表" aria-label="编辑播放列表" :disabled="!canEditCurrentPlaylist" @click="$emit('edit-playlist')">
        <img class="svg-icon" :src="editIcon" alt="" aria-hidden="true">
      </button>
    </div>

    <div class="playlist-scroll-body">
      <div v-if="isScanning && scanningPlaylistId === currentPlaylistId" class="scan-overlay">
        <span>{{ scanStatusLabel }}</span>
      </div>

      <div v-if="songs.length" class="song-list">
        <div
          v-for="(song, index) in songs"
          :key="favoriteSongKey(song)"
          :data-song-id="song.id"
          class="song-row"
          :class="{ active: currentMediaKey === favoriteSongKey(song) }"
          @dblclick="$emit('play-song', song)"
        >
          <span class="song-index">{{ index + 1 }}</span>
          <button
            type="button"
            class="song-cover"
            :title="`查找歌曲信息：${song.title}`"
            :aria-label="`查找歌曲信息：${song.title}`"
            @click.stop="$emit('open-song-info-search', song)"
            @dblclick.stop
          >
            <img v-if="song.cover" :src="song.cover" alt="" aria-hidden="true">
            <span v-else>{{ songInitial(song) }}</span>
            <span class="song-cover-hover" aria-hidden="true">
              <img class="svg-icon" :src="searchIcon" alt="">
            </span>
          </button>
          <span class="song-copy">
            <strong>{{ song.title }}</strong>
            <small>{{ song.artist || 'Unknown Artist' }}</small>
          </span>
          <button
            class="row-icon-btn"
            :title="isFavoriteSong(song) ? '取消收藏' : '收藏'"
            :aria-label="isFavoriteSong(song) ? '取消收藏' : '收藏'"
            @click.stop="$emit('toggle-song-favorite', song)"
          >
            <img class="svg-icon" :src="isFavoriteSong(song) ? heartIcon : heartOutlineIcon" alt="" aria-hidden="true">
          </button>
          <span class="song-duration">{{ formatTime(song.duration) }}</span>
          <button
            type="button"
            class="mini-danger-btn icon-danger-btn song-remove-btn"
            title="删除歌曲"
            aria-label="删除歌曲"
            @click.stop="$emit('remove-song', song)"
            @dblclick.stop
          >
            <img class="svg-icon" :src="trashIcon" alt="" aria-hidden="true">
          </button>
        </div>
      </div>

      <div v-else-if="!(isScanning && scanningPlaylistId === currentPlaylistId)" class="empty-state">
        <p>该播放列表暂无歌曲</p>
        <button
          v-if="playlistHasScanSource"
          class="primary-btn compact"
          :disabled="isScanning"
          @click="$emit('scan-current-playlist')"
        >
          {{ isScanning ? '扫描中' : '立即扫描' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-toolbar :deep(.app-select-value) {
  font-size: 13px;
}
</style>
