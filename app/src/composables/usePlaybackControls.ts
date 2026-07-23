import { computed, ref, type ComputedRef } from 'vue';
import type { MediaItem } from '../types/plugin';
import type { RepeatMode } from '../types/ui';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';

interface PlaybackControlOptions {
  favoriteShuffleWeight?: ComputedRef<number>;
  onFavoriteToggleError?: (error: unknown, song: MediaItem) => void;
}

export const usePlaybackControls = (
  songs: ComputedRef<MediaItem[]>,
  currentSongIndex: ComputedRef<number>,
  options: PlaybackControlOptions = {},
) => {
  const playlistStore = usePlaylistStore();
  const playerStore = usePlayerStore();
  const shuffleEnabled = ref(false);
  const repeatMode = ref<RepeatMode>('none');
  const playbackShouldResume = ref(false);
  const shuffleQueue = ref<string[]>([]);
  const isVolumePopoverOpen = ref(false);
  let volumePopoverListenerAttached = false;

  const volumePercent = computed(() => Math.round(playerStore.volume * 100));
  const favoriteShuffleWeight = computed(() => Math.max(1, options.favoriteShuffleWeight?.value ?? 1));
  const currentSongIsFavorite = computed(() => (
    playerStore.currentMedia ? playlistStore.isFavoriteSong(playerStore.currentMedia) : false
  ));

  const playMedia = async (song: MediaItem) => {
    playbackShouldResume.value = true;
    await playerStore.play(song);
  };

  const songKey = (song: Pick<MediaItem, 'sourceId' | 'id'>) => playlistStore.favoriteKey(song);

  const shuffleItems = <T>(items: T[]) => {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };

  const weightedShuffleSongs = (items: MediaItem[]) => {
    if (favoriteShuffleWeight.value <= 1) return shuffleItems(items).map(songKey);

    const pool = [...items];
    const next: string[] = [];

    while (pool.length) {
      const totalWeight = pool.reduce((total, song) => (
        total + (playlistStore.isFavoriteSong(song) ? favoriteShuffleWeight.value : 1)
      ), 0);
      let cursor = Math.random() * totalWeight;
      const selectedIndex = pool.findIndex(song => {
        cursor -= playlistStore.isFavoriteSong(song) ? favoriteShuffleWeight.value : 1;
        return cursor <= 0;
      });
      const [selectedSong] = pool.splice(selectedIndex >= 0 ? selectedIndex : pool.length - 1, 1);
      next.push(songKey(selectedSong));
    }

    return next;
  };

  const rebuildShuffleQueue = (excludeKey?: string | null) => {
    shuffleQueue.value = weightedShuffleSongs(
      songs.value
        .filter(song => songKey(song) !== excludeKey),
    );
  };

  const removeFromShuffleQueue = (key: string) => {
    shuffleQueue.value = shuffleQueue.value.filter(item => item !== key);
  };

  const playSong = (song: MediaItem) => {
    removeFromShuffleQueue(songKey(song));
    void playMedia(song);
  };

  const toggleSongFavorite = (song: MediaItem) => {
    void playlistStore.toggleFavoriteSong(song).catch(error => {
      options.onFavoriteToggleError?.(error, song);
    });
  };

  const toggleCurrentFavorite = () => {
    if (playerStore.currentMedia) {
      toggleSongFavorite(playerStore.currentMedia);
    }
  };

  const takeNextShuffleSong = (allowRebuild: boolean) => {
    const currentId = playerStore.currentMedia ? songKey(playerStore.currentMedia) : null;

    if (!shuffleQueue.value.length && allowRebuild) {
      rebuildShuffleQueue(currentId);
    }

    const nextId = shuffleQueue.value.shift();
    return songs.value.find(song => songKey(song) === nextId) ?? null;
  };

  const getInitialSong = () => {
    if (!shuffleEnabled.value) return songs.value[0] ?? null;
    if (!shuffleQueue.value.length) {
      rebuildShuffleQueue(null);
    }
    return takeNextShuffleSong(false);
  };

  const togglePlay = () => {
    if (playerStore.currentMedia && playerStore.isPlaying) {
      playbackShouldResume.value = false;
      void playerStore.pause();
      return;
    }

    const song = playerStore.currentMedia ?? getInitialSong();
    if (song) {
      void playMedia(song);
    }
  };

  const playNextByMode = (fromEnded = false) => {
    if (!songs.value.length) return;

    if (repeatMode.value === 'one' && fromEnded && playerStore.currentMedia) {
      playerStore.seek(0);
      void playMedia(playerStore.currentMedia);
      return;
    }

    if (shuffleEnabled.value) {
      const nextSong = takeNextShuffleSong(repeatMode.value === 'list');
      if (nextSong) {
        void playMedia(nextSong);
      } else {
        playbackShouldResume.value = false;
        playerStore.syncStatus();
      }
      return;
    }

    const currentIndex = currentSongIndex.value >= 0 ? currentSongIndex.value : -1;
    const nextIndex = currentIndex + 1;

    if (nextIndex < songs.value.length) {
      void playMedia(songs.value[nextIndex]);
    } else if (repeatMode.value === 'list' || !fromEnded) {
      void playMedia(songs.value[0]);
    } else {
      playbackShouldResume.value = false;
      playerStore.syncStatus();
    }
  };

  const handleTrackEnded = () => {
    playNextByMode(true);
  };

  const playByOffset = (offset: number) => {
    if (!songs.value.length) return;

    if (offset > 0) {
      playNextByMode(false);
      return;
    }

    const startIndex = currentSongIndex.value >= 0 ? currentSongIndex.value : 0;
    const nextIndex = startIndex + offset;

    if (nextIndex >= 0) {
      void playMedia(songs.value[nextIndex]);
    } else if (repeatMode.value === 'list') {
      void playMedia(songs.value[songs.value.length - 1]);
    }
  };

  const toggleShuffle = () => {
    shuffleEnabled.value = !shuffleEnabled.value;

    if (shuffleEnabled.value) {
      rebuildShuffleQueue(playerStore.currentMedia ? songKey(playerStore.currentMedia) : null);
    } else {
      shuffleQueue.value = [];
    }
  };

  const toggleRepeatMode = () => {
    if (repeatMode.value === 'none') {
      repeatMode.value = 'list';
    } else if (repeatMode.value === 'list') {
      repeatMode.value = 'one';
    } else {
      repeatMode.value = 'none';
    }
  };

  const handleSeek = (event: Event) => {
    const target = event.target as HTMLInputElement;
    playerStore.seek(Number(target.value));
  };

  const handleVolumeInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    playerStore.setVolume(Number(target.value));
  };

  const closeVolumePopover = () => {
    isVolumePopoverOpen.value = false;
    volumePopoverListenerAttached = false;
  };

  const toggleVolumePopover = () => {
    isVolumePopoverOpen.value = !isVolumePopoverOpen.value;

    if (isVolumePopoverOpen.value && !volumePopoverListenerAttached) {
      volumePopoverListenerAttached = true;
      window.setTimeout(() => {
        document.addEventListener('pointerdown', closeVolumePopover, { once: true });
      });
    }
  };

  const clearShuffleQueue = () => {
    shuffleQueue.value = [];
  };

  const setPlaybackRestoreState = (state: {
    repeatMode: RepeatMode;
    shuffleEnabled: boolean;
    wasPlaying: boolean;
  }) => {
    repeatMode.value = state.repeatMode;
    shuffleEnabled.value = state.shuffleEnabled;
    playbackShouldResume.value = state.wasPlaying;
  };

  return {
    clearShuffleQueue,
    closeVolumePopover,
    currentSongIsFavorite,
    handleSeek,
    handleTrackEnded,
    handleVolumeInput,
    isVolumePopoverOpen,
    playByOffset,
    playMedia,
    playSong,
    playbackShouldResume,
    rebuildShuffleQueue,
    repeatMode,
    setPlaybackRestoreState,
    shuffleEnabled,
    shuffleQueue,
    toggleCurrentFavorite,
    togglePlay,
    toggleRepeatMode,
    toggleShuffle,
    toggleSongFavorite,
    toggleVolumePopover,
    volumePercent,
  };
};
