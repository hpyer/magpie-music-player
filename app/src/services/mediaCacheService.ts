import { convertFileSrc } from '@tauri-apps/api/core';
import { exists, mkdir, open, readDir, remove, rename, stat } from '@tauri-apps/plugin-fs';
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

export interface MediaCacheProgress {
  key: string;
  mediaId: string;
  sourceId: string;
  state: 'downloading' | 'complete' | 'error';
  receivedBytes: number;
  totalBytes: number | null;
  progress: number;
}

const DEFAULT_LIMIT_BYTES = 1024 * 1024 * 1024;
const SONG_CACHE_EXTENSION = 'song';

const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url);

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const pathJoin = (dir: string, child: string) => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${child}`;
};

const mediaProgressKey = (media: MediaItem) => `${media.sourceId}:${media.id}`;

const extraValue = (media: MediaItem, key: string) => {
  const value = media.extra?.[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
};

const contentFingerprint = (media: MediaItem, url: string) => {
  const values = [
    extraValue(media, 'cacheKey'),
    extraValue(media, 'cacheVersion'),
    extraValue(media, 'etag'),
    extraValue(media, 'lastModified'),
    extraValue(media, 'size'),
    extraValue(media, 'contentLength'),
    extraValue(media, 'contentType'),
    extraValue(media, 'suffix'),
    media.duration,
  ].filter(value => value !== undefined && value !== '');

  if (values.length) return values.join(':');

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
};

class MediaCacheService {
  private config: MediaCacheConfig = {
    cacheDir: '',
    limitBytes: DEFAULT_LIMIT_BYTES,
    allowedSourceIds: [],
  };

  private cacheTasks = new Map<string, Promise<string>>();
  private listeners = new Set<(progress: MediaCacheProgress) => void>();

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

  subscribe(listener: (progress: MediaCacheProgress) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  progressKey(media: MediaItem) {
    return mediaProgressKey(media);
  }

  async resolvePlayableUrl(media: MediaItem, url?: string) {
    if (!url || !isRemoteUrl(url)) return url;
    if (!this.config.cacheDir || !this.canCacheMedia(media)) return url;

    const cachePath = this.cacheFilePath(media, url);
    if (await exists(cachePath)) {
      this.emitProgress(media, {
        state: 'complete',
        receivedBytes: 1,
        totalBytes: 1,
        progress: 1,
      });
      return convertFileSrc(cachePath);
    }

    void this.ensureCached(media, url).catch(error => {
      console.warn('[MediaCache] Background cache failed:', error);
    });
    return url;
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
    const id = hashString(`${media.sourceId}:${media.id}:${contentFingerprint(media, url)}`);
    return pathJoin(this.config.cacheDir, `${id}.${SONG_CACHE_EXTENSION}`);
  }

  private tempCacheFilePath(media: MediaItem, url: string) {
    return `${this.cacheFilePath(media, url)}.part`;
  }

  private emitProgress(media: MediaItem, progress: Omit<MediaCacheProgress, 'key' | 'mediaId' | 'sourceId'>) {
    const event = {
      key: mediaProgressKey(media),
      mediaId: media.id,
      sourceId: media.sourceId,
      ...progress,
    };
    this.listeners.forEach(listener => listener(event));
  }

  private async removeIfExists(path: string) {
    try {
      if (await exists(path)) {
        await remove(path);
      }
    } catch (error) {
      console.warn(`[MediaCache] Failed to remove cache file ${path}:`, error);
    }
  }

  private async ensureCached(media: MediaItem, url: string) {
    await mkdir(this.config.cacheDir, { recursive: true });

    const cachePath = this.cacheFilePath(media, url);
    if (await exists(cachePath)) {
      this.emitProgress(media, {
        state: 'complete',
        receivedBytes: 1,
        totalBytes: 1,
        progress: 1,
      });
      return cachePath;
    }

    const existingTask = this.cacheTasks.get(cachePath);
    if (existingTask) return existingTask;

    const task = this.downloadToCache(media, url, cachePath)
      .finally(() => {
        this.cacheTasks.delete(cachePath);
      });
    this.cacheTasks.set(cachePath, task);
    return task;
  }

  private async downloadToCache(media: MediaItem, url: string, cachePath: string) {
    const tempPath = this.tempCacheFilePath(media, url);
    await this.removeIfExists(tempPath);

    let file: Awaited<ReturnType<typeof open>> | null = null;
    let receivedBytes = 0;
    let totalBytes: number | null = null;

    try {
      const response = await tauriFetch(url, { connectTimeout: 15000 });
      if (!response.ok) {
        throw new Error(`Failed to cache media: ${response.status} ${response.statusText}`);
      }

      const contentLength = Number(response.headers.get('content-length'));
      totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
      this.emitProgress(media, {
        state: 'downloading',
        receivedBytes,
        totalBytes,
        progress: 0,
      });

      if (!response.body) {
        throw new Error('Failed to cache media: response body is empty.');
      }

      const reader = response.body.getReader();
      file = await open(tempPath, { write: true, create: true, truncate: true });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;

        await file.write(value);
        receivedBytes += value.byteLength;
        this.emitProgress(media, {
          state: 'downloading',
          receivedBytes,
          totalBytes,
          progress: totalBytes ? Math.min(1, receivedBytes / totalBytes) : 0,
        });
      }

      await file.close();
      file = null;

      await rename(tempPath, cachePath);
      this.emitProgress(media, {
        state: 'complete',
        receivedBytes,
        totalBytes: totalBytes ?? receivedBytes,
        progress: 1,
      });
      await this.cleanup();
      return cachePath;
    } catch (error) {
      if (file) {
        try {
          await file.close();
        } catch {
          // Ignore close failures while reporting the original cache error.
        }
      }
      await this.removeIfExists(tempPath);
      this.emitProgress(media, {
        state: 'error',
        receivedBytes,
        totalBytes,
        progress: 0,
      });
      throw error;
    }
  }

  private async listCacheEntries() {
    const entries: CacheEntry[] = [];

    try {
      if (!await exists(this.config.cacheDir)) return entries;
      const dirEntries = await readDir(this.config.cacheDir);

      for (const entry of dirEntries) {
        if (!entry.isFile) continue;
        if (entry.name.endsWith('.part')) continue;

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
