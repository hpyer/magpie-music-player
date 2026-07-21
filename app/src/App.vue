<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { appDataDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { mkdir as mkdirFsDir, readDir as readFsDir, readFile as readFsFile, remove as removeFsEntry, stat as statFsEntry } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { type } from '@tauri-apps/plugin-os';
import AppConfirm from './components/AppConfirm.vue';
import type { AppSelectOption } from './components/AppSelect.vue';
import AppToast from './components/AppToast.vue';
import PlaylistModal from './views/player/components/PlaylistModal.vue';
import LyricSearchModal from './views/player/components/LyricSearchModal.vue';
import SongInfoSearchModal from './views/player/components/SongInfoSearchModal.vue';
import SettingsModal from './views/player/components/SettingsModal.vue';
import PlayerView from './views/player/PlayerView.vue';
import SetupView from './views/setup/SetupView.vue';
import { useAppFeedback } from './composables/useAppFeedback';
import { useLyricsDisplay } from './composables/useLyricsDisplay';
import { usePlaybackControls } from './composables/usePlaybackControls';
import { player } from './core/player';
import { pluginManager } from './core/pluginManager';
import { PLUGIN_PACKAGE_EXTENSION } from './core/pluginRuntime';
import { clearGlobalShortcuts, syncGlobalShortcuts } from './services/globalShortcutService';
import { appLogError, appLogInfo, appLogWarn, errorToLogDetails, initializeAppLogger, revealAppDataDirectory } from './services/appLogger';
import { LOCAL_MUSIC_SOURCE_ID, localMusicService } from './services/localMusicService';
import { mediaCacheService } from './services/mediaCacheService';
import { pluginBlocklistService } from './services/pluginBlocklistService';
import { pluginInstallerService } from './services/pluginInstallerService';
import { pluginRuntimeService } from './services/pluginRuntimeService';
import { AppStorageCorruptionError, resetAppStorage } from './store/appFileStorage';
import { readPlaybackSession, writePlaybackSession, type PlaybackSession } from './store/playbackSessionStore';
import { AppSettings, InstalledPluginSetting, ShortcutSetting, createDefaultAppSettings, useAppSettingsStore } from './store/appSettingsStore';
import { configureMediaAssetCache } from './store/mediaAssetCache';
import { usePlayerStore } from './store/playerStore';
import { usePlaylistStore } from './store/playlistStore';
import { LyricSearchResult, MediaItem, PlaylistType, PluginConfigField, PluginPlaylistItem, SongInfoSearchResult } from './types/plugin';
import type {
  CacheFileEntry,
  CacheGroupId,
  PanelMode,
  PlaylistForm,
  PlaylistFormMode,
  PlaylistFormType,
  SettingsTab,
} from './types/ui';
import { pluginCapabilityTags, pluginConfigFields, pluginConfigInputType, cloneSettings, getShortcutDefault as getPlatformShortcutDefault, missingPluginConfigLabels, normalizePluginConfigValue, normalizeShortcutsForPlatform } from './utils/settings';
import { formatBytes } from './utils/format';
import { pathJoin } from './utils/path';
import { officialCacheAllowedSourceIds, settingsTabs, themeOptions } from './config/appConfig';
import './assets/app.css';
import addIcon from './assets/svg/add.svg';
import closeIcon from './assets/svg/close.svg';
import editIcon from './assets/svg/edit.svg';
import heartIcon from './assets/svg/heart.svg';
import heartOutlineIcon from './assets/svg/heart-outline.svg';
import lyricsIcon from './assets/svg/lyrics.svg';
import minimizeIcon from './assets/svg/minimize.svg';
import nextIcon from './assets/svg/next.svg';
import pauseIcon from './assets/svg/pause.svg';
import playIcon from './assets/svg/play.svg';
import playlistIcon from './assets/svg/playlist.svg';
import previousIcon from './assets/svg/previous.svg';
import repeatListIcon from './assets/svg/repeat-list.svg';
import repeatOneIcon from './assets/svg/repeat-one.svg';
import searchIcon from './assets/svg/search.svg';
import settingsIcon from './assets/svg/settings.svg';
import shuffleIcon from './assets/svg/shuffle.svg';
import trashIcon from './assets/svg/trash.svg';
import volumeIcon from './assets/svg/volume.svg';
import appPackage from '../package.json';

const playlistStore = usePlaylistStore();
const playerStore = usePlayerStore();
const settingsStore = useAppSettingsStore();
const appWindow = getCurrentWindow();
const appWebview = getCurrentWebview();
const PLAYER_WIDTH = 360;
const COMPACT_HEIGHT = 336;
const EXPANDED_HEIGHT = 640;
const appName = 'MagpieMusicPlayer';
const appVersion = appPackage.version;
const appDescription = '一款轻量的桌面音乐播放器，支持本地音乐管理、播放列表、插件扩展、歌词与歌曲信息检索。';
const STARTUP_STEP_TIMEOUT_MS = 5000;
const PLUGIN_STARTUP_SYNC_DELAY_MS = 900;
const PLUGIN_STARTUP_SYNC_IDLE_TIMEOUT_MS = 2500;

const isScanning = ref(false);
const scanningPlaylistId = ref<string | null>(null);
const scannedSongCount = ref(0);
const expandedPanel = ref<PanelMode>(null);
const isPlaylistModalOpen = ref(false);
const isSettingsModalOpen = ref(false);
const isLyricSearchModalOpen = ref(false);
const isSongInfoSearchModalOpen = ref(false);
const playlistFormMode = ref<PlaylistFormMode>('create');
const editingPlaylistId = ref<string | null>(null);
const playlistForm = ref<PlaylistForm>({
  name: '默认列表',
  type: 'local-directory',
  localDir: '',
  pluginId: '',
  pluginPlaylistId: '',
  scanImmediately: true,
});
const pluginPlaylistSources = ref<Array<{ id: string; name: string }>>([]);
const pluginPlaylistOptions = ref<PluginPlaylistItem[]>([]);
const isLoadingPluginPlaylists = ref(false);
const lyricSearchPlugins = ref<Array<{ id: string; name: string }>>([]);
const songInfoSearchPlugins = ref<Array<{ id: string; name: string }>>([]);
const musicSearchPlugins = ref<Array<{ id: string; name: string }>>([]);
const settingsTab = ref<SettingsTab>('theme');
const settingsDraft = ref<AppSettings>(createDefaultAppSettings());
const pendingPluginRemovals = ref(new Set<string>());
const isPluginPackageDragActive = ref(false);
const isInstallingPluginPackage = ref(false);
const expandedPluginIds = ref(new Set<string>());
const activeShortcutId = ref<string | null>(null);
const pressedShortcutKeys = ref(new Set<string>());
const defaultCacheDir = ref('');
const defaultCoverDir = ref('');
const defaultLyricsDir = ref('');
const isOpeningAppDataDirectory = ref(false);
const cacheUsedBytes = ref<Record<CacheGroupId, number>>({ songs: 0, covers: 0, lyrics: 0 });
const readingCacheUsageIds = ref(new Set<CacheGroupId>());
const clearingCacheIds = ref(new Set<CacheGroupId>());
const isSearchingLyrics = ref(false);
const isApplyingLyricSearchResult = ref(false);
const lyricSearchTitle = ref('');
const lyricSearchArtist = ref('');
const activeLyricSearchPluginId = ref('');
const lyricSearchResultsByPlugin = ref<Record<string, Array<LyricSearchResult & { pluginId: string }>>>({});
const lyricPluginLoadingIds = ref(new Set<string>());
const isSearchingSongInfo = ref(false);
const isApplyingSongInfoSearchResult = ref(false);
const songInfoSearchSong = ref<MediaItem | null>(null);
const songInfoSearchTitle = ref('');
const songInfoSearchArtist = ref('');
const activeSongInfoSearchPluginId = ref('');
const songInfoSearchResultsByPlugin = ref<Record<string, Array<SongInfoSearchResult & { pluginId: string }>>>({});
const songInfoPluginLoadingIds = ref(new Set<string>());
const networkSearchQuery = ref('');
const isSearchingNetworkMusic = ref(false);
const activeMusicSearchPluginId = ref('');
const networkSearchResultsByPlugin = ref<Record<string, MediaItem[]>>({});
const isCachingNetworkSongId = ref<string | null>(null);
const isMacOs = ref(false);
const startupFallbackMessage = ref('');
const {
  closeConfirmDialog,
  confirmDialog,
  dismissToast,
  pauseToast,
  requestConfirm,
  requestConfirmWithOption,
  resumeToast,
  showToast,
  toasts,
  updateConfirmOptionChecked,
} = useAppFeedback();
let syncTimer: number | undefined;
let playbackSessionTimer: number | undefined;
let stopEndedListener: (() => void) | undefined;
let stopCloseRequestedListener: (() => void) | undefined;
let stopDragDropListener: (() => void) | undefined;
let isClosingWindow = false;
let closeAfterPersistTask: Promise<void> | null = null;
let isPlaybackSessionRestorePending = true;
let lyricSearchRequestId = 0;
let songInfoSearchRequestId = 0;
let cancelPluginStartupSyncSchedule: (() => void) | undefined;

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const currentPlaylist = computed(() => playlistStore.currentPlaylist);
const songs = computed(() => currentPlaylist.value?.songs ?? []);
const currentSongIndex = computed(() => {
  if (!playerStore.currentMedia) return -1;
  return songs.value.findIndex(song => song.id === playerStore.currentMedia?.id);
});
const {
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
  toggleCurrentFavorite,
  togglePlay,
  toggleRepeatMode,
  toggleShuffle,
  toggleSongFavorite,
  toggleVolumePopover,
  volumePercent,
} = usePlaybackControls(songs, currentSongIndex);
const currentSong = computed(() => playerStore.currentMedia ?? songs.value[0] ?? null);
const displayedCurrentTime = computed(() => (
  playerStore.currentMedia?.id === currentSong.value?.id
    ? playerStore.currentTime
    : 0
));
const displayedDuration = computed(() => {
  const songDuration = currentSong.value?.duration ?? 0;
  if (!playerStore.currentMedia || playerStore.currentMedia.id !== currentSong.value?.id) {
    return songDuration;
  }
  if (!playerStore.isPlaying && playerStore.currentTime === 0 && songDuration) {
    return songDuration;
  }
  return playerStore.duration || songDuration;
});
const progressPercent = computed(() => {
  if (!displayedDuration.value || Number.isNaN(displayedDuration.value)) return 0;
  return Math.min(100, (displayedCurrentTime.value / displayedDuration.value) * 100);
});
const albumLine = computed(() => {
  if (!currentSong.value) return 'Artist Name • Album Name';
  const artist = currentSong.value.artist || 'Unknown Artist';
  const details = [artist, currentSong.value.album].filter(Boolean);
  return details.join(' • ');
});
const {
  activeLyricIndex,
  lyricLines,
  parsedLyric,
} = useLyricsDisplay(currentSong, computed(() => playerStore.currentTime));
const repeatIcon = computed(() => {
  if (repeatMode.value === 'list') return repeatListIcon;
  if (repeatMode.value === 'one') return repeatOneIcon;
  return repeatListIcon;
});
const repeatTitle = computed(() => {
  if (repeatMode.value === 'list') return '列表循环';
  if (repeatMode.value === 'one') return '单曲循环';
  return '不循环';
});
const playlistModalTitle = computed(() => playlistFormMode.value === 'create' ? '新建播放列表' : '编辑播放列表');
const isLocalDirectoryPlaylist = computed(() => playlistForm.value.type === 'local-directory');
const isPluginPlaylist = computed(() => playlistForm.value.type.startsWith('plugin:'));
const selectedPlaylistPluginId = computed(() => (
  isPluginPlaylist.value
    ? playlistForm.value.type.slice('plugin:'.length)
    : playlistForm.value.pluginId
));
const playlistTypeOptions = computed<Array<{ value: PlaylistFormType; label: string }>>(() => [
  { value: 'local-directory', label: '本地目录' },
  ...pluginPlaylistSources.value.map(plugin => ({
    value: `plugin:${plugin.id}` as PlaylistFormType,
    label: plugin.name,
  })),
]);
const playlistSelectOptions = computed<AppSelectOption[]>(() => playlistStore.playlists.map(playlist => ({
  value: playlist.id,
  label: playlist.name,
  meta: `(${playlist.songs.length})`,
})));
const pluginPlaylistSelectOptions = computed<AppSelectOption[]>(() => pluginPlaylistOptions.value.map(playlist => ({
  value: playlist.id,
  label: playlist.name,
  meta: playlist.songCount ? `(${playlist.songCount})` : undefined,
})));
const pluginPlaylistPlaceholder = computed(() => {
  if (isLoadingPluginPlaylists.value) return '读取中...';
  return pluginPlaylistOptions.value.length ? '请选择列表' : '暂无远程播放列表';
});
const defaultPlaylistNameForType = (type: PlaylistFormType) => {
  if (type === 'local-directory') return '默认本地列表';

  const pluginId = type.startsWith('plugin:')
    ? type.slice('plugin:'.length)
    : '';
  const pluginName = pluginPlaylistSources.value.find(plugin => plugin.id === pluginId)?.name ?? '远程';
  return `默认${pluginName}列表`;
};
const activeLyricSearchResults = computed(() => lyricSearchResultsByPlugin.value[activeLyricSearchPluginId.value] ?? []);
const activeSongInfoSearchResults = computed(() => songInfoSearchResultsByPlugin.value[activeSongInfoSearchPluginId.value] ?? []);
const activeMusicSearchResults = computed(() => networkSearchResultsByPlugin.value[activeMusicSearchPluginId.value] ?? []);
const expandPluginDetails = (pluginId: string) => {
  const nextExpandedIds = new Set(expandedPluginIds.value);
  nextExpandedIds.add(pluginId);
  expandedPluginIds.value = nextExpandedIds;
};

const notifyMissingPluginConfig = (plugin: InstalledPluginSetting, missingLabels = missingPluginConfigLabels(plugin)) => {
  showToast(`启用 ${plugin.name} 前，请先填写：${missingLabels.join('、')}。`, {
    title: '插件配置',
    kind: 'warning',
  });
};

const setPluginConfigValue = (plugin: InstalledPluginSetting, field: PluginConfigField, value: string | boolean) => {
  plugin.config[field.key] = normalizePluginConfigValue(field, value);
};

const updatePluginConfigFromInput = (plugin: InstalledPluginSetting, field: PluginConfigField, event: Event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  setPluginConfigValue(plugin, field, target?.value ?? '');
};

const updatePluginConfigFromBoolean = (plugin: InstalledPluginSetting, field: PluginConfigField, checked: boolean) => {
  setPluginConfigValue(plugin, field, checked);
};

const getShortcutDefault = (shortcutId: ShortcutSetting['id']) => {
  return getPlatformShortcutDefault(shortcutId, isMacOs.value);
};

const activeTheme = computed(() => {
  const themeId = isSettingsModalOpen.value ? settingsDraft.value.themeId : settingsStore.settings.themeId;
  return themeOptions.find(theme => theme.id === themeId) ?? themeOptions[0];
});

const surfaceThemeStyle = computed(() => ({
  '--ink': activeTheme.value.ink,
  '--muted-ink': activeTheme.value.mutedInk,
  '--panel': activeTheme.value.panel,
  '--theme-background': activeTheme.value.background,
  '--theme-panel': activeTheme.value.panel,
  '--theme-ink': activeTheme.value.ink,
  '--theme-muted-ink': activeTheme.value.mutedInk,
  '--theme-control': activeTheme.value.control,
  '--theme-control-ink': activeTheme.value.controlInk,
  '--theme-icon-filter': activeTheme.value.iconFilter ?? 'brightness(0) saturate(100%)',
  '--theme-play-icon-filter': activeTheme.value.playIconFilter ?? 'brightness(0) invert(1)',
  '--theme-range-track': activeTheme.value.rangeTrack ?? 'rgba(0, 0, 0, 0.28)',
  '--theme-line': activeTheme.value.line ?? 'rgba(8, 16, 18, 0.1)',
  '--theme-panel-header': activeTheme.value.panelHeader ?? 'rgba(8, 16, 18, 0.045)',
  '--theme-field': activeTheme.value.field ?? 'rgba(8, 16, 18, 0.07)',
  '--theme-field-hover': activeTheme.value.fieldHover ?? 'rgba(8, 16, 18, 0.12)',
  '--theme-row-active': activeTheme.value.rowActive ?? 'rgba(255, 255, 255, 0.34)',
  '--theme-modal-background': activeTheme.value.modalBackground ?? '#f8fbfb',
  '--theme-modal-border': activeTheme.value.modalBorder ?? 'rgba(255, 255, 255, 0.74)',
}));
const cacheDirectoryDisplay = computed(() => settingsDraft.value.cache.songs.dir || defaultCacheDir.value);
const coverDirectoryDisplay = computed(() => settingsDraft.value.cache.covers.dir || defaultCoverDir.value);
const lyricsDirectoryDisplay = computed(() => settingsDraft.value.cache.lyrics.dir || defaultLyricsDir.value);
const cacheGroups = computed<Array<{
  id: CacheGroupId;
  title: string;
  directory: string;
  limitGb: number;
}>>(() => [
  {
    id: 'songs',
    title: '歌曲目录',
    directory: cacheDirectoryDisplay.value,
    limitGb: settingsDraft.value.cache.songs.limitGb,
  },
  {
    id: 'covers',
    title: '封面目录',
    directory: coverDirectoryDisplay.value,
    limitGb: settingsDraft.value.cache.covers.limitGb,
  },
  {
    id: 'lyrics',
    title: '歌词目录',
    directory: lyricsDirectoryDisplay.value,
    limitGb: settingsDraft.value.cache.lyrics.limitGb,
  },
]);
const scanStatusLabel = computed(() => (
  scannedSongCount.value
    ? `扫描中... 已读取 ${scannedSongCount.value} 首`
    : '扫描中...'
));

const detectPlatform = async () => {
  try {
    return await type();
  } catch {
    return 'unknown';
  }
};

const withStartupTimeout = async <T,>(
  label: string,
  task: Promise<T>,
  timeoutMs = STARTUP_STEP_TIMEOUT_MS,
) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${label} 超时`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

const scheduleStartupBackgroundTask = (task: () => void) => {
  let idleHandle: number | undefined;
  let hasRun = false;
  const idleWindow = window as IdleSchedulerWindow;

  const runOnce = () => {
    if (hasRun) return;
    hasRun = true;
    cancelPluginStartupSyncSchedule = undefined;
    task();
  };

  const delayHandle = window.setTimeout(() => {
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(runOnce, {
        timeout: PLUGIN_STARTUP_SYNC_IDLE_TIMEOUT_MS,
      });
      return;
    }

    runOnce();
  }, PLUGIN_STARTUP_SYNC_DELAY_MS);

  return () => {
    window.clearTimeout(delayHandle);
    if (idleHandle !== undefined && typeof idleWindow.cancelIdleCallback === 'function') {
      idleWindow.cancelIdleCallback(idleHandle);
    }
    cancelPluginStartupSyncSchedule = undefined;
  };
};

const configureWindow = async (osType: string) => {
  const isOpaquePlatform = osType === 'linux';

  document.documentElement.dataset.platform = osType;

  try {
    if (isOpaquePlatform) {
      await appWindow.setBackgroundColor([255, 255, 255, 255]);
      await appWebview.setBackgroundColor([255, 255, 255, 255]);
      return;
    }

    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch {
    // Running in the browser preview does not expose all Tauri window APIs.
  }

  try {
    await appWebview.setBackgroundColor([0, 0, 0, 0]);
  } catch {
    // Some platforms do not implement dynamic webview background updates.
  }
};

const emptyPlaybackSession = (): PlaybackSession => ({
  currentPlaylistId: null,
  currentSongId: null,
  currentSongPath: null,
  currentSongUrl: null,
  currentTime: 0,
  wasPlaying: false,
  shuffleEnabled: false,
  repeatMode: 'none',
  updatedAt: 0,
});

const requestStorageReinitialization = async () => {
  const shouldReset = await requestConfirm({
    title: '系统文件损坏',
    message: '应用配置文件无法解密。重新初始化会清空播放列表、系统设置和已安装插件等数据。',
    confirmText: '重新初始化',
    cancelText: '退出应用',
    kind: 'danger',
  });

  if (!shouldReset) {
    try {
      await appWindow.close();
    } catch (closeError) {
      console.warn('[App] Failed to close after storage corruption:', closeError);
    }
    return false;
  }

  await resetAppStorage();
  showToast('应用数据已重新初始化。', { title: '系统初始化', kind: 'warning' });
  return true;
};

const initializeAppSettings = async () => {
  try {
    await settingsStore.initialize();
    return true;
  } catch (error) {
    if (!(error instanceof AppStorageCorruptionError)) {
      throw error;
    }

    const didReset = await requestStorageReinitialization();
    if (!didReset) return false;

    await settingsStore.initialize();
    return true;
  }
};

const resizeWindow = async () => {
  try {
    const height = expandedPanel.value || isSettingsModalOpen.value ? EXPANDED_HEIGHT : COMPACT_HEIGHT;
    await appWindow.setSize(new LogicalSize(
      PLAYER_WIDTH,
      height,
    ));
  } catch {
    // Running in the browser preview does not expose the Tauri window API.
  }
};

const closeApp = async () => {
  await closeAfterPersist();
};

const minimizeApp = async () => {
  try {
    await appWindow.minimize();
  } catch (error) {
    console.warn('[App] Failed to minimize window:', error);
    appLogWarn('window.minimize.failed', '窗口最小化失败。', errorToLogDetails(error));
  }
};

const startWindowDrag = async (event: PointerEvent) => {
  if (event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  if (target?.closest('button, input, select, textarea, a, .expand-panel')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  try {
    await appWindow.startDragging();
  } catch {
    // Browser preview cannot drag the native window.
  }
};

const togglePanel = (panel: PanelMode) => {
  if (panel === 'search') {
    refreshPluginCapabilities();
  }
  expandedPanel.value = expandedPanel.value === panel ? null : panel;
};

const scrollActiveSongIntoView = async (behavior: ScrollBehavior = 'smooth') => {
  if (expandedPanel.value !== 'playlist' || !playerStore.currentMedia?.id) return;

  await nextTick();

  window.requestAnimationFrame(() => {
    const container = document.querySelector<HTMLElement>('.playlist-scroll-body');
    if (!container || !playerStore.currentMedia?.id) return;

    const activeRow = Array
      .from(container.querySelectorAll<HTMLElement>('.song-row'))
      .find(row => row.dataset.songId === playerStore.currentMedia?.id);

    activeRow?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior,
    });
  });
};

const scrollActiveLyricIntoView = async (behavior: ScrollBehavior = 'smooth') => {
  if (expandedPanel.value !== 'lyrics') return;

  await nextTick();

  window.requestAnimationFrame(() => {
    const container = document.querySelector<HTMLElement>('.lyrics-panel');
    if (!container) return;

    if (!parsedLyric.value.isSynced || activeLyricIndex.value < 0) {
      container.scrollTo({ top: 0, behavior });
      return;
    }

    const activeLine = container.querySelector<HTMLElement>(`[data-lyric-index="${activeLyricIndex.value}"]`);
    activeLine?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior,
    });
  });
};

watch([expandedPanel, isSettingsModalOpen], resizeWindow);
watch(songs, () => {
  clearShuffleQueue();
});
watch([() => playerStore.currentMedia?.id, expandedPanel, songs], () => {
  void scrollActiveSongIntoView();
}, { flush: 'post' });
watch([activeLyricIndex, expandedPanel, () => currentSong.value?.id], () => {
  void scrollActiveLyricIntoView();
}, { flush: 'post' });
watch(() => playlistStore.currentPlaylistId, () => {
  void playlistStore.save().catch(error => {
    console.warn('[App] Failed to persist current playlist selection:', error);
  });
  void persistPlaybackSession();
});
watch([
  () => playerStore.currentMedia?.id,
  () => playerStore.isPlaying,
  () => shuffleEnabled.value,
  () => repeatMode.value,
], () => {
  void persistPlaybackSession();
});
watch(() => playlistForm.value.type, type => {
  if (!isPlaylistModalOpen.value) return;

  if (playlistFormMode.value === 'create') {
    playlistForm.value.name = defaultPlaylistNameForType(type);
  }

  if (type.startsWith('plugin:')) {
    playlistForm.value.pluginId = selectedPlaylistPluginId.value;
    playlistForm.value.pluginPlaylistId = '';
    void loadPluginPlaylistOptions(selectedPlaylistPluginId.value);
  } else {
    playlistForm.value.pluginId = '';
    playlistForm.value.pluginPlaylistId = '';
    pluginPlaylistOptions.value = [];
  }
});

const checkAndNotifyPermission = async (dir: string) => {
  const result = await localMusicService.checkPermission(dir);

  if (result.error === 'PERMISSION_DENIED') {
    const osType = await type();
    let msg = '无法读取选择的目录。请确保应用具有足够的访问权限。';

    if (osType === 'macos') {
      msg = '检测到权限限制。请在“系统设置 -> 隐私与安全性 -> 完全磁盘访问权限”中为本应用授权，或尝试将目录移动到“下载”或“文档”之外的公开位置。';
    } else if (osType === 'windows') {
      msg = '访问被拒绝。请检查文件夹的 NTFS 权限设置，或尝试以管理员身份运行。';
    } else {
      msg = '无法读取该目录，请检查文件系统权限 (chmod/chown) 设置。';
    }

    showToast(msg, { title: '权限授权提醒', kind: 'error' });
    return false;
  } else if (result.error) {
    showToast(`访问出错: ${result.error}`, { title: '错误', kind: 'error' });
    return false;
  }

  return true;
};

const syncAppGlobalShortcuts = async (notify = false) => {
  try {
    const result = await syncGlobalShortcuts(settingsStore.settings, {
      playPause: togglePlay,
      previousTrack: () => playByOffset(-1),
      nextTrack: () => playByOffset(1),
    });

    if (notify && settingsStore.settings.shortcutsEnabled && !result.ok) {
      showToast(
        `以下快捷键注册失败，可能已被系统或其他应用占用：${result.failed.join('、')}`,
        { title: '全局快捷键', kind: 'warning' },
      );
    }
  } catch (error) {
    console.warn('[App] Failed to sync global shortcuts:', error);
    if (notify) {
      showToast(`全局快捷键注册失败: ${String(error)}`, { title: '全局快捷键', kind: 'error' });
    }
  }
};

const isOfficialCacheSource = (sourceId: string) => officialCacheAllowedSourceIds.includes(sourceId);

const pluginHasMusicSearchCapability = (plugin: InstalledPluginSetting) => (
  plugin.manifest.capabilities.includes('music-search') || plugin.manifest.capabilities.includes('search')
);

const isCacheSourceConfigurable = (plugin: InstalledPluginSetting) => (
  !isOfficialCacheSource(plugin.id) && pluginHasMusicSearchCapability(plugin)
);

const thirdPartyCacheAllowedSourceIds = (settings: AppSettings) => {
  const configurableSourceIds = new Set(
    settings.plugins
      .filter(isCacheSourceConfigurable)
      .map(plugin => plugin.id),
  );

  return settings.cache.allowedSourceIds.filter(sourceId => configurableSourceIds.has(sourceId));
};

const syncMediaCacheConfig = () => {
  mediaCacheService.configure({
    cacheDir: settingsStore.settings.cache.songs.dir || defaultCacheDir.value,
    limitBytes: settingsStore.settings.cache.songs.limitGb * 1024 * 1024 * 1024,
    allowedSourceIds: Array.from(new Set([
      ...officialCacheAllowedSourceIds,
      ...thirdPartyCacheAllowedSourceIds(settingsStore.settings),
    ])),
  });
  configureMediaAssetCache({
    coverDir: settingsStore.settings.cache.covers.dir || defaultCoverDir.value,
    lyricDir: settingsStore.settings.cache.lyrics.dir || defaultLyricsDir.value,
  });
};

const ensureDirectoryExists = async (dir: string) => {
  if (!dir || dir.startsWith('应用数据目录/')) return;
  await mkdirFsDir(dir, { recursive: true });
};

const configuredCacheDirectories = () => [
  settingsStore.settings.cache.songs.dir || defaultCacheDir.value,
  settingsStore.settings.cache.covers.dir || defaultCoverDir.value,
  settingsStore.settings.cache.lyrics.dir || defaultLyricsDir.value,
].filter(Boolean);

const ensureConfiguredCacheDirectories = async () => {
  await Promise.allSettled(configuredCacheDirectories().map(ensureDirectoryExists));
};

const blockedPluginMessage = (plugin: InstalledPluginSetting) => (
  plugin.blocked?.reason
    ? `${plugin.name}: ${plugin.blocked.reason}`
    : `${plugin.name}: 已被阻止加载`
);

const syncPluginBlocklist = async (notify = false) => {
  const refresh = await pluginBlocklistService.refresh(settingsStore.settings.pluginBlocklist);
  if (refresh.error) {
    console.warn('[PluginBlocklist] Failed to refresh blocklist:', refresh.error);
    if (notify && refresh.errorKind === 'signature') {
      showToast(
        '插件黑名单签名校验失败，可能是应用内置公钥不匹配或远程列表异常。建议升级到最新版应用。',
        { title: '插件黑名单', kind: 'warning' },
      );
    }
  }

  const matchesByPluginId = new Map(
    pluginBlocklistService
      .matchPlugins(settingsStore.settings.plugins, refresh.document)
      .map(match => [match.pluginId, match]),
  );
  const warningMatchesByPluginId = new Map(
    pluginBlocklistService
      .matchPluginWarnings(settingsStore.settings.plugins, refresh.document)
      .map(match => [match.pluginId, match]),
  );

  const nextSettings = cloneSettings(settingsStore.settings);
  nextSettings.pluginBlocklist = refresh.settings;

  let changed = refresh.changed;
  const newlyBlocked: InstalledPluginSetting[] = [];
  nextSettings.plugins = nextSettings.plugins.map(plugin => {
    const match = matchesByPluginId.get(plugin.id);
    const warningMatch = warningMatchesByPluginId.get(plugin.id);
    const nextBlocked = match?.block;
    const nextWarning = warningMatch?.warning;
    const wasBlocked = Boolean(plugin.blocked);
    const wasEnabled = plugin.enabled;

    if (!nextBlocked) {
      const stableWarning = plugin.warning
        && nextWarning
        && plugin.warning.entryId === nextWarning.entryId
        && plugin.warning.reason === nextWarning.reason
        && plugin.warning.detailsUrl === nextWarning.detailsUrl
        && plugin.warning.matchedBy === nextWarning.matchedBy
        ? plugin.warning
        : nextWarning;
      const warningChanged = JSON.stringify(plugin.warning) !== JSON.stringify(stableWarning);
      if (!wasBlocked && !warningChanged) return plugin;
      changed = true;
      return {
        ...plugin,
        blocked: undefined,
        warning: stableWarning,
      };
    }

    const stableBlocked = plugin.blocked
      && plugin.blocked.entryId === nextBlocked.entryId
      && plugin.blocked.reason === nextBlocked.reason
      && plugin.blocked.detailsUrl === nextBlocked.detailsUrl
      && plugin.blocked.matchedBy === nextBlocked.matchedBy
      ? plugin.blocked
      : nextBlocked;
    const nextPlugin = {
      ...plugin,
      enabled: false,
      blocked: stableBlocked,
      warning: undefined,
    };
    const blockChanged = wasEnabled || !wasBlocked || JSON.stringify(plugin.blocked) !== JSON.stringify(stableBlocked);
    if (blockChanged || plugin.warning) {
      changed = true;
    }
    if (blockChanged) {
      newlyBlocked.push(nextPlugin);
    }
    return nextPlugin;
  });

  if (changed) {
    await settingsStore.save(nextSettings);
    if (isSettingsModalOpen.value) {
      settingsDraft.value = {
        ...settingsDraft.value,
        pluginBlocklist: {
          ...settingsStore.settings.pluginBlocklist,
          urls: settingsStore.settings.pluginBlocklist.urls
            ? [...settingsStore.settings.pluginBlocklist.urls]
            : undefined,
          signatureUrls: settingsStore.settings.pluginBlocklist.signatureUrls
            ? [...settingsStore.settings.pluginBlocklist.signatureUrls]
            : undefined,
          publicKeyJwk: settingsStore.settings.pluginBlocklist.publicKeyJwk
            ? { ...settingsStore.settings.pluginBlocklist.publicKeyJwk }
            : undefined,
        },
        plugins: settingsDraft.value.plugins.map(plugin => {
          const savedPlugin = settingsStore.settings.plugins.find(item => item.id === plugin.id);
          return savedPlugin
            ? {
                ...plugin,
                enabled: savedPlugin.enabled,
                blocked: savedPlugin.blocked ? { ...savedPlugin.blocked } : undefined,
                warning: savedPlugin.warning ? { ...savedPlugin.warning } : undefined,
              }
            : plugin;
        }),
      };
    }
  }

  if (notify && newlyBlocked.length) {
    showToast(
      `以下插件已被阻止加载：\n${newlyBlocked.map(blockedPluginMessage).join('\n')}`,
      { title: '插件阻止列表', kind: 'warning' },
    );
  }
};

const syncExternalPlugins = async (notify = false) => {
  try {
    await syncPluginBlocklist(notify);
    const result = await pluginRuntimeService.sync(settingsStore.settings.plugins);
    refreshPluginCapabilities();
    if (!result.failures.length) return;

    const failedIds = new Set(result.failures.map(failure => failure.pluginId));
    const nextSettings = {
      ...settingsStore.settings,
      shortcuts: settingsStore.settings.shortcuts.map(shortcut => ({ ...shortcut })),
      plugins: settingsStore.settings.plugins.map(plugin => ({
        ...plugin,
        manifest: { ...plugin.manifest },
        config: { ...plugin.config },
        enabled: failedIds.has(plugin.id) ? false : plugin.enabled,
      })),
    };
    await settingsStore.save(nextSettings);
    refreshPluginCapabilities();

    if (isSettingsModalOpen.value) {
      settingsDraft.value.plugins = settingsDraft.value.plugins.map(plugin => ({
        ...plugin,
        enabled: failedIds.has(plugin.id) ? false : plugin.enabled,
      }));
    }

    if (notify) {
      showToast(
        `以下插件加载失败，已自动禁用：\n${result.failures.map(failure => `${failure.pluginName}: ${failure.reason}`).join('\n')}`,
        { title: '插件', kind: 'warning' },
      );
    }
  } catch (error) {
    console.warn('[App] Failed to sync external plugins:', error);
    if (notify) {
      showToast(`插件加载失败: ${String(error)}`, { title: '插件', kind: 'error' });
    }
  }
};

const createPlaybackSessionSnapshot = (): PlaybackSession => ({
  currentPlaylistId: playlistStore.currentPlaylistId,
  currentSongId: playerStore.currentMedia?.id ?? null,
  currentSongPath: playerStore.currentMedia?.extra?.path ?? null,
  currentSongUrl: playerStore.currentMedia?.url ?? null,
  currentTime: Number.isFinite(playerStore.currentTime) ? playerStore.currentTime : 0,
  wasPlaying: Boolean(playerStore.currentMedia && playbackShouldResume.value),
  shuffleEnabled: shuffleEnabled.value,
  repeatMode: repeatMode.value,
  updatedAt: Date.now(),
});

const persistPlaybackSession = async (force = false) => {
  if (isPlaybackSessionRestorePending && !force) return;

  playerStore.syncStatus();
  await writePlaybackSession(createPlaybackSessionSnapshot());
};

const closeAfterPersist = async () => {
  if (closeAfterPersistTask) return closeAfterPersistTask;

  isClosingWindow = true;
  closeAfterPersistTask = (async () => {
    if (playbackSessionTimer) {
      window.clearInterval(playbackSessionTimer);
      playbackSessionTimer = undefined;
    }
    if (syncTimer) {
      window.clearInterval(syncTimer);
      syncTimer = undefined;
    }
    cancelPluginStartupSyncSchedule?.();
    await persistPlaybackSession(true);

    try {
      await appWindow.destroy();
    } catch (error) {
      console.warn('[App] Failed to destroy window after persisting session:', error);
      window.close();
    }
  })();

  return closeAfterPersistTask;
};

const restorePlaybackSession = async (session: PlaybackSession) => {
  setPlaybackRestoreState({
    repeatMode: session.repeatMode,
    shuffleEnabled: session.shuffleEnabled,
    wasPlaying: session.wasPlaying,
  });

  if (session.currentPlaylistId && playlistStore.playlists.some(playlist => playlist.id === session.currentPlaylistId)) {
    playlistStore.currentPlaylistId = session.currentPlaylistId;
  }

  const matchesSessionSong = (songItem: MediaItem) => (
    Boolean(session.currentSongId && songItem.id === session.currentSongId)
    || Boolean(session.currentSongPath && songItem.extra?.path === session.currentSongPath)
    || Boolean(session.currentSongUrl && songItem.url === session.currentSongUrl)
  );

  let playlist = playlistStore.currentPlaylist;
  let song = playlist?.songs.find(matchesSessionSong);

  if (!song && (session.currentSongId || session.currentSongPath || session.currentSongUrl)) {
    const playlistWithSong = playlistStore.playlists.find(item => item.songs.some(matchesSessionSong));
    if (playlistWithSong) {
      playlistStore.currentPlaylistId = playlistWithSong.id;
      playlist = playlistWithSong;
      song = playlist.songs.find(matchesSessionSong);
    }
  }

  if (!song) return false;

  const needsPluginPlaybackUrl = song.sourceId !== LOCAL_MUSIC_SOURCE_ID && !song.url && !pluginManager.getPlugin(song.sourceId);
  if (needsPluginPlaybackUrl) return false;

  try {
    await playerStore.load(song, session.currentTime);
  } catch (error) {
    console.warn('[App] Failed to restore playback session:', error);
    return false;
  }

  if (shuffleEnabled.value) {
    rebuildShuffleQueue(song.id);
  }

  playbackShouldResume.value = false;
  playerStore.syncStatus();
  return true;
};

onMounted(async () => {
  const osType = await detectPlatform();
  isMacOs.value = osType === 'macos';
  await initializeAppLogger({
    appName,
    appVersion,
    platform: osType,
  }).catch(error => {
    console.warn('[App] Failed to initialize app logger:', error);
  });

  try {
    await withStartupTimeout('配置窗口', configureWindow(osType), 3000);
    appLogInfo('startup.window.configured', '窗口配置完成。', { platform: osType });
  } catch (error) {
    console.warn('[App] Failed to configure native window before startup:', error);
    document.documentElement.dataset.platform = osType;
  }

  try {
    const canContinueStartup = await initializeAppSettings();
    if (!canContinueStartup) return;
    appLogInfo('startup.settings.initialized', '应用设置初始化完成。');
  } catch (error) {
    startupFallbackMessage.value = `设置初始化失败，已使用默认设置启动。${String(error)}`;
    appLogError('startup.settings.failed', '应用设置初始化失败。', errorToLogDetails(error));
    console.warn('[App] Failed to initialize settings before startup:', error);
  }

  void settingsStore.save(normalizeShortcutsForPlatform(settingsStore.settings, isMacOs.value))
    .catch(error => {
      console.warn('[App] Failed to persist normalized settings after startup:', error);
    });

  try {
    const appData = await withStartupTimeout('读取应用数据目录', appDataDir(), 3000);
    defaultCacheDir.value = pathJoin(appData, 'songs');
    defaultCoverDir.value = pathJoin(appData, 'covers');
    defaultLyricsDir.value = pathJoin(appData, 'lyrics');
    appLogInfo('startup.app_data.resolved', '应用数据目录解析完成。', { appDataDirectory: appData });
  } catch (error) {
    console.warn('[App] Failed to resolve app data directory before startup:', error);
    appLogError('startup.app_data.failed', '应用数据目录解析失败。', errorToLogDetails(error));
    defaultCacheDir.value = '应用数据目录/songs';
    defaultCoverDir.value = '应用数据目录/covers';
    defaultLyricsDir.value = '应用数据目录/lyrics';
  }

  syncMediaCacheConfig();
  void ensureConfiguredCacheDirectories().catch(error => {
    console.warn('[App] Failed to create cache directories after startup:', error);
  });

  let savedPlaybackSession: PlaybackSession = emptyPlaybackSession();
  try {
    await playlistStore.initialize({ hydrateMediaAssets: false });
    appLogInfo('startup.playlists.initialized', '播放列表初始化完成。', {
      playlistCount: playlistStore.playlists.length,
      hasLocalMusicDir: Boolean(playlistStore.localMusicDir),
      currentPlaylistId: playlistStore.currentPlaylistId,
    });
  } catch (error) {
    if (error instanceof AppStorageCorruptionError) {
      const didReset = await requestStorageReinitialization();
      if (didReset) {
        window.location.reload();
      }
      return;
    }

    startupFallbackMessage.value = `播放列表初始化失败，已进入默认首屏。${String(error)}`;
    appLogError('startup.playlists.failed', '播放列表初始化失败。', errorToLogDetails(error));
    console.warn('[App] Failed to initialize playlists before startup:', error);
    playlistStore.hasLoaded = true;
    playlistStore.isInitialized = Boolean(playlistStore.localMusicDir || playlistStore.playlists.length);
  }

  try {
    await withStartupTimeout('初始化音量', playerStore.initializeVolume(), 3000);
  } catch (error) {
    console.warn('[App] Failed to initialize volume before startup:', error);
    appLogError('startup.volume.failed', '音量初始化失败。', errorToLogDetails(error));
  }

  try {
    savedPlaybackSession = await withStartupTimeout('读取播放状态', readPlaybackSession(), 3000);
  } catch (error) {
    console.warn('[App] Failed to read playback session before startup:', error);
    appLogError('startup.playback_session.failed', '播放状态读取失败。', errorToLogDetails(error));
  }

  if (startupFallbackMessage.value) {
    showToast(startupFallbackMessage.value, { title: '启动提醒', kind: 'warning' });
  }

  let didRestorePlaybackSession = await restorePlaybackSession(savedPlaybackSession);
  if (didRestorePlaybackSession) {
    isPlaybackSessionRestorePending = false;
  }
  void syncAppGlobalShortcuts(true).catch(error => {
    console.warn('[App] Failed to sync global shortcuts after startup:', error);
  });
  await resizeWindow();
  appLogInfo('app.startup.completed', '应用启动流程完成。', {
    initialized: playlistStore.isInitialized,
    playlistCount: playlistStore.playlists.length,
    pluginCount: settingsStore.settings.plugins.length,
  });
  stopEndedListener = player.onEnded(handleTrackEnded);
  window.addEventListener('keydown', handleWindowShortcut);
  try {
    stopCloseRequestedListener = await appWindow.onCloseRequested(async event => {
      event.preventDefault();
      await closeAfterPersist();
    });
  } catch {
    // Browser preview does not expose native window close events.
  }
  try {
    stopDragDropListener = await appWindow.onDragDropEvent(event => {
      if (!isSettingsModalOpen.value || settingsTab.value !== 'plugins') return;

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        isPluginPackageDragActive.value = true;
      } else if (event.payload.type === 'leave') {
        isPluginPackageDragActive.value = false;
      } else if (event.payload.type === 'drop') {
        isPluginPackageDragActive.value = false;
        void installPluginPackages(event.payload.paths);
      }
    });
  } catch {
    // Browser preview does not expose native file drag/drop events.
  }

  syncTimer = window.setInterval(() => {
    playerStore.syncStatus();
  }, 500);

  playbackSessionTimer = window.setInterval(() => {
    void persistPlaybackSession();
  }, 3000);

  const retryRestorePlaybackSession = async () => {
    if (didRestorePlaybackSession) return;
    didRestorePlaybackSession = await restorePlaybackSession(savedPlaybackSession);
    if (didRestorePlaybackSession) {
      isPlaybackSessionRestorePending = false;
    }
  };

  let pluginStartupTask: Promise<void> | null = null;
  const pluginStartupSettled = new Promise<void>(resolve => {
    cancelPluginStartupSyncSchedule = scheduleStartupBackgroundTask(() => {
      appLogInfo('plugins.startup_sync.begin', '后台插件校验开始。', {
        delayMs: PLUGIN_STARTUP_SYNC_DELAY_MS,
      }, 'plugin');
      pluginStartupTask = (async () => {
        await syncExternalPlugins(true);
        await retryRestorePlaybackSession();
      })()
        .catch(error => {
          console.warn('[App] Failed to run plugin startup sync:', error);
          appLogError('plugins.startup_sync.failed', '后台插件校验失败。', errorToLogDetails(error), 'plugin');
        })
        .finally(() => {
          resolve();
        });
      void pluginStartupTask;
    });
  });

  const hydrateMediaAssetsTask = (async () => {
    if (!playlistStore.playlists.length) return;

    try {
      await playlistStore.hydrateMediaAssets();
      await playlistStore.cacheInlineMediaAssets();
      await playlistStore.save();
    } catch (error) {
      console.warn('[App] Failed to hydrate media assets after startup:', error);
    }
  })();

  const startupDir = playlistStore.currentPlaylist?.localDir ?? playlistStore.localMusicDir;
  let scanStartupTask: Promise<void> | null = null;
  if (startupDir && (!playlistStore.currentPlaylist || playlistStore.currentPlaylist.songs.length === 0)) {
    scanStartupTask = (async () => {
      try {
        const hasPerm = await checkAndNotifyPermission(startupDir);
        if (hasPerm) {
          await scanLocalMusic(startupDir);
          await retryRestorePlaybackSession();
        }
      } catch (error) {
        console.warn('[App] Failed to scan startup music directory:', error);
      }
    })();
  }

  if (!didRestorePlaybackSession) {
    void Promise
      .allSettled([pluginStartupSettled, scanStartupTask].filter((task): task is Promise<void> => Boolean(task)))
      .finally(() => {
        isPlaybackSessionRestorePending = false;
      });
  }

  void hydrateMediaAssetsTask;
});

onBeforeUnmount(() => {
  if (!isClosingWindow) {
    void persistPlaybackSession();
  }
  cancelPluginStartupSyncSchedule?.();
  if (syncTimer) {
    window.clearInterval(syncTimer);
  }
  if (playbackSessionTimer) {
    window.clearInterval(playbackSessionTimer);
  }
  stopEndedListener?.();
  stopCloseRequestedListener?.();
  stopDragDropListener?.();
  void clearGlobalShortcuts();
  pluginRuntimeService.stopAll();
  window.removeEventListener('keydown', handleWindowShortcut);
  document.removeEventListener('pointerdown', closeVolumePopover);
});

const scanLocalMusic = async (dir: string, playlistId = playlistStore.currentPlaylistId, options: { replace?: boolean } = {}) => {
  if (isScanning.value) return;

  isScanning.value = true;
  scanningPlaylistId.value = playlistId ?? null;
  scannedSongCount.value = 0;

  const originalSongs = playlistId
    ? [...(playlistStore.playlists.find(playlist => playlist.id === playlistId)?.songs ?? [])]
    : [];
  const pendingSongs: MediaItem[] = [];
  const flushPendingSongs = async () => {
    if (!playlistId || !pendingSongs.length) return;

    const songsToFlush = pendingSongs.splice(0, pendingSongs.length);
    await playlistStore.addSongsToPlaylist(playlistId, songsToFlush);
  };

  try {
    if (playlistId && options.replace) {
      await playlistStore.beginPlaylistRescan(playlistId);
    }

    const scannedSongs = await localMusicService.scanDirectory(dir, {
      onSong: async song => {
        scannedSongCount.value += 1;
        if (!playlistId || !options.replace) return;

        pendingSongs.push(song);
        if (pendingSongs.length >= 8) {
          await flushPendingSongs();
        }
      },
    });

    await flushPendingSongs();

    if (playlistId) {
      if (options.replace) {
        await playlistStore.replacePlaylistSongs(playlistId, scannedSongs, { removedFrom: originalSongs });
      } else {
        await playlistStore.addSongsToPlaylist(playlistId, scannedSongs);
      }
    }
  } catch (err) {
    console.error('[App] Error during scanLocalMusic:', err);
    showToast(`扫描本地音乐失败: ${String(err)}`, { title: '本地音乐', kind: 'error' });
  } finally {
    isScanning.value = false;
    scanningPlaylistId.value = null;
  }
};

const scanCurrentPlaylist = async () => {
  const dir = playlistStore.currentPlaylist?.localDir ?? playlistStore.localMusicDir;
  if (!dir) return;

  await scanLocalMusic(dir, playlistStore.currentPlaylistId, { replace: true });
};

const switchPlaylist = (playlistId: string) => {
  const playlist = playlistStore.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  playlistStore.currentPlaylistId = playlistId;
  clearShuffleQueue();
  playbackShouldResume.value = false;
  playerStore.select(playlist.songs[0] ?? null);
};

const selectAfterRemovingSong = (playlistId: string, songId: string) => {
  if (playerStore.currentMedia?.id !== songId) return;

  const playlist = playlistStore.playlists.find(item => item.id === playlistId);
  if (!playlist) {
    playerStore.select(null);
    return;
  }

  const songIndex = playlist.songs.findIndex(song => song.id === songId);
  const nextSong = playlist.songs[songIndex + 1] ?? playlist.songs[songIndex - 1] ?? null;
  playerStore.select(nextSong);
};

const getLocalSongPath = (song: MediaItem) => (
  typeof song.extra?.path === 'string' ? song.extra.path : ''
);

const deleteLocalSongFile = async (song: MediaItem) => {
  const localPath = getLocalSongPath(song);
  if (!localPath) {
    throw new Error('没有找到该歌曲对应的本地文件路径。');
  }

  await removeFsEntry(localPath);
};

const deleteRemoteSongFile = async (playlist: NonNullable<typeof currentPlaylist.value>, song: MediaItem) => {
  await pluginManager.deleteMedia(song.sourceId, song.id, {
    playlistId: playlist.pluginPlaylist?.playlistId,
    playlistName: playlist.pluginPlaylist?.playlistName ?? playlist.name,
    media: song,
  });
};

const removeSongFromCurrentPlaylist = async (song: MediaItem) => {
  const playlist = currentPlaylist.value;
  if (!playlist) return;

  const isRemotePlaylist = playlist.type === 'plugin-playlist';
  const decision = await requestConfirmWithOption({
    title: '删除歌曲',
    message: `确定要从当前列表删除“${song.title}”吗？`,
    confirmText: '删除',
    kind: 'danger',
    optionLabel: isRemotePlaylist ? '同时删除远程文件' : '同时删除本地文件',
    optionDescription: isRemotePlaylist
      ? '需要当前插件支持远程删除能力。'
      : '会从磁盘中移除对应音频文件。',
    optionChecked: false,
  });
  if (!decision.confirmed) return;

  try {
    if (decision.optionChecked) {
      if (isRemotePlaylist) {
        await deleteRemoteSongFile(playlist, song);
      } else {
        await deleteLocalSongFile(song);
      }
    }

    selectAfterRemovingSong(playlist.id, song.id);
    await playlistStore.removeSongFromPlaylist(playlist.id, song.id);
    showToast('歌曲已删除。', { title: '删除歌曲', kind: 'success' });
  } catch (error) {
    showToast(`删除歌曲失败: ${String(error)}`, { title: '删除歌曲', kind: 'error' });
  }
};

const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest('input, textarea, select, button, a, [contenteditable="true"]'));
};

const handleWindowShortcut = (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.repeat || isEditableShortcutTarget(event.target)) return;
  if (isPlaylistModalOpen.value || isSettingsModalOpen.value) return;

  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    playByOffset(-1);
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    playByOffset(1);
  }
};

const refreshPluginCapabilities = () => {
  pluginPlaylistSources.value = pluginManager
    .getPlaylistSourcePlugins()
    .map(plugin => ({ id: plugin.id, name: plugin.name }));
  lyricSearchPlugins.value = pluginManager
    .getLyricsSearchPlugins()
    .map(plugin => ({ id: plugin.id, name: plugin.name }));
  songInfoSearchPlugins.value = pluginManager
    .getSongInfoSearchPlugins()
    .map(plugin => ({ id: plugin.id, name: plugin.name }));
  musicSearchPlugins.value = pluginManager
    .getMusicSearchPlugins()
    .map(plugin => ({ id: plugin.id, name: plugin.name }));

  if (!activeLyricSearchPluginId.value || !lyricSearchPlugins.value.some(plugin => plugin.id === activeLyricSearchPluginId.value)) {
    activeLyricSearchPluginId.value = lyricSearchPlugins.value[0]?.id ?? '';
  }
  if (!activeSongInfoSearchPluginId.value || !songInfoSearchPlugins.value.some(plugin => plugin.id === activeSongInfoSearchPluginId.value)) {
    activeSongInfoSearchPluginId.value = songInfoSearchPlugins.value[0]?.id ?? '';
  }
  if (!activeMusicSearchPluginId.value || !musicSearchPlugins.value.some(plugin => plugin.id === activeMusicSearchPluginId.value)) {
    activeMusicSearchPluginId.value = musicSearchPlugins.value[0]?.id ?? '';
  }
  if (!musicSearchPlugins.value.length && expandedPanel.value === 'search') {
    expandedPanel.value = null;
  }
};

const loadPluginPlaylistOptions = async (pluginId = selectedPlaylistPluginId.value) => {
  pluginPlaylistOptions.value = [];
  if (!pluginId) return;

  isLoadingPluginPlaylists.value = true;
  try {
    pluginPlaylistOptions.value = await pluginManager.listPluginPlaylists(pluginId);
  } catch (error) {
    console.error('[App] Failed to load plugin playlists:', error);
    showToast(`读取远程播放列表失败: ${String(error)}`, { title: '远程播放列表', kind: 'error' });
  } finally {
    isLoadingPluginPlaylists.value = false;
  }
};

const openCreatePlaylistModal = async () => {
  refreshPluginCapabilities();
  playlistFormMode.value = 'create';
  editingPlaylistId.value = null;
  playlistForm.value = {
    name: defaultPlaylistNameForType('local-directory'),
    type: 'local-directory',
    localDir: playlistStore.localMusicDir ?? playlistStore.currentPlaylist?.localDir ?? '',
    pluginId: '',
    pluginPlaylistId: '',
    scanImmediately: true,
  };
  pluginPlaylistOptions.value = [];
  isPlaylistModalOpen.value = true;
};

const openEditPlaylistModal = async () => {
  refreshPluginCapabilities();
  const playlist = playlistStore.currentPlaylist;
  if (!playlist) return;
  const pluginType = playlist.pluginPlaylist?.pluginId
    ? (`plugin:${playlist.pluginPlaylist.pluginId}` as PlaylistFormType)
    : 'local-directory';

  playlistFormMode.value = 'edit';
  editingPlaylistId.value = playlist.id;
  playlistForm.value = {
    name: playlist.name,
    type: playlist.type === 'plugin-playlist' ? pluginType : 'local-directory',
    localDir: playlist.localDir ?? playlistStore.localMusicDir ?? '',
    pluginId: playlist.pluginPlaylist?.pluginId ?? '',
    pluginPlaylistId: playlist.pluginPlaylist?.playlistId ?? '',
    scanImmediately: true,
  };
  await loadPluginPlaylistOptions(playlistForm.value.pluginId);
  isPlaylistModalOpen.value = true;
};

const closePlaylistModal = () => {
  isPlaylistModalOpen.value = false;
};

const deleteEditingPlaylist = async () => {
  const playlistId = editingPlaylistId.value;
  const playlist = playlistStore.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const shouldDelete = await requestConfirm({
    title: '删除播放列表',
    message: `确定要删除播放列表“${playlist.name}”吗？列表中的缓存信息也会一并移除。`,
    confirmText: '删除',
    kind: 'danger',
  });
  if (!shouldDelete) return;

  const wasCurrentPlaylist = playlistStore.currentPlaylistId === playlist.id;
  await playlistStore.deletePlaylist(playlist.id);
  if (wasCurrentPlaylist) {
    playerStore.select(playlistStore.currentPlaylist?.songs[0] ?? null);
  }
  closePlaylistModal();
};

const openSettingsModal = () => {
  settingsDraft.value = cloneSettings(normalizeShortcutsForPlatform(settingsStore.settings, isMacOs.value));
  pendingPluginRemovals.value = new Set();
  settingsTab.value = 'theme';
  isSettingsModalOpen.value = true;
  void refreshCacheUsage();
};

const closeSettingsModal = () => {
  settingsDraft.value = cloneSettings(normalizeShortcutsForPlatform(settingsStore.settings, isMacOs.value));
  pendingPluginRemovals.value = new Set();
  activeShortcutId.value = null;
  pressedShortcutKeys.value.clear();
  isSettingsModalOpen.value = false;
};

const saveSettings = async () => {
  const incompletePlugins = settingsDraft.value.plugins.filter(plugin => plugin.enabled && missingPluginConfigLabels(plugin).length);
  const incompletePlugin = incompletePlugins[0];
  if (incompletePlugin) {
    incompletePlugins.forEach(plugin => {
      plugin.enabled = false;
    });
    expandPluginDetails(incompletePlugin.id);
    settingsTab.value = 'plugins';
    notifyMissingPluginConfig(incompletePlugin);
  }

  settingsDraft.value.cache.allowedSourceIds = thirdPartyCacheAllowedSourceIds(settingsDraft.value);
  await settingsStore.save(normalizeShortcutsForPlatform(settingsDraft.value, isMacOs.value));
  await ensureConfiguredCacheDirectories();
  syncMediaCacheConfig();
  await enforceCacheLimits();
  for (const pluginId of pendingPluginRemovals.value) {
    if (!settingsStore.settings.plugins.some(plugin => plugin.id === pluginId)) {
      await pluginInstallerService.remove(pluginId);
    }
  }
  pendingPluginRemovals.value = new Set();
  await syncExternalPlugins(true);
  await syncAppGlobalShortcuts(true);
  isSettingsModalOpen.value = false;
};

const openAppDataDirectory = async () => {
  if (isOpeningAppDataDirectory.value) return;

  isOpeningAppDataDirectory.value = true;
  try {
    await revealAppDataDirectory();
    appLogInfo('app_data.directory.opened', '已打开应用数据目录。');
  } catch (error) {
    console.warn('[App] Failed to open app data directory:', error);
    appLogError('app_data.directory.open_failed', '打开应用数据目录失败。', errorToLogDetails(error));
    showToast(`打开应用数据目录失败: ${String(error)}`, { title: '应用数据', kind: 'error' });
  } finally {
    isOpeningAppDataDirectory.value = false;
  }
};

const selectCacheDirectory = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '请选择歌曲目录',
  });

  if (selected && typeof selected === 'string') {
    settingsDraft.value.cache.songs.dir = selected;
    void refreshCacheUsage('songs');
  }
};

const selectCoverDirectory = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '请选择封面目录',
  });

  if (selected && typeof selected === 'string') {
    settingsDraft.value.cache.covers.dir = selected;
    void refreshCacheUsage('covers');
  }
};

const selectLyricsDirectory = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '请选择歌词目录',
  });

  if (selected && typeof selected === 'string') {
    settingsDraft.value.cache.lyrics.dir = selected;
    void refreshCacheUsage('lyrics');
  }
};

const lyricSearchContext = () => {
  const song = currentSong.value;
  const title = lyricSearchTitle.value.trim() || song?.title;
  if (!song || !title) return null;

  return {
    songId: song.id,
    title,
    artist: lyricSearchArtist.value.trim() || song.artist,
    album: song.album,
    duration: song.duration,
  };
};

const songInfoSearchContext = () => {
  const song = songInfoSearchSong.value;
  const title = songInfoSearchTitle.value.trim() || song?.title || song?.artist || song?.album;
  if (!song || !title) return null;

  return {
    songId: song.id,
    title,
    artist: songInfoSearchArtist.value.trim() || song.artist,
    album: song.album,
    duration: song.duration,
  };
};

const isLocalPlaylistSong = (song: MediaItem) => (
  currentPlaylist.value?.type === 'local-directory'
  && song.sourceId === LOCAL_MUSIC_SOURCE_ID
  && currentPlaylist.value.songs.some(item => item.id === song.id)
);

const notifyEmbeddedWriteFallback = (message: string) => {
  showToast(message, {
    title: '写入歌曲文件',
    kind: 'warning',
    duration: 5200,
  });
};

const songInfoWriteFallbackMessage = (info: Partial<Pick<MediaItem, 'cover'>>) => (
  info.cover
    ? '歌曲信息写入歌曲文件失败，已保存在应用列表中；封面会保存到封面缓存。'
    : '歌曲信息写入歌曲文件失败，已保存在应用列表中。'
);

const writeSongLyric = async (song: MediaItem, lyric: string) => {
  let shouldCache = true;
  if (isLocalPlaylistSong(song)) {
    try {
      const didWriteEmbedded = await localMusicService.writeEmbeddedLyric(song, lyric);
      shouldCache = !didWriteEmbedded;
      if (!didWriteEmbedded) {
        notifyEmbeddedWriteFallback('歌词写入歌曲文件失败，已改为保存到歌词缓存。');
      }
    } catch (error) {
      console.warn('[App] Failed to write embedded lyric, falling back to cache:', error);
      notifyEmbeddedWriteFallback(`歌词写入歌曲文件失败，已改为保存到歌词缓存。${String(error)}`);
      shouldCache = true;
    }
  }

  await playlistStore.updateSongLyric(song.id, lyric, { cache: shouldCache });
  if (shouldCache) {
    await enforceCacheGroupLimit('lyrics');
  }
};

const writeSongInfo = async (song: MediaItem, info: Partial<Pick<MediaItem, 'title' | 'artist' | 'album' | 'cover' | 'year'>>) => {
  let shouldCache = Boolean(info.cover);
  if (isLocalPlaylistSong(song)) {
    try {
      const didWriteEmbedded = await localMusicService.writeEmbeddedSongInfo(song, info);
      shouldCache = Boolean(info.cover) && !didWriteEmbedded;
      if (!didWriteEmbedded) {
        notifyEmbeddedWriteFallback(songInfoWriteFallbackMessage(info));
      }
    } catch (error) {
      console.warn('[App] Failed to write embedded song info, falling back to cache:', error);
      notifyEmbeddedWriteFallback(`${songInfoWriteFallbackMessage(info)}${String(error)}`);
      shouldCache = Boolean(info.cover);
    }
  }

  await playlistStore.updateSongInfo(song.id, info, { cache: shouldCache });
  if (shouldCache) {
    await enforceCacheGroupLimit('covers');
  }
};

const openLyricSearchModal = async () => {
  const song = currentSong.value;
  if (!song) return;

  refreshPluginCapabilities();
  lyricSearchTitle.value = song.title;
  lyricSearchArtist.value = song.artist || '';
  lyricSearchResultsByPlugin.value = {};
  activeLyricSearchPluginId.value = lyricSearchPlugins.value[0]?.id ?? '';
  isLyricSearchModalOpen.value = true;
  await searchLyricsFromPlugins();
};

const searchLyricsFromPlugins = async () => {
  const context = lyricSearchContext();
  if (!context || isSearchingLyrics.value || !lyricSearchPlugins.value.length) return;

  isSearchingLyrics.value = true;
  const requestId = ++lyricSearchRequestId;
  lyricSearchResultsByPlugin.value = Object.fromEntries(lyricSearchPlugins.value.map(plugin => [plugin.id, []]));
  lyricPluginLoadingIds.value = new Set(lyricSearchPlugins.value.map(plugin => plugin.id));

  try {
    await Promise.all(lyricSearchPlugins.value.map(async plugin => {
      try {
        const results = await pluginManager.searchPluginLyrics(plugin.id, context);
        if (requestId !== lyricSearchRequestId) return;
        lyricSearchResultsByPlugin.value = {
          ...lyricSearchResultsByPlugin.value,
          [plugin.id]: results,
        };
      } catch (error) {
        console.error(`[App] Failed to search lyrics with ${plugin.name}:`, error);
        if (requestId !== lyricSearchRequestId) return;
        lyricSearchResultsByPlugin.value = {
          ...lyricSearchResultsByPlugin.value,
          [plugin.id]: [],
        };
      } finally {
        if (requestId === lyricSearchRequestId) {
          const nextLoadingIds = new Set(lyricPluginLoadingIds.value);
          nextLoadingIds.delete(plugin.id);
          lyricPluginLoadingIds.value = nextLoadingIds;
        }
      }
    }));
    if (!activeLyricSearchPluginId.value) {
      activeLyricSearchPluginId.value = lyricSearchPlugins.value[0]?.id ?? '';
    }
  } catch (error) {
    showToast(`查找歌词失败: ${String(error)}`, { title: '查找歌词', kind: 'error' });
  } finally {
    if (requestId === lyricSearchRequestId) {
      isSearchingLyrics.value = false;
      lyricPluginLoadingIds.value = new Set();
    }
  }
};

const closeLyricSearchModal = () => {
  if (isApplyingLyricSearchResult.value) return;
  isLyricSearchModalOpen.value = false;
  lyricSearchRequestId += 1;
  isSearchingLyrics.value = false;
  lyricPluginLoadingIds.value = new Set();
};

const applyLyricSearchResult = async (result: LyricSearchResult & { pluginId: string }) => {
  const context = lyricSearchContext();
  const song = currentSong.value;
  if (!context || !song || isApplyingLyricSearchResult.value) return;

  isApplyingLyricSearchResult.value = true;
  try {
    const lyric = await pluginManager.getLyric(result.pluginId, result.id, context);
    if (!lyric?.trim()) {
      showToast('该歌词结果没有返回可用内容。', { title: '查找歌词', kind: 'warning' });
      return;
    }

    song.lyric = lyric;
    if (playerStore.currentMedia?.id === song.id) {
      playerStore.currentMedia.lyric = lyric;
    }

    await writeSongLyric(song, lyric);
    isLyricSearchModalOpen.value = false;
  } catch (error) {
    showToast(`应用歌词失败: ${String(error)}`, { title: '查找歌词', kind: 'error' });
  } finally {
    isApplyingLyricSearchResult.value = false;
  }
};

const openSongInfoSearchModal = async (song: MediaItem) => {
  refreshPluginCapabilities();
  songInfoSearchSong.value = song;
  songInfoSearchTitle.value = song.title;
  songInfoSearchArtist.value = song.artist || '';
  songInfoSearchResultsByPlugin.value = {};
  activeSongInfoSearchPluginId.value = songInfoSearchPlugins.value[0]?.id ?? '';
  isSongInfoSearchModalOpen.value = true;
  await searchSongInfoFromPlugins();
};

const searchSongInfoFromPlugins = async () => {
  const context = songInfoSearchContext();
  if (!context || isSearchingSongInfo.value || !songInfoSearchPlugins.value.length) return;

  isSearchingSongInfo.value = true;
  const requestId = ++songInfoSearchRequestId;
  songInfoSearchResultsByPlugin.value = Object.fromEntries(songInfoSearchPlugins.value.map(plugin => [plugin.id, []]));
  songInfoPluginLoadingIds.value = new Set(songInfoSearchPlugins.value.map(plugin => plugin.id));

  try {
    await Promise.all(songInfoSearchPlugins.value.map(async plugin => {
      try {
        const results = await pluginManager.searchPluginSongInfo(plugin.id, context);
        if (requestId !== songInfoSearchRequestId) return;
        songInfoSearchResultsByPlugin.value = {
          ...songInfoSearchResultsByPlugin.value,
          [plugin.id]: results,
        };
      } catch (error) {
        console.error(`[App] Failed to search song info with ${plugin.name}:`, error);
        if (requestId !== songInfoSearchRequestId) return;
        songInfoSearchResultsByPlugin.value = {
          ...songInfoSearchResultsByPlugin.value,
          [plugin.id]: [],
        };
      } finally {
        if (requestId === songInfoSearchRequestId) {
          const nextLoadingIds = new Set(songInfoPluginLoadingIds.value);
          nextLoadingIds.delete(plugin.id);
          songInfoPluginLoadingIds.value = nextLoadingIds;
        }
      }
    }));
    if (!activeSongInfoSearchPluginId.value) {
      activeSongInfoSearchPluginId.value = songInfoSearchPlugins.value[0]?.id ?? '';
    }
  } catch (error) {
    showToast(`查找歌曲信息失败: ${String(error)}`, { title: '查找歌曲信息', kind: 'error' });
  } finally {
    if (requestId === songInfoSearchRequestId) {
      isSearchingSongInfo.value = false;
      songInfoPluginLoadingIds.value = new Set();
    }
  }
};

const closeSongInfoSearchModal = () => {
  if (isApplyingSongInfoSearchResult.value) return;
  isSongInfoSearchModalOpen.value = false;
  songInfoSearchSong.value = null;
  songInfoSearchRequestId += 1;
  isSearchingSongInfo.value = false;
  songInfoPluginLoadingIds.value = new Set();
};

const imageSourceToDataUrl = async (source: string) => {
  if (source.startsWith('data:')) return source;

  const response = await tauriFetch(source);
  if (!response.ok) {
    throw new Error(`封面获取失败: ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('封面格式无效'));
      }
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('封面读取失败')), { once: true });
    reader.readAsDataURL(blob);
  });
};

