import {
  Plugin,
  LyricSearchContext,
  LyricSearchResult,
  MediaDeleteContext,
  MediaItem,
  PluginManifest,
  PluginPlaylistItem,
  PluginSandbox,
  RegisteredPlugin,
  SearchResult,
  SongInfoSearchContext,
  SongInfoSearchResult,
} from '../types/plugin';
import { appLogError, errorToLogDetails } from '../services/appLogger';

export interface RegisterPluginOptions {
  sandbox: PluginSandbox;
  manifest: PluginManifest;
}

const withPluginSource = (pluginId: string, media: MediaItem): MediaItem => ({
  ...media,
  sourceId: pluginId,
});

const withPluginSearchSource = (pluginId: string, result: SearchResult): SearchResult => ({
  ...result,
  songs: (result.songs ?? []).map(song => withPluginSource(pluginId, song)),
  albums: result.albums?.map(album => ({
    ...album,
    sourceId: pluginId,
    songs: album.songs?.map(song => withPluginSource(pluginId, song)),
  })),
  artists: result.artists?.map(artist => ({
    ...artist,
    sourceId: pluginId,
    albums: artist.albums?.map(album => ({
      ...album,
      sourceId: pluginId,
      songs: album.songs?.map(song => withPluginSource(pluginId, song)),
    })),
    songs: artist.songs?.map(song => withPluginSource(pluginId, song)),
  })),
});

