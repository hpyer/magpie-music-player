import { invoke } from '@tauri-apps/api/core';
import { appDataDir, homeDir } from '@tauri-apps/api/path';

type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface AppLogEntry {
  level: AppLogLevel;
  scope: string;
  event: string;
  message?: string;
  details?: unknown;
}

interface AppDirectory {
  path: string;
}

const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|credential|config|lyric|lyrics|cover|url)$/i;
const MAX_STRING_LENGTH = 1200;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 40;

let appDataPath = '';
let homePath = '';
let consoleBridgeInstalled = false;
let logQueue = Promise.resolve();
let loggerAvailable = true;

const originalConsole = {
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

const trimString = (value: string) => (
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value
);

const redactString = (value: string) => {
  let output = value;
  const normalizedAppDataPath = appDataPath ? normalizePath(appDataPath) : '';
  const normalizedHomePath = homePath ? normalizePath(homePath) : '';

  if (normalizedAppDataPath) {
    output = output.split(normalizedAppDataPath).join('$APPDATA');
  }
  if (normalizedHomePath) {
    output = output.replace(new RegExp(`${escapeRegExp(normalizedHomePath)}\\/[^\\s'")]+`, 'g'), '$HOME/<redacted>');
    output = output.split(normalizedHomePath).join('$HOME');
  }

  output = output
    .replace(/\/home\/[^/\s'")]+\/[^\s'")]+/g, '$HOME/<redacted>')
    .replace(/\/Users\/[^/\s'")]+\/[^\s'")]+/g, '$HOME/<redacted>')
    .replace(/[A-Z]:\/Users\/[^/\s'")]+\/[^\s'")]+/gi, '%USERPROFILE%/<redacted>')
    .replace(/(https?:\/\/[^/\s'")]+)\/[^\s'")]+/gi, '$1/<redacted>')
    .replace(/(https?:\/\/[^?\s'")]+)\?[^ \n'")]+/gi, '$1?<redacted>');

  return trimString(output);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeValue = (value: unknown, key = '', depth = 0): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '<redacted>';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (depth >= 4) return '<truncated>';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map(item => sanitizeValue(item, key, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  return Object.fromEntries(entries.map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeValue(entryValue, entryKey, depth + 1),
  ]));
};

const normalizeConsoleArg = (arg: unknown) => {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(sanitizeValue(arg));
  } catch {
    return String(arg);
  }
};

const enqueueLog = (entry: AppLogEntry) => {
  if (!loggerAvailable) return;

  const safeEntry: AppLogEntry = {
    level: entry.level,
    scope: redactString(entry.scope),
    event: redactString(entry.event),
    message: entry.message ? redactString(entry.message) : undefined,
    details: sanitizeValue(entry.details),
  };

  logQueue = logQueue
    .catch(() => undefined)
    .then(async () => {
      await invoke('append_app_log', { entry: safeEntry });
    })
    .catch(error => {
      loggerAvailable = false;
      originalConsole.warn('[AppLogger] Failed to write app log:', error);
    });
};

const installConsoleBridge = () => {
  if (consoleBridgeInstalled) return;
  consoleBridgeInstalled = true;

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    enqueueLog({
      level: 'warn',
      scope: 'console',
      event: 'console.warn',
      message: args.map(normalizeConsoleArg).join(' '),
    });
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    enqueueLog({
      level: 'error',
      scope: 'console',
      event: 'console.error',
      message: args.map(normalizeConsoleArg).join(' '),
    });
  };
};

export const initializeAppLogger = async (details: Record<string, unknown>) => {
  try {
    [appDataPath, homePath] = await Promise.all([
      appDataDir().catch(() => ''),
      homeDir().catch(() => ''),
    ]);
  } catch {
    appDataPath = '';
    homePath = '';
  }

  installConsoleBridge();
  appLogInfo('app.startup.begin', '应用启动开始。', details);
};

export const appLog = (level: AppLogLevel, event: string, message?: string, details?: unknown, scope = 'app') => {
  enqueueLog({ level, scope, event, message, details });
};

export const appLogInfo = (event: string, message?: string, details?: unknown, scope = 'app') => {
  appLog('info', event, message, details, scope);
};

export const appLogWarn = (event: string, message?: string, details?: unknown, scope = 'app') => {
  appLog('warn', event, message, details, scope);
};

export const appLogError = (event: string, message?: string, details?: unknown, scope = 'app') => {
  appLog('error', event, message, details, scope);
};

export const errorToLogDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: String(error) };
};

export const getAppLogDirectory = async () => {
  const result = await invoke<AppDirectory>('get_app_log_directory');
  return result.path;
};

export const revealAppDataDirectory = async () => {
  const result = await invoke<AppDirectory>('reveal_app_data_directory');
  return result.path;
};
