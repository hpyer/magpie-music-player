import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { MediaItem } from '../types/plugin';
import { readJsonFile, removeStorageFile, storagePath, writeJsonFile } from './appFileStorage';

interface MediaAssetRecord {
  id: string;
  cover?: string;
  lyric?: string;
  updatedAt: number;
}

const hashString = (value: string) => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

const assetPath = (songId: string) => storagePath('media-assets', `${hashString(songId)}.json`);
let coverCacheDir = '';
let lyricCacheDir = '';

const pathJoin = (dir: string, child: string) => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${child}`;
};

const coverPath = (songId: string) => (
  coverCacheDir ? pathJoin(coverCacheDir, `${hashString(songId)}.txt`) : ''
);

const lyricPath = (songId: string) => (
  lyricCacheDir ? pathJoin(lyricCacheDir, `${hashString(songId)}.lrc`) : ''
);

export const configureMediaAssetCache = (config: { coverDir?: string; lyricDir?: string }) => {
  coverCacheDir = config.coverDir ?? '';
  lyricCacheDir = config.lyricDir ?? '';
};

const saveCoverAsset = async (song: MediaItem) => {
  if (!song.cover || !coverCacheDir) return;

  await mkdir(coverCacheDir, { recursive: true });
  await writeTextFile(coverPath(song.id), song.cover);
};

const saveLyricAsset = async (song: MediaItem) => {
  if (!song.lyric || !lyricCacheDir) return;

  await mkdir(lyricCacheDir, { recursive: true });
  await writeTextFile(lyricPath(song.id), song.lyric);
};

const loadTextAsset = async (path: string) => {
  if (!path) return undefined;

  try {
    if (!await exists(path)) return undefined;
    return readTextFile(path);
  } catch {
    return undefined;
  }
};

export const saveMediaAssets = async (song: MediaItem) => {
  if (!song.cover && !song.lyric) return;

  await saveCoverAsset(song);
  await saveLyricAsset(song);

  const record: MediaAssetRecord = {
    id: song.id,
    cover: coverCacheDir ? undefined : song.cover,
    lyric: lyricCacheDir ? undefined : song.lyric,
    updatedAt: Date.now(),
  };

  await writeJsonFile(assetPath(song.id), record);
};

export const loadMediaAssets = async (songId: string) => {
  const record = await readJsonFile<MediaAssetRecord | null>(assetPath(songId), null);
  const cover = await loadTextAsset(coverPath(songId));
  const lyric = await loadTextAsset(lyricPath(songId));
  if (record?.id === songId) {
    return {
      ...record,
      cover: cover ?? record.cover,
      lyric: lyric ?? record.lyric,
    };
  }
  return cover || lyric ? { id: songId, cover, lyric, updatedAt: Date.now() } : undefined;
};

export const deleteMediaAssets = async (songId: string) => {
  await removeStorageFile(assetPath(songId));
  const paths = [coverPath(songId), lyricPath(songId)].filter(Boolean);
  await Promise.all(paths.map(async path => {
    try {
      if (await exists(path)) {
        await remove(path);
      }
    } catch {
      // Ignore cache cleanup failures.
    }
  }));
};
