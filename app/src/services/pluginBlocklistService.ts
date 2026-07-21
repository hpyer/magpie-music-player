import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type {
  InstalledPluginBlock,
  InstalledPluginSetting,
  InstalledPluginWarning,
  PluginBlocklistDocument,
  PluginBlocklistEntry,
  PluginBlocklistSettings,
} from '../store/appSettingsStore';

export interface PluginBlocklistRefreshResult {
  settings: PluginBlocklistSettings;
  document?: PluginBlocklistDocument;
  changed: boolean;
  error?: string;
  errorKind?: 'network' | 'signature' | 'document';
}

export interface PluginBlocklistMatch {
  pluginId: string;
  pluginName: string;
  block: InstalledPluginBlock;
}

export interface PluginBlocklistWarningMatch {
  pluginId: string;
  pluginName: string;
  warning: InstalledPluginWarning;
}

const textEncoder = new TextEncoder();

const normalizeBase64 = (value: string) => {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
};

const decodeBase64 = (value: string) => {
  const binary = atob(normalizeBase64(value));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

const signatureFromText = (text: string) => {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as { signature?: unknown };
    if (typeof parsed.signature === 'string') return parsed.signature;
  } catch {
    // Plain signature files are supported too.
  }
  return trimmed;
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const readJsonResponse = async <T>(url: string): Promise<{ text: string; json: T }> => {
  const response = await tauriFetch(url, { connectTimeout: 15000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) as T };
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readTextResponse = async (url: string) => {
  const response = await tauriFetch(url, { connectTimeout: 15000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const validateDocument = (document: PluginBlocklistDocument) => {
  if (document.version !== 1) {
    throw new Error(`Unsupported plugin blocklist version: ${document.version}`);
  }
  if (typeof document.updatedAt !== 'string' || !Array.isArray(document.entries)) {
    throw new Error('Invalid plugin blocklist document.');
  }
};

const verifySignature = async (payload: string, signatureText: string, publicKeyJwk: JsonWebKey) => {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signature = decodeBase64(signatureFromText(signatureText));
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      textEncoder.encode(payload),
    );
    if (!ok) {
      throw new Error('signature mismatch');
    }
  } catch (error) {
    throw new Error(`Plugin blocklist signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const shouldRefresh = (settings: PluginBlocklistSettings) => {
  if (!settings.cached || !settings.lastCheckedAt) return true;
  const intervalMs = settings.refreshIntervalHours * 60 * 60 * 1000;
  return Date.now() - settings.lastCheckedAt >= intervalMs;
};

const refreshErrorKind = (error: unknown): PluginBlocklistRefreshResult['errorKind'] => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('signature verification failed')) return 'signature';
  if (message.includes('Invalid JSON') || message.includes('Invalid plugin blocklist') || message.includes('Unsupported plugin blocklist')) {
    return 'document';
  }
  return 'network';
};

const blocklistCandidates = (settings: PluginBlocklistSettings) => {
  const urls = Array.from(new Set(
    (settings.urls?.length ? settings.urls : [settings.url])
      .filter(value => typeof value === 'string' && value.trim())
      .map(value => value.trim()),
  ));

  return urls.map((url, index) => ({
    url,
    signatureUrl: settings.signatureUrls?.[index]?.trim()
      || (index === 0 ? settings.signatureUrl?.trim() : undefined)
      || `${url}.sig`,
  }));
};

const entrySeverity = (entry: PluginBlocklistEntry) => entry.severity ?? 'block';

const includes = (values: string[] | undefined, value: string | undefined) => (
  Boolean(value && values?.includes(value))
);

const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const pluginNetworkOrigins = (plugin: InstalledPluginSetting) => (
  (plugin.manifest.networkAllowlist ?? [])
    .map(allowItem => {
      if (allowItem.startsWith('user-configured:')) {
        const key = allowItem.slice('user-configured:'.length);
        const configured = plugin.config[key];
        return typeof configured === 'string' ? normalizeOrigin(configured) : '';
      }
      return normalizeOrigin(allowItem);
    })
    .filter(Boolean)
);

const matchEntry = (plugin: InstalledPluginSetting, entry: PluginBlocklistEntry): string | undefined => {
  if (includes(entry.pluginIds, plugin.id)) return 'plugin id';
  if (includes(entry.signerIds, plugin.manifest.integrity?.signer)) return 'signer id';
  if (includes(entry.packageHashes, plugin.installedIntegrity?.packageHash)) return 'package hash';

  const entryHashes = [
    plugin.manifest.integrity?.entry,
    plugin.installedIntegrity?.files?.[plugin.entry],
  ].filter(Boolean) as string[];
  if (entry.entryHashes?.some(hash => entryHashes.includes(hash))) return 'entry hash';

  const origins = pluginNetworkOrigins(plugin);
  if (entry.networkOrigins?.some(origin => origins.includes(normalizeOrigin(origin)))) {
    return 'network origin';
  }

  return undefined;
};

class PluginBlocklistService {
  async refresh(settings: PluginBlocklistSettings): Promise<PluginBlocklistRefreshResult> {
    const candidates = blocklistCandidates(settings);

    if (!settings.enabled || !candidates.length) {
      return { settings, changed: false };
    }

    if (!settings.publicKeyJwk) {
      return {
        settings,
        document: settings.cached,
        changed: false,
      };
    }

    if (!shouldRefresh(settings)) {
      return { settings, document: settings.cached, changed: false };
    }

    try {
      const errors: string[] = [];
      const errorKinds = new Set<PluginBlocklistRefreshResult['errorKind']>();

      for (const candidate of candidates) {
        try {
          const [{ text, json }, signatureText] = await Promise.all([
            readJsonResponse<PluginBlocklistDocument>(candidate.url),
            readTextResponse(candidate.signatureUrl),
          ]);
          await verifySignature(text, signatureText, settings.publicKeyJwk);
          validateDocument(json);

          const nextSettings = {
            ...settings,
            url: candidate.url,
            lastCheckedAt: Date.now(),
            cached: json,
          };
          return {
            settings: nextSettings,
            document: json,
            changed: !sameJson(nextSettings, settings),
          };
        } catch (error) {
          errorKinds.add(refreshErrorKind(error));
          errors.push(`${candidate.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const aggregateError = new Error(errors.join('\n'));
      const kind: PluginBlocklistRefreshResult['errorKind'] = errorKinds.has('signature')
        ? 'signature'
        : (errorKinds.has('document') ? 'document' : 'network');
      Object.assign(aggregateError, { kind });
      throw aggregateError;
    } catch (error) {
      const nextSettings = {
        ...settings,
        lastCheckedAt: Date.now(),
      };
      return {
        settings: nextSettings,
        document: settings.cached,
        changed: !sameJson(nextSettings, settings),
        error: error instanceof Error ? error.message : String(error),
        errorKind: error && typeof error === 'object' && 'kind' in error
          ? (error as { kind?: PluginBlocklistRefreshResult['errorKind'] }).kind
          : refreshErrorKind(error),
      };
    }
  }

  matchPlugin(plugin: InstalledPluginSetting, document?: PluginBlocklistDocument): PluginBlocklistMatch | undefined {
    if (!document) return undefined;

    for (const entry of document.entries) {
      if (entrySeverity(entry) !== 'block') continue;
      const matchedBy = matchEntry(plugin, entry);
      if (!matchedBy) continue;

      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        block: {
          entryId: entry.id,
          reason: entry.reason,
          detailsUrl: entry.detailsUrl,
          matchedBy,
          blockedAt: Date.now(),
        },
      };
    }

    return undefined;
  }

  matchPluginWarning(plugin: InstalledPluginSetting, document?: PluginBlocklistDocument): PluginBlocklistWarningMatch | undefined {
    if (!document) return undefined;

    for (const entry of document.entries) {
      if (entrySeverity(entry) !== 'warn') continue;
      const matchedBy = matchEntry(plugin, entry);
      if (!matchedBy) continue;

      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        warning: {
          entryId: entry.id,
          reason: entry.reason,
          detailsUrl: entry.detailsUrl,
          matchedBy,
          warnedAt: Date.now(),
        },
      };
    }

    return undefined;
  }

  matchPlugins(plugins: InstalledPluginSetting[], document?: PluginBlocklistDocument): PluginBlocklistMatch[] {
    return plugins
      .map(plugin => this.matchPlugin(plugin, document))
      .filter(Boolean) as PluginBlocklistMatch[];
  }

  matchPluginWarnings(plugins: InstalledPluginSetting[], document?: PluginBlocklistDocument): PluginBlocklistWarningMatch[] {
    return plugins
      .map(plugin => this.matchPluginWarning(plugin, document))
      .filter(Boolean) as PluginBlocklistWarningMatch[];
  }
}

export const pluginBlocklistService = new PluginBlocklistService();
