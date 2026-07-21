import { MediaItem } from '../types/plugin';
import { readDir, readFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { join, extname, basename } from '@tauri-apps/api/path';
import { parseBlob, selectCover, TimestampFormat } from 'music-metadata';
import type { IAudioMetadata, ILyricsTag, IPicture } from 'music-metadata';

interface MetadataReadResult {
  metadata: IAudioMetadata | null;
  error?: string;
  recoveredWithoutCover?: boolean;
}

interface ScanDirectoryOptions {
  onSong?: (song: MediaItem) => void | Promise<void>;
  maxDepth?: number;
}

interface EmbeddedMetadataUpdate {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  lyrics?: string;
  coverDataUrl?: string;
}

export const LOCAL_MUSIC_SOURCE_ID = 'local-music';

export class LocalMusicService {

  private supportedExtensions = ['mp3', 'flac', 'wav', 'ogg', 'm4a'];
  private supportedCoverExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  private ignorePatterns = [
    'Media.localized',
    '.musiclibrary',
    'System Volume Information',
    '$RECYCLE.BIN',
    'Thumbs.db',
    'desktop.ini',
    'AlbumArt_',
    'Folder.jpg'
  ];

  /**
   * 检查目录权限
   */
  public async checkPermission(dirPath: string): Promise<{ read: boolean; write: boolean; error?: string }> {
    try {
      // 检查读权限
      await readDir(dirPath);

      return { read: true, write: true };
    } catch (error: any) {
      console.error('Permission check failed:', error);
      const errorStr = String(error);
      const isPermissionError = errorStr.includes('Access is denied') || 
                               errorStr.includes('Permission denied') || 
                               errorStr.includes('Operation not permitted');
      
      return { 
        read: false, 
        write: false, 
        error: isPermissionError ? 'PERMISSION_DENIED' : errorStr 
      };
    }
  }

  private formatAssetUrl(url: string): string {
    return url;
  }

  private getMimeType(ext: string): string {
    switch (ext.toLowerCase()) {
      case 'flac':
        return 'audio/flac';
      case 'm4a':
        return 'audio/mp4';
      case 'ogg':
        return 'audio/ogg';
      case 'wav':
        return 'audio/wav';
      case 'mp3':
      default:
        return 'audio/mpeg';
    }
  }

  private parseYear(metadata: IAudioMetadata): number | undefined {
    const year = metadata.common.year ?? metadata.common.originalyear;
    if (year) return year;

    const date = metadata.common.date
      ?? metadata.common.originaldate
      ?? metadata.common.releasedate
      ?? this.findNativeText(metadata, ['tdrc', 'tyer', 'tdat', '©day', 'date', 'year']);
    const match = date?.match(/\d{4}/);
    return match ? Number(match[0]) : undefined;
  }

  private normalizeText(value?: string | null): string | undefined {
    return value?.replace(/\s+/g, ' ').trim() || undefined;
  }

  private firstText(...values: Array<string | undefined | null>): string | undefined {
    for (const value of values) {
      const normalized = this.normalizeText(value);
      if (normalized) return normalized;
    }
    return undefined;
  }

  private cleanNamePart(value: string): string {
    return value
      .replace(/\[[^\]]*]/g, '')
      .replace(/\([^)]*(?:official|mv|伴奏|纯音乐|lyrics?|cover)[^)]*\)/gi, '')
      .replace(/[._]+$/g, '')
      .trim();
  }

  private parseNameParts(fileNameWithoutExt: string): { title: string; artist: string } {
    const normalized = fileNameWithoutExt.replace(/\s+/g, ' ').trim();
    const separators = [' - ', ' – ', ' — ', ' － ', '－', '-', '–', '—'];

    for (const separator of separators) {
      const index = normalized.indexOf(separator);
      if (index <= 0) continue;

      const left = this.cleanNamePart(normalized.slice(0, index));
      const right = this.cleanNamePart(normalized.slice(index + separator.length));
      if (left && right) {
        return { title: left, artist: right };
      }
    }

    return {
      title: this.cleanNamePart(normalized) || normalized,
      artist: '未知艺术家',
    };
  }

  private tagValueToText(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (Array.isArray(value)) {
      return value.map(item => this.tagValueToText(item)).filter(Boolean).join('\n') || undefined;
    }
    if (value && typeof value === 'object') {
      const text = (value as { text?: unknown; lyrics?: unknown }).text ?? (value as { lyrics?: unknown }).lyrics;
      return this.tagValueToText(text);
    }
    return undefined;
  }

  private findNativeText(metadata: IAudioMetadata, tagIds: string[]): string | undefined {
    const wantedIds = tagIds.map(id => id.toLowerCase());

    for (const tags of Object.values(metadata.native)) {
      for (const tag of tags) {
        if (!wantedIds.includes(tag.id.toLowerCase())) continue;

        const text = this.tagValueToText(tag.value);
        if (text) return this.normalizeText(text);
      }
    }

    return undefined;
  }

  private lyricsTagToText(tag: ILyricsTag): string | undefined {
    if (tag.syncText?.length) {
      return tag.syncText
        .map(line => {
          if (line.timestamp === undefined || tag.timeStampFormat === TimestampFormat.mpegFrameNumber) {
            return line.text;
          }

          const minutes = Math.floor(line.timestamp / 60000);
          const seconds = Math.floor((line.timestamp % 60000) / 1000);
          const hundredths = Math.floor((line.timestamp % 1000) / 10);
          return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}]${line.text}`;
        })
        .filter(Boolean)
        .join('\n');
    }
    if (tag.text?.trim()) return tag.text.trim();
    return undefined;
  }

  private extractLyrics(metadata: IAudioMetadata): string | undefined {
    const commonLyrics = metadata.common.lyrics
      ?.map(tag => this.lyricsTagToText(tag))
      .filter(Boolean)
      .join('\n');

    if (commonLyrics?.trim()) return commonLyrics.trim();

    for (const tags of Object.values(metadata.native)) {
      for (const tag of tags) {
        const id = tag.id.toLowerCase();
        if (id.includes('lyric') || id === 'uslt' || id === 'sylt') {
          const text = this.tagValueToText(tag.value);
          if (text) return text;
        }
      }
    }

    return undefined;
  }

  private pictureToDataUrl(picture: IPicture | null): string | undefined {
    if (!picture?.data?.length) return undefined;

    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < picture.data.length; i += chunkSize) {
      binary += String.fromCharCode(...picture.data.subarray(i, i + chunkSize));
    }

    return `data:${picture.format || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  private async imageFileToDataUrl(fullPath: string, ext: string): Promise<string | undefined> {
    try {
      const bytes = await readFile(fullPath);
      const mimeType = ext.toLowerCase() === 'png'
        ? 'image/png'
        : ext.toLowerCase() === 'webp'
          ? 'image/webp'
          : 'image/jpeg';

      return this.pictureToDataUrl({ data: bytes, format: mimeType, type: 'Cover (front)' });
    } catch (error) {
      console.warn(`[LocalMusic] Failed to read cover image for ${fullPath}:`, error);
      return undefined;
    }
  }

  private async findFolderCover(dirPath: string, entries: Awaited<ReturnType<typeof readDir>>): Promise<string | undefined> {
    const coverFiles = entries.filter(entry => entry.isFile && this.supportedCoverExtensions.includes(entry.name.split('.').pop()?.toLowerCase() ?? ''));
    if (!coverFiles.length) return undefined;

    const preferredNames = ['cover', 'folder', 'front', 'album', 'albumart', 'artwork'];
    const preferredCover = coverFiles.find(entry => {
      const name = entry.name.toLowerCase().replace(/\.[^.]+$/, '');
      return preferredNames.some(preferredName => name === preferredName || name.includes(preferredName));
    });
    const coverEntry = preferredCover ?? coverFiles[0];
    const coverExt = await extname(coverEntry.name);
    const coverPath = await join(dirPath, coverEntry.name);
    return this.imageFileToDataUrl(coverPath, coverExt);
  }

  private async readMetadata(fullPath: string, ext: string): Promise<MetadataReadResult> {
    try {
      const bytes = await readFile(fullPath);
      const blob = new Blob([bytes], { type: this.getMimeType(ext) });
      return {
        metadata: await parseBlob(blob, { duration: true, skipCovers: false }),
      };
    } catch (error) {
      console.warn(`[LocalMusic] Failed to read metadata for ${fullPath}:`, error);

      try {
        const bytes = await readFile(fullPath);
        const blob = new Blob([bytes], { type: this.getMimeType(ext) });
        return {
          metadata: await parseBlob(blob, { duration: true, skipCovers: true }),
          error: String(error),
          recoveredWithoutCover: true,
        };
      } catch (fallbackError) {
        console.warn(`[LocalMusic] Failed to read metadata without cover for ${fullPath}:`, fallbackError);
        return {
          metadata: null,
          error: String(fallbackError),
        };
      }
    }
  }

  private getLocalPath(song: MediaItem): string {
    return typeof song.extra?.path === 'string' ? song.extra.path : '';
  }

  private async writeEmbeddedMetadata(update: EmbeddedMetadataUpdate): Promise<boolean> {
    if (!update.path) return false;
    return invoke<boolean>('write_embedded_metadata', { update });
  }

  private createResolvedTags(metadata: IAudioMetadata | null, fallbackTitle: string) {
    const nameParts = this.parseNameParts(fallbackTitle);
    const commonArtists = metadata?.common.artists?.map(artist => artist.trim()).filter(Boolean).join(', ');
    const commonTitle = this.normalizeText(metadata?.common.title);
    const nativeTitle = metadata ? this.findNativeText(metadata, ['tit2', '©nam', 'title', 'iname', 'wm/title']) : undefined;
    const rawTitle = this.firstText(commonTitle, nativeTitle, nameParts.title) ?? fallbackTitle;
    const parsedTitleParts = this.parseNameParts(rawTitle);
    const artist = this.firstText(
      metadata?.common.artist,
      commonArtists,
      metadata ? this.findNativeText(metadata, ['tpe1', '©art', 'artist', 'artists', 'iart', 'wm/artist']) : undefined,
      parsedTitleParts.artist !== '未知艺术家' ? parsedTitleParts.artist : undefined,
      nameParts.artist,
    ) ?? '未知艺术家';
    const shouldSplitTitle = !metadata?.common.artist && !commonArtists && parsedTitleParts.artist !== '未知艺术家';
    const title = shouldSplitTitle ? parsedTitleParts.title : rawTitle;
    const album = this.firstText(
      metadata?.common.album,
      metadata ? this.findNativeText(metadata, ['talb', '©alb', 'album', 'iprd', 'wm/albumtitle']) : undefined,
    ) ?? '本地音乐';

    return { title, artist, album };
  }

  private async createMediaItem(fullPath: string, fileName: string, ext: string, folderCover?: string): Promise<MediaItem> {
    const fallbackTitle = await basename(fileName, ext);
    const assetUrl = this.formatAssetUrl(convertFileSrc(fullPath));
    const safeId = btoa(encodeURIComponent(fullPath));
    const metadataResult = await this.readMetadata(fullPath, ext);
    const metadata = metadataResult.metadata;
    const year = metadata ? this.parseYear(metadata) : undefined;
    const cover = metadata ? this.pictureToDataUrl(selectCover(metadata.common.picture)) ?? folderCover : folderCover;
    const resolvedTags = this.createResolvedTags(metadata, fallbackTitle);

    return {
      id: safeId,
      sourceId: LOCAL_MUSIC_SOURCE_ID,
      title: resolvedTags.title,
      artist: resolvedTags.artist,
      album: resolvedTags.album,
      year,
      duration: metadata?.format.duration,
      cover,
      lyric: metadata ? this.extractLyrics(metadata) : undefined,
      url: assetUrl,
      extra: {
        path: fullPath,
        date: metadata?.common.date,
        genre: metadata?.common.genre,
        albumArtist: metadata?.common.albumartist,
        track: metadata?.common.track,
        disk: metadata?.common.disk,
        codec: metadata?.format.codec,
        container: metadata?.format.container,
        bitrate: metadata?.format.bitrate,
        metadataError: metadataResult.error,
        recoveredWithoutCover: metadataResult.recoveredWithoutCover,
        hasEmbeddedCover: Boolean(metadata?.common.picture?.length),
        hasFolderCover: Boolean(folderCover),
      },
    };
  }

  public async scanDirectory(dirPath: string, options: ScanDirectoryOptions = {}, depth = 0): Promise<MediaItem[]> {
    const songs: MediaItem[] = [];
    const maxDepth = options.maxDepth ?? 1;
    console.log(`[LocalMusic] Starting scan in: ${dirPath}`);

    try {
      const entries = await readDir(dirPath);
      console.log(`[LocalMusic] Found ${entries.length} entries in ${dirPath}`);
      const folderCover = await this.findFolderCover(dirPath, entries);

      for (const entry of entries) {
        // 跳过以 . 开头的隐藏文件
        if (entry.name.startsWith('.')) continue;

        // 跳过系统或第三方缓存/索引文件
        if (this.ignorePatterns.some(pattern => entry.name.includes(pattern))) {
          console.log(`[LocalMusic] Ignoring entry: ${entry.name}`);
          continue;
        }

        const fullPath = await join(dirPath, entry.name);

        if (entry.isDirectory) {
          if (depth >= maxDepth) {
            console.log(`[LocalMusic] Skipping nested directory beyond max depth: ${fullPath}`);
            continue;
          }

          const subSongs = await this.scanDirectory(fullPath, options, depth + 1);
          songs.push(...subSongs);
        } else if (entry.isFile) {
          try {
            const ext = await extname(entry.name);
            console.log(`[LocalMusic] Checking file: ${entry.name} (ext: ${ext})`);

            if (this.supportedExtensions.includes(ext.toLowerCase())) {
              const song = await this.createMediaItem(fullPath, entry.name, ext, folderCover);
              songs.push(song);
              await options.onSong?.(song);
              console.log(`[LocalMusic] Added song: ${song.title}`);
            }
          } catch (e) {
            console.warn(`[LocalMusic] Skipping file without extension or error: ${entry.name}`, e);
          }
        }
      }
    } catch (error) {
      console.error(`[LocalMusic] Error scanning directory ${dirPath}:`, error);
    }

    return songs;
  }

  public async getMediaUrl(mediaId: string): Promise<string> {
    const path = decodeURIComponent(atob(mediaId));
    let url = convertFileSrc(path);
    url = this.formatAssetUrl(url);
    
    console.log(`[LocalMusic] Final playback URL for ${path}: ${url}`);
    return url;
  }

  public async readEmbeddedMediaAssets(song: MediaItem): Promise<Pick<MediaItem, 'cover' | 'lyric'>> {
    const fullPath = typeof song.extra?.path === 'string' ? song.extra.path : '';
    if (!fullPath) return {};

    try {
      const ext = await extname(fullPath);
      const metadataResult = await this.readMetadata(fullPath, ext);
      const metadata = metadataResult.metadata;
      if (!metadata) return {};

      return {
        cover: this.pictureToDataUrl(selectCover(metadata.common.picture)),
        lyric: this.extractLyrics(metadata),
      };
    } catch (error) {
      console.warn(`[LocalMusic] Failed to read embedded media assets for ${fullPath}:`, error);
      return {};
    }
  }

  public async writeEmbeddedLyric(song: MediaItem, lyric: string): Promise<boolean> {
    return this.writeEmbeddedMetadata({
      path: this.getLocalPath(song),
      lyrics: lyric,
    });
  }

  public async writeEmbeddedCover(song: MediaItem, cover: string): Promise<boolean> {
    return this.writeEmbeddedMetadata({
      path: this.getLocalPath(song),
      coverDataUrl: cover,
    });
  }

  public async writeEmbeddedSongInfo(song: MediaItem, info: Partial<Pick<MediaItem, 'title' | 'artist' | 'album' | 'cover' | 'year'>>): Promise<boolean> {
    const update: EmbeddedMetadataUpdate = {
      path: this.getLocalPath(song),
      title: info.title,
      artist: info.artist,
      album: info.album,
      year: info.year,
      coverDataUrl: info.cover,
    };

    try {
      return await this.writeEmbeddedMetadata(update);
    } catch (error) {
      const hasTextMetadata = Boolean(info.title || info.artist || info.album || info.year);
      if (!info.cover || !hasTextMetadata) throw error;

      console.warn('[LocalMusic] Failed to write embedded cover, retrying text metadata only:', error);
      await this.writeEmbeddedMetadata({
        path: update.path,
        title: update.title,
        artist: update.artist,
        album: update.album,
        year: update.year,
      });
      return false;
    }
  }

}

export const localMusicService = new LocalMusicService();
