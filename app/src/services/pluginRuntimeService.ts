import { BaseDirectory, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { pluginManager } from '../core/pluginManager';
import { pluginStoragePath } from './pluginInstallerService';
import { appLogError, appLogInfo, appLogWarn, errorToLogDetails } from './appLogger';
import type { InstalledPluginSetting } from '../store/appSettingsStore';
import type {
  LyricSearchContext,
  LyricSearchResult,
  MediaDeleteContext,
  MediaItem,
  Plugin,
  PluginPlaylistItem,
  SearchResult,
  SongInfoSearchContext,
  SongInfoSearchResult,
} from '../types/plugin';

interface WorkerResponse<T = unknown> {
  id: number;
  result?: T;
  error?: string;
}

interface WorkerHostMessage {
  hostMessageId: number;
  message: {
    type: 'network.request';
    url: string;
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
  };
}

const isWorkerHostMessage = (value: unknown): value is WorkerHostMessage => {
  return Boolean(value && typeof value === 'object' && 'hostMessageId' in value && 'message' in value);
};

const toCloneablePayload = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
};

const toHexDigest = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const yieldToBrowser = () => new Promise<void>(resolve => {
  window.setTimeout(resolve, 0);
});

class WorkerPluginHost {
  private readonly worker: Worker;
  private readonly moduleUrl: string;
  private readonly workerUrl: string;
  private nextMessageId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    moduleSource: string,
    private readonly plugin: InstalledPluginSetting,
  ) {
    const moduleBlob = new Blob([moduleSource], { type: 'text/javascript' });
    this.moduleUrl = URL.createObjectURL(moduleBlob);
    const workerSource = `
      let nextHostMessageId = 1;
      const hostPending = new Map();

      const sendHostMessage = (message) => {
        const hostMessageId = nextHostMessageId++;
        return new Promise((resolve, reject) => {
          hostPending.set(hostMessageId, { resolve, reject });
          self.postMessage({ hostMessageId, message });
        });
      };

      globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const headers = {};
        new Headers(init.headers || {}).forEach((value, key) => {
          if (['origin', 'referer', 'referrer'].includes(key.toLowerCase())) return;
          headers[key] = value;
        });
        const response = await sendHostMessage({
          type: 'network.request',
          url,
          init: {
            method: init.method,
            headers,
            body: typeof init.body === 'string' ? init.body : undefined,
          },
        });
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };

      const pluginModulePromise = import(${JSON.stringify(this.moduleUrl)});

      self.onmessage = async (event) => {
        if (event.data && 'hostResponseId' in event.data) {
          const pending = hostPending.get(event.data.hostResponseId);
          if (!pending) return;
          hostPending.delete(event.data.hostResponseId);
          if (event.data.error) {
            pending.reject(new Error(event.data.error));
          } else {
            pending.resolve(event.data.result);
          }
          return;
        }

        const { id, message } = event.data;
        try {
          const pluginModule = await pluginModulePromise;
          if (typeof pluginModule.handleMessage !== 'function') {
            throw new Error('Plugin module must export handleMessage(message).');
          }
          const result = await pluginModule.handleMessage(message);
          self.postMessage({ id, result });
        } catch (error) {
          self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
        }
      };
    `;
    this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  private handleMessage = (event: MessageEvent<WorkerResponse | WorkerHostMessage>) => {
    if (isWorkerHostMessage(event.data)) {
      void this.handleHostMessage(event.data);
      return;
    }

    const pending = this.pending.get(event.data.id);
    if (!pending) return;

    this.pending.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.result);
    }
  };

  private async handleHostMessage(hostMessage: WorkerHostMessage) {
    try {
      if (hostMessage.message.type !== 'network.request') {
        throw new Error(`Unsupported host message: ${hostMessage.message.type}`);
      }
      const result = await this.requestNetwork(hostMessage.message.url, hostMessage.message.init);
      this.worker.postMessage({ hostResponseId: hostMessage.hostMessageId, result });
    } catch (error) {
      this.worker.postMessage({
        hostResponseId: hostMessage.hostMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestNetwork(url: string, init: WorkerHostMessage['message']['init']) {
    if (!this.isAllowedNetworkUrl(url)) {
      throw new Error(`Network request is not allowed for this plugin: ${url}`);
    }

    const response = await tauriFetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      connectTimeout: 15000,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    };
  }

  isAllowedNetworkUrl(url: string) {
    if (!this.plugin.manifest.permissions.includes('network:request')) return false;

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

    return this.plugin.manifest.networkAllowlist?.some(allowItem => {
      if (allowItem.startsWith('user-configured:')) {
        const configKey = allowItem.slice('user-configured:'.length);
        const configuredUrl = this.plugin.config[configKey];
        if (typeof configuredUrl !== 'string' || !configuredUrl) return false;
        try {
          return target.origin === new URL(configuredUrl).origin;
        } catch {
          return false;
        }
      }

      try {
        return target.origin === new URL(allowItem).origin;
      } catch {
        return false;
      }
    }) ?? false;
  }

  private handleError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'Plugin worker failed.');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  };

  sendMessage<T>(message: unknown): Promise<T> {
    const id = this.nextMessageId;
    this.nextMessageId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
      });
      this.worker.postMessage({
        id,
        message: toCloneablePayload(message),
      });
    });
  }

  destroy() {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();
    URL.revokeObjectURL(this.workerUrl);
    URL.revokeObjectURL(this.moduleUrl);
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Plugin worker stopped.'));
    }
    this.pending.clear();
  }
}

