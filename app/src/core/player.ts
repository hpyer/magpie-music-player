import { MediaItem } from '../types/plugin';
import { pluginManager } from './pluginManager';
import { mediaCacheService } from '../services/mediaCacheService';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { appLogError, appLogWarn, errorToLogDetails } from '../services/appLogger';

interface NativeAudioStatus {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  ended: boolean;
}

const isLocalMusic = (media: MediaItem) => media.sourceId === 'local-music';

const localPathFromMedia = (media: MediaItem) => (
  typeof media.extra?.path === 'string' ? media.extra.path : ''
);

const extensionFromPath = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';

const mimeTypeFromPath = (path: string) => {
  switch (extensionFromPath(path)) {
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
};

export class Player {
  private static instance: Player;
  private audio: HTMLAudioElement;
  private currentMedia: MediaItem | null = null;
  private isPlaying: boolean = false;
  private endedListeners = new Set<() => void>();
  private targetVolume = 0.5;
  private volumeFadeFrame: number | null = null;
  private volumeFadeToken = 0;
  private playbackOperationToken = 0;
  private volumeWatchdogTimer: number | null = null;
  private localBlobUrl: string | null = null;
  private backend: 'web' | 'native' = 'web';
  private nativeStatus: NativeAudioStatus = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    ended: false,
  };
  private nativeStatusTimer: number | null = null;
  private nativeEndedNotified = false;

  private constructor() {
    this.audio = new Audio();
    this.setupListeners();
  }

  public static getInstance(): Player {
    if (!Player.instance) {
      Player.instance = new Player();
    }
    return Player.instance;
  }

  private setupListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      console.log('Player started playing.');
    });
    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      console.log('Player paused.');
    });
    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      console.log('Player track ended.');
      this.endedListeners.forEach(listener => listener());
    });
    this.audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      if (this.audio.error) {
        console.error(`Audio error details: code ${this.audio.error.code}, message: ${this.audio.error.message}`);
      }
    });
  }

  private cancelVolumeFade() {
    this.volumeFadeToken += 1;
    if (this.volumeFadeFrame !== null) {
      window.cancelAnimationFrame(this.volumeFadeFrame);
      this.volumeFadeFrame = null;
    }
  }

  private beginPlaybackOperation() {
    this.playbackOperationToken += 1;
    this.cancelVolumeFade();
    this.cancelVolumeWatchdog();
    return this.playbackOperationToken;
  }

  private isCurrentPlaybackOperation(token: number) {
    return token === this.playbackOperationToken;
  }

  private fadeVolume(toVolume: number, duration = 220, playbackOperationToken = this.playbackOperationToken) {
    this.cancelVolumeFade();

    const token = this.volumeFadeToken;
    const fromVolume = this.audio.volume;
    const targetVolume = Math.min(1, Math.max(0, toVolume));

    if (duration <= 0 || Math.abs(fromVolume - targetVolume) < 0.01) {
      if (this.isCurrentPlaybackOperation(playbackOperationToken)) {
        this.audio.volume = targetVolume;
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const startedAt = performance.now();

      const step = (timestamp: number) => {
        if (token !== this.volumeFadeToken || !this.isCurrentPlaybackOperation(playbackOperationToken)) {
          resolve();
          return;
        }

        const progress = Math.min(1, (timestamp - startedAt) / duration);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        this.audio.volume = fromVolume + (targetVolume - fromVolume) * easedProgress;

        if (progress < 1) {
          this.volumeFadeFrame = window.requestAnimationFrame(step);
        } else {
          this.volumeFadeFrame = null;
          if (this.isCurrentPlaybackOperation(playbackOperationToken)) {
            this.audio.volume = targetVolume;
          }
          resolve();
        }
      };

      this.volumeFadeFrame = window.requestAnimationFrame(step);
    });
  }

  private cancelVolumeWatchdog() {
    if (this.volumeWatchdogTimer !== null) {
      window.clearTimeout(this.volumeWatchdogTimer);
      this.volumeWatchdogTimer = null;
    }
  }

  private resetNativeStatus() {
    this.nativeStatus = {
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      ended: false,
    };
    this.nativeEndedNotified = false;
  }

  private async refreshNativeStatus() {
    if (this.backend !== 'native') return;

    try {
      this.nativeStatus = await invoke<NativeAudioStatus>('native_audio_status');
      if (this.nativeStatus.ended && !this.nativeEndedNotified) {
        this.nativeEndedNotified = true;
        this.isPlaying = false;
        this.endedListeners.forEach(listener => listener());
      }
    } catch (error) {
      console.warn('[Player] Failed to read native audio status:', error);
      appLogError('player.native.status_failed', '读取原生音频状态失败。', {
        error: errorToLogDetails(error),
      }, 'player');
    }
  }

  private startNativeStatusPolling() {
    if (this.nativeStatusTimer !== null) return;

    this.nativeStatusTimer = window.setInterval(() => {
      void this.refreshNativeStatus();
    }, 350);
  }

  private stopNativeStatusPolling() {
    if (this.nativeStatusTimer !== null) {
      window.clearInterval(this.nativeStatusTimer);
      this.nativeStatusTimer = null;
    }
  }

  private async stopNativeAudio() {
    if (this.backend === 'native') {
      this.backend = 'web';
      this.stopNativeStatusPolling();
      this.resetNativeStatus();
      try {
        await invoke('native_audio_stop');
      } catch (error) {
        console.warn('[Player] Failed to stop native audio:', error);
      }
    }
  }

  private async playNative(media: MediaItem, currentTime = 0) {
    const path = localPathFromMedia(media);
    if (!path) {
      throw new Error('没有找到本地音频文件路径。');
    }

    await invoke('native_audio_play', {
      path,
      volume: this.targetVolume,
      startSeconds: currentTime,
    });

    this.backend = 'native';
    this.currentMedia = media;
    this.isPlaying = true;
    this.nativeEndedNotified = false;
    this.nativeStatus = {
      isPlaying: true,
      currentTime,
      duration: media.duration ?? 0,
      ended: false,
    };
    this.startNativeStatusPolling();
    void this.refreshNativeStatus();
  }

  private revokeLocalBlobUrl(urlToKeep?: string) {
    if (this.localBlobUrl && this.localBlobUrl !== urlToKeep) {
      URL.revokeObjectURL(this.localBlobUrl);
      this.localBlobUrl = null;
    }
  }

  private async createLocalBlobUrl(media: MediaItem) {
    const path = localPathFromMedia(media);
    if (!isLocalMusic(media) || !path) return '';

    const mimeType = mimeTypeFromPath(path);
    const bytes = await readFile(path);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    this.revokeLocalBlobUrl();
    this.localBlobUrl = url;
    appLogWarn('player.local_blob.created', '已为本地音乐创建 Blob URL 重试播放。', {
      media: {
        sourceId: media.sourceId,
        mimeType,
        byteLength: bytes.byteLength,
      },
    }, 'player');
    return url;
  }

  private async playCurrentSource(media: MediaItem, playbackOperationToken: number) {
    try {
      return await this.fadeInPlayback(this.audio.play(), playbackOperationToken);
    } catch (error) {
      if (!this.isCurrentPlaybackOperation(playbackOperationToken) || !isLocalMusic(media)) {
        throw error;
      }

      console.warn('[Player] Failed to play local asset URL, retrying with a blob URL:', error);
      appLogWarn('player.local_asset.failed', '本地音乐 asset URL 播放失败，准备使用 Blob URL 重试。', {
        media: {
          sourceId: media.sourceId,
        },
        error: errorToLogDetails(error),
      }, 'player');
      const blobUrl = await this.createLocalBlobUrl(media);
      if (!this.isCurrentPlaybackOperation(playbackOperationToken) || !blobUrl) return;

      this.audio.src = blobUrl;
      this.audio.load();
      try {
        return await this.fadeInPlayback(this.audio.play(), playbackOperationToken);
      } catch (blobError) {
        appLogError('player.local_blob.failed', '本地音乐 Blob URL 播放仍然失败。', {
          media: {
            sourceId: media.sourceId,
            mimeType: mimeTypeFromPath(localPathFromMedia(media)),
          },
          error: errorToLogDetails(blobError),
          hint: '如果 HTMLAudioElement error code 为 4，通常表示系统 WebKitGTK/GStreamer 缺少对应解码器或不支持该媒体格式。',
        }, 'player');
        try {
          await this.playNative(media, 0);
          appLogWarn('player.native_fallback.started', '已切换到原生音频后端播放本地音乐。', {
            media: {
              sourceId: media.sourceId,
              mimeType: mimeTypeFromPath(localPathFromMedia(media)),
            },
          }, 'player');
          return;
        } catch (nativeError) {
          appLogError('player.native_fallback.failed', '原生音频后端播放本地音乐失败。', {
            error: errorToLogDetails(nativeError),
          }, 'player');
          throw nativeError;
        }
      }
    }
  }

  private ensureAudiblePlayback(playbackOperationToken: number) {
    this.cancelVolumeWatchdog();

    this.volumeWatchdogTimer = window.setTimeout(() => {
      this.volumeWatchdogTimer = null;

      if (
        this.isCurrentPlaybackOperation(playbackOperationToken)
        && !this.audio.paused
        && this.targetVolume > 0
        && this.audio.volume < 0.01
      ) {
        console.warn('[Player] Recovered playback volume after a stale fade operation.');
        this.cancelVolumeFade();
        this.audio.volume = this.targetVolume;
      }
    }, 520);
  }

  private async fadeInPlayback(playTask: Promise<void>, playbackOperationToken: number) {
    this.audio.volume = 0;
    try {
      await playTask;
    } catch (error) {
      if (!this.isCurrentPlaybackOperation(playbackOperationToken)) {
        return;
      }

      this.audio.volume = this.targetVolume;
      throw error;
    }

    if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
    this.ensureAudiblePlayback(playbackOperationToken);
    await this.fadeVolume(this.targetVolume, 220, playbackOperationToken);
  }

  private async resolveMediaUrl(media: MediaItem) {
    let url = media.url;

    // External plugin media may need a fresh playback URL.
    const plugin = pluginManager.getPlugin(media.sourceId);
    if (plugin?.getMediaUrl) {
      url = await plugin.getMediaUrl(media.id);
    }

    return mediaCacheService.resolvePlayableUrl(media, url);
  }

  private async seekWhenReady(time: number) {
    const seekTime = Math.max(0, time);
    if (!seekTime) return;

    const applySeek = () => {
      try {
        this.audio.currentTime = Math.min(seekTime, this.audio.duration || seekTime);
      } catch (error) {
        console.warn('[Player] Failed to restore current time:', error);
      }
    };

    if (this.audio.readyState > 0) {
      applySeek();
      return;
    }

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        this.audio.removeEventListener('error', handleError);
      };
      const handleLoadedMetadata = () => {
        cleanup();
        applySeek();
        resolve();
      };
      const handleError = () => {
        cleanup();
        resolve();
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve();
      }, 1200);

      this.audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      this.audio.addEventListener('error', handleError, { once: true });
    });
  }

  public async load(media: MediaItem, currentTime = 0) {
    const playbackOperationToken = this.beginPlaybackOperation();
    await this.stopNativeAudio();
    this.currentMedia = media;

    const url = await this.resolveMediaUrl(media);
    if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
    if (!url) {
      console.error(`Cannot find URL for media: ${media.title}`);
      return;
    }

    if (this.audio.src !== url) {
      console.log(`[Player] Loading audio src: ${url}`);
      this.revokeLocalBlobUrl(url);
      this.audio.src = url;
      this.audio.load();
    }

    this.audio.volume = this.targetVolume;
    await this.seekWhenReady(currentTime);
  }

  public async play(media: MediaItem) {
    const playbackOperationToken = this.beginPlaybackOperation();

    if (this.backend === 'native' && this.currentMedia?.id === media.id) {
      await invoke('native_audio_resume');
      if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
      this.isPlaying = true;
      this.nativeStatus = {
        ...this.nativeStatus,
        isPlaying: true,
        ended: false,
      };
      this.nativeEndedNotified = false;
      this.startNativeStatusPolling();
      void this.refreshNativeStatus();
      return;
    }

    await this.stopNativeAudio();

    if (this.currentMedia?.id === media.id && this.audio.src) {
      if (!this.audio.paused) {
        await this.audio.play();
        if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
        this.ensureAudiblePlayback(playbackOperationToken);
        return this.fadeVolume(this.targetVolume, 120, playbackOperationToken);
      }
      return this.playCurrentSource(media, playbackOperationToken);
    }

    this.currentMedia = media;
    const url = await this.resolveMediaUrl(media);
    if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;

    if (url) {
      console.log(`[Player] Setting audio src to: ${url}`);
      this.revokeLocalBlobUrl(url);
      this.audio.src = url;
      this.audio.load();
      return this.playCurrentSource(media, playbackOperationToken);
    } else {
      console.error(`Cannot find URL for media: ${media.title}`);
    }
  }

  public async pause() {
    const playbackOperationToken = this.beginPlaybackOperation();
    if (this.backend === 'native') {
      await invoke('native_audio_pause');
      if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
      await this.refreshNativeStatus();
      this.isPlaying = false;
      this.nativeStatus = {
        ...this.nativeStatus,
        isPlaying: false,
      };
      return;
    }

    if (this.audio.paused) {
      this.audio.volume = this.targetVolume;
      return;
    }

    await this.fadeVolume(0, 180, playbackOperationToken);
    if (!this.isCurrentPlaybackOperation(playbackOperationToken)) return;
    this.audio.pause();
    this.audio.volume = this.targetVolume;
  }

  public stop() {
    this.beginPlaybackOperation();
    this.cancelVolumeWatchdog();
    void this.stopNativeAudio();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.volume = this.targetVolume;
    this.revokeLocalBlobUrl();
    this.currentMedia = null;
    this.isPlaying = false;
  }

  public seek(time: number) {
    if (this.backend === 'native') {
      this.nativeStatus = {
        ...this.nativeStatus,
        currentTime: Math.max(0, time),
        ended: false,
      };
      this.nativeEndedNotified = false;
      void invoke('native_audio_seek', { seconds: Math.max(0, time) })
        .then(() => this.refreshNativeStatus())
        .catch(error => {
          console.warn('[Player] Failed to seek native audio:', error);
          appLogError('player.native.seek_failed', '原生音频跳转失败。', {
            error: errorToLogDetails(error),
          }, 'player');
        });
      return;
    }

    this.audio.currentTime = time;
  }

  public setVolume(volume: number) {
    this.targetVolume = Math.min(1, Math.max(0, volume));
    this.cancelVolumeFade();
    this.cancelVolumeWatchdog();
    this.audio.volume = this.targetVolume;
    if (this.backend === 'native') {
      void invoke('native_audio_set_volume', { volume: this.targetVolume });
    }
  }

  public onEnded(listener: () => void) {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  public getStatus() {
    if (this.backend === 'native') {
      return {
        isPlaying: this.nativeStatus.isPlaying,
        currentTime: this.nativeStatus.currentTime,
        duration: this.nativeStatus.duration || this.currentMedia?.duration || 0,
        currentMedia: this.currentMedia,
      };
    }

    return {
      isPlaying: this.isPlaying,
      currentTime: this.audio.currentTime,
      duration: this.audio.duration,
      currentMedia: this.currentMedia,
    };
  }
}

export const player = Player.getInstance();
