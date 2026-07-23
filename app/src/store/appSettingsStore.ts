import { defineStore } from 'pinia';
import { officialCacheAllowedSourceIds, themeOptions } from '../config/appConfig';
import defaultPluginBlocklistPublicKey from '../config/pluginBlocklistPublicKey.json';
import type { PluginConfigField, PluginConfigValue, PluginManifest } from '../types/plugin';
import { readJsonFile, storagePath, writeJsonFile } from './appFileStorage';

export type ThemeId = 'sunset' | 'graphite' | 'aurora' | 'orchid' | 'paper' | 'midnight';

export interface ShortcutSetting {
  id: 'playPause' | 'previousTrack' | 'nextTrack';
  name: string;
  keys: string;
}

export interface InstalledPluginSetting {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  entry: string;
  runtime: PluginManifest['runtime'];
  manifest: PluginManifest;
  configSchema?: PluginConfigField[];
  config: Record<string, PluginConfigValue>;
  installedIntegrity?: {
    algorithm: 'sha256';
    packageHash?: string;
    files: Record<string, string>;
  };
  blocked?: InstalledPluginBlock;
  warning?: InstalledPluginWarning;
}

export interface InstalledPluginBlock {
  entryId: string;
  reason?: string;
  detailsUrl?: string;
  matchedBy: string;
  blockedAt: number;
}

export interface InstalledPluginWarning {
  entryId: string;
  reason?: string;
  detailsUrl?: string;
  matchedBy: string;
  warnedAt: number;
}

export type PluginBlocklistSeverity = 'block' | 'warn';

export interface PluginBlocklistEntry {
  id: string;
  pluginIds?: string[];
  signerIds?: string[];
  packageHashes?: string[];
  entryHashes?: string[];
  networkOrigins?: string[];
  reason?: string;
  detailsUrl?: string;
  severity?: PluginBlocklistSeverity;
}

export interface PluginBlocklistDocument {
  version: 1;
  updatedAt: string;
  entries: PluginBlocklistEntry[];
}

export interface PluginBlocklistSettings {
  enabled: boolean;
  url: string;
  urls?: string[];
  signatureUrl?: string;
  signatureUrls?: string[];
  publicKeyJwk?: JsonWebKey;
  refreshIntervalHours: number;
  lastCheckedAt?: number;
  cached?: PluginBlocklistDocument;
}

export interface CachePathSetting {
  dir: string;
  limitGb: number;
}

export interface CacheSettings {
  songs: CachePathSetting;
  covers: CachePathSetting;
  lyrics: CachePathSetting;
  allowedSourceIds: string[];
}

export interface PlaybackSettings {
  favoriteShuffleWeight: number;
}

export interface AppSettings {
  themeId: ThemeId;
  shortcutsEnabled: boolean;
  shortcuts: ShortcutSetting[];
  playback: PlaybackSettings;
  cache: CacheSettings;
  pluginBlocklist: PluginBlocklistSettings;
  plugins: InstalledPluginSetting[];
}

const APP_SETTINGS_PATH = storagePath('settings', 'app.json');

export const defaultPluginBlocklistUrls = [
  'https://gitee.com/Hpyer/magpie-music-player/raw/main/plugin-blocklist/blocklist.json',
  'https://raw.githubusercontent.com/hpyer/magpie-music-player/main/plugin-blocklist/blocklist.json',
];

export const defaultShortcuts = (): ShortcutSetting[] => [
  { id: 'playPause', name: '播放/暂停', keys: 'Ctrl+Shift+Space' },
  { id: 'previousTrack', name: '上一首', keys: 'Ctrl+Shift+ArrowLeft' },
  { id: 'nextTrack', name: '下一首', keys: 'Ctrl+Shift+ArrowRight' },
];

export const createDefaultAppSettings = (): AppSettings => ({
  themeId: 'sunset',
  shortcutsEnabled: false,
  shortcuts: defaultShortcuts(),
  playback: {
    favoriteShuffleWeight: 1,
  },
  cache: {
    songs: { dir: '', limitGb: 1 },
    covers: { dir: '', limitGb: 0.5 },
    lyrics: { dir: '', limitGb: 0.5 },
    allowedSourceIds: [],
  },
  pluginBlocklist: {
    enabled: true,
    url: defaultPluginBlocklistUrls[0],
    urls: defaultPluginBlocklistUrls,
    publicKeyJwk: { ...defaultPluginBlocklistPublicKey } as JsonWebKey,
    refreshIntervalHours: 12,
  },
  plugins: [],
});

const normalizeCachePathSetting = (
  setting: Partial<CachePathSetting> | undefined,
  fallback: CachePathSetting,
): CachePathSetting => ({
  dir: setting?.dir ?? fallback.dir,
  limitGb: Number.isFinite(setting?.limitGb)
    ? Math.min(50, Math.max(0.1, setting?.limitGb as number))
    : fallback.limitGb,
});

const normalizeAllowedSourceIds = (sourceIds: unknown): string[] => {
  const values = Array.isArray(sourceIds) ? sourceIds : [];
  return Array.from(new Set(
    values
      .filter(value => typeof value === 'string' && value.trim())
      .map(value => value.trim())
      .filter(value => !officialCacheAllowedSourceIds.includes(value)),
  ));
};

const normalizeFavoriteShuffleWeight = (value: unknown, fallback: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  if (![1, 1.5, 2, 3].includes(numericValue)) return fallback;
  return numericValue;
};

const normalizeConfigSchema = (schema: unknown): PluginConfigField[] | undefined => {
  const fields = Array.isArray(schema)
    ? schema
    : (schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : undefined);
  if (!Array.isArray(fields)) return undefined;

  return fields.map(field => ({
    ...(field as PluginConfigField),
    options: (field as PluginConfigField).options?.map(option => ({ ...option })),
  }));
};

