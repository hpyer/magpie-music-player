import { defineStore } from 'pinia';
import { MediaItem } from '../types/plugin';
import { player } from '../core/player';
import { readJsonFile, storagePath, writeJsonFile } from './appFileStorage';

interface PlayerSettings {
  volume?: number;
}

const PLAYER_SETTINGS_PATH = storagePath('settings', 'player.json');
const LEGACY_VOLUME_KEY = 'magpie_player_volume';

const readLegacyVolume = () => {
  try {
    const savedVolume = localStorage.getItem(LEGACY_VOLUME_KEY);
    localStorage.removeItem(LEGACY_VOLUME_KEY);
    return savedVolume === null ? undefined : Number(savedVolume);
  } catch {
    return undefined;
  }
};

export const usePlayerStore = defineStore('player', {
  state: () => ({
    currentMedia: null as MediaItem | null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.5,
  }),
  actions: {
    async initializeVolume() {
      const settings = await readJsonFile<PlayerSettings>(PLAYER_SETTINGS_PATH, {});
      const parsedVolume = settings.volume ?? readLegacyVolume();
      const volume = Number.isFinite(parsedVolume)
        ? Math.min(1, Math.max(0, parsedVolume as number))
        : 0.5;
      this.setVolume(volume);
    },
    async play(media: MediaItem) {
      this.currentMedia = media;
      await player.play(media);
      this.syncStatus();
    },
    async load(media: MediaItem, currentTime = 0) {
      this.currentMedia = media;
      this.currentTime = Math.max(0, currentTime);
      await player.load(media, currentTime);
      this.syncStatus();
    },
    select(media: MediaItem | null) {
      player.stop();
      this.currentMedia = media;
      this.isPlaying = false;
      this.currentTime = 0;
      this.duration = media?.duration ?? 0;
    },
    async pause() {
      await player.pause();
      this.syncStatus();
    },
    seek(time: number) {
      player.seek(time);
      this.syncStatus();
    },
    setVolume(volume: number) {
      const normalizedVolume = Math.min(1, Math.max(0, volume));
      player.setVolume(normalizedVolume);
      this.volume = normalizedVolume;
      void writeJsonFile(PLAYER_SETTINGS_PATH, { volume: normalizedVolume });
    },
    syncStatus() {
      const status = player.getStatus();
      this.isPlaying = status.isPlaying;
      this.currentTime = status.currentTime;
      this.duration = status.duration;
      this.currentMedia = status.currentMedia;
    }
  }
});