const applySongInfoSearchResult = async (result: SongInfoSearchResult & { pluginId: string }) => {
  const context = songInfoSearchContext();
  const song = songInfoSearchSong.value;
  if (!context || !song || isApplyingSongInfoSearchResult.value) return;

  isApplyingSongInfoSearchResult.value = true;
  try {
    const detail = await pluginManager.getSongInfo(result.pluginId, result.id, context);
    const selected = {
      ...detail,
      ...result,
      cover: detail?.cover || detail?.imageUrl || detail?.thumbnail || result.cover || result.imageUrl || result.thumbnail,
    };
    const coverSource = selected.cover || selected.imageUrl || selected.thumbnail;
    const cover = coverSource ? await imageSourceToDataUrl(coverSource) : undefined;
    const info: Partial<Pick<MediaItem, 'title' | 'artist' | 'album' | 'cover' | 'year'>> = {
      title: selected.title,
      artist: selected.artist,
      album: selected.album,
      year: selected.year,
      cover,
    };

    if (!info.title && !info.artist && !info.album && !info.cover) {
      showToast('该结果没有返回可用歌曲信息。', { title: '查找歌曲信息', kind: 'warning' });
      return;
    }

    if (info.title) song.title = info.title;
    if (info.artist) song.artist = info.artist;
    if (info.album) song.album = info.album;
    if (info.year) song.year = info.year;
    if (info.cover) song.cover = info.cover;
    if (playerStore.currentMedia?.id === song.id) {
      if (info.title) playerStore.currentMedia.title = info.title;
      if (info.artist) playerStore.currentMedia.artist = info.artist;
      if (info.album) playerStore.currentMedia.album = info.album;
      if (info.year) playerStore.currentMedia.year = info.year;
      if (info.cover) playerStore.currentMedia.cover = info.cover;
    }

    await writeSongInfo(song, info);
    isSongInfoSearchModalOpen.value = false;
  } catch (error) {
    showToast(`应用歌曲信息失败: ${String(error)}`, { title: '查找歌曲信息', kind: 'error' });
  } finally {
    isApplyingSongInfoSearchResult.value = false;
  }
};

