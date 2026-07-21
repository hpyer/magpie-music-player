import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';

const STORAGE_KEY_PATH = 'system.bin';
const APP_STORAGE_DIRECTORIES = ['settings', 'library', 'media-assets', 'plugins', 'songs', 'covers', 'lyrics', 'cache'];
const APP_STORAGE_FILES = [STORAGE_KEY_PATH];
const ENCRYPTED_FILE_MAGIC = new TextEncoder().encode('MPJ1');
const ENCRYPTION_IV_BYTES = 12;

const directoryCache = new Set<string>();
let storageKeyPromise: Promise<CryptoKey> | null = null;
let createdStorageKeyInSession = false;

export class AppStorageCorruptionError extends Error {
  constructor(message = '应用配置文件无法解密。') {
    super(message);
    this.name = 'AppStorageCorruptionError';
  }
}

const normalizeDirectory = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

export const ensureStorageDirectory = async (path: string) => {
  if (!path) return;
  if (directoryCache.has(path)) return;

  await mkdir(path, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });
  directoryCache.add(path);
};

const isEncryptedPayload = (bytes: Uint8Array) => (
  bytes.length > ENCRYPTED_FILE_MAGIC.length + ENCRYPTION_IV_BYTES
  && ENCRYPTED_FILE_MAGIC.every((byte, index) => bytes[index] === byte)
);

const concatBytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const importStorageKey = (rawKey: Uint8Array) => (
  crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
);

const loadStorageKey = async () => {
  const keyExists = await exists(STORAGE_KEY_PATH, { baseDir: BaseDirectory.AppData });
  if (keyExists) {
    const rawKey = await readFile(STORAGE_KEY_PATH, { baseDir: BaseDirectory.AppData });
    if (rawKey.byteLength !== 32) {
      throw new AppStorageCorruptionError('应用密钥文件损坏。');
    }
    return importStorageKey(rawKey);
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyDirectory = normalizeDirectory(STORAGE_KEY_PATH);
  if (keyDirectory) {
    await ensureStorageDirectory(keyDirectory);
  }
  await writeFile(STORAGE_KEY_PATH, rawKey, {
    baseDir: BaseDirectory.AppData,
    create: true,
  });
  createdStorageKeyInSession = true;
  return importStorageKey(rawKey);
};

const getStorageKey = () => {
  storageKeyPromise ??= loadStorageKey();
  return storageKeyPromise;
};

const decryptJsonText = async (bytes: Uint8Array) => {
  if (!isEncryptedPayload(bytes)) {
    if (createdStorageKeyInSession) {
      return new TextDecoder().decode(bytes);
    }
    throw new AppStorageCorruptionError('应用配置文件不是加密格式。');
  }

  const ivStart = ENCRYPTED_FILE_MAGIC.length;
  const ivEnd = ivStart + ENCRYPTION_IV_BYTES;
  const iv = bytes.slice(ivStart, ivEnd);
  const ciphertext = bytes.slice(ivEnd);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await getStorageKey(),
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    throw new AppStorageCorruptionError(error instanceof Error ? error.message : String(error));
  }
};

const encryptJsonText = async (content: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getStorageKey(),
    new TextEncoder().encode(content),
  ));
  return concatBytes(ENCRYPTED_FILE_MAGIC, iv, ciphertext);
};

export const readJsonFile = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    const fileExists = await exists(path, { baseDir: BaseDirectory.AppData });
    if (!fileExists) return fallback;

    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData });
    await getStorageKey();
    const content = await decryptJsonText(bytes);
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new AppStorageCorruptionError(error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    if (error instanceof AppStorageCorruptionError) {
      throw error;
    }
    console.warn(`[Storage] Failed to read ${path}:`, error);
    return fallback;
  }
};

export const writeJsonFile = async (path: string, value: unknown) => {
  const directory = normalizeDirectory(path);
  if (directory) {
    await ensureStorageDirectory(directory);
  }

  try {
    const payload = await encryptJsonText(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(path, payload, {
      baseDir: BaseDirectory.AppData,
      create: true,
    });
  } catch (error) {
    console.error(`[Storage] Failed to write ${path}:`, error);
    throw error;
  }
};

export const removeStorageFile = async (path: string) => {
  try {
    if (await exists(path, { baseDir: BaseDirectory.AppData })) {
      await remove(path, { baseDir: BaseDirectory.AppData });
    }
  } catch (error) {
    console.warn(`[Storage] Failed to remove ${path}:`, error);
  }
};

export const resetAppStorage = async () => {
  try {
    await Promise.allSettled(APP_STORAGE_FILES.map(async path => {
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, { baseDir: BaseDirectory.AppData });
      }
    }));

    await Promise.allSettled(APP_STORAGE_DIRECTORIES.map(async path => {
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, {
          baseDir: BaseDirectory.AppData,
          recursive: true,
        });
      }
    }));
  } finally {
    directoryCache.clear();
    storageKeyPromise = null;
    createdStorageKeyInSession = false;
  }
};

export const storagePath = (...parts: string[]) => parts.filter(Boolean).join('/');
