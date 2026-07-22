import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { MediaItem } from '../types/plugin';
import { readJsonFile, removeStorageFile, storagePath, writeJsonFile } from './appFileStorage';

interface MediaAssetRecord {
  id: string;
  sourceId: string;
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

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const cacheFileStem = (song: MediaItem) => hashString(`${song.sourceId}:${song.id}`);
const assetPath = (song: MediaItem) => storagePath('media-assets', `${cacheFileStem(song)}.json`);
let coverCacheDir = '';
let lyricCacheDir = '';

const pathJoin = (dir: string, child: string) => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${child}`;
};

const coverPath = (song: MediaItem) => (
  coverCacheDir ? pathJoin(coverCacheDir, `${cacheFileStem(song)}.cover`) : ''
);

const lyricPath = (song: MediaItem) => (
  lyricCacheDir ? pathJoin(lyricCacheDir, `${cacheFileStem(song)}.lyric`) : ''
);

export const configureMediaAssetCache = (config: { coverDir?: string; lyricDir?: string }) => {
  coverCacheDir = config.coverDir ?? '';
  lyricCacheDir = config.lyricDir ?? '';
};

const saveCoverAsset = async (song: MediaItem) => {
  if (!song.cover || !coverCacheDir) return;

  await mkdir(coverCacheDir, { recursive: true });
  await writeTextFile(coverPath(song), song.cover);
};

const saveLyricAsset = async (song: MediaItem) => {
  if (!song.lyric || !lyricCacheDir) return;

  await mkdir(lyricCacheDir, { recursive: true });
  await writeTextFile(lyricPath(song), song.lyric);
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

const removeIfExists = async (path: string) => {
  try {
    if (path && await exists(path)) {
      await remove(path);
    }
  } catch {
    // Ignore cache cleanup failures.
  }
};

export const saveMediaAssets = async (song: MediaItem) => {
  if (!song.cover && !song.lyric) return;

  await saveCoverAsset(song);
  await saveLyricAsset(song);

  const record: MediaAssetRecord = {
    id: song.id,
    sourceId: song.sourceId,
    cover: coverCacheDir ? undefined : song.cover,
    lyric: lyricCacheDir ? undefined : song.lyric,
    updatedAt: Date.now(),
  };

  await writeJsonFile(assetPath(song), record);
};

export const loadMediaAssets = async (song: MediaItem) => {
  const record = await readJsonFile<MediaAssetRecord | null>(assetPath(song), null);
  const cover = await loadTextAsset(coverPath(song));
  const lyric = await loadTextAsset(lyricPath(song));
  if (record?.id === song.id && record.sourceId === song.sourceId) {
    return {
      ...record,
      cover: cover ?? record.cover,
      lyric: lyric ?? record.lyric,
    };
  }
  return cover || lyric ? { id: song.id, sourceId: song.sourceId, cover, lyric, updatedAt: Date.now() } : undefined;
};

export const deleteMediaAssets = async (song: MediaItem) => {
  await removeStorageFile(assetPath(song));
  const paths = [
    coverPath(song),
    lyricPath(song),
  ].filter(Boolean);
  await Promise.all(paths.map(removeIfExists));
};
