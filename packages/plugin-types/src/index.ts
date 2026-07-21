/** 媒体条目，表示一首可以展示、加入播放列表或播放的歌曲。 */
export interface MediaItem {
  /** 插件内部的媒体 id。主应用会在后续 `media.url` 等消息中把它传回插件。 */
  id: string;
  /** 媒体来源 id。插件返回值中的该字段会被主应用改写为当前插件 id。 */
  sourceId: string;
  /** 歌曲标题。 */
  title: string;
  /** 艺术家名称。没有明确艺术家时建议返回空字符串或可展示的占位名称。 */
  artist: string;
  /** 专辑名称。 */
  album?: string;
  /** 发行年份。 */
  year?: number;
  /** 歌曲时长，单位为秒。 */
  duration?: number;
  /** 封面地址，可以是远程 URL、数据 URL，或主应用可识别的本地资源地址。 */
  cover?: string;
  /** 可直接播放的媒体地址。若需要运行时解析，可不填并实现 `media.url`。 */
  url?: string;
  /** 歌词文本，通常为 LRC 或纯文本。 */
  lyric?: string;
  /** 插件自定义扩展数据。主应用不会依赖该字段的结构。 */
  extra?: any;
}

/** 专辑条目，用于音乐搜索结果中的专辑列表或艺术家详情。 */
export interface AlbumItem {
  /** 插件内部的专辑 id。 */
  id: string;
  /** 专辑来源 id。插件返回值中的该字段会被主应用改写为当前插件 id。 */
  sourceId: string;
  /** 专辑名称。 */
  title: string;
  /** 专辑艺术家。 */
  artist: string;
  /** 专辑封面地址。 */
  cover?: string;
  /** 专辑描述。 */
  description?: string;
  /** 专辑内歌曲列表。 */
  songs?: MediaItem[];
}

/** 艺术家条目，用于音乐搜索结果中的艺术家列表。 */
export interface ArtistItem {
  /** 插件内部的艺术家 id。 */
  id: string;
  /** 艺术家来源 id。插件返回值中的该字段会被主应用改写为当前插件 id。 */
  sourceId: string;
  /** 艺术家名称。 */
  name: string;
  /** 艺术家头像地址。 */
  avatar?: string;
  /** 艺术家描述。 */
  description?: string;
  /** 艺术家的专辑列表。 */
  albums?: AlbumItem[];
  /** 艺术家的歌曲列表。 */
  songs?: MediaItem[];
}

/** 音乐搜索结果。至少返回歌曲数组，专辑和艺术家可按能力补充。 */
export interface SearchResult {
  /** 歌曲结果列表。 */
  songs: MediaItem[];
  /** 专辑结果列表。 */
  albums?: AlbumItem[];
  /** 艺术家结果列表。 */
  artists?: ArtistItem[];
}

/** 插件提供的远程播放列表摘要。 */
export interface PluginPlaylistItem {
  /** 插件内部的播放列表 id。 */
  id: string;
  /** 播放列表名称。 */
  name: string;
  /** 播放列表描述。 */
  description?: string;
  /** 播放列表封面地址。 */
  cover?: string;
  /** 播放列表歌曲数量。 */
  songCount?: number;
}

/** 主应用保存的远程播放列表引用。 */
export interface PluginPlaylistRef {
  /** 提供该播放列表的插件 id。 */
  pluginId: string;
  /** 插件内部的播放列表 id。 */
  playlistId: string;
  /** 播放列表名称快照，用于展示。 */
  playlistName?: string;
}

/** 歌词搜索上下文，由主应用根据当前歌曲信息传给插件。 */
export interface LyricSearchContext {
  /** 主应用中的歌曲 id。 */
  songId?: string;
  /** 歌曲标题。 */
  title: string;
  /** 艺术家名称。 */
  artist?: string;
  /** 专辑名称。 */
  album?: string;
  /** 歌曲时长，单位为秒。 */
  duration?: number;
}

/** 歌词搜索结果摘要。选中后主应用会再请求歌词正文。 */
export interface LyricSearchResult {
  /** 插件内部的歌词结果 id。 */
  id: string;
  /** 歌曲标题。 */
  title: string;
  /** 艺术家名称。 */
  artist?: string;
  /** 专辑名称。 */
  album?: string;
  /** 歌曲时长，单位为秒。 */
  duration?: number;
  /** 结果来源名称，通常为插件名或上游服务名。 */
  provider: string;
  /** 封面地址。 */
  cover?: string;
  /** 缩略图地址。 */
  thumbnail?: string;
  /** 图片地址。 */
  imageUrl?: string;
  /** 歌词预览文本。 */
  preview?: string;
}

