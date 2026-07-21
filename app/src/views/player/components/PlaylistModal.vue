<script setup lang="ts">
import AppModal from '../../../components/AppModal.vue';
import AppSelect, { type AppSelectOption } from '../../../components/AppSelect.vue';
import type { PlaylistForm, PlaylistFormType } from '../../../types/ui';

defineProps<{
  closeIcon: string;
  isLoadingPluginPlaylists: boolean;
  isLocalDirectoryPlaylist: boolean;
  isOpen: boolean;
  isPluginPlaylist: boolean;
  isScanning: boolean;
  playlistForm: PlaylistForm;
  playlistFormMode: 'create' | 'edit';
  playlistModalTitle: string;
  playlistTypeOptions: Array<{ value: PlaylistFormType; label: string }>;
  pluginPlaylistPlaceholder: string;
  pluginPlaylistSelectOptions: AppSelectOption[];
  selectedPlaylistPluginId: string;
  trashIcon: string;
}>();

defineEmits<{
  (event: 'close'): void;
  (event: 'load-plugin-playlist-options'): void;
  (event: 'select-playlist-directory'): void;
  (event: 'delete-playlist'): void;
  (event: 'submit'): void;
}>();
</script>

<template>
  <AppModal
    :open="isOpen"
    :title="playlistModalTitle"
    :close-icon="closeIcon"
    @close="$emit('close')"
  >
    <form class="playlist-modal-form" @submit.prevent="$emit('submit')">
      <label class="form-field">
        <span>播放列表名称</span>
        <input v-model="playlistForm.name" type="text" autocomplete="off" placeholder="请输入名称">
      </label>

      <label class="form-field">
        <span>播放列表类型</span>
        <div class="type-options" role="radiogroup" aria-label="播放列表类型">
          <label
            v-for="option in playlistTypeOptions"
            :key="option.value"
            class="type-option"
            :class="{ active: playlistForm.type === option.value }"
          >
            <input v-model="playlistForm.type" type="radio" :value="option.value">
            <span>{{ option.label }}</span>
          </label>
        </div>
      </label>

      <label v-if="isLocalDirectoryPlaylist" class="form-field">
        <span>目录地址</span>
        <div class="directory-input">
          <input v-model="playlistForm.localDir" type="text" readonly placeholder="请选择本地音乐目录">
          <button type="button" class="secondary-action-btn" @click="$emit('select-playlist-directory')">选择</button>
        </div>
      </label>

      <label v-if="isLocalDirectoryPlaylist" class="form-switch">
        <input v-model="playlistForm.scanImmediately" type="checkbox">
        <span class="switch-track" aria-hidden="true"></span>
        <span>立即扫描文件</span>
      </label>

      <template v-if="isPluginPlaylist">
        <label class="form-field">
          <span>远程播放列表</span>
          <div class="directory-input">
            <AppSelect
              v-model="playlistForm.pluginPlaylistId"
              :options="pluginPlaylistSelectOptions"
              :placeholder="pluginPlaylistPlaceholder"
              :disabled="isLoadingPluginPlaylists || !pluginPlaylistSelectOptions.length"
              aria-label="远程播放列表"
            />
            <button type="button" class="secondary-action-btn" :disabled="isLoadingPluginPlaylists || !selectedPlaylistPluginId" @click="$emit('load-plugin-playlist-options')">
              刷新
            </button>
          </div>
        </label>
      </template>

      <footer class="modal-actions playlist-modal-actions" :class="{ 'with-delete': playlistFormMode === 'edit' }">
        <button
          v-if="playlistFormMode === 'edit'"
          type="button"
          class="mini-danger-btn icon-danger-btn playlist-delete-btn"
          title="删除播放列表"
          aria-label="删除播放列表"
          @click="$emit('delete-playlist')"
        >
          <img class="svg-icon" :src="trashIcon" alt="" aria-hidden="true">
        </button>
        <button type="button" class="ghost-action-btn" @click="$emit('close')">取消</button>
        <button type="submit" class="solid-action-btn" :disabled="isScanning">
          {{ isScanning ? '处理中...' : '保存' }}
        </button>
      </footer>
    </form>
  </AppModal>
</template>