const isPluginPackagePath = (path: string) => path.toLowerCase().endsWith(PLUGIN_PACKAGE_EXTENSION);

const installPluginPackages = async (paths: string[]) => {
  if (isInstallingPluginPackage.value) return;

  const packagePaths = paths.filter(isPluginPackagePath);
  if (!packagePaths.length) {
    showToast(`请安装 ${PLUGIN_PACKAGE_EXTENSION} 插件包。`, { title: '插件安装', kind: 'warning' });
    return;
  }

  isInstallingPluginPackage.value = true;
  const installedNames: string[] = [];
  const errors: string[] = [];

  try {
    for (const packagePath of packagePaths) {
      try {
        const installed = await pluginInstallerService.install(packagePath);
        const currentIndex = settingsDraft.value.plugins.findIndex(plugin => plugin.id === installed.id);
        const existing = currentIndex >= 0 ? settingsDraft.value.plugins[currentIndex] : undefined;
        const blocked = pluginBlocklistService.matchPlugin(installed, settingsStore.settings.pluginBlocklist.cached)?.block;
        const warning = pluginBlocklistService.matchPluginWarning(installed, settingsStore.settings.pluginBlocklist.cached)?.warning;
        const nextPlugin = {
          ...installed,
          enabled: blocked ? false : (existing?.enabled ?? installed.enabled),
          config: existing?.config ?? installed.config,
          blocked,
          warning: blocked ? undefined : warning,
        };
        if (currentIndex >= 0) {
          settingsDraft.value.plugins.splice(currentIndex, 1, nextPlugin);
        } else {
          settingsDraft.value.plugins.push(nextPlugin);
        }
        pendingPluginRemovals.value.delete(installed.id);
        installedNames.push(`${installed.name} ${installed.version}`);
      } catch (error) {
        errors.push(`${packagePath}: ${String(error)}`);
      }
    }
  } finally {
    isInstallingPluginPackage.value = false;
  }

  if (installedNames.length) {
    showToast(`已安装插件：${installedNames.join('、')}。保存设置后生效。`, {
      title: '插件安装',
      kind: errors.length ? 'warning' : 'success',
    });
  }
  if (errors.length) {
    showToast(`插件安装失败:\n${errors.join('\n')}`, { title: '插件安装', kind: 'error' });
  }
};

