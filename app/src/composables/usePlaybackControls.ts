import { computed, ref, type ComputedRef } from 'vue';
import type { MediaItem } from '../types/plugin';
import type { RepeatMode } from '../types/ui';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';

export const usePlaybackControls = (
  songs: ComputedRef<MediaItem[]>,
  currentSongIndex: ComputedRef<number>,
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
  const currentSongIsFavorite = computed(() => (
    playerStore.currentMedia ? playlistStore.isFavoriteSong(playerStore.currentMedia.id) : false
  ));

  const playMedia = async (song: MediaItem) => {
    playbackShouldResume.value = true;
    await playerStore.play(song);
  };

  const shuffleIds = (ids: string[]) => {
    const next = [...ids];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };

  const rebuildShuffleQueue = (excludeId?: string | null) => {
    shuffleQueue.value = shuffleIds(
      songs.value
        .map(song => song.id)
        .filter(id => id !== excludeId),
    );
  };

  const removeFromShuffleQueue = (songId: string) => {
    shuffleQueue.value = shuffleQueue.value.filter(id => id !== songId);
  };

  const playSong = (song: MediaItem) => {
    removeFromShuffleQueue(song.id);
    void playMedia(song);
  };

  const toggleSongFavorite = (song: MediaItem) => {
    void playlistStore.toggleFavoriteSong(song.id);
  };

  const toggleCurrentFavorite = () => {
    if (playerStore.currentMedia) {
      toggleSongFavorite(playerStore.currentMedia);
    }
  };

  const takeNextShuffleSong = (allowRebuild: boolean) => {
    const currentId = playerStore.currentMedia?.id ?? null;

    if (!shuffleQueue.value.length && allowRebuild) {
      rebuildShuffleQueue(currentId);
    }

    const nextId = shuffleQueue.value.shift();
    return songs.value.find(song => song.id === nextId) ?? null;
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
      rebuildShuffleQueue(playerStore.currentMedia?.id);
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
