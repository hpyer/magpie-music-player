<script setup lang="ts">
import AppModal from '../../../components/AppModal.vue';
import type { AppSettings, InstalledPluginSetting, ShortcutSetting, ThemeId } from '../../../store/appSettingsStore';
import type { PluginConfigField } from '../../../types/plugin';
import type { CacheGroup, SettingsTab, ThemeOption } from '../../../types/ui';

defineProps<{
  activeShortcutId: string | null;
  appDescription: string;
  appName: string;
  appVersion: string;
  cacheGroups: CacheGroup[];
  cacheUsageLabel: (groupId: CacheGroup['id']) => string;
  clearingCacheIds: Set<CacheGroup['id']>;
  closeIcon: string;
  expandedPluginIds: Set<string>;
  isInstallingPluginPackage: boolean;
  isCacheSourceConfigurable: (plugin: InstalledPluginSetting) => boolean;
  isCacheSourceAllowed: (sourceId: string) => boolean;
  isOpen: boolean;
  isOpeningAppDataDirectory: boolean;
  isPluginPackageDragActive: boolean;
  pluginCapabilityTags: (plugin: InstalledPluginSetting) => string[];
  pluginConfigFields: (plugin: InstalledPluginSetting) => PluginConfigField[];
  pluginConfigInputType: (field: PluginConfigField) => string;
  settingsDraft: AppSettings;
  settingsTab: SettingsTab;
  settingsTabs: Array<{ value: SettingsTab; label: string }>;
  themeOptions: ThemeOption[];
  trashIcon: string;
}>();

defineEmits<{
  (event: 'begin-shortcut-capture', value: ShortcutSetting['id']): void;
  (event: 'capture-shortcut-key', keyboardEvent: KeyboardEvent, shortcutId: ShortcutSetting['id']): void;
  (event: 'clear-cache-directory', value: CacheGroup['id']): void;
  (event: 'close'): void;
  (event: 'open-app-data-directory'): void;
  (event: 'release-shortcut-key', value: KeyboardEvent): void;
  (event: 'remove-plugin', value: string): void;
  (event: 'restore-shortcut-default', value: ShortcutSetting['id']): void;
  (event: 'save'): void;
  (event: 'select-cache-group-directory', value: CacheGroup['id']): void;
  (event: 'select-plugin-package'): void;
  (event: 'select-theme', value: ThemeId): void;
  (event: 'set-settings-tab', value: SettingsTab): void;
  (event: 'toggle-plugin-expanded', value: string): void;
  (event: 'update-cache-group-limit', groupId: CacheGroup['id'], value: Event): void;
  (event: 'update-cache-source-allowed', sourceId: string, value: boolean): void;
  (event: 'update-favorite-shuffle-weight', value: Event): void;
  (event: 'update-plugin-config-boolean', plugin: InstalledPluginSetting, field: PluginConfigField, value: boolean): void;
  (event: 'update-plugin-config-input', plugin: InstalledPluginSetting, field: PluginConfigField, value: Event): void;
  (event: 'update-plugin-enabled', plugin: InstalledPluginSetting, value: boolean): void;
  (event: 'update-shortcuts-enabled', value: boolean): void;
}>();
</script>