const selectPluginPackage = async () => {
  const selected = await open({
    directory: false,
    multiple: false,
    title: '请选择插件包',
    filters: [{ name: 'Magpie Plugin Zip', extensions: [PLUGIN_PACKAGE_EXTENSION.slice(1)] }],
  });

  if (selected && typeof selected === 'string') {
    await installPluginPackages([selected]);
  }
};

const removePlugin = async (pluginId: string) => {
  const plugin = settingsDraft.value.plugins.find(item => item.id === pluginId);
  if (!plugin) return;

  const shouldRemove = await requestConfirm({
    title: '删除插件',
    message: `确定要删除插件“${plugin.name}”吗？`,
    confirmText: '删除',
    kind: 'danger',
  });
  if (!shouldRemove) return;

  settingsDraft.value.plugins = settingsDraft.value.plugins.filter(plugin => plugin.id !== pluginId);
  pendingPluginRemovals.value.add(pluginId);
  const nextExpandedIds = new Set(expandedPluginIds.value);
  nextExpandedIds.delete(pluginId);
  expandedPluginIds.value = nextExpandedIds;
};

const updatePluginEnabled = (plugin: InstalledPluginSetting, nextEnabled: boolean) => {
  if (!nextEnabled) {
    plugin.enabled = false;
    return;
  }

  if (plugin.blocked) {
    plugin.enabled = false;
    showToast(blockedPluginMessage(plugin), { title: '插件已被阻止', kind: 'warning' });
    return;
  }

  const missingLabels = missingPluginConfigLabels(plugin);
  if (missingLabels.length) {
    plugin.enabled = false;
    expandPluginDetails(plugin.id);
    notifyMissingPluginConfig(plugin, missingLabels);
    return;
  }

  plugin.enabled = true;
};