/** 歌曲信息搜索上下文，由主应用根据当前歌曲信息传给插件。 */
export interface SongInfoSearchContext {
  /** 主应用中的歌曲 id。 */
  songId?: string;
  /** 歌曲标题。 */
  title: string;
  /** 艺术家名称。 */
  artist?: string;
  /** 专辑名称。 */
  album?: string;
  /** 歌曲时长，单位为秒。 */
  duration?: number;
}

/** 歌曲信息搜索结果，可用于补全标题、艺术家、专辑、封面等元数据。 */
export interface SongInfoSearchResult {
  /** 插件内部的歌曲信息结果 id。 */
  id: string;
  /** 歌曲标题。 */
  title: string;
  /** 艺术家名称。 */
  artist?: string;
  /** 专辑名称。 */
  album?: string;
  /** 结果来源名称，通常为插件名或上游服务名。 */
  provider: string;
  /** 封面地址。 */
  cover?: string;
  /** 缩略图地址。 */
  thumbnail?: string;
  /** 图片地址。 */
  imageUrl?: string;
  /** 发行年份。 */
  year?: number;
  /** 歌曲时长，单位为秒。 */
  duration?: number;
  /** 封面宽度，单位为像素。 */
  width?: number;
  /** 封面高度，单位为像素。 */
  height?: number;
}

/** 媒体缓存请求。当前主要供未来扩展使用。 */
export interface MediaCacheRequest {
  /** 插件内部的媒体 id。 */
  mediaId: string;
  /** 需要缓存的媒体地址。 */
  url?: string;
  /** 建议文件名。 */
  fileName?: string;
  /** 媒体内容类型，例如 `audio/mpeg`。 */
  contentType?: string;
}

/** 删除远程媒体时附带的上下文。 */
export interface MediaDeleteContext {
  /** 主应用播放列表 id。 */
  playlistId?: string;
  /** 主应用播放列表名称。 */
  playlistName?: string;
  /** 被删除的媒体信息快照。 */
  media?: MediaItem;
}

/** 插件运行时类型。 */
export type PluginRuntime = 'wasm-wasi' | 'web-worker-esm';

/** 主应用内部记录的插件沙箱类型。 */
export type PluginSandbox = 'wasm-wasi' | 'web-worker';

/** 插件请求的权限。主应用会根据这些权限展示提示并限制能力。 */
export type PluginPermission =
  /** 搜索媒体。 */
  | 'media:search'
  /** 解析媒体播放地址。 */
  | 'media:resolve-url'
  /** 读取远程播放列表。 */
  | 'media:playlist'
  /** 搜索或读取歌词。 */
  | 'media:lyrics'
  /** 读取或写入封面。 */
  | 'media:cover'
  /** 读取或写入歌曲元数据。 */
  | 'media:metadata'
  /** 删除远程媒体。 */
  | 'media:delete'
  /** 写入媒体缓存。 */
  | 'cache:write'
  /** 发起网络请求。 */
  | 'network:request'
  /** 使用插件私有存储。 */
  | 'storage:plugin'
  /** 提供自定义界面面板。 */
  | 'ui:panel';

/** 插件声明的能力。主应用根据能力决定会向插件发送哪些消息。 */
export type PluginCapability =
  /** 兼容旧版的音乐搜索能力。新插件优先使用 `music-search`。 */
  | 'search'
  /** 歌曲搜索能力。 */
  | 'music-search'
  /** 媒体播放地址解析能力。 */
  | 'media-url'
  /** 远程媒体删除能力。 */
  | 'media-delete'
  /** 远程播放列表来源能力。 */
  | 'playlist-source'
  /** 歌词搜索能力。 */
  | 'lyrics-search'
  /** 歌曲信息搜索能力。 */
  | 'song-info-search'
  /** 兼容旧版的歌词能力。 */
  | 'lyrics'
  /** 兼容旧版的元数据能力。 */
  | 'metadata'
  /** 兼容旧版的播放列表导入能力。 */
  | 'playlist-import'
  /** 自定义界面面板能力。 */
  | 'ui-panel';

