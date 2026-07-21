import JSZip from 'jszip';
import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { PLUGIN_MANIFEST_FILE, validatePluginManifest } from '../core/pluginRuntime';
import { storagePath } from '../store/appFileStorage';
import type { InstalledPluginSetting } from '../store/appSettingsStore';
import type { PluginConfigField, PluginManifest } from '../types/plugin';

const PLUGIN_STORAGE_ROOT = storagePath('plugins');

const sanitizeRelativePath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new Error(`Invalid plugin package path: ${path}`);
  }
  return parts.join('/');
};

const parentDirectory = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

const pluginStoragePath = (pluginId: string, ...parts: string[]) => (
  storagePath('plugins', pluginId, ...parts)
);

const findManifestEntry = (zip: JSZip) => {
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  return entries.find(entry => entry.name === PLUGIN_MANIFEST_FILE)
    ?? entries.find(entry => entry.name.endsWith(`/${PLUGIN_MANIFEST_FILE}`));
};

const trimManifestRoot = (manifestPath: string) => {
  if (manifestPath === PLUGIN_MANIFEST_FILE) return '';
  return manifestPath.slice(0, -PLUGIN_MANIFEST_FILE.length).replace(/\/+$/, '');
};

const toHexDigest = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const readPackageEntryBytes = async (zip: JSZip, root: string, relativePath: string, label: string) => {
  const path = sanitizeRelativePath(root ? `${root}/${relativePath}` : relativePath);
  const entry = zip.file(path);
  if (!entry) {
    throw new Error(`${label} not found: ${relativePath}`);
  }
  return entry.async('uint8array');
};

const writeZipEntry = async (pluginId: string, relativePath: string, bytes: Uint8Array) => {
  const outputPath = pluginStoragePath(pluginId, relativePath);
  const directory = parentDirectory(outputPath);
  if (directory) {
    await mkdir(directory, { baseDir: BaseDirectory.AppData, recursive: true });
  }
  await writeFile(outputPath, bytes, { baseDir: BaseDirectory.AppData, create: true });
};

const createDefaultConfig = (schema?: PluginConfigField[]) => {
  const config: InstalledPluginSetting['config'] = {};
  for (const field of schema ?? []) {
    if (field.default !== undefined) {
      config[field.key] = field.default;
    }
  }
  return config;
};

const normalizeConfigSchema = (schema: unknown): PluginConfigField[] | undefined => {
  const fields = Array.isArray(schema)
    ? schema
    : (schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : undefined);
  if (!Array.isArray(fields)) return undefined;

  return fields
    .filter(field => (
      field
      && typeof field === 'object'
      && typeof field.key === 'string'
      && typeof field.label === 'string'
      && ['text', 'password', 'url', 'number', 'boolean', 'select'].includes(field.type)
    ))
    .map(field => ({ ...field }));
};

const readConfigSchemaFromEntry = async (moduleSource: string): Promise<PluginConfigField[] | undefined> => {
  const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
  const workerSource = `
    const moduleUrl = ${JSON.stringify(moduleUrl)};
    globalThis.fetch = async () => {
      throw new Error('Network is unavailable while reading plugin config schema.');
    };
    (async () => {
      try {
        const pluginModule = await import(moduleUrl);
        if (typeof pluginModule.handleMessage !== 'function') {
          throw new Error('Plugin module must export handleMessage(message).');
        }
        const result = await pluginModule.handleMessage({ type: 'installation.config-schema' });
        self.postMessage({ ok: true, result });
      } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  `;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));

  try {
    return await new Promise<PluginConfigField[] | undefined>((resolve, reject) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error('Plugin config schema loading timed out.'));
      }, 8000);

      worker.addEventListener('message', event => {
        window.clearTimeout(timeout);
        worker.terminate();
        if (!event.data?.ok) {
          reject(new Error(event.data?.error ?? 'Plugin config schema loading failed.'));
        } else {
          resolve(normalizeConfigSchema(event.data.result));
        }
      }, { once: true });

      worker.addEventListener('error', event => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'Plugin config schema loading failed.'));
      }, { once: true });
    });
  } finally {
    URL.revokeObjectURL(workerUrl);
    URL.revokeObjectURL(moduleUrl);
  }
};

class PluginInstallerService {
  async install(packagePath: string, existing?: InstalledPluginSetting): Promise<InstalledPluginSetting> {
    const packageBytes = await readFile(packagePath);
    const packageHash = await toHexDigest(packageBytes);
    const zip = await JSZip.loadAsync(packageBytes);
    const manifestEntry = findManifestEntry(zip);
    if (!manifestEntry) {
      throw new Error(`${PLUGIN_MANIFEST_FILE} not found in plugin package.`);
    }

    const manifestRoot = trimManifestRoot(manifestEntry.name);
    const manifestText = await manifestEntry.async('string');
    const manifest = JSON.parse(manifestText) as PluginManifest;
    const validation = validatePluginManifest(manifest);
    if (!validation.ok) {
      throw new Error(validation.errors.join('\n'));
    }

    if (manifest.integrity?.algorithm !== 'sha256' || !manifest.integrity.entry) {
      throw new Error('Plugin package must declare a SHA-256 entry hash.');
    }

    const entryBytes = await readPackageEntryBytes(zip, manifestRoot, manifest.entry, 'Plugin entry');
    const entryHash = await toHexDigest(entryBytes);
    if (entryHash !== manifest.integrity.entry) {
      throw new Error(`Plugin entry hash mismatch. Expected ${manifest.integrity.entry}, got ${entryHash}.`);
    }
    const configSchema = await readConfigSchemaFromEntry(new TextDecoder().decode(entryBytes));

    const installDir = pluginStoragePath(manifest.id);
    if (await exists(installDir, { baseDir: BaseDirectory.AppData })) {
      await remove(installDir, { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await mkdir(installDir, { baseDir: BaseDirectory.AppData, recursive: true });

    const prefix = manifestRoot ? `${manifestRoot}/` : '';
    const installedFiles: Record<string, string> = {};
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.startsWith(prefix)) continue;

      const relativePath = sanitizeRelativePath(entry.name.slice(prefix.length));
      const bytes = await entry.async('uint8array');
      installedFiles[relativePath] = await toHexDigest(bytes);
      await writeZipEntry(manifest.id, relativePath, bytes);
    }

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      enabled: existing?.enabled ?? false,
      entry: manifest.entry,
      runtime: manifest.runtime,
      manifest,
      configSchema,
      config: {
        ...createDefaultConfig(configSchema),
        ...(existing?.config ?? {}),
      },
      installedIntegrity: {
        algorithm: 'sha256',
        packageHash,
        files: installedFiles,
      },
    };
  }

  async remove(pluginId: string) {
    const installDir = pluginStoragePath(pluginId);
    if (await exists(installDir, { baseDir: BaseDirectory.AppData })) {
      await remove(installDir, { baseDir: BaseDirectory.AppData, recursive: true });
    }
  }
}

export const pluginInstallerService = new PluginInstallerService();
export { pluginStoragePath, PLUGIN_STORAGE_ROOT };