const togglePluginExpanded = (pluginId: string) => {
  const nextExpandedIds = new Set(expandedPluginIds.value);
  if (nextExpandedIds.has(pluginId)) {
    nextExpandedIds.delete(pluginId);
  } else {
    nextExpandedIds.add(pluginId);
  }
  expandedPluginIds.value = nextExpandedIds;
};

const shortcutKeyName = (event: KeyboardEvent) => {
  if (event.key === ' ') return 'Space';
  if (event.key === 'Control') return 'Ctrl';
  if (event.key === 'Meta') return isMacOs.value ? 'Cmd' : 'Meta';
  if (event.key === 'Alt') return 'Alt';
  if (event.key === 'Shift') return 'Shift';
  if (event.key.startsWith('Arrow')) return event.key;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
};

const orderedShortcutKeys = (keys: Set<string>) => {
  const priority = isMacOs.value ? ['Cmd', 'Ctrl', 'Alt', 'Shift'] : ['Ctrl', 'Meta', 'Alt', 'Shift'];
  const ordered = priority.filter(key => keys.has(key));
  const rest = Array.from(keys).filter(key => !priority.includes(key)).sort();
  return [...ordered, ...rest].join('+');
};

const beginShortcutCapture = (shortcutId: ShortcutSetting['id']) => {
  activeShortcutId.value = shortcutId;
  pressedShortcutKeys.value = new Set();
  const shortcut = settingsDraft.value.shortcuts.find(item => item.id === shortcutId);
  if (shortcut) shortcut.keys = '';
};