const missingRequiredConfigLabels = (plugin: InstalledPluginSetting) => {
  return (plugin.configSchema ?? []).filter(field => {
    if (!field.required) return false;
    const value = plugin.config[field.key];
    return value === undefined || value === null || String(value).trim() === '';
  }).map(field => field.label);
};

const verifyInstalledPluginFiles = async (plugin: InstalledPluginSetting) => {
  if (plugin.installedIntegrity?.algorithm !== 'sha256') {
    throw new Error('插件缺少安装完整性记录，请重新安装。');
  }

  for (const [relativePath, expectedHash] of Object.entries(plugin.installedIntegrity.files)) {
    await yieldToBrowser();
    const bytes = await readFile(pluginStoragePath(plugin.id, relativePath), {
      baseDir: BaseDirectory.AppData,
    });
    const actualHash = await toHexDigest(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(`插件文件校验失败: ${relativePath}`);
    }
  }
};

export interface PluginRuntimeSyncFailure {
  pluginId: string;
  pluginName: string;
  reason: string;
}

export interface PluginRuntimeSyncResult {
  failures: PluginRuntimeSyncFailure[];
}

class PluginRuntimeService {
  private hosts = new Map<string, WorkerPluginHost>();

  async sync(plugins: InstalledPluginSetting[]): Promise<PluginRuntimeSyncResult> {
    const failures: PluginRuntimeSyncFailure[] = [];
    const enabledIds = new Set(plugins.filter(plugin => plugin.enabled).map(plugin => plugin.id));

    appLogInfo('plugins.sync.begin', '开始同步插件运行时。', {
      plugins: plugins.map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        enabled: plugin.enabled,
        runtime: plugin.runtime,
        capabilities: plugin.manifest.capabilities,
        permissions: plugin.manifest.permissions,
        blocked: Boolean(plugin.blocked),
      })),
    }, 'plugin');

    for (const pluginId of Array.from(this.hosts.keys())) {
      if (!enabledIds.has(pluginId)) {
        this.stop(pluginId);
      }
    }

    for (const plugin of plugins) {
      await yieldToBrowser();
      if (!plugin.enabled) continue;
      if (plugin.runtime !== 'web-worker-esm') {
        const reason = `Unsupported runtime: ${plugin.runtime}`;
        console.warn(`[PluginRuntime] ${reason}`);
        appLogWarn('plugin.runtime.unsupported', reason, {
          plugin: { id: plugin.id, name: plugin.name, version: plugin.version, runtime: plugin.runtime },
        }, 'plugin');
        failures.push({ pluginId: plugin.id, pluginName: plugin.name, reason });
        continue;
      }
      try {
        await verifyInstalledPluginFiles(plugin);
      } catch (error) {
        this.stop(plugin.id);
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[PluginRuntime] ${plugin.id} integrity verification failed:`, error);
        appLogError('plugin.integrity.failed', '插件完整性校验失败。', {
          plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
          error: errorToLogDetails(error),
        }, 'plugin');
        failures.push({ pluginId: plugin.id, pluginName: plugin.name, reason });
        continue;
      }
      const missingConfigLabels = missingRequiredConfigLabels(plugin);
      if (missingConfigLabels.length) {
        this.stop(plugin.id);
        const reason = `缺少必填配置：${missingConfigLabels.join('、')}`;
        console.warn(`[PluginRuntime] ${plugin.id} ${reason}`);
        appLogWarn('plugin.config.missing', '插件缺少必填配置。', {
          plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
          missingFields: missingConfigLabels,
        }, 'plugin');
        failures.push({ pluginId: plugin.id, pluginName: plugin.name, reason });
        continue;
      }

      this.stop(plugin.id);
      try {
        await this.start(plugin);
        appLogInfo('plugin.started', '插件已启动。', {
          plugin: {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            runtime: plugin.runtime,
            capabilities: plugin.manifest.capabilities,
          },
        }, 'plugin');
      } catch (error) {
        this.stop(plugin.id);
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[PluginRuntime] Failed to start plugin ${plugin.id}:`, error);
        appLogError('plugin.start.failed', '插件启动失败。', {
          plugin: { id: plugin.id, name: plugin.name, version: plugin.version, runtime: plugin.runtime },
          error: errorToLogDetails(error),
        }, 'plugin');
        failures.push({ pluginId: plugin.id, pluginName: plugin.name, reason });
      }
    }

    appLogInfo('plugins.sync.completed', '插件运行时同步完成。', {
      activePluginIds: Array.from(this.hosts.keys()),
      failures: failures.map(failure => ({
        pluginId: failure.pluginId,
        pluginName: failure.pluginName,
        reason: failure.reason,
      })),
    }, 'plugin');
    return { failures };
  }

  stop(pluginId: string) {
    const hadPlugin = this.hosts.has(pluginId) || Boolean(pluginManager.getPlugin(pluginId));
    this.hosts.get(pluginId)?.destroy();
    this.hosts.delete(pluginId);
    pluginManager.unregister(pluginId);
    if (hadPlugin) {
      appLogInfo('plugin.stopped', '插件已停止。', { pluginId }, 'plugin');
    }
  }

  stopAll() {
    for (const pluginId of Array.from(this.hosts.keys())) {
      this.stop(pluginId);
    }
  }

  private async start(plugin: InstalledPluginSetting) {
    const runtimePlugin = toCloneablePayload(plugin);
    const source = await readTextFile(pluginStoragePath(runtimePlugin.id, runtimePlugin.entry), {
      baseDir: BaseDirectory.AppData,
    });
    const host = new WorkerPluginHost(source, runtimePlugin);
    await host.sendMessage({ type: 'runtime.initialize', config: runtimePlugin.config });

    const adapter: Plugin = {
      id: runtimePlugin.id,
      name: runtimePlugin.name,
      version: runtimePlugin.version,
      author: runtimePlugin.manifest.author,
      description: runtimePlugin.manifest.description,
    };

    if (runtimePlugin.manifest.capabilities.includes('playlist-source')) {
      adapter.listPlaylists = () => host.sendMessage<PluginPlaylistItem[]>({ type: 'playlist.list' });
      adapter.getPlaylistSongs = (playlistId: string) => (
        host.sendMessage<MediaItem[]>({ type: 'playlist.songs', playlistId })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('music-search') || runtimePlugin.manifest.capabilities.includes('search')) {
      adapter.searchMusic = (query: string, page: number, limit: number) => (
        host.sendMessage<SearchResult>({ type: 'music.search', query, page, limit })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('lyrics-search')) {
      adapter.searchLyrics = (context: LyricSearchContext) => (
        host.sendMessage<LyricSearchResult[]>({ type: 'lyrics.search', context })
      );
      adapter.getLyric = (lyricId: string, context: LyricSearchContext) => (
        host.sendMessage<string>({ type: 'lyrics.get', lyricId, context })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('song-info-search')) {
      adapter.searchSongInfo = (context: SongInfoSearchContext) => (
        host.sendMessage<SongInfoSearchResult[]>({ type: 'song-info.search', context })
      );
      adapter.getSongInfo = (songInfoId: string, context: SongInfoSearchContext) => (
        host.sendMessage<SongInfoSearchResult>({ type: 'song-info.get', songInfoId, context })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('media-url')) {
      adapter.getMediaUrl = async (mediaId: string) => {
        const url = await host.sendMessage<string>({ type: 'media.url', mediaId });
        if (!host.isAllowedNetworkUrl(url)) {
          throw new Error(`Plugin returned a media URL outside its network allowlist: ${url}`);
        }
        return url;
      };
    }

    if (runtimePlugin.manifest.capabilities.includes('media-lyrics')) {
      adapter.getMediaLyric = (mediaId: string) => (
        host.sendMessage<string>({ type: 'media.lyric', mediaId })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('media-cover')) {
      adapter.getMediaCover = (mediaId: string) => (
        host.sendMessage<string>({ type: 'media.cover', mediaId })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('media-favorite')) {
      adapter.setMediaFavorite = (mediaId: string, favorite: boolean) => (
        host.sendMessage<void>({ type: 'media.favorite', mediaId, favorite })
      );
    }

    if (runtimePlugin.manifest.capabilities.includes('media-delete')) {
      adapter.deleteMedia = (mediaId: string, context?: MediaDeleteContext) => (
        host.sendMessage<void>({ type: 'media.delete', mediaId, context })
      );
    }

    pluginManager.register(adapter, {
      sandbox: 'web-worker',
      manifest: runtimePlugin.manifest,
    });
    this.hosts.set(runtimePlugin.id, host);
  }
}

export const pluginRuntimeService = new PluginRuntimeService();