/** 插件包完整性信息。 */
export interface PluginIntegrity {
  /** 哈希算法，目前固定为 `sha256`。 */
  algorithm: 'sha256';
  /** `entry` 指向文件的 SHA-256 哈希。 */
  entry: string;
  /** 其它资源文件的 SHA-256 哈希表，键为包内相对路径。 */
  assets?: Record<string, string>;
  /** 插件包或清单签名。 */
  signature?: string;
  /** 签名者 id 或公钥标识。 */
  signer?: string;
}

/** 插件配置值类型。 */
export type PluginConfigValue = string | number | boolean;

/** 选择型配置字段的选项。 */
export interface PluginConfigOption {
  /** 展示给用户的选项名称。 */
  label: string;
  /** 实际保存到配置中的值。 */
  value: string;
}

/** 插件配置表单字段。 */
export interface PluginConfigField {
  /** 配置键名。会作为 `runtime.initialize.config` 中的字段名。 */
  key: string;
  /** 展示给用户的字段名称。 */
  label: string;
  /** 字段输入类型。 */
  type: 'text' | 'password' | 'url' | 'number' | 'boolean' | 'select';
  /** 输入占位提示。 */
  placeholder?: string;
  /** 默认值。 */
  default?: PluginConfigValue;
  /** 是否必填。主应用会在启用插件前校验。 */
  required?: boolean;
  /** `select` 字段可选项。 */
  options?: PluginConfigOption[];
}

/** 插件配置 schema，由 `installation.config-schema` 消息返回。 */
export interface PluginConfigSchema {
  /** 配置字段列表。 */
  fields: PluginConfigField[];
}

/** 插件清单，对应插件包根目录的 `plugin.json`。 */
export interface PluginManifest {
  /** 清单结构版本，目前固定为 1。 */
  schemaVersion: 1;
  /** 插件唯一 id，建议使用反向域名格式。 */
  id: string;
  /** 插件展示名称。 */
  name: string;
  /** 插件版本号。 */
  version: string;
  /** 插件运行时类型。 */
  runtime: PluginRuntime;
  /** 插件入口文件路径，相对于插件包根目录。 */
  entry: string;
  /** 插件作者。 */
  author?: string;
  /** 插件描述。 */
  description?: string;
  /** 插件主页。 */
  homepage?: string;
  /** 插件请求的权限列表。 */
  permissions: PluginPermission[];
  /** 插件提供的能力列表。 */
  capabilities: PluginCapability[];
  /** 允许访问的网络来源列表。插件网络请求应受该列表限制。 */
  networkAllowlist?: string[];
  /** 插件完整性信息。 */
  integrity?: PluginIntegrity;
}

/** 安装阶段消息：主应用读取插件配置表单。 */
export type PluginInstallationMessage = {
  type: 'installation.config-schema';
};

/** 运行时初始化消息：主应用把用户配置传给插件。 */
export type PluginRuntimeInitializeMessage = {
  type: 'runtime.initialize';
  /** 用户在插件设置中填写并保存的配置。 */
  config: Record<string, PluginConfigValue>;
};

/** 远程播放列表来源消息。 */
export type PlaylistSourceMessage =
  /** 请求播放列表列表，返回 `PluginPlaylistItem[]`。 */
  | { type: 'playlist.list' }
  /** 请求指定播放列表中的歌曲，返回 `MediaItem[]`。 */
  | { type: 'playlist.songs'; playlistId: string };

/** 歌曲搜索消息，返回 `SearchResult`。 */
export type MusicSearchMessage = {
  type: 'music.search';
  /** 搜索关键词。 */
  query: string;
  /** 页码，从 1 开始。 */
  page: number;
  /** 每页数量。 */
  limit: number;
};

/** 歌词搜索与读取消息。 */
export type LyricsSearchMessage =
  /** 搜索歌词，返回 `LyricSearchResult[]`。 */
  | { type: 'lyrics.search'; context: LyricSearchContext }
  /** 读取歌词正文，返回字符串。 */
  | { type: 'lyrics.get'; lyricId: string; context: LyricSearchContext };

/** 歌曲信息搜索与读取消息。 */
export type SongInfoSearchMessage =
  /** 搜索歌曲信息，返回 `SongInfoSearchResult[]`。 */
  | { type: 'song-info.search'; context: SongInfoSearchContext }
  /** 读取歌曲信息详情，返回 `SongInfoSearchResult`。 */
  | { type: 'song-info.get'; songInfoId: string; context: SongInfoSearchContext };