const captureShortcutKey = (event: KeyboardEvent, shortcutId: ShortcutSetting['id']) => {
  event.preventDefault();
  event.stopPropagation();

  if (activeShortcutId.value !== shortcutId) {
    beginShortcutCapture(shortcutId);
  }

  if (event.key === 'Escape' || event.key === 'Backspace') {
    const shortcut = settingsDraft.value.shortcuts.find(item => item.id === shortcutId);
    if (shortcut) shortcut.keys = '';
    pressedShortcutKeys.value = new Set();
    return;
  }

  const key = shortcutKeyName(event);
  const nextKeys = new Set(pressedShortcutKeys.value);
  nextKeys.add(key);
  pressedShortcutKeys.value = nextKeys;

  const shortcut = settingsDraft.value.shortcuts.find(item => item.id === shortcutId);
  if (shortcut) shortcut.keys = orderedShortcutKeys(nextKeys);
};

const restoreShortcutDefault = (shortcutId: ShortcutSetting['id']) => {
  const shortcut = settingsDraft.value.shortcuts.find(item => item.id === shortcutId);
  if (shortcut && !shortcut.keys.trim()) {
    shortcut.keys = getShortcutDefault(shortcutId);
  }

  if (activeShortcutId.value === shortcutId) {
    activeShortcutId.value = null;
    pressedShortcutKeys.value = new Set();
  }
};

