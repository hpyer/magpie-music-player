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
      <div class="form-field">
        <span>播放列表类型</span>
        <div class="type-options" role="radiogroup" aria-label="播放列表类型">
          <button
            v-for="option in playlistTypeOptions"
            :key="option.value"
            type="button"
            class="type-option"
            :class="{ active: playlistForm.type === option.value }"
            :aria-pressed="playlistForm.type === option.value"
            @click="playlistForm.type = option.value"
          >
            <span>{{ option.label }}</span>
          </button>
        </div>
      </div>

      <div class="form-field">
        <span>播放列表名称</span>
        <input v-model="playlistForm.name" type="text" autocomplete="off" placeholder="请输入名称" aria-label="播放列表名称">
      </div>

      <div v-if="isLocalDirectoryPlaylist" class="form-field">
        <span>目录地址</span>
        <div class="directory-input">
          <input v-model="playlistForm.localDir" type="text" readonly placeholder="请选择本地音乐目录" aria-label="目录地址">
          <button type="button" class="secondary-action-btn" @click="$emit('select-playlist-directory')">选择</button>
        </div>
      </div>

      <template v-if="isPluginPlaylist">
        <div class="form-field">
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
        </div>
      </template>

      <div v-if="isLocalDirectoryPlaylist || isPluginPlaylist" class="form-switch">
        <button
          type="button"
          class="switch-button"
          :aria-pressed="playlistForm.scanImmediately"
          :aria-label="isPluginPlaylist ? '立即刷新歌曲' : '立即扫描文件'"
          @click="playlistForm.scanImmediately = !playlistForm.scanImmediately"
        >
          <span class="switch-track" aria-hidden="true"></span>
        </button>
        <span>{{ isPluginPlaylist ? '立即刷新歌曲' : '立即扫描文件' }}</span>
      </div>

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