const normalizePluginBlocklistDocument = (document: unknown): PluginBlocklistDocument | undefined => {
  if (!document || typeof document !== 'object') return undefined;
  const value = document as Partial<PluginBlocklistDocument>;
  if (value.version !== 1 || typeof value.updatedAt !== 'string' || !Array.isArray(value.entries)) {
    return undefined;
  }

  return {
    version: 1,
    updatedAt: value.updatedAt,
    entries: value.entries
      .filter(entry => entry && typeof entry === 'object' && typeof (entry as PluginBlocklistEntry).id === 'string')
      .map(entry => ({ ...(entry as PluginBlocklistEntry) })),
  };
};

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && Boolean(value.trim())
);

const normalizePluginBlocklistSettings = (
  settings: Partial<PluginBlocklistSettings> | undefined,
): PluginBlocklistSettings => {
  const fallback = createDefaultAppSettings().pluginBlocklist;
  const urls = Array.from(new Set(
    (Array.isArray(settings?.urls) && settings.urls.length ? settings.urls : [settings?.url, ...defaultPluginBlocklistUrls])
      .filter(nonEmptyString)
      .map(value => value.trim()),
  ));
  const signatureUrls = Array.isArray(settings?.signatureUrls)
    ? settings.signatureUrls.filter(nonEmptyString).map(value => value.trim())
    : undefined;
  return {
    enabled: settings?.enabled ?? fallback.enabled,
    url: typeof settings?.url === 'string' && settings.url.trim() ? settings.url : urls[0] ?? fallback.url,
    urls: urls.length ? urls : fallback.urls,
    signatureUrl: typeof settings?.signatureUrl === 'string' ? settings.signatureUrl : undefined,
    signatureUrls,
    publicKeyJwk: fallback.publicKeyJwk ? { ...fallback.publicKeyJwk } : undefined,
    refreshIntervalHours: Number.isFinite(settings?.refreshIntervalHours)
      ? Math.min(168, Math.max(1, settings?.refreshIntervalHours as number))
      : fallback.refreshIntervalHours,
    lastCheckedAt: Number.isFinite(settings?.lastCheckedAt) ? settings?.lastCheckedAt : undefined,
    cached: normalizePluginBlocklistDocument(settings?.cached),
  };
};

const normalizeSettings = (settings: Partial<AppSettings>): AppSettings => {
  const fallback = createDefaultAppSettings();
  const shortcutsById = new Map((settings.shortcuts ?? []).map(shortcut => [shortcut.id, shortcut]));
  const themeId = typeof settings.themeId === 'string'
    && themeOptions.some(theme => theme.id === settings.themeId)
    ? settings.themeId
    : fallback.themeId;

  return {
    themeId,
    shortcutsEnabled: settings.shortcutsEnabled ?? fallback.shortcutsEnabled,
    shortcuts: fallback.shortcuts.map(shortcut => ({
      ...shortcut,
      keys: shortcutsById.get(shortcut.id)?.keys || shortcut.keys,
    })),
    playback: {
      favoriteShuffleWeight: normalizeFavoriteShuffleWeight(
        settings.playback?.favoriteShuffleWeight,
        fallback.playback.favoriteShuffleWeight,
      ),
    },
    cache: {
      songs: normalizeCachePathSetting(settings.cache?.songs, fallback.cache.songs),
      covers: normalizeCachePathSetting(settings.cache?.covers, fallback.cache.covers),
      lyrics: normalizeCachePathSetting(settings.cache?.lyrics, fallback.cache.lyrics),
      allowedSourceIds: normalizeAllowedSourceIds(settings.cache?.allowedSourceIds),
    },
    pluginBlocklist: normalizePluginBlocklistSettings(settings.pluginBlocklist),
    plugins: (settings.plugins ?? fallback.plugins).map(plugin => {
      const manifest = plugin.manifest ?? {
        schemaVersion: 1,
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        runtime: plugin.runtime ?? 'web-worker-esm',
        entry: plugin.entry ?? '',
        permissions: [],
        capabilities: [],
      };
      const configSchema = normalizeConfigSchema(plugin.configSchema);

      const config = { ...(plugin.config ?? {}) };
      for (const field of configSchema ?? []) {
        if (config[field.key] === undefined && field.default !== undefined) {
          config[field.key] = field.default;
        }
      }

      return {
        ...plugin,
        entry: plugin.entry ?? manifest.entry ?? '',
        runtime: plugin.runtime ?? manifest.runtime ?? 'web-worker-esm',
        manifest,
        configSchema,
        config,
        installedIntegrity: plugin.installedIntegrity,
        blocked: plugin.blocked
          ? {
              ...plugin.blocked,
              blockedAt: Number.isFinite(plugin.blocked.blockedAt) ? plugin.blocked.blockedAt : Date.now(),
            }
          : undefined,
        warning: plugin.warning
          ? {
              ...plugin.warning,
              warnedAt: Number.isFinite(plugin.warning.warnedAt) ? plugin.warning.warnedAt : Date.now(),
            }
          : undefined,
      };
    }),
  };
};

export const useAppSettingsStore = defineStore('appSettings', {
  state: () => ({
    settings: createDefaultAppSettings(),
    hasLoaded: false,
  }),
  actions: {
    async initialize() {
      const savedSettings = await readJsonFile<Partial<AppSettings>>(APP_SETTINGS_PATH, {});
      this.settings = normalizeSettings(savedSettings);
      this.hasLoaded = true;
      await this.save();
    },
    async save(settings?: AppSettings) {
      this.settings = normalizeSettings(settings ?? this.settings);
      await writeJsonFile(APP_SETTINGS_PATH, this.settings);
    },
  },
});