const releaseShortcutKey = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();

  const key = shortcutKeyName(event);
  const nextKeys = new Set(pressedShortcutKeys.value);
  nextKeys.delete(key);
  pressedShortcutKeys.value = nextKeys;
};

const normalizeFsSize = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getFileCacheEntry = async (path: string): Promise<CacheFileEntry> => {
  try {
    const info = await statFsEntry(path);
    return {
      path,
      size: normalizeFsSize(info.size),
      mtime: info.mtime?.getTime() ?? 0,
    };
  } catch (error) {
    console.warn(`[App] Failed to stat cache file ${path}, falling back to byte length:`, error);
    try {
      const bytes = await readFsFile(path);
      return {
        path,
        size: bytes.byteLength,
        mtime: 0,
      };
    } catch (readError) {
      console.warn(`[App] Failed to read cache file ${path}:`, readError);
      return { path, size: 0, mtime: 0 };
    }
  }
};

const getDirectorySize = async (dir: string): Promise<number> => {
  try {
    return Number(await invoke<number | string>('get_directory_size', { path: dir }));
  } catch (error) {
    console.warn(`[App] Failed to get native cache directory size for ${dir}, falling back to web fs:`, error);
  }

  try {
    const entries = await readFsDir(dir);
    let total = 0;

    for (const entry of entries) {
      const fullPath = pathJoin(dir, entry.name);
      if (entry.isDirectory) {
        total += await getDirectorySize(fullPath);
      } else if (entry.isFile) {
        total += (await getFileCacheEntry(fullPath)).size;
      }
    }

    return total;
  } catch (error) {
    console.warn(`[App] Failed to read cache directory ${dir}:`, error);
    return 0;
  }
};

const listDirectoryFiles = async (dir: string): Promise<CacheFileEntry[]> => {
  try {
    const entries = await readFsDir(dir);
    const files: CacheFileEntry[] = [];

    for (const entry of entries) {
      const fullPath = pathJoin(dir, entry.name);
      if (entry.isDirectory) {
        files.push(...await listDirectoryFiles(fullPath));
      } else if (entry.isFile) {
        files.push(await getFileCacheEntry(fullPath));
      }
    }

    return files;
  } catch (error) {
    console.warn(`[App] Failed to list cache directory ${dir}:`, error);
    return [];
  }
};

const cacheGroupById = (groupId: CacheGroupId) => cacheGroups.value.find(group => group.id === groupId);

const cacheUsageLabel = (groupId: CacheGroupId) => (
  readingCacheUsageIds.value.has(groupId)
    ? '计算中'
    : formatBytes(cacheUsedBytes.value[groupId] ?? 0)
);

const refreshCacheUsage = async (groupId?: CacheGroupId) => {
  const groups = groupId
    ? cacheGroups.value.filter(group => group.id === groupId)
    : cacheGroups.value;

  const groupIds = groups.map(group => group.id);
  readingCacheUsageIds.value = new Set([...readingCacheUsageIds.value, ...groupIds]);

  try {
    const usageEntries = await Promise.all(groups.map(async (group) => {
      const size = group.directory ? await getDirectorySize(group.directory) : 0;
      return [group.id, size] as const;
    }));
    cacheUsedBytes.value = {
      ...cacheUsedBytes.value,
      ...Object.fromEntries(usageEntries),
    };
  } finally {
    const nextIds = new Set(readingCacheUsageIds.value);
    groupIds.forEach(id => nextIds.delete(id));
    readingCacheUsageIds.value = nextIds;
  }
};

const updateCacheGroupLimit = (groupId: CacheGroupId, event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const nextValue = Number(target?.value);
  const normalizedValue = Number.isFinite(nextValue) ? nextValue : 0.1;

  settingsDraft.value.cache[groupId].limitGb = normalizedValue;
};

const updateCacheSourceAllowed = (sourceId: string, allowed: boolean) => {
  const plugin = settingsDraft.value.plugins.find(item => item.id === sourceId);
  if (!plugin || !isCacheSourceConfigurable(plugin)) return;

  const allowedSourceIds = new Set(settingsDraft.value.cache.allowedSourceIds);
  if (allowed) {
    allowedSourceIds.add(sourceId);
  } else {
    allowedSourceIds.delete(sourceId);
  }
  settingsDraft.value.cache.allowedSourceIds = Array.from(allowedSourceIds);
};

const isCacheSourceAllowedInDraft = (sourceId: string) => (
  isOfficialCacheSource(sourceId) || settingsDraft.value.cache.allowedSourceIds.includes(sourceId)
);

const selectCacheGroupDirectory = async (groupId: CacheGroupId) => {
  if (groupId === 'songs') {
    await selectCacheDirectory();
  } else if (groupId === 'covers') {
    await selectCoverDirectory();
  } else {
    await selectLyricsDirectory();
  }
};

const cleanupDirectoryToLimit = async (dir: string, limitGb: number) => {
  const limitBytes = Math.max(1024 * 1024, limitGb * 1024 * 1024 * 1024);
  const files = await listDirectoryFiles(dir);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= limitBytes) return;

  const oldestFiles = files.sort((a, b) => a.mtime - b.mtime);
  for (const file of oldestFiles) {
    if (total <= limitBytes) break;
    try {
      await removeFsEntry(file.path);
      total -= file.size;
    } catch (error) {
      console.warn(`[App] Failed to remove cache file ${file.path}:`, error);
    }
  }
};

const enforceCacheGroupLimit = async (groupId: CacheGroupId) => {
  const group = cacheGroupById(groupId);
  if (!group?.directory) return;

  await cleanupDirectoryToLimit(group.directory, group.limitGb);
  await refreshCacheUsage(groupId);
};

const enforceCacheLimits = async () => {
  await Promise.all(cacheGroups.value.map(group => enforceCacheGroupLimit(group.id)));
};

const clearCacheDirectory = async (groupId: CacheGroupId) => {
  const group = cacheGroupById(groupId);
  const dir = group?.directory;
  if (!group || !dir || clearingCacheIds.value.has(groupId)) return;

  const shouldClear = await requestConfirm({
    title: `清空${group.title}缓存`,
    message: `确定要清空${group.title}目录中的文件吗？`,
    confirmText: '清空',
    kind: 'danger',
  });
  if (!shouldClear) return;

  clearingCacheIds.value = new Set([...clearingCacheIds.value, groupId]);
  try {
    await ensureDirectoryExists(dir);
    const entries = await readFsDir(dir);
    await Promise.allSettled(entries.map(entry => removeFsEntry(pathJoin(dir, entry.name), { recursive: true })));
    await refreshCacheUsage(groupId);
  } catch (error) {
    showToast(`清空${group.title}缓存失败: ${String(error)}`, { title: '清空缓存', kind: 'error' });
  } finally {
    const nextIds = new Set(clearingCacheIds.value);
    nextIds.delete(groupId);
    clearingCacheIds.value = nextIds;
  }
};

watch(() => settingsTab.value, tab => {
  if (tab === 'cache') {
    void refreshCacheUsage();
  }
});

const selectPlaylistDirectory = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '请选择播放列表本地目录',
  });

  if (selected && typeof selected === 'string') {
    const hasPerm = await checkAndNotifyPermission(selected);
    if (hasPerm) {
      playlistForm.value.localDir = selected;
    }
  }
};

const searchNetworkMusic = async () => {
  const query = networkSearchQuery.value.trim();
  if (!query || isSearchingNetworkMusic.value) return;

  refreshPluginCapabilities();
  if (!musicSearchPlugins.value.length) return;

  isSearchingNetworkMusic.value = true;
  const nextResults: Record<string, MediaItem[]> = {};
  try {
    await Promise.all(musicSearchPlugins.value.map(async plugin => {
      try {
        const result = await pluginManager.searchMusic(plugin.id, query, 1, 20);
        nextResults[plugin.id] = result.songs ?? [];
      } catch (error) {
        console.error(`[App] Failed to search music with ${plugin.name}:`, error);
        nextResults[plugin.id] = [];
      }
    }));
    networkSearchResultsByPlugin.value = nextResults;
    if (!activeMusicSearchPluginId.value) {
      activeMusicSearchPluginId.value = musicSearchPlugins.value[0]?.id ?? '';
    }
  } catch (error) {
    showToast(`网络搜索失败: ${String(error)}`, { title: '网络搜索', kind: 'error' });
  } finally {
    isSearchingNetworkMusic.value = false;
  }
};

const playNetworkSong = (song: MediaItem) => {
  void playMedia(song);
};

const addNetworkSongToCurrentPlaylist = async (song: MediaItem) => {
  if (!playlistStore.currentPlaylistId) return;

  await playlistStore.addSongToPlaylist(playlistStore.currentPlaylistId, song);
};

const isMediaCacheAllowed = (song: MediaItem) => mediaCacheService.canCacheMedia(song);

const cacheNetworkSong = async (song: MediaItem) => {
  if (!mediaCacheService.canCacheMedia(song)) {
    showToast('该歌曲来源未加入允许缓存白名单。', { title: '缓存歌曲', kind: 'warning' });
    return;
  }

  isCachingNetworkSongId.value = song.id;
  try {
    const url = await pluginManager.resolveMediaUrl(song);
    const cachedPath = await mediaCacheService.cacheMedia(song, url);
    showToast(`已缓存到: ${cachedPath}`, { title: '缓存歌曲', kind: 'success' });
    void refreshCacheUsage();
  } catch (error) {
    showToast(`缓存失败: ${String(error)}`, { title: '缓存歌曲', kind: 'error' });
  } finally {
    isCachingNetworkSongId.value = null;
  }
};

