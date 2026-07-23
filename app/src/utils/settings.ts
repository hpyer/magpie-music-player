import type { AppSettings, InstalledPluginSetting, ShortcutSetting } from '../store/appSettingsStore';
import { defaultShortcuts } from '../store/appSettingsStore';
import type { PluginConfigField, PluginConfigValue } from '../types/plugin';
import { pluginCapabilityGroups } from '../config/appConfig';

export const pluginCapabilityTags = (plugin: InstalledPluginSetting) => {
  return pluginCapabilityGroups
    .filter(group => group.capabilities.some(capability => plugin.manifest.capabilities.includes(capability)))
    .map(group => group.label);
};

export const pluginConfigFields = (plugin: InstalledPluginSetting) => plugin.configSchema ?? [];

export const isPluginConfigFieldMissing = (plugin: InstalledPluginSetting, field: PluginConfigField) => {
  if (!field.required) return false;
  const value = plugin.config[field.key];
  return value === undefined || value === null || String(value).trim() === '';
};

export const missingPluginConfigLabels = (plugin: InstalledPluginSetting) => (
  pluginConfigFields(plugin)
    .filter(field => isPluginConfigFieldMissing(plugin, field))
    .map(field => field.label)
);

export const pluginConfigInputType = (field: PluginConfigField) => {
  if (field.type === 'password') return 'password';
  if (field.type === 'url') return 'url';
  if (field.type === 'number') return 'number';
  return 'text';
};

export const normalizePluginConfigValue = (field: PluginConfigField, value: string | boolean): PluginConfigValue => {
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'number') {
    if (value === '') return '';
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : '';
  }
  return String(value);
};

export const cloneSettings = (settings: AppSettings): AppSettings => ({
  ...settings,
  cache: {
    songs: { ...settings.cache.songs },
    covers: { ...settings.cache.covers },
    lyrics: { ...settings.cache.lyrics },
    allowedSourceIds: [...settings.cache.allowedSourceIds],
  },
  playback: { ...settings.playback },
  pluginBlocklist: {
    ...settings.pluginBlocklist,
    urls: settings.pluginBlocklist.urls ? [...settings.pluginBlocklist.urls] : undefined,
    signatureUrls: settings.pluginBlocklist.signatureUrls ? [...settings.pluginBlocklist.signatureUrls] : undefined,
    publicKeyJwk: settings.pluginBlocklist.publicKeyJwk
      ? { ...settings.pluginBlocklist.publicKeyJwk }
      : undefined,
    cached: settings.pluginBlocklist.cached
      ? {
          ...settings.pluginBlocklist.cached,
          entries: settings.pluginBlocklist.cached.entries.map(entry => ({ ...entry })),
        }
      : undefined,
  },
  shortcuts: settings.shortcuts.map(shortcut => ({ ...shortcut })),
  plugins: settings.plugins.map(plugin => ({
    ...plugin,
    manifest: { ...plugin.manifest },
    configSchema: plugin.configSchema
      ? plugin.configSchema.map(field => ({
          ...field,
          options: field.options?.map(option => ({ ...option })),
        }))
      : undefined,
    config: { ...plugin.config },
    installedIntegrity: plugin.installedIntegrity
      ? {
          ...plugin.installedIntegrity,
          files: { ...plugin.installedIntegrity.files },
        }
      : undefined,
    blocked: plugin.blocked ? { ...plugin.blocked } : undefined,
    warning: plugin.warning ? { ...plugin.warning } : undefined,
  })),
});

export const shortcutDefaultsForPlatform = (isMacOs: boolean): ShortcutSetting[] => (
  defaultShortcuts().map(shortcut => ({
    ...shortcut,
    keys: isMacOs ? shortcut.keys.replace(/^Ctrl\+/, 'Cmd+') : shortcut.keys,
  }))
);

export const getShortcutDefault = (shortcutId: ShortcutSetting['id'], isMacOs: boolean) => {
  return shortcutDefaultsForPlatform(isMacOs).find(shortcut => shortcut.id === shortcutId)?.keys ?? '';
};

export const normalizeShortcutsForPlatform = (settings: AppSettings, isMacOs: boolean): AppSettings => {
  const crossPlatformDefaults = defaultShortcuts();

  return {
    ...settings,
    shortcuts: settings.shortcuts.map(shortcut => {
      const ctrlDefault = crossPlatformDefaults.find(item => item.id === shortcut.id)?.keys;
      const platformDefault = getShortcutDefault(shortcut.id, isMacOs);
      const keys = isMacOs && shortcut.keys === ctrlDefault ? platformDefault : shortcut.keys;

      return {
        ...shortcut,
        keys: keys || platformDefault,
      };
    }),
  };
};
