import { computed, type ComputedRef } from 'vue';
import type { MediaItem } from '../types/plugin';
import type { LyricLine, ParsedLyric } from '../types/ui';

const parseLyricTimestamp = (value: string) => {
  const match = value.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? '0';
  const milliseconds = fraction.length === 1
    ? Number(fraction) * 100
    : fraction.length === 2
      ? Number(fraction) * 10
      : Number(fraction.slice(0, 3).padEnd(3, '0'));

  return (minutes * 60 + seconds) * 1000 + milliseconds;
};

export const parseLyrics = (lyric?: string): ParsedLyric => {
  const fallback: ParsedLyric = {
    isSynced: false,
    lines: [{ text: '暂无歌词' }],
  };

  if (!lyric?.trim()) return fallback;

  const syncedLines: LyricLine[] = [];
  const plainLines: LyricLine[] = [];
  const timestampPattern = /\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g;
  const metadataPattern = /^\[(ar|ti|al|by|offset|length|re|ve):/i;

  for (const rawLine of lyric.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || metadataPattern.test(line)) continue;

    const timestamps = [...line.matchAll(timestampPattern)]
      .map(match => parseLyricTimestamp(match[1]))
      .filter((time): time is number => time !== null);

    const text = line.replace(timestampPattern, '').trim();

    if (timestamps.length) {
      for (const time of timestamps) {
        syncedLines.push({ time, text: text || ' ' });
      }
    } else {
      plainLines.push({ text: line });
    }
  }

  if (syncedLines.length) {
    return {
      isSynced: true,
      lines: syncedLines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)),
    };
  }

  return {
    isSynced: false,
    lines: plainLines.length ? plainLines : fallback.lines,
  };
};

export const useLyricsDisplay = (
  currentSong: ComputedRef<MediaItem | null>,
  currentTime: ComputedRef<number>,
) => {
  const parsedLyric = computed(() => parseLyrics(currentSong.value?.lyric));
  const lyricLines = computed(() => parsedLyric.value.lines);
  const activeLyricIndex = computed(() => {
    if (!parsedLyric.value.isSynced) return -1;

    const currentTimeMs = currentTime.value * 1000;
    let activeIndex = -1;

    for (let index = 0; index < parsedLyric.value.lines.length; index += 1) {
      const lineTime = parsedLyric.value.lines[index].time;
      if (lineTime === undefined || lineTime > currentTimeMs + 120) break;
      activeIndex = index;
    }

    return activeIndex;
  });

  return {
    activeLyricIndex,
    lyricLines,
    parsedLyric,
  };
};