/** 媒体播放地址解析消息，返回可播放 URL 字符串。 */
export type MediaUrlMessage = {
  type: 'media.url';
  /** 插件内部的媒体 id。 */
  mediaId: string;
};

/** 删除远程媒体消息。 */
export type MediaDeleteMessage = {
  type: 'media.delete';
  /** 插件内部的媒体 id。 */
  mediaId: string;
  /** 删除上下文，供插件决定如何处理。 */
  context?: MediaDeleteContext;
};

/** 插件 `handleMessage(message)` 可以接收的全部消息类型。 */
export type PluginMessage =
  | PluginInstallationMessage
  | PluginRuntimeInitializeMessage
  | PlaylistSourceMessage
  | MusicSearchMessage
  | LyricsSearchMessage
  | SongInfoSearchMessage
  | MediaUrlMessage
  | MediaDeleteMessage;

/** 主应用内部注册插件时保存的记录。 */
export interface RegisteredPlugin {
  /** 运行时适配后的插件对象。 */
  plugin: Plugin;
  /** 插件沙箱类型。 */
  sandbox: PluginSandbox;
  /** 插件清单。 */
  manifest: PluginManifest;
  /** 注册时间戳。 */
  installedAt: number;
}

/** 主应用播放列表类型。 */
export type PlaylistType = 'local-directory' | 'plugin-playlist';

/** 主应用播放列表。 */
export interface Playlist {
  /** 播放列表 id。 */
  id: string;
  /** 播放列表名称。 */
  name: string;
  /** 播放列表类型。 */
  type?: PlaylistType;
  /** 本地目录路径，仅本地目录播放列表使用。 */
  localDir?: string;
  /** 远程插件播放列表引用。 */
  pluginPlaylist?: PluginPlaylistRef;
  /** 播放列表描述。 */
  description?: string;
  /** 播放列表封面地址。 */
  cover?: string;
  /** 播放列表歌曲。 */
  songs: MediaItem[];
  /** 创建时间戳。 */
  createdAt: number;
}

/** 主应用内部使用的插件能力适配接口。普通插件通常只需要导出 `handleMessage`。 */
export interface Plugin {
  /** 插件 id，应与清单 id 一致。 */
  id: string;
  /** 插件名称。 */
  name: string;
  /** 插件版本。 */
  version: string;
  /** 插件作者。 */
  author?: string;
  /** 插件描述。 */
  description?: string;

  /** 兼容旧版的搜索方法。新插件优先通过 `handleMessage` 处理 `music.search`。 */
  search?(query: string, page: number, limit: number): Promise<SearchResult>;
  /** 歌曲搜索方法。 */
  searchMusic?(query: string, page: number, limit: number): Promise<SearchResult>;

  /** 列出远程播放列表。 */
  listPlaylists?(): Promise<PluginPlaylistItem[]>;
  /** 获取远程播放列表歌曲。 */
  getPlaylistSongs?(playlistId: string): Promise<MediaItem[]>;

  /** 获取媒体播放地址。 */
  getMediaUrl?(mediaId: string): Promise<string>;
  /** 删除远程媒体。 */
  deleteMedia?(mediaId: string, context?: MediaDeleteContext): Promise<void>;
  /** 获取媒体歌词。 */
  getMediaLyric?(mediaId: string): Promise<string>;
  /** 获取媒体详情。 */
  getMediaDetail?(mediaId: string): Promise<MediaItem>;

  /** 搜索歌词。 */
  searchLyrics?(context: LyricSearchContext): Promise<LyricSearchResult[]>;
  /** 获取歌词正文。 */
  getLyric?(lyricId: string, context: LyricSearchContext): Promise<string>;

  /** 搜索歌曲信息。 */
  searchSongInfo?(context: SongInfoSearchContext): Promise<SongInfoSearchResult[]>;
  /** 获取歌曲信息详情。 */
  getSongInfo?(songInfoId: string, context: SongInfoSearchContext): Promise<SongInfoSearchResult>;

  /** 获取专辑详情。 */
  getAlbumDetail?(albumId: string): Promise<AlbumItem>;
  /** 获取艺术家详情。 */
  getArtistDetail?(artistId: string): Promise<ArtistItem>;

  /** 插件安装后的生命周期回调。 */
  onInstall?(): void;
  /** 插件卸载前后的生命周期回调。 */
  onUninstall?(): void;
  /** 插件启用时的生命周期回调。 */
  onEnable?(): void;
  /** 插件禁用时的生命周期回调。 */
  onDisable?(): void;
}
