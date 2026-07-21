import type { PluginConfigSchema, PluginMessage } from '@magpie-music/plugin-types';

const configSchema: PluginConfigSchema = {
  fields: [],
};

export async function handleMessage(message: PluginMessage) {
  if (message.type === 'installation.config-schema') {
    return configSchema;
  }

  if (message.type === 'runtime.initialize') {
    return { ok: true };
  }

  throw new Error(`Unsupported message type: ${message.type}`);
}
