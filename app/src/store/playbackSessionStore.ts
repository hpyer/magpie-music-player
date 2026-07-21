import { readJsonFile, storagePath, writeJsonFile } from './appFileStorage';

export type PlaybackRepeatMode = 'none' | 'list' | 'one';

export interface PlaybackSession {
  currentPlaylistId: string | null;
  currentSongId: string | null;
  currentSongPath: string | null;
  currentSongUrl: string | null;
  currentTime: number;
  wasPlaying: boolean;
  shuffleEnabled: boolean;
  repeatMode: PlaybackRepeatMode;
  updatedAt: number;
}

const PLAYBACK_SESSION_PATH = storagePath('settings', 'playback-session.json');
let playbackSessionSaveQueue = Promise.resolve();

const normalizeRepeatMode = (repeatMode?: string): PlaybackRepeatMode => {
  if (repeatMode === 'list' || repeatMode === 'one') return repeatMode;
  return 'none';
};

const normalizePlaybackSession = (session: Partial<PlaybackSession>): PlaybackSession => ({
  currentPlaylistId: session.currentPlaylistId ?? null,
  currentSongId: session.currentSongId ?? null,
  currentSongPath: session.currentSongPath ?? null,
  currentSongUrl: session.currentSongUrl ?? null,
  currentTime: Number.isFinite(session.currentTime)
    ? Math.max(0, session.currentTime as number)
    : 0,
  wasPlaying: Boolean(session.wasPlaying),
  shuffleEnabled: Boolean(session.shuffleEnabled),
  repeatMode: normalizeRepeatMode(session.repeatMode),
  updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt as number : 0,
});

export const readPlaybackSession = async () => {
  const session = await readJsonFile<Partial<PlaybackSession>>(PLAYBACK_SESSION_PATH, {});
  return normalizePlaybackSession(session);
};

export const writePlaybackSession = async (session: PlaybackSession) => {
  const normalizedSession = normalizePlaybackSession(session);

  playbackSessionSaveQueue = playbackSessionSaveQueue
    .catch(() => undefined)
    .then(() => writeJsonFile(PLAYBACK_SESSION_PATH, normalizedSession));

  await playbackSessionSaveQueue.catch(error => {
    console.error('[PlaybackSessionStore] Failed to save playback session:', error);
  });
};
