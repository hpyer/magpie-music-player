import { defineStore } from 'pinia';
import { pluginManager } from '../core/pluginManager';
import { LOCAL_MUSIC_SOURCE_ID, localMusicService } from '../services/localMusicService';
import { Playlist, MediaItem, PlaylistType, PluginPlaylistRef } from '../types/plugin';
import { readJsonFile, storagePath, writeJsonFile } from './appFileStorage';
import { deleteMediaAssets, loadMediaAssets, saveMediaAssets } from './mediaAssetCache';

interface PlaylistSettings {
  name?: string;
  type?: PlaylistType;
  localDir?: string;
  pluginPlaylist?: PluginPlaylistRef;
}

interface PlaylistStateFile {
  playlists?: Playlist[];
  currentPlaylistId?: string | null;
  localMusicDir?: string | null;
  favoriteSongs?: Record<string, FavoriteSongState>;
  favoriteSongIds?: string[];
}

interface PlaylistSaveOptions {
  throwOnError?: boolean;
}

export interface FavoriteSongState {
  sourceId: string;
  mediaId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  createdAt: number;
  updatedAt: number;
}

const PLAYLIST_STATE_PATH = storagePath('library', 'playlist-state.json');
const LEGACY_PLAYLIST_STORAGE_KEY = 'magpie_playlists_v1';
const LEGACY_FAVORITES_STORAGE_KEY = 'magpie_favorite_song_ids_v1';
const LEGACY_LOCAL_DIR_STORAGE_KEY = 'magpie_local_dir';
let playlistSaveQueue = Promise.resolve();

const toPersistedSong = (song: MediaItem): MediaItem => {
  const { cover: _cover, lyric: _lyric, ...persistedSong } = song;
  return persistedSong;
};

const toPersistedPlaylist = (playlist: Playlist): Playlist => ({
  ...playlist,
  songs: playlist.songs.map(toPersistedSong),
});

const normalizePlaylistSources = (playlist: Playlist): Playlist => {
  if (playlist.type !== 'plugin-playlist' || !playlist.pluginPlaylist?.pluginId) return playlist;

  return {
    ...playlist,
    songs: playlist.songs.map(song => ({
      ...song,
      sourceId: playlist.pluginPlaylist!.pluginId,
    })),
  };
};

const runInBatches = async <T>(items: T[], handler: (item: T) => Promise<unknown>, batchSize = 12) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.allSettled(batch.map(handler));
  }
};

const hasSavedPlaylistState = (state: PlaylistStateFile) => {
  return Boolean(
    state.playlists?.length
    || state.localMusicDir
    || state.currentPlaylistId
    || state.favoriteSongIds?.length,
  );
};

const readLegacyPlaylistState = (): PlaylistStateFile => {
  try {
    const legacyPlaylists = localStorage.getItem(LEGACY_PLAYLIST_STORAGE_KEY);
    const legacyLocalDir = localStorage.getItem(LEGACY_LOCAL_DIR_STORAGE_KEY);
    const legacyFavorites = localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY);

    return {
      playlists: legacyPlaylists ? JSON.parse(legacyPlaylists) : undefined,
      localMusicDir: legacyLocalDir,
      favoriteSongIds: legacyFavorites ? JSON.parse(legacyFavorites) : undefined,
    };
  } catch (error) {
    console.warn('[PlaylistStore] Failed to migrate legacy browser storage:', error);
    return {};
  }
};

const clearLegacyPlaylistState = () => {
  try {
    localStorage.removeItem(LEGACY_PLAYLIST_STORAGE_KEY);
    localStorage.removeItem(LEGACY_LOCAL_DIR_STORAGE_KEY);
    localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY);
  } catch (error) {
    console.warn('[PlaylistStore] Failed to clear legacy browser storage:', error);
  }
};

const favoriteSongKey = (song: Pick<MediaItem, 'sourceId' | 'id'>) => `${song.sourceId}:${song.id}`;

