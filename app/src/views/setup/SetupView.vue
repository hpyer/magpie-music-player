<script setup lang="ts">
defineProps<{
  appName: string;
  closeIcon: string;
  minimizeIcon: string;
  settingsIcon: string;
  surfaceThemeStyle: Record<string, string>;
}>();

defineEmits<{
  (event: 'close'): void;
  (event: 'minimize'): void;
  (event: 'open-settings'): void;
  (event: 'create-playlist'): void;
  (event: 'start-window-drag', value: PointerEvent): void;
}>();
</script>

<template>
  <div class="setup-screen" @pointerdown="$emit('start-window-drag', $event)">
    <div class="setup-content app-surface" :style="surfaceThemeStyle">
      <button class="settings-btn" title="设置" aria-label="设置" @click="$emit('open-settings')">
        <img class="svg-icon" :src="settingsIcon" alt="" aria-hidden="true">
      </button>
      <button class="minimize-btn" title="最小化" aria-label="最小化" @click="$emit('minimize')">
        <img class="svg-icon" :src="minimizeIcon" alt="" aria-hidden="true">
      </button>
      <button class="close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
        <img class="svg-icon" :src="closeIcon" alt="" aria-hidden="true">
      </button>

      <div class="setup-copy">
        <span class="setup-kicker">Magpie Music</span>
        <h2>创建播放列表</h2>
        <p>创建第一个播放列表，开始享受音乐</p>
      </div>

      <button class="primary-btn setup-action" @click="$emit('create-playlist')">新建播放列表</button>
      <footer class="app-footnote">{{ appName }}</footer>
    </div>
  </div>
</template>
