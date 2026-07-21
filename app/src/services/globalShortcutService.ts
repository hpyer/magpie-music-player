import { isRegistered, register, unregisterAll, type ShortcutEvent } from '@tauri-apps/plugin-global-shortcut';
import type { AppSettings, ShortcutSetting } from '../store/appSettingsStore';

type ShortcutAction = ShortcutSetting['id'];

type ShortcutHandlers = Record<ShortcutAction, () => void>;

export interface GlobalShortcutSyncResult {
  ok: boolean;
  registered: string[];
  failed: string[];
  error?: unknown;
}

const shortcutKeyToAction = new Map<string, ShortcutAction>();

const normalizeShortcut = (keys: string) => {
  const parts = keys
    .split('+')
    .map(key => key.trim())
    .filter(Boolean);
  const modifierMap: Record<string, string> = {
    cmd: 'super',
    command: 'super',
    super: 'super',
    meta: 'super',
    ctrl: 'control',
    control: 'control',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  };
  const modifiers: string[] = [];
  let mainKey = '';

  for (const part of parts) {
    const normalized = modifierMap[part.toLowerCase()];
    if (normalized) {
      modifiers.push(normalized);
    } else {
      mainKey = part.toLowerCase();
    }
  }

  const orderedModifiers = ['shift', 'control', 'alt', 'super'].filter(modifier => modifiers.includes(modifier));
  return [...orderedModifiers, mainKey].filter(Boolean).join('+');
};

const toTauriShortcut = (keys: string) => {
  return keys
    .split('+')
    .map(key => key.trim())
    .filter(Boolean)
    .map(key => {
      if (key === 'Cmd') return 'Command';
      if (key === 'Ctrl') return 'Control';
      return key;
    })
    .join('+');
};

const handleShortcutEvent = (event: ShortcutEvent, handlers: ShortcutHandlers) => {
  if (event.state !== 'Pressed') return;

  const action = shortcutKeyToAction.get(normalizeShortcut(event.shortcut));
  if (action) {
    handlers[action]();
  }
};

export const syncGlobalShortcuts = async (settings: AppSettings, handlers: ShortcutHandlers): Promise<GlobalShortcutSyncResult> => {
  shortcutKeyToAction.clear();

  try {
    await unregisterAll();
  } catch (error) {
    console.warn('[GlobalShortcut] Failed to unregister shortcuts:', error);
  }

  if (!settings.shortcutsEnabled) {
    return {
      ok: true,
      registered: [],
      failed: [],
    };
  }

  const shortcuts = settings.shortcuts
    .map(shortcut => ({
      action: shortcut.id,
      keys: toTauriShortcut(shortcut.keys),
    }))
    .filter(shortcut => shortcut.keys);

  if (!shortcuts.length) {
    return {
      ok: true,
      registered: [],
      failed: [],
    };
  }

  for (const shortcut of shortcuts) {
    shortcutKeyToAction.set(normalizeShortcut(shortcut.keys), shortcut.action);
  }

  try {
    await register(shortcuts.map(shortcut => shortcut.keys), event => handleShortcutEvent(event, handlers));

    const registered: string[] = [];
    const failed: string[] = [];

    await Promise.all(shortcuts.map(async shortcut => {
      if (await isRegistered(shortcut.keys)) {
        registered.push(shortcut.keys);
      } else {
        failed.push(shortcut.keys);
      }
    }));

    return {
      ok: failed.length === 0,
      registered,
      failed,
    };
  } catch (error) {
    console.error('[GlobalShortcut] Failed to register shortcuts:', error);
    return {
      ok: false,
      registered: [],
      failed: shortcuts.map(shortcut => shortcut.keys),
      error,
    };
  }
};

export const clearGlobalShortcuts = async () => {
  shortcutKeyToAction.clear();
  await unregisterAll();
};
