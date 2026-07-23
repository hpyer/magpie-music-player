<script setup lang="ts">
import LyricsPanel from './components/LyricsPanel.vue';
import NetworkSearchPanel from './components/NetworkSearchPanel.vue';
import PlaylistPanel from './components/PlaylistPanel.vue';
import type { AppSelectOption } from '../../components/AppSelect.vue';
import type { MediaItem } from '../../types/plugin';
import type { PanelMode, ParsedLyric, PluginOption, RepeatMode } from '../../types/ui';

defineProps<{
  activeLyricIndex: number;
  activeMusicSearchPluginId: string;
  activeMusicSearchResults: MediaItem[];
  addIcon: string;
  albumLine: string;
  appName: string;
  cacheProgressPercent: number;
  cacheTrackState: 'default' | 'empty' | 'downloading' | 'complete';
  canEditCurrentPlaylist: boolean;
  closeIcon: string;
  currentMediaKey: string;
  currentSong: MediaItem | null;
  currentSongIsFavorite: boolean;
  displayedCurrentTime: number;
  displayedDuration: number;
  editIcon: string;
  expandedPanel: PanelMode;
  favoriteSongKeys: string[];
  heartIcon: string;
  heartOutlineIcon: string;
  isCachingNetworkSongId: string | null;
  isMediaCacheAllowed: (media: MediaItem) => boolean;
  isSearchingLyrics: boolean;
  isSearchingNetworkMusic: boolean;
  isSettingsModalOpen: boolean;
  isScanning: boolean;
  isVolumePopoverOpen: boolean;
  lyricLines: ParsedLyric['lines'];
  lyricsIcon: string;
  minimizeIcon: string;
  musicSearchPlugins: PluginOption[];
  networkSearchQuery: string;
  nextIcon: string;
  parsedLyric: ParsedLyric;
  pauseIcon: string;
  playIcon: string;
  playerCurrentMedia: MediaItem | null;
  playerIsPlaying: boolean;
  playerVolume: number;
  playlistHasScanSource: boolean;
  playlistIcon: string;
  playlistSelectOptions: AppSelectOption[];
  previousIcon: string;
  progressPercent: number;
  repeatIcon: string;
  repeatMode: RepeatMode;
  repeatTitle: string;
  scanStatusLabel: string;
  scanningPlaylistId: string | null;
  searchIcon: string;
  settingsIcon: string;
  shuffleEnabled: boolean;
  shuffleIcon: string;
  songs: MediaItem[];
  surfaceThemeStyle: Record<string, string>;
  trashIcon: string;
  volumeIcon: string;
  volumePercent: number;
  currentPlaylistId: string | null;
}>();

defineEmits<{
  (event: 'add-network-song', value: MediaItem): void;
  (event: 'cache-network-song', value: MediaItem): void;
  (event: 'close'): void;
  (event: 'create-playlist'): void;
  (event: 'edit-playlist'): void;
  (event: 'handle-seek', value: Event): void;
  (event: 'handle-volume-input', value: Event): void;
  (event: 'open-song-info-search', value: MediaItem): void;
  (event: 'open-lyric-search'): void;
  (event: 'open-settings'): void;
  (event: 'play-by-offset', value: number): void;
  (event: 'play-network-song', value: MediaItem): void;
  (event: 'play-song', value: MediaItem): void;
  (event: 'remove-song', value: MediaItem): void;
  (event: 'scan-current-playlist'): void;
  (event: 'search-network-music'): void;
  (event: 'start-window-drag', value: PointerEvent): void;
  (event: 'minimize'): void;
  (event: 'switch-playlist', value: string): void;
  (event: 'toggle-current-favorite'): void;
  (event: 'toggle-panel', value: Exclude<PanelMode, null>): void;
  (event: 'toggle-play'): void;
  (event: 'toggle-repeat-mode'): void;
  (event: 'toggle-shuffle'): void;
  (event: 'toggle-song-favorite', value: MediaItem): void;
  (event: 'toggle-volume-popover'): void;
  (event: 'update:activeMusicSearchPluginId', value: string): void;
  (event: 'update:networkSearchQuery', value: string): void;
}>();

