/** @type {import('@magpie-music/plugin-types').PluginConfigSchema} */
const configSchema = {
  fields: [],
};

/** @param {import('@magpie-music/plugin-types').PluginMessage} message */
export async function handleMessage(message) {
  if (message.type === 'installation.config-schema') {
    return configSchema;
  }

  if (message.type === 'runtime.initialize') {
    return { ok: true };
  }

  throw new Error(`Unsupported message type: ${message.type}`);
}
