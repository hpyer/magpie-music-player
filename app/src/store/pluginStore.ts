import { defineStore } from 'pinia';
import { Plugin, SearchResult } from '../types/plugin';
import { pluginManager, type RegisterPluginOptions } from '../core/pluginManager';

export const usePluginStore = defineStore('plugin', {
  state: () => ({
    plugins: [] as Plugin[],
    searchResults: {} as Record<string, SearchResult>,
    isSearching: false,
  }),
  actions: {
    loadPlugins() {
      this.plugins = pluginManager.getAllPlugins();
    },
    async search(query: string) {
      this.isSearching = true;
      try {
        this.searchResults = await pluginManager.searchAll(query);
      } finally {
        this.isSearching = false;
      }
    },
    registerPlugin(plugin: Plugin, options: RegisterPluginOptions) {
      pluginManager.register(plugin, options);
      this.loadPlugins();
    },
    unregisterPlugin(pluginId: string) {
      pluginManager.unregister(pluginId);
      this.loadPlugins();
    }
  }
});