const submitPlaylistForm = async () => {
  const name = playlistForm.value.name.trim();
  const type: PlaylistType = isPluginPlaylist.value ? 'plugin-playlist' : 'local-directory';
  const localDir = playlistForm.value.localDir.trim();
  const pluginId = selectedPlaylistPluginId.value;
  const pluginPlaylistId = playlistForm.value.pluginPlaylistId;
  const shouldScanImmediately = playlistForm.value.scanImmediately;

  if (!name) {
    showToast('请输入播放列表名称。', { title: '表单未完成', kind: 'warning' });
    return;
  }

  if (type === 'local-directory' && !localDir) {
    showToast('请选择本地目录。', { title: '表单未完成', kind: 'warning' });
    return;
  }

  if (type === 'plugin-playlist') {
    if (!pluginId || !pluginPlaylistId) {
      showToast('请选择远程播放列表。', { title: '表单未完成', kind: 'warning' });
      return;
    }
  }

  try {
    if (type === 'local-directory') {
      const hasPerm = await checkAndNotifyPermission(localDir);
      if (!hasPerm) return;
      await playlistStore.setLocalMusicDir(localDir);
    }

    if (playlistFormMode.value === 'create') {
      const selectedPluginPlaylist = pluginPlaylistOptions.value.find(item => item.id === pluginPlaylistId);
      const playlist = await playlistStore.createPlaylist(name, {
        type,
        localDir: type === 'local-directory' ? localDir : undefined,
        pluginPlaylist: type === 'plugin-playlist'
          ? {
            pluginId,
            playlistId: pluginPlaylistId,
            playlistName: selectedPluginPlaylist?.name,
          }
          : undefined,
      });
      playlistStore.currentPlaylistId = playlist.id;
      expandedPanel.value = 'playlist';
      await playlistStore.save({ throwOnError: true });
      closePlaylistModal();

      if (type === 'local-directory' && shouldScanImmediately) {
        await scanLocalMusic(localDir, playlist.id);
      } else if (type === 'plugin-playlist') {
        isScanning.value = true;
        try {
          await playlistStore.refreshPluginPlaylist(playlist.id);
        } finally {
          isScanning.value = false;
        }
      }
      return;
    }

    if (!editingPlaylistId.value) return;

    const playlist = playlistStore.playlists.find(pl => pl.id === editingPlaylistId.value);
    const shouldReloadLocalSongs = shouldScanImmediately && type === 'local-directory';
    const shouldRefreshPluginSongs = type === 'plugin-playlist'
      && (
        playlist?.pluginPlaylist?.pluginId !== pluginId
        || playlist?.pluginPlaylist?.playlistId !== pluginPlaylistId
        || !playlist?.songs.length
      );
    const selectedPluginPlaylist = pluginPlaylistOptions.value.find(item => item.id === pluginPlaylistId);

    await playlistStore.updatePlaylist(editingPlaylistId.value, {
      name,
      type,
      localDir: type === 'local-directory' ? localDir : undefined,
      pluginPlaylist: type === 'plugin-playlist'
        ? {
          pluginId,
          playlistId: pluginPlaylistId,
          playlistName: selectedPluginPlaylist?.name,
        }
        : undefined,
    });
    playlistStore.currentPlaylistId = editingPlaylistId.value;
    await playlistStore.save({ throwOnError: true });

    closePlaylistModal();

    if (type === 'local-directory' && shouldReloadLocalSongs) {
      await scanLocalMusic(localDir, editingPlaylistId.value, { replace: true });
    } else if (type === 'plugin-playlist' && shouldRefreshPluginSongs) {
      isScanning.value = true;
      try {
        await playlistStore.refreshPluginPlaylist(editingPlaylistId.value);
      } finally {
        isScanning.value = false;
      }
    }
  } catch (error) {
    showToast(`保存播放列表失败: ${String(error)}`, { title: '播放列表', kind: 'error' });
    console.error('[App] Failed to submit playlist form:', error);
  }
};
</script>

<template>
  <div
    v-if="!playlistStore.hasLoaded"
    class="startup-screen app-surface"
    :style="surfaceThemeStyle"
  >
    <strong>MagpieMusicPlayer</strong>
    <span>正在启动...</span>
  </div>

  <SetupView
    v-else-if="!playlistStore.isInitialized"
    :app-name="appName"
    :close-icon="closeIcon"
    :minimize-icon="minimizeIcon"
    :settings-icon="settingsIcon"
    :surface-theme-style="surfaceThemeStyle"
    @close="closeApp"
    @create-playlist="openCreatePlaylistModal"
    @minimize="minimizeApp"
    @open-settings="openSettingsModal"
    @start-window-drag="startWindowDrag"
  />

  <PlayerView
    v-else-if="playlistStore.hasLoaded"
    v-model:active-music-search-plugin-id="activeMusicSearchPluginId"
    v-model:network-search-query="networkSearchQuery"
    :active-lyric-index="activeLyricIndex"
    :active-music-search-results="activeMusicSearchResults"
    :add-icon="addIcon"
    :album-line="albumLine"
    :app-name="appName"
    :close-icon="closeIcon"
    :current-playlist-id="playlistStore.currentPlaylistId"
    :current-song="currentSong"
    :current-song-is-favorite="currentSongIsFavorite"
    :displayed-current-time="displayedCurrentTime"
    :displayed-duration="displayedDuration"
    :edit-icon="editIcon"
    :expanded-panel="expandedPanel"
    :favorite-song-ids="playlistStore.favoriteSongIds"
    :heart-icon="heartIcon"
    :heart-outline-icon="heartOutlineIcon"
    :is-caching-network-song-id="isCachingNetworkSongId"
    :is-media-cache-allowed="isMediaCacheAllowed"
    :is-searching-lyrics="isSearchingLyrics"
    :is-searching-network-music="isSearchingNetworkMusic"
    :is-settings-modal-open="isSettingsModalOpen"
    :is-scanning="isScanning"
    :is-volume-popover-open="isVolumePopoverOpen"
    :lyric-lines="lyricLines"
    :lyrics-icon="lyricsIcon"
    :minimize-icon="minimizeIcon"
    :music-search-plugins="musicSearchPlugins"
    :next-icon="nextIcon"
    :parsed-lyric="parsedLyric"
    :pause-icon="pauseIcon"
    :play-icon="playIcon"
    :player-current-media="playerStore.currentMedia"
    :player-is-playing="playerStore.isPlaying"
    :player-volume="playerStore.volume"
    :playlist-has-scan-source="Boolean(playlistStore.currentPlaylist?.localDir || playlistStore.localMusicDir)"
    :playlist-icon="playlistIcon"
    :playlist-select-options="playlistSelectOptions"
    :previous-icon="previousIcon"
    :progress-percent="progressPercent"
    :repeat-icon="repeatIcon"
    :repeat-mode="repeatMode"
    :repeat-title="repeatTitle"
    :scan-status-label="scanStatusLabel"
    :scanning-playlist-id="scanningPlaylistId"
    :search-icon="searchIcon"
    :settings-icon="settingsIcon"
    :shuffle-enabled="shuffleEnabled"
    :shuffle-icon="shuffleIcon"
    :songs="songs"
    :surface-theme-style="surfaceThemeStyle"
    :trash-icon="trashIcon"
    :volume-icon="volumeIcon"
    :volume-percent="volumePercent"
    @add-network-song="addNetworkSongToCurrentPlaylist"
    @close="closeApp"
    @create-playlist="openCreatePlaylistModal"
    @cache-network-song="cacheNetworkSong"
    @edit-playlist="openEditPlaylistModal"
    @handle-seek="handleSeek"
    @handle-volume-input="handleVolumeInput"
    @open-song-info-search="openSongInfoSearchModal"
    @open-lyric-search="openLyricSearchModal"
    @open-settings="openSettingsModal"
    @play-by-offset="playByOffset"
    @play-network-song="playNetworkSong"
    @play-song="playSong"
    @remove-song="removeSongFromCurrentPlaylist"
    @scan-current-playlist="scanCurrentPlaylist"
    @search-network-music="searchNetworkMusic"
    @start-window-drag="startWindowDrag"
    @minimize="minimizeApp"
    @switch-playlist="switchPlaylist"
    @toggle-current-favorite="toggleCurrentFavorite"
    @toggle-panel="togglePanel"
    @toggle-play="togglePlay"
    @toggle-repeat-mode="toggleRepeatMode"
    @toggle-shuffle="toggleShuffle"
    @toggle-song-favorite="toggleSongFavorite"
    @toggle-volume-popover="toggleVolumePopover"
  />

  <div :style="surfaceThemeStyle">
    <PlaylistModal
      :close-icon="closeIcon"
      :is-loading-plugin-playlists="isLoadingPluginPlaylists"
      :is-local-directory-playlist="isLocalDirectoryPlaylist"
      :is-open="isPlaylistModalOpen"
      :is-plugin-playlist="isPluginPlaylist"
      :is-scanning="isScanning"
      :playlist-form="playlistForm"
      :playlist-form-mode="playlistFormMode"
      :playlist-modal-title="playlistModalTitle"
      :playlist-type-options="playlistTypeOptions"
      :plugin-playlist-placeholder="pluginPlaylistPlaceholder"
      :plugin-playlist-select-options="pluginPlaylistSelectOptions"
      :selected-playlist-plugin-id="selectedPlaylistPluginId"
      :trash-icon="trashIcon"
      @close="closePlaylistModal"
      @delete-playlist="deleteEditingPlaylist"
      @load-plugin-playlist-options="loadPluginPlaylistOptions()"
      @select-playlist-directory="selectPlaylistDirectory"
      @submit="submitPlaylistForm"
    />

    <LyricSearchModal
      v-model:active-lyric-search-plugin-id="activeLyricSearchPluginId"
      v-model:lyric-search-artist="lyricSearchArtist"
      v-model:lyric-search-title="lyricSearchTitle"
      :active-lyric-search-results="activeLyricSearchResults"
      :close-icon="closeIcon"
      :is-open="isLyricSearchModalOpen"
      :is-applying-result="isApplyingLyricSearchResult"
      :is-searching-lyrics="isSearchingLyrics"
      :lyric-plugin-loading-ids="lyricPluginLoadingIds"
      :lyric-search-plugins="lyricSearchPlugins"
      @apply-result="applyLyricSearchResult"
      @close="closeLyricSearchModal"
      @search="searchLyricsFromPlugins"
    />

    <SongInfoSearchModal
      v-model:active-song-info-search-plugin-id="activeSongInfoSearchPluginId"
      v-model:song-info-search-artist="songInfoSearchArtist"
      v-model:song-info-search-title="songInfoSearchTitle"
      :active-song-info-search-results="activeSongInfoSearchResults"
      :close-icon="closeIcon"
      :is-open="isSongInfoSearchModalOpen"
      :is-applying-result="isApplyingSongInfoSearchResult"
      :is-searching-song-info="isSearchingSongInfo"
      :song-info-search-plugins="songInfoSearchPlugins"
      :song-info-plugin-loading-ids="songInfoPluginLoadingIds"
      @apply-result="applySongInfoSearchResult"
      @close="closeSongInfoSearchModal"
      @search="searchSongInfoFromPlugins"
    />

    <SettingsModal
      :active-shortcut-id="activeShortcutId"
      :app-description="appDescription"
      :app-name="appName"
      :app-version="appVersion"
      :cache-groups="cacheGroups"
      :cache-usage-label="cacheUsageLabel"
      :clearing-cache-ids="clearingCacheIds"
      :close-icon="closeIcon"
      :expanded-plugin-ids="expandedPluginIds"
	      :is-installing-plugin-package="isInstallingPluginPackage"
	      :is-open="isSettingsModalOpen"
	      :is-opening-app-data-directory="isOpeningAppDataDirectory"
	      :is-plugin-package-drag-active="isPluginPackageDragActive"
	      :plugin-capability-tags="pluginCapabilityTags"
      :plugin-config-fields="pluginConfigFields"
      :plugin-config-input-type="pluginConfigInputType"
      :is-cache-source-configurable="isCacheSourceConfigurable"
      :is-cache-source-allowed="isCacheSourceAllowedInDraft"
      :settings-draft="settingsDraft"
      :settings-tab="settingsTab"
      :settings-tabs="settingsTabs"
      :theme-options="themeOptions"
      :trash-icon="trashIcon"
      @begin-shortcut-capture="beginShortcutCapture"
      @capture-shortcut-key="captureShortcutKey"
	      @clear-cache-directory="clearCacheDirectory"
	      @close="closeSettingsModal"
	      @open-app-data-directory="openAppDataDirectory"
	      @release-shortcut-key="releaseShortcutKey"
      @remove-plugin="removePlugin"
      @restore-shortcut-default="restoreShortcutDefault"
      @save="saveSettings"
      @select-cache-group-directory="selectCacheGroupDirectory"
      @select-plugin-package="selectPluginPackage"
      @select-theme="settingsDraft.themeId = $event"
      @set-settings-tab="settingsTab = $event"
      @toggle-plugin-expanded="togglePluginExpanded"
      @update-cache-group-limit="updateCacheGroupLimit"
      @update-cache-source-allowed="updateCacheSourceAllowed"
      @update-plugin-config-boolean="updatePluginConfigFromBoolean"
      @update-plugin-config-input="updatePluginConfigFromInput"
      @update-plugin-enabled="updatePluginEnabled"
      @update-shortcuts-enabled="settingsDraft.shortcutsEnabled = $event"
    />

    <AppConfirm
      :open="confirmDialog.open"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :confirm-text="confirmDialog.confirmText"
      :cancel-text="confirmDialog.cancelText"
      :kind="confirmDialog.kind"
      :option-label="confirmDialog.optionLabel"
      :option-description="confirmDialog.optionDescription"
      :option-checked="confirmDialog.optionChecked"
      :theme-style="surfaceThemeStyle"
      @confirm="closeConfirmDialog(true)"
      @cancel="closeConfirmDialog(false)"
      @update:option-checked="updateConfirmOptionChecked"
    />
    <AppToast
      :toasts="toasts"
      :theme-style="surfaceThemeStyle"
      @dismiss="dismissToast"
      @pause="pauseToast"
      @resume="resumeToast"
    />
  </div>
</template>