const formatTime = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remain = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remain.toString().padStart(2, '0')}`;
};
</script>

<template>
  <div class="window-shell" @pointerdown="$emit('start-window-drag', $event)">
    <section class="player-card app-surface" :style="surfaceThemeStyle" :class="{ 'is-expanded': expandedPanel || isSettingsModalOpen }" @pointerdown="$emit('start-window-drag', $event)">
      <button class="settings-btn" title="设置" aria-label="设置" @click="$emit('open-settings')">
        <img class="svg-icon" :src="settingsIcon" alt="" aria-hidden="true">
      </button>
      <button
        v-if="musicSearchPlugins.length"
        class="search-btn"
        :class="{ active: expandedPanel === 'search' }"
        title="搜索歌曲"
        aria-label="搜索歌曲"
        @click="$emit('toggle-panel', 'search')"
      >
        <img class="svg-icon" :src="searchIcon" alt="" aria-hidden="true">
      </button>
      <button class="minimize-btn" title="最小化" aria-label="最小化" @click="$emit('minimize')">
        <img class="svg-icon" :src="minimizeIcon" alt="" aria-hidden="true">
      </button>
      <button class="close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
        <img class="svg-icon" :src="closeIcon" alt="" aria-hidden="true">
      </button>

      <header class="track-header">
        <transition name="track-fade">
          <div class="track-copy" :key="currentSong?.id || 'empty-track'">
            <h1>{{ currentSong?.title || 'Song Name' }}</h1>
            <p :title="albumLine">{{ albumLine }}</p>
          </div>
        </transition>
      </header>

      <div class="progress-block">
        <input
          class="progress-slider"
          type="range"
          min="0"
          :max="displayedDuration"
          :value="displayedCurrentTime"
          :style="{ '--progress': `${progressPercent}%`, '--cache-progress': `${cacheProgressPercent}%` }"
          :data-cache-state="cacheTrackState"
          :title="cacheProgressPercent > 0 && cacheProgressPercent < 100 ? `缓存 ${Math.round(cacheProgressPercent)}%` : undefined"
          :disabled="!currentSong"
          aria-label="播放进度"
          @input="$emit('handle-seek', $event)"
        >
        <div class="time-row">
          <span>{{ formatTime(displayedCurrentTime) }}</span>
          <span>{{ formatTime(displayedDuration) }}</span>
        </div>
      </div>

      <div class="control-grid">
        <button class="tool-btn mode-btn" :class="{ active: shuffleEnabled }" :title="shuffleEnabled ? '随机播放已开启' : '顺序播放'" aria-label="随机播放" @click="$emit('toggle-shuffle')">
          <img class="svg-icon" :src="shuffleIcon" alt="" aria-hidden="true">
        </button>
        <button class="tool-btn transport" title="上一首" aria-label="上一首" @click="$emit('play-by-offset', -1)">
          <img class="svg-icon" :src="previousIcon" alt="" aria-hidden="true">
        </button>
        <button class="play-btn" :class="{ active: playerIsPlaying }" title="播放/暂停" aria-label="播放/暂停" @click="$emit('toggle-play')">
          <img class="svg-icon play-icon" :class="{ 'play-symbol': !playerIsPlaying }" :src="playerIsPlaying ? pauseIcon : playIcon" alt="" aria-hidden="true">
        </button>
        <button class="tool-btn transport" title="下一首" aria-label="下一首" @click="$emit('play-by-offset', 1)">
          <img class="svg-icon" :src="nextIcon" alt="" aria-hidden="true">
        </button>
        <button class="tool-btn mode-btn" :class="{ active: repeatMode !== 'none' }" :title="repeatTitle" :aria-label="repeatTitle" @click="$emit('toggle-repeat-mode')">
          <img class="svg-icon" :src="repeatIcon" alt="" aria-hidden="true">
        </button>
        <button
          class="tool-btn favorite-control"
          :class="{ active: currentSongIsFavorite }"
          :title="currentSongIsFavorite ? '取消收藏' : '收藏'"
          :aria-label="currentSongIsFavorite ? '取消收藏' : '收藏'"
          :disabled="!playerCurrentMedia"
          @click="$emit('toggle-current-favorite')"
        >
          <img class="svg-icon" :src="currentSongIsFavorite ? heartIcon : heartOutlineIcon" alt="" aria-hidden="true">
        </button>
        <button class="tool-btn lyrics-control" :class="{ active: expandedPanel === 'lyrics' }" title="歌词" aria-label="歌词" @click="$emit('toggle-panel', 'lyrics')">
          <img class="svg-icon" :src="lyricsIcon" alt="" aria-hidden="true">
        </button>
        <button class="tool-btn playlist-control" :class="{ active: expandedPanel === 'playlist' }" title="播放列表" aria-label="播放列表" @click="$emit('toggle-panel', 'playlist')">
          <img class="svg-icon" :src="playlistIcon" alt="" aria-hidden="true">
        </button>
        <div class="volume-popover volume-control-button" @pointerdown.stop>
          <button
            class="tool-btn"
            :class="{ active: isVolumePopoverOpen }"
            title="音量"
            aria-label="音量"
            @click.stop="$emit('toggle-volume-popover')"
          >
            <img class="svg-icon" :src="volumeIcon" alt="" aria-hidden="true">
          </button>
          <transition name="volume-popover">
            <div v-if="isVolumePopoverOpen" class="volume-panel">
              <input
                class="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="playerVolume"
                :style="{ '--volume': `${volumePercent}%` }"
                aria-label="音量"
                @input="$emit('handle-volume-input', $event)"
              >
              <span class="volume-value">{{ volumePercent }}%</span>
            </div>
          </transition>
        </div>
      </div>

      <transition name="panel">
        <div v-if="expandedPanel" class="expand-panel">
          <LyricsPanel
            v-if="expandedPanel === 'lyrics'"
            :active-lyric-index="activeLyricIndex"
            :current-song-exists="Boolean(currentSong)"
            :is-searching-lyrics="isSearchingLyrics"
            :lyric-lines="lyricLines"
            :parsed-lyric="parsedLyric"
            @open-lyric-search="$emit('open-lyric-search')"
          />

          <PlaylistPanel
            v-else-if="expandedPanel === 'playlist'"
            :add-icon="addIcon"
            :can-edit-current-playlist="canEditCurrentPlaylist"
            :current-media-key="currentMediaKey"
            :current-playlist-id="currentPlaylistId"
            :edit-icon="editIcon"
            :favorite-song-keys="favoriteSongKeys"
            :heart-icon="heartIcon"
            :heart-outline-icon="heartOutlineIcon"
            :is-scanning="isScanning"
            :playlist-has-scan-source="playlistHasScanSource"
            :playlist-select-options="playlistSelectOptions"
            :scan-status-label="scanStatusLabel"
            :scanning-playlist-id="scanningPlaylistId"
            :search-icon="searchIcon"
            :songs="songs"
            :trash-icon="trashIcon"
            @create-playlist="$emit('create-playlist')"
            @edit-playlist="$emit('edit-playlist')"
            @open-song-info-search="$emit('open-song-info-search', $event)"
            @play-song="$emit('play-song', $event)"
            @remove-song="$emit('remove-song', $event)"
            @scan-current-playlist="$emit('scan-current-playlist')"
            @switch-playlist="$emit('switch-playlist', $event)"
            @toggle-song-favorite="$emit('toggle-song-favorite', $event)"
          />

          <NetworkSearchPanel
            v-else
            :active-music-search-plugin-id="activeMusicSearchPluginId"
            :active-music-search-results="activeMusicSearchResults"
            :is-caching-network-song-id="isCachingNetworkSongId"
            :is-media-cache-allowed="isMediaCacheAllowed"
            :is-searching-network-music="isSearchingNetworkMusic"
            :music-search-plugins="musicSearchPlugins"
            :network-search-query="networkSearchQuery"
            @add-network-song="$emit('add-network-song', $event)"
            @cache-network-song="$emit('cache-network-song', $event)"
            @play-network-song="$emit('play-network-song', $event)"
            @search-network-music="$emit('search-network-music')"
            @update:active-music-search-plugin-id="$emit('update:activeMusicSearchPluginId', $event)"
            @update:network-search-query="$emit('update:networkSearchQuery', $event)"
          />
        </div>
      </transition>

      <footer class="app-footnote">{{ appName }}</footer>
    </section>
  </div>
</template>
