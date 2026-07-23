import type { PlaybackRepeatMode } from '../store/playbackSessionStore';
import type { ThemeId } from '../store/appSettingsStore';

export type PanelMode = 'playlist' | 'lyrics' | 'search' | null;
export type RepeatMode = PlaybackRepeatMode;
export type PlaylistFormMode = 'create' | 'edit';
export type SettingsTab = 'theme' | 'playback' | 'plugins' | 'shortcuts' | 'cache' | 'about';
export type CacheGroupId = 'songs' | 'covers' | 'lyrics';
export type PlaylistFormType = 'local-directory' | 'plugin-playlist' | `plugin:${string}`;

export interface ThemeOption {
  id: ThemeId;
  name: string;
  background: string;
  panel: string;
  ink: string;
  mutedInk: string;
  control: string;
  controlInk: string;
  cacheTrackSoft?: string;
  iconFilter?: string;
  playIconFilter?: string;
  rangeTrack?: string;
  line?: string;
  panelHeader?: string;
  field?: string;
  fieldHover?: string;
  rowActive?: string;
  modalBackground?: string;
  modalBorder?: string;
}

export interface LyricLine {
  text: string;
  time?: number;
}

export interface ParsedLyric {
  isSynced: boolean;
  lines: LyricLine[];
}

export interface CacheFileEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface PlaylistForm {
  name: string;
  type: PlaylistFormType;
  localDir: string;
  pluginId: string;
  pluginPlaylistId: string;
  scanImmediately: boolean;
}

export interface PluginOption {
  id: string;
  name: string;
}

export interface CacheGroup {
  id: CacheGroupId;
  title: string;
  directory: string;
  limitGb: number;
}