<template>
  <AppModal
    :open="isOpen"
    title="设置"
    size="wide"
    :close-icon="closeIcon"
    @close="$emit('close')"
  >
    <form class="settings-modal-form" @submit.prevent="$emit('save')">
      <div class="settings-layout">
        <aside class="settings-tabs" role="tablist" aria-label="设置分类">
          <button
            v-for="tab in settingsTabs"
            :key="tab.value"
            type="button"
            class="settings-tab"
            :class="{ active: settingsTab === tab.value }"
            @click="$emit('set-settings-tab', tab.value)"
          >
            {{ tab.label }}
          </button>
        </aside>

        <div class="settings-panel">
          <section v-if="settingsTab === 'theme'" class="settings-section">
            <div class="theme-grid">
              <button
                v-for="theme in themeOptions"
                :key="theme.id"
                type="button"
                class="theme-option"
                :class="{ active: settingsDraft.themeId === theme.id }"
                @click="$emit('select-theme', theme.id)"
              >
                <span class="theme-thumb" :style="{ background: theme.background }"></span>
                <span>{{ theme.name }}</span>
              </button>
            </div>
          </section>

          <section v-else-if="settingsTab === 'playback'" class="settings-section">
            <div class="settings-field">
              <span>收藏歌曲随机权重</span>
              <select
                :value="String(settingsDraft.playback.favoriteShuffleWeight)"
                aria-label="收藏歌曲随机权重"
                @change="$emit('update-favorite-shuffle-weight', $event)"
              >
                <option value="1">关闭</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
                <option value="3">3x</option>
              </select>
            </div>
          </section>

          <section v-else-if="settingsTab === 'plugins'" class="settings-section">
            <div class="plugin-install-zone" :class="{ active: isPluginPackageDragActive }">
              <button
                type="button"
                class="plugin-install-btn"
                :disabled="isInstallingPluginPackage"
                @click="$emit('select-plugin-package')"
              >
                <span>{{ isInstallingPluginPackage ? '安装中' : '选择或拖入插件包(.zip)' }}</span>
              </button>
            </div>
            <div v-if="settingsDraft.plugins.length" class="plugin-list">
              <div v-for="plugin in settingsDraft.plugins" :key="plugin.id" class="plugin-card">
                <div class="plugin-row">
                  <span class="plugin-copy">
                    <strong>{{ plugin.name }}</strong>
                    <span class="plugin-meta-row">
                      <span v-for="tag in pluginCapabilityTags(plugin)" :key="tag" class="plugin-capability-tag">{{ tag }}</span>
                      <small>v{{ plugin.version }}</small>
                      <button
                        type="button"
                        class="plugin-switch"
                        :class="{ blocked: plugin.blocked }"
                        :disabled="Boolean(plugin.blocked)"
                        :title="plugin.blocked ? '插件已被阻止' : (plugin.enabled ? '禁用插件' : '启用插件')"
                        :aria-pressed="plugin.enabled"
                        @click="$emit('update-plugin-enabled', plugin, !plugin.enabled)"
                      >
                        <span class="switch-track" aria-hidden="true"></span>
                      </button>
                    </span>
                    <em>{{ plugin.manifest.description || plugin.id }}</em>
                    <em v-if="plugin.blocked" class="plugin-blocked-note">
                      已阻止：{{ plugin.blocked.reason || plugin.blocked.entryId }}
                    </em>
                    <em v-else-if="plugin.warning" class="plugin-warning-note">
                      警告：{{ plugin.warning.reason || plugin.warning.entryId }}
                    </em>
                    <span v-if="isCacheSourceConfigurable(plugin)" class="settings-switch plugin-cache-switch">
                      <button
                        type="button"
                        class="switch-button"
                        :aria-pressed="isCacheSourceAllowed(plugin.id)"
                        aria-label="允许缓存后播放"
                        @click="$emit('update-cache-source-allowed', plugin.id, !isCacheSourceAllowed(plugin.id))"
                      >
                        <span class="switch-track" aria-hidden="true"></span>
                      </button>
                      <span>允许缓存后播放</span>
                    </span>
                  </span>
                  <div class="plugin-card-actions">
                    <button
                      v-if="pluginConfigFields(plugin).length"
                      type="button"
                      class="plugin-expand-btn"
                      :class="{ open: expandedPluginIds.has(plugin.id) }"
                      :aria-expanded="expandedPluginIds.has(plugin.id)"
                      :title="expandedPluginIds.has(plugin.id) ? '收起' : '展开'"
                      :aria-label="expandedPluginIds.has(plugin.id) ? '收起插件详情' : '展开插件详情'"
                      @click="$emit('toggle-plugin-expanded', plugin.id)"
                    >
                      <span class="plugin-chevron" aria-hidden="true"></span>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  class="mini-danger-btn icon-danger-btn plugin-remove-btn"
                  title="删除插件"
                  aria-label="删除插件"
                  @click="$emit('remove-plugin', plugin.id)"
                >
                  <img class="svg-icon" :src="trashIcon" alt="" aria-hidden="true">
                </button>
                <div v-if="pluginConfigFields(plugin).length && expandedPluginIds.has(plugin.id)" class="plugin-details">
                  <div class="plugin-config-grid">
                    <template v-for="field in pluginConfigFields(plugin)" :key="field.key">
                      <div v-if="field.type === 'boolean'" class="form-switch plugin-config-switch">
                        <button
                          type="button"
                          class="switch-button"
                          :aria-pressed="Boolean(plugin.config[field.key] ?? field.default)"
                          :aria-label="field.label"
                          @click="$emit('update-plugin-config-boolean', plugin, field, !Boolean(plugin.config[field.key] ?? field.default))"
                        >
                          <span class="switch-track" aria-hidden="true"></span>
                        </button>
                        <span>{{ field.label }}</span>
                      </div>
                      <div v-else class="settings-field compact">
                        <span>{{ field.label }}{{ field.required ? ' *' : '' }}</span>
                        <select
                          v-if="field.type === 'select'"
                          :value="String(plugin.config[field.key] ?? field.default ?? '')"
                          @change="$emit('update-plugin-config-input', plugin, field, $event)"
                        >
                          <option value="">请选择</option>
                          <option v-for="option in field.options ?? []" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                        <input
                          v-else
                          :value="String(plugin.config[field.key] ?? field.default ?? '')"
                          :type="pluginConfigInputType(field)"
                          :placeholder="field.placeholder"
                          :autocomplete="field.type === 'password' ? 'current-password' : 'off'"
                          @input="$emit('update-plugin-config-input', plugin, field, $event)"
                        >
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="settings-empty">暂无插件</p>
          </section>

          <section v-else-if="settingsTab === 'shortcuts'" class="settings-section">
            <div class="settings-switch">
              <button
                type="button"
                class="switch-button"
                :aria-pressed="settingsDraft.shortcutsEnabled"
                aria-label="启用全局快捷键"
                @click="$emit('update-shortcuts-enabled', !settingsDraft.shortcutsEnabled)"
              >
                <span class="switch-track" aria-hidden="true"></span>
              </button>
              <span>启用全局快捷键</span>
            </div>
            <div v-for="shortcut in settingsDraft.shortcuts" :key="shortcut.id" class="settings-field">
              <span>{{ shortcut.name }}</span>
              <input
                v-model="shortcut.keys"
                type="text"
                autocomplete="off"
                readonly
                :disabled="!settingsDraft.shortcutsEnabled"
                :placeholder="activeShortcutId === shortcut.id ? '按下快捷键' : '未设置'"
                @focus="$emit('begin-shortcut-capture', shortcut.id)"
                @click="$emit('begin-shortcut-capture', shortcut.id)"
                @keydown="$emit('capture-shortcut-key', $event, shortcut.id)"
                @keyup="$emit('release-shortcut-key', $event)"
                @blur="$emit('restore-shortcut-default', shortcut.id)"
              >
            </div>
          </section>

          <section v-else-if="settingsTab === 'cache'" class="settings-section">
            <div v-for="group in cacheGroups" :key="group.id" class="cache-group">
              <h3>{{ group.title }}</h3>
              <div class="settings-field">
                <div class="directory-input">
                  <input :value="group.directory" type="text" readonly :aria-label="`${group.title}目录`">
                  <button type="button" class="secondary-action-btn" @click="$emit('select-cache-group-directory', group.id)">选择</button>
                </div>
              </div>
              <div class="settings-field cache-limit-field">
                <span>容量上限 (GB)</span>
                <div class="cache-limit-row">
                  <input
                    :value="group.limitGb"
                    type="number"
                    min="0.1"
                    max="50"
                    step="0.1"
                    title="容量上限 (GB)"
                    aria-label="容量上限 (GB)"
                    @input="$emit('update-cache-group-limit', group.id, $event)"
                  >
                </div>
              </div>
              <div class="cache-actions-row">
                <span class="cache-usage">已用 {{ cacheUsageLabel(group.id) }}</span>
                <button
                  type="button"
                  class="mini-danger-btn icon-danger-btn cache-clear-btn"
                  :disabled="clearingCacheIds.has(group.id)"
                  :title="clearingCacheIds.has(group.id) ? '清理中' : '清除缓存'"
                  :aria-label="clearingCacheIds.has(group.id) ? '清理中' : '清除缓存'"
                  @click="$emit('clear-cache-directory', group.id)"
                >
                  <img class="svg-icon" :src="trashIcon" alt="" aria-hidden="true">
                </button>
              </div>
            </div>
          </section>

          <section v-else class="settings-section about-section">
            <div class="about-card">
              <div class="about-heading">
                <strong>{{ appName }}</strong>
              </div>
              <p>{{ appDescription }}</p>
            </div>

            <div class="about-info-list">
              <div class="about-info-row">
                <span>当前版本</span>
                <strong>v{{ appVersion }}</strong>
              </div>
              <div class="about-info-row">
                <span>核心能力</span>
                <strong>本地播放、插件扩展、歌词与封面检索</strong>
              </div>
            </div>

            <button
              type="button"
              class="secondary-action-btn app-data-directory-btn"
              :disabled="isOpeningAppDataDirectory"
              @click="$emit('open-app-data-directory')"
            >
              {{ isOpeningAppDataDirectory ? '打开中' : '打开应用数据目录' }}
            </button>
          </section>
        </div>
      </div>

      <footer class="modal-actions">
        <button type="button" class="ghost-action-btn" @click="$emit('close')">取消</button>
        <button type="submit" class="solid-action-btn">保存</button>
      </footer>
    </form>
  </AppModal>
</template>
