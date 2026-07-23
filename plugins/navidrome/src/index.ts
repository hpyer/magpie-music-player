import type { MediaItem, PluginConfigSchema, PluginPlaylistItem } from '@magpie-music/plugin-types';

interface NavidromeConfig {
  serverUrl: string;
  username: string;
  password: string;
  clientName?: string;
  apiVersion?: string;
}

interface SubsonicResponse<T> {
  'subsonic-response': {
    status: 'ok' | 'failed';
    error?: {
      code: number;
      message: string;
    };
  } & T;
}

interface NavidromePlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount?: number;
  coverArt?: string;
}

interface NavidromeSong {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  duration?: number;
  coverArt?: string;
  starred?: string;
  suffix?: string;
  contentType?: string;
  size?: number;
  track?: number;
}

interface NavidromeLegacyLyrics {
  artist?: string;
  title?: string;
  value?: string;
}

interface NavidromeStructuredLyricLine {
  start?: number;
  value?: string;
}

interface NavidromeStructuredLyrics {
  lang?: string;
  synced?: boolean;
  displayArtist?: string;
  displayTitle?: string;
  offset?: number;
  line?: NavidromeStructuredLyricLine | NavidromeStructuredLyricLine[];
}

type NavidromeHostMessage =
  | { type: 'installation.config-schema' }
  | { type: 'runtime.initialize'; config: NavidromeConfig }
  | { type: 'ping' }
  | { type: 'playlist.list' }
  | { type: 'playlist.songs'; playlistId: string }
  | { type: 'media.url'; mediaId: string }
  | { type: 'media.lyric'; mediaId: string }
  | { type: 'media.cover'; mediaId: string }
  | { type: 'media.favorite'; mediaId: string; favorite: boolean };

const PLUGIN_ID = 'cn.hpyer.magpie.navidrome';
const DEFAULT_API_VERSION = '1.16.1';
const DEFAULT_CLIENT_NAME = 'MagpieMusicPlayer';

let activePlugin: ReturnType<typeof createNavidromePlugin> | null = null;

