import { PluginManifest, PluginRuntime } from '../types/plugin';

export const PLUGIN_PACKAGE_EXTENSION = '.zip';
export const PLUGIN_MANIFEST_FILE = 'plugin.json';

export const SUPPORTED_PLUGIN_SCHEMA_VERSION = 1;

export const SUPPORTED_PLUGIN_RUNTIMES: readonly PluginRuntime[] = [
  'wasm-wasi',
  'web-worker-esm',
];

export interface PluginManifestValidationResult {
  ok: boolean;
  errors: string[];
}

export function isSupportedPluginRuntime(runtime: string): runtime is PluginRuntime {
  return SUPPORTED_PLUGIN_RUNTIMES.includes(runtime as PluginRuntime);
}

export function validatePluginManifest(manifest: PluginManifest): PluginManifestValidationResult {
  const errors: string[] = [];

  if (manifest.schemaVersion !== SUPPORTED_PLUGIN_SCHEMA_VERSION) {
    errors.push(`Unsupported plugin schema version: ${manifest.schemaVersion}`);
  }

  if (!manifest.id.trim()) errors.push('Plugin id is required.');
  if (!manifest.name.trim()) errors.push('Plugin name is required.');
  if (!manifest.version.trim()) errors.push('Plugin version is required.');
  if (!manifest.entry.trim()) errors.push('Plugin entry is required.');
  if (!isSupportedPluginRuntime(manifest.runtime)) {
    errors.push(`Unsupported plugin runtime: ${manifest.runtime}`);
  }

  if (manifest.permissions.includes('network:request') && !manifest.networkAllowlist?.length) {
    errors.push('Network plugins must declare a networkAllowlist.');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