const favoriteSongSnapshot = (song: MediaItem, existing?: FavoriteSongState): FavoriteSongState => {
  const now = Date.now();
  return {
    sourceId: song.sourceId,
    mediaId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
};

const migrateLegacyFavorites = (playlists: Playlist[], favoriteSongIds: string[] = []) => {
  const legacyIds = new Set(favoriteSongIds);
  if (!legacyIds.size) return {};

  return playlists
    .flatMap(playlist => playlist.songs)
    .filter(song => legacyIds.has(song.id))
    .reduce<Record<string, FavoriteSongState>>((favorites, song) => {
      favorites[favoriteSongKey(song)] = favoriteSongSnapshot(song, favorites[favoriteSongKey(song)]);
      return favorites;
    }, {});
};

const hasSongReference = (playlists: Playlist[], key: string) => (
  playlists.some(playlist => playlist.songs.some(song => favoriteSongKey(song) === key))
);

export const usePlaylistStore = defineStore('playlist', {
  state: () => ({
    playlists: [] as Playlist[],
    currentPlaylistId: null as string | null,
    localMusicDir: null as string | null,
    isInitialized: false,
    hasLoaded: false,
    favoriteSongs: {} as Record<string, FavoriteSongState>,
  }),
  getters: {
    currentPlaylist: (state) => state.playlists.find(p => p.id === state.currentPlaylistId) || null,
    favoriteSongKeys: (state) => Object.keys(state.favoriteSongs),
  },
  actions: {
    async initialize(options: { hydrateMediaAssets?: boolean } = {}) {
      const shouldHydrateMediaAssets = options.hydrateMediaAssets ?? false;

      try {
        const fileState = await readJsonFile<PlaylistStateFile>(PLAYLIST_STATE_PATH, {});
        const shouldMigrateLegacyState = !hasSavedPlaylistState(fileState);
        const savedState = shouldMigrateLegacyState ? readLegacyPlaylistState() : fileState;
        const savedDir = savedState.localMusicDir ?? null;

        if (savedState.playlists?.length) {
          this.playlists = savedState.playlists.map((playlist: Playlist) => normalizePlaylistSources({
            type: 'local-directory' as PlaylistType,
            ...playlist,
            localDir: playlist.localDir ?? savedDir ?? undefined,
          }));
        }

        if (savedDir) {
          this.localMusicDir = savedDir;
          this.isInitialized = true;
        }

        // Keep legacy users with only a saved directory working, but let first-run users create their playlist explicitly.
        if (this.playlists.length === 0 && savedDir) {
          const newPlaylist: Playlist = {
            id: crypto.randomUUID(),
            name: '默认播放列表',
            type: 'local-directory',
            localDir: savedDir,
            songs: [],
            createdAt: Date.now(),
          };
          this.playlists.push(newPlaylist);
        }

        if (savedState.currentPlaylistId && this.playlists.some(playlist => playlist.id === savedState.currentPlaylistId)) {
          this.currentPlaylistId = savedState.currentPlaylistId;
        } else if (!this.currentPlaylistId && this.playlists.length > 0) {
          this.currentPlaylistId = this.playlists[0].id;
        }

        this.isInitialized = Boolean(this.localMusicDir || this.playlists.length);
        this.hasLoaded = true;
        this.favoriteSongs = savedState.favoriteSongs ?? migrateLegacyFavorites(this.playlists, savedState.favoriteSongIds);

        if (shouldHydrateMediaAssets && this.playlists.length) {
          await this.hydrateMediaAssets();
          await this.cacheInlineMediaAssets();
        }

        await this.save();

        if (shouldMigrateLegacyState && hasSavedPlaylistState(savedState)) {
          clearLegacyPlaylistState();
        }
      } finally {
        this.hasLoaded = true;
      }
    },

    async createPlaylist(name: string, settings: Omit<PlaylistSettings, 'name'> = {}) {
      const newPlaylist: Playlist = {
        id: crypto.randomUUID(),
        name,
        type: settings.type ?? 'local-directory',
        localDir: settings.localDir,
        pluginPlaylist: settings.pluginPlaylist,
        songs: [],
        createdAt: Date.now(),
      };
      this.playlists.push(newPlaylist);
      this.isInitialized = true;
      await this.save({ throwOnError: true });
      return newPlaylist;
    },

    async updatePlaylist(id: string, settings: PlaylistSettings) {
      const playlist = this.playlists.find(p => p.id === id);
      if (!playlist) return null;

      if (settings.name !== undefined) playlist.name = settings.name;
      if (settings.type !== undefined) {
        playlist.type = settings.type;
        if (settings.type === 'local-directory') {
          playlist.pluginPlaylist = undefined;
        } else if (settings.type === 'plugin-playlist') {
          playlist.localDir = undefined;
        }
      }
      if (settings.localDir !== undefined) playlist.localDir = settings.localDir;
      if (settings.pluginPlaylist !== undefined) playlist.pluginPlaylist = settings.pluginPlaylist;

      await this.save({ throwOnError: true });
      return playlist;
    },

    async setLocalMusicDir(dir: string) {
      this.localMusicDir = dir;
      this.isInitialized = true;
      await this.save({ throwOnError: true });
    },

    async hydrateMediaAssets() {
      await Promise.allSettled(this.playlists.flatMap(playlist => playlist.songs.map(async (song) => {
        if (song.sourceId === LOCAL_MUSIC_SOURCE_ID && (!song.cover || !song.lyric)) {
          const embeddedAssets = await localMusicService.readEmbeddedMediaAssets(song);
          if (!song.cover && embeddedAssets.cover) song.cover = embeddedAssets.cover;
          if (!song.lyric && embeddedAssets.lyric) song.lyric = embeddedAssets.lyric;
        }

        const assets = await loadMediaAssets(song);
        if (!assets) return;

        if (!song.cover && assets.cover) song.cover = assets.cover;
        if (!song.lyric && assets.lyric) song.lyric = assets.lyric;
      })));
    },

    async cacheInlineMediaAssets() {
      await runInBatches(this.playlists.flatMap(playlist => playlist.songs), saveMediaAssets);
    },

    async addSongToPlaylist(playlistId: string, song: MediaItem) {
      await this.addSongsToPlaylist(playlistId, [song]);
    },

    async addSongsToPlaylist(playlistId: string, songs: MediaItem[]) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (!playlist) return;

      await runInBatches(songs, saveMediaAssets);

      songs.forEach((song) => {
        const existingIndex = playlist.songs.findIndex(s => s.id === song.id);
        if (existingIndex >= 0) {
          playlist.songs[existingIndex] = {
            ...playlist.songs[existingIndex],
            ...song,
            extra: {
              ...playlist.songs[existingIndex].extra,
              ...song.extra,
            },
          };
        } else {
          playlist.songs.push(song);
        }
      });

      await this.save({ throwOnError: true });
    },

    async beginPlaylistRescan(playlistId: string) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (!playlist) return;

      playlist.songs = [];
      await this.save({ throwOnError: true });
    },

    async replacePlaylistSongs(playlistId: string, songs: MediaItem[], options: { removedFrom?: MediaItem[] } = {}) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (!playlist) return;

      const nextSongIds = new Set(songs.map(song => song.id));
      const baselineSongs = options.removedFrom ?? playlist.songs;
      const removedSongs = baselineSongs.filter(song => !nextSongIds.has(song.id));
      const existingSongs = new Map(playlist.songs.map(song => [song.id, song]));

      playlist.songs = songs.map(song => {
        const existingSong = existingSongs.get(song.id);
        return {
          ...existingSong,
          ...song,
          cover: song.cover ?? existingSong?.cover,
          lyric: song.lyric ?? existingSong?.lyric,
          extra: {
            ...existingSong?.extra,
            ...song.extra,
          },
        };
      });

      await runInBatches(playlist.songs, saveMediaAssets);
      await Promise.allSettled(removedSongs.map(deleteMediaAssets));
      await this.save({ throwOnError: true });
    },

    async removeSongFromPlaylist(playlistId: string, songId: string) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (playlist) {
        const removedSongs = playlist.songs.filter(song => song.id === songId);
        playlist.songs = playlist.songs.filter(s => s.id !== songId);
        removedSongs.forEach(song => {
          const key = favoriteSongKey(song);
          if (!hasSongReference(this.playlists, key)) {
            delete this.favoriteSongs[key];
          }
        });
        await Promise.allSettled(removedSongs.map(deleteMediaAssets));
        await this.save({ throwOnError: true });
      }
    },

    async clearPlaylistSongs(playlistId: string) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (playlist) {
        await Promise.all(playlist.songs.map(deleteMediaAssets));
        playlist.songs = [];
        await this.save({ throwOnError: true });
      }
    },

    async refreshPluginPlaylist(playlistId: string) {
      const playlist = this.playlists.find(p => p.id === playlistId);
      if (!playlist?.pluginPlaylist) return;

      const songs = await pluginManager.getPluginPlaylistSongs(
        playlist.pluginPlaylist.pluginId,
        playlist.pluginPlaylist.playlistId,
      );

      playlist.songs = songs;
      await runInBatches(songs, saveMediaAssets);
      await this.save({ throwOnError: true });
    },

    favoriteKey(song: Pick<MediaItem, 'sourceId' | 'id'>) {
      return favoriteSongKey(song);
    },

    isFavoriteSong(song: Pick<MediaItem, 'sourceId' | 'id'>) {
      return Boolean(this.favoriteSongs[favoriteSongKey(song)]);
    },

    async setFavoriteSong(song: MediaItem, favorite: boolean) {
      const key = favoriteSongKey(song);
      if (favorite) {
        this.favoriteSongs[key] = favoriteSongSnapshot(song, this.favoriteSongs[key]);
      } else {
        delete this.favoriteSongs[key];
      }
      await this.save({ throwOnError: true });
    },

    async toggleFavoriteSong(song: MediaItem) {
      await this.setFavoriteSong(song, !this.isFavoriteSong(song));
    },

    async updateSongLyric(songId: string, lyric: string, options: { cache?: boolean } = {}) {
      const songs = this.playlists.flatMap(playlist => playlist.songs).filter(song => song.id === songId);
      songs.forEach(song => {
        song.lyric = lyric;
      });

      if (options.cache ?? true) {
        await runInBatches(songs, saveMediaAssets);
      }
      await this.save({ throwOnError: true });
    },

    async updateSongCover(songId: string, cover: string, options: { cache?: boolean } = {}) {
      const songs = this.playlists.flatMap(playlist => playlist.songs).filter(song => song.id === songId);
      songs.forEach(song => {
        song.cover = cover;
      });

      if (options.cache ?? true) {
        await runInBatches(songs, saveMediaAssets);
      }
      await this.save({ throwOnError: true });
    },

    async updateSongInfo(songId: string, info: Partial<Pick<MediaItem, 'title' | 'artist' | 'album' | 'cover' | 'year'>>, options: { cache?: boolean } = {}) {
      const songs = this.playlists.flatMap(playlist => playlist.songs).filter(song => song.id === songId);
      songs.forEach(song => {
        if (info.title?.trim()) song.title = info.title.trim();
        if (info.artist?.trim()) song.artist = info.artist.trim();
        if (info.album?.trim()) song.album = info.album.trim();
        if (info.year) song.year = info.year;
        if (info.cover) song.cover = info.cover;
      });

      if ((options.cache ?? true) && info.cover) {
        await runInBatches(songs, saveMediaAssets);
      }
      await this.save({ throwOnError: true });
    },

    async deletePlaylist(id: string) {
      const playlist = this.playlists.find(p => p.id === id);
      if (playlist) {
        await Promise.all(playlist.songs.map(deleteMediaAssets));
        const remainingPlaylists = this.playlists.filter(p => p.id !== id);
        playlist.songs.forEach(song => {
          const key = favoriteSongKey(song);
          if (!hasSongReference(remainingPlaylists, key)) {
            delete this.favoriteSongs[key];
          }
        });
      }

      this.playlists = this.playlists.filter(p => p.id !== id);
      if (this.currentPlaylistId === id) {
        this.currentPlaylistId = this.playlists[0]?.id || null;
      }
      await this.save({ throwOnError: true });
    },

    async save(options: PlaylistSaveOptions = {}) {
      const persistedPlaylists = this.playlists.map(toPersistedPlaylist);
      const state = {
        playlists: persistedPlaylists,
        currentPlaylistId: this.currentPlaylistId,
        localMusicDir: this.localMusicDir,
        favoriteSongs: this.favoriteSongs,
      } satisfies PlaylistStateFile;

      playlistSaveQueue = playlistSaveQueue
        .catch(() => undefined)
        .then(() => writeJsonFile(PLAYLIST_STATE_PATH, state));

      const saveError = await playlistSaveQueue.catch(error => {
        console.error('[PlaylistStore] Failed to save playlists:', error);
        return error;
      });

      if (saveError && options.throwOnError) {
        throw saveError;
      }
    }
  }
});