const configSchema: PluginConfigSchema = {
  fields: [
    {
      key: 'serverUrl',
      label: '服务地址',
      type: 'url',
      placeholder: 'https://music.example.com',
      required: true,
    },
    {
      key: 'username',
      label: '用户名',
      type: 'text',
      required: true,
    },
    {
      key: 'password',
      label: '密码',
      type: 'password',
      required: true,
    },
  ],
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const formatLrcTimestamp = (milliseconds: number) => {
  const normalized = Math.max(0, Math.round(milliseconds));
  const totalSeconds = Math.floor(normalized / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((normalized % 1000) / 10);
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
};

const structuredLyricsToText = (lyrics: NavidromeStructuredLyrics) => {
  const lines = asArray(lyrics.line).filter(line => line.value?.trim());
  if (!lines.length) return '';

  if (!lyrics.synced) {
    return lines.map(line => line.value?.trim() ?? '').join('\n');
  }

  const offset = lyrics.offset ?? 0;
  return lines
    .map(line => `${formatLrcTimestamp((line.start ?? 0) + offset)}${line.value?.trim() ?? ''}`)
    .join('\n');
};

const bestStructuredLyrics = (items: NavidromeStructuredLyrics[]) => (
  items.find(item => item.synced)
  ?? items[0]
  ?? null
);

const normalizeServerUrl = (serverUrl: string) => serverUrl.replace(/\/+$/, '');

const randomSalt = () => {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const rotateLeft = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount));

const md5 = (input: string) => {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const table = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;

      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const next = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + table[index] + words[g]) | 0, shifts[index])) | 0;
      a = next;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new DataView(new ArrayBuffer(16));
  digest.setUint32(0, a0, true);
  digest.setUint32(4, b0, true);
  digest.setUint32(8, c0, true);
  digest.setUint32(12, d0, true);

  return Array.from(new Uint8Array(digest.buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

class NavidromeClient {
  private readonly config: Required<NavidromeConfig>;

  constructor(config: NavidromeConfig) {
    if (!config.serverUrl || !config.username || !config.password) {
      throw new Error('Navidrome config requires serverUrl, username and password.');
    }

    this.config = {
      serverUrl: normalizeServerUrl(config.serverUrl),
      username: config.username,
      password: config.password,
      clientName: config.clientName ?? DEFAULT_CLIENT_NAME,
      apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
    };
  }

  private authParams() {
    const salt = randomSalt();
    return {
      u: this.config.username,
      s: salt,
      t: md5(`${this.config.password}${salt}`),
      v: this.config.apiVersion,
      c: this.config.clientName,
      f: 'json',
    };
  }

  private endpoint(name: string, params: Record<string, string | number | undefined> = {}) {
    const url = new URL(`${this.config.serverUrl}/rest/${name}.view`);
    const mergedParams = {
      ...this.authParams(),
      ...params,
    };

    for (const [key, value] of Object.entries(mergedParams)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  private async request<T>(name: string, params: Record<string, string | number | undefined> = {}) {
    const response = await fetch(this.endpoint(name, params), {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Navidrome request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as SubsonicResponse<T>;
    const subsonic = body['subsonic-response'];
    if (!subsonic) {
      throw new Error('Invalid Navidrome response.');
    }
    if (subsonic.status !== 'ok') {
      throw new Error(subsonic.error?.message ?? 'Navidrome request failed.');
    }

    return subsonic;
  }

  async ping() {
    await this.request('ping');
    return true;
  }

  async listPlaylists(): Promise<PluginPlaylistItem[]> {
    const response = await this.request<{ playlists?: { playlist?: NavidromePlaylist | NavidromePlaylist[] } }>('getPlaylists');
    return asArray(response.playlists?.playlist).map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.comment,
      songCount: playlist.songCount,
      cover: playlist.coverArt ? this.coverArtUrl(playlist.coverArt) : undefined,
    }));
  }

  async getPlaylistSongs(playlistId: string): Promise<MediaItem[]> {
    const response = await this.request<{ playlist?: { entry?: NavidromeSong | NavidromeSong[] } }>('getPlaylist', { id: playlistId });
    return asArray(response.playlist?.entry).map(song => this.toMediaItem(song, playlistId));
  }

  async getMediaLyric(mediaId: string) {
    const lyricBySongId = await this.getLyricsBySongId(mediaId).catch(() => '');
    if (lyricBySongId) return lyricBySongId;

    const song = await this.getSong(mediaId).catch(() => null);
    if (!song?.title) return '';

    return this.getLegacyLyrics(song.artist, song.title).catch(() => '');
  }

  streamUrl(mediaId: string) {
    return this.endpoint('stream', { id: mediaId });
  }

  async getMediaCover(mediaId: string) {
    const song = await this.getSong(mediaId);
    return song?.coverArt ? this.coverArtUrl(song.coverArt) : '';
  }

  async setMediaFavorite(mediaId: string, favorite: boolean) {
    await this.request(favorite ? 'star' : 'unstar', { id: mediaId });
  }

  private coverArtUrl(coverArt: string) {
    return this.endpoint('getCoverArt', { id: coverArt });
  }

  private async getSong(mediaId: string) {
    const response = await this.request<{ song?: NavidromeSong }>('getSong', { id: mediaId });
    return response.song;
  }

  private async getLyricsBySongId(mediaId: string) {
    const response = await this.request<{ lyricsList?: { structuredLyrics?: NavidromeStructuredLyrics | NavidromeStructuredLyrics[] } }>('getLyricsBySongId', { id: mediaId });
    const lyrics = bestStructuredLyrics(asArray(response.lyricsList?.structuredLyrics));
    return lyrics ? structuredLyricsToText(lyrics) : '';
  }

  private async getLegacyLyrics(artist: string | undefined, title: string) {
    const response = await this.request<{ lyrics?: NavidromeLegacyLyrics }>('getLyrics', { artist, title });
    return response.lyrics?.value?.trim() ?? '';
  }

  private toMediaItem(song: NavidromeSong, playlistId?: string): MediaItem {
    return {
      id: song.id,
      sourceId: PLUGIN_ID,
      title: song.title || song.id,
      artist: song.artist || 'Unknown Artist',
      album: song.album,
      year: song.year,
      duration: song.duration,
      cover: song.coverArt ? this.coverArtUrl(song.coverArt) : undefined,
      extra: {
        navidromeId: song.id,
        playlistId,
        remoteFavorite: Boolean(song.starred),
        remoteFavoriteAt: song.starred,
        remoteFavoriteProvider: 'navidrome',
        suffix: song.suffix,
        contentType: song.contentType,
        size: song.size,
        track: song.track,
      },
    };
  }
}

function createNavidromePlugin(config: NavidromeConfig) {
  const client = new NavidromeClient(config);

  return {
    id: PLUGIN_ID,
    name: 'Navidrome',
    version: '1.0.2',
    async listPlaylists() {
      return client.listPlaylists();
    },
    async getPlaylistSongs(playlistId: string) {
      return client.getPlaylistSongs(playlistId);
    },
    async getMediaUrl(mediaId: string) {
      return client.streamUrl(mediaId);
    },
    async getMediaLyric(mediaId: string) {
      return client.getMediaLyric(mediaId);
    },
    async getMediaCover(mediaId: string) {
      return client.getMediaCover(mediaId);
    },
    async setMediaFavorite(mediaId: string, favorite: boolean) {
      return client.setMediaFavorite(mediaId, favorite);
    },
    async ping() {
      return client.ping();
    },
  };
}

export async function handleMessage(message: NavidromeHostMessage) {
  if (message.type === 'installation.config-schema') {
    return configSchema;
  }

  if (message.type === 'runtime.initialize') {
    activePlugin = createNavidromePlugin(message.config);
    return { ok: true };
  }

  if (!activePlugin) {
    throw new Error('Navidrome plugin is not configured.');
  }

  if (message.type === 'ping') {
    return activePlugin.ping();
  }
  if (message.type === 'playlist.list') {
    return activePlugin.listPlaylists();
  }
  if (message.type === 'playlist.songs') {
    return activePlugin.getPlaylistSongs(message.playlistId);
  }
  if (message.type === 'media.url') {
    return activePlugin.getMediaUrl(message.mediaId);
  }
  if (message.type === 'media.lyric') {
    return activePlugin.getMediaLyric(message.mediaId);
  }
  if (message.type === 'media.cover') {
    return activePlugin.getMediaCover(message.mediaId);
  }
  if (message.type === 'media.favorite') {
    return activePlugin.setMediaFavorite(message.mediaId, message.favorite);
  }

  throw new Error(`Unsupported message type: ${(message as { type: string }).type}`);
}