const logPluginFailure = (plugin: Plugin, operation: string, error: unknown) => {
  appLogError('plugin.execution.failed', `插件执行失败: ${operation}`, {
    plugin: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
    },
    operation,
    error: errorToLogDetails(error),
  }, 'plugin');
};

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, Plugin> = new Map();
  private records: Map<string, RegisteredPlugin> = new Map();

  private constructor() {}

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public register(plugin: Plugin, options: RegisterPluginOptions) {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin with ID ${plugin.id} already exists. Overwriting...`);
    }

    this.plugins.set(plugin.id, plugin);
    this.records.set(plugin.id, {
      plugin,
      sandbox: options.sandbox,
      manifest: options.manifest,
      installedAt: Date.now(),
    });
    plugin.onEnable?.();
    console.log(`Plugin registered: ${plugin.name} (${plugin.version})`);
  }

  public unregister(pluginId: string) {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.onDisable?.();
      this.plugins.delete(pluginId);
      this.records.delete(pluginId);
      console.log(`Plugin unregistered: ${plugin.name}`);
    }
  }

  public getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  public getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  public getPluginRecord(pluginId: string): RegisteredPlugin | undefined {
    return this.records.get(pluginId);
  }

  public getAllPluginRecords(): RegisteredPlugin[] {
    return Array.from(this.records.values());
  }

  public async searchAll(query: string, page: number = 1, limit: number = 20): Promise<Record<string, SearchResult>> {
    const results: Record<string, SearchResult> = {};
    const searchPromises = Array.from(this.plugins.values()).map(async (plugin) => {
      const search = plugin.searchMusic ?? plugin.search;
      if (search) {
        try {
          const res = await search.call(plugin, query, page, limit);
          results[plugin.id] = withPluginSearchSource(plugin.id, res);
        } catch (error) {
          console.error(`Error searching in plugin ${plugin.name}:`, error);
          logPluginFailure(plugin, 'searchAll', error);
        }
      }
    });

    await Promise.all(searchPromises);
    return results;
  }

  public getPlaylistSourcePlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(plugin => plugin.listPlaylists && plugin.getPlaylistSongs);
  }

  public getMusicSearchPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(plugin => plugin.searchMusic || plugin.search);
  }

  public getLyricsSearchPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(plugin => plugin.searchLyrics && plugin.getLyric);
  }

  public getSongInfoSearchPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(plugin => plugin.searchSongInfo && plugin.getSongInfo);
  }

  public async searchMusic(pluginId: string, query: string, page: number = 1, limit: number = 20): Promise<SearchResult> {
    const plugin = this.plugins.get(pluginId);
    const search = plugin?.searchMusic ?? plugin?.search;
    if (!plugin || !search) return { songs: [] };

    try {
      return withPluginSearchSource(plugin.id, await search.call(plugin, query, page, limit));
    } catch (error) {
      logPluginFailure(plugin, 'music.search', error);
      throw error;
    }
  }

  public async listPluginPlaylists(pluginId: string): Promise<PluginPlaylistItem[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.listPlaylists) return [];

    try {
      return plugin.listPlaylists();
    } catch (error) {
      logPluginFailure(plugin, 'playlist.list', error);
      throw error;
    }
  }

  public async getPluginPlaylistSongs(pluginId: string, playlistId: string): Promise<MediaItem[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.getPlaylistSongs) return [];

    try {
      return (await plugin.getPlaylistSongs(playlistId)).map(song => withPluginSource(plugin.id, song));
    } catch (error) {
      logPluginFailure(plugin, 'playlist.songs', error);
      throw error;
    }
  }

  public async searchLyrics(context: LyricSearchContext): Promise<Array<LyricSearchResult & { pluginId: string }>> {
    const results = await Promise.all(Array.from(this.plugins.values()).map(async plugin => {
      if (!plugin.searchLyrics) return [];

      try {
        const pluginResults = await plugin.searchLyrics(context);
        return pluginResults.map(result => ({
          ...result,
          pluginId: plugin.id,
          provider: result.provider || plugin.name,
        }));
      } catch (error) {
        console.error(`Error searching lyrics in plugin ${plugin.name}:`, error);
        logPluginFailure(plugin, 'lyrics.search.all', error);
        return [];
      }
    }));

    return results.flat();
  }

  public async searchPluginLyrics(pluginId: string, context: LyricSearchContext): Promise<Array<LyricSearchResult & { pluginId: string }>> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.searchLyrics) return [];

    let results: LyricSearchResult[];
    try {
      results = await plugin.searchLyrics(context);
    } catch (error) {
      logPluginFailure(plugin, 'lyrics.search', error);
      throw error;
    }
    return results.map(result => ({
      ...result,
      pluginId: plugin.id,
      provider: result.provider || plugin.name,
    }));
  }

  public async getLyric(pluginId: string, lyricId: string, context: LyricSearchContext): Promise<string | null> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.getLyric) return null;

    try {
      return plugin.getLyric(lyricId, context);
    } catch (error) {
      logPluginFailure(plugin, 'lyrics.get', error);
      throw error;
    }
  }

  public async searchPluginSongInfo(pluginId: string, context: SongInfoSearchContext): Promise<Array<SongInfoSearchResult & { pluginId: string }>> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.searchSongInfo) return [];

    let results: SongInfoSearchResult[];
    try {
      results = await plugin.searchSongInfo(context);
    } catch (error) {
      logPluginFailure(plugin, 'song-info.search', error);
      throw error;
    }
    return results.map(result => ({
      ...result,
      pluginId: plugin.id,
      provider: result.provider || plugin.name,
    }));
  }

  public async getSongInfo(pluginId: string, songInfoId: string, context: SongInfoSearchContext): Promise<SongInfoSearchResult | null> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.getSongInfo) return null;

    try {
      return plugin.getSongInfo(songInfoId, context);
    } catch (error) {
      logPluginFailure(plugin, 'song-info.get', error);
      throw error;
    }
  }

  public async resolveMediaUrl(media: MediaItem): Promise<string | undefined> {
    const plugin = this.plugins.get(media.sourceId);
    if (plugin?.getMediaUrl) {
      try {
        return plugin.getMediaUrl(media.id);
      } catch (error) {
        logPluginFailure(plugin, 'media.url', error);
        throw error;
      }
    }

    return media.url;
  }

  public canDeleteMedia(pluginId: string): boolean {
    return Boolean(this.plugins.get(pluginId)?.deleteMedia);
  }

  public canSetMediaFavorite(pluginId: string): boolean {
    return Boolean(this.plugins.get(pluginId)?.setMediaFavorite);
  }

  public async setMediaFavorite(pluginId: string, mediaId: string, favorite: boolean) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.setMediaFavorite) {
      throw new Error('该插件不支持同步远程收藏。');
    }

    try {
      await plugin.setMediaFavorite(mediaId, favorite);
    } catch (error) {
      logPluginFailure(plugin, 'media.favorite', error);
      throw error;
    }
  }

  public async deleteMedia(pluginId: string, mediaId: string, context?: MediaDeleteContext) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.deleteMedia) {
      throw new Error('该插件不支持删除远程文件。');
    }

    try {
      await plugin.deleteMedia(mediaId, context);
    } catch (error) {
      logPluginFailure(plugin, 'media.delete', error);
      throw error;
    }
  }
}

export const pluginManager = PluginManager.getInstance();
