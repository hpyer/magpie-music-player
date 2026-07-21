import { convertFileSrc } from '@tauri-apps/api/core';
import { exists, mkdir, readDir, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { MediaItem } from '../types/plugin';

interface MediaCacheConfig {
  cacheDir: string;
  limitBytes: number;
  allowedSourceIds: string[];
}

interface CacheEntry {
  path: string;
  size: number;
  mtime: number;
}

const DEFAULT_LIMIT_BYTES = 1024 * 1024 * 1024;

const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url);

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const extensionFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase() ?? 'audio';
  } catch {
    return 'audio';
  }
};

const pathJoin = (dir: string, child: string) => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${child}`;
};

class MediaCacheService {
  private config: MediaCacheConfig = {
    cacheDir: '',
    limitBytes: DEFAULT_LIMIT_BYTES,
    allowedSourceIds: [],
  };

  configure(config: Partial<MediaCacheConfig>) {
    this.config = {
      ...this.config,
      ...config,
      limitBytes: Math.max(1024 * 1024, config.limitBytes ?? this.config.limitBytes),
      allowedSourceIds: config.allowedSourceIds ?? this.config.allowedSourceIds,
    };
  }

  canCacheMedia(media: MediaItem) {
    return this.config.allowedSourceIds.includes(media.sourceId);
  }

  async resolvePlayableUrl(media: MediaItem, url?: string) {
    if (!url || !isRemoteUrl(url)) return url;
    if (!this.config.cacheDir || !this.canCacheMedia(media)) return url;

    const cachePath = await this.ensureCached(media, url);
    return convertFileSrc(cachePath);
  }

  async cacheMedia(media: MediaItem, url = media.url) {
    if (!url) {
      throw new Error('Media URL is required for caching.');
    }
    if (!this.canCacheMedia(media)) {
      throw new Error('该来源不在允许缓存白名单中。');
    }
    if (!isRemoteUrl(url)) return url;
    if (!this.config.cacheDir) {
      throw new Error('Cache directory is not configured.');
    }

    return this.ensureCached(media, url);
  }

  private cacheFilePath(media: MediaItem, url: string) {
    const extension = extensionFromUrl(url);
    const id = hashString(`${media.sourceId}:${media.id}:${url}`);
    return pathJoin(this.config.cacheDir, `${id}.${extension}`);
  }

  private async ensureCached(media: MediaItem, url: string) {
    await mkdir(this.config.cacheDir, { recursive: true });

    const cachePath = this.cacheFilePath(media, url);
    if (await exists(cachePath)) {
      return cachePath;
    }

    const response = await tauriFetch(url, { connectTimeout: 15000 });
    if (!response.ok) {
      throw new Error(`Failed to cache media: ${response.status} ${response.statusText}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(cachePath, bytes);
    await this.cleanup();
    return cachePath;
  }

  private async listCacheEntries() {
    const entries: CacheEntry[] = [];

    try {
      if (!await exists(this.config.cacheDir)) return entries;
      const dirEntries = await readDir(this.config.cacheDir);

      for (const entry of dirEntries) {
        if (!entry.isFile) continue;

        const fullPath = pathJoin(this.config.cacheDir, entry.name);
        const info = await stat(fullPath);
        entries.push({
          path: fullPath,
          size: info.size ?? 0,
          mtime: info.mtime?.getTime() ?? 0,
        });
      }
    } catch (error) {
      console.warn('[MediaCache] Failed to list cache entries:', error);
    }

    return entries;
  }

  private async cleanup() {
    const entries = await this.listCacheEntries();
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= this.config.limitBytes) return;

    const oldestFirst = entries.sort((a, b) => a.mtime - b.mtime);
    for (const entry of oldestFirst) {
      if (total <= this.config.limitBytes) break;

      try {
        await remove(entry.path);
        total -= entry.size;
      } catch (error) {
        console.warn(`[MediaCache] Failed to remove cache file ${entry.path}:`, error);
      }
    }
  }
}

export const mediaCacheService = new MediaCacheService();
