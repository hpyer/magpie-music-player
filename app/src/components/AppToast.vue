<script setup lang="ts">
import type { CSSProperties } from 'vue';

export interface ToastItem {
  id: number;
  title: string;
  message: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  durationMs: number;
  remainingMs: number;
  expiresAt: number;
  isPaused: boolean;
}

defineProps<{
  toasts: ToastItem[];
  themeStyle?: CSSProperties;
}>();

defineEmits<{
  dismiss: [id: number];
  pause: [id: number];
  resume: [id: number];
}>();

const remainingSeconds = (toast: ToastItem) => Math.max(1, Math.ceil(toast.remainingMs / 1000));
</script>

<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-stack" :style="themeStyle" aria-live="polite" aria-atomic="true">
      <article
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="toast.kind"
        @focusin="$emit('pause', toast.id)"
        @focusout="$emit('resume', toast.id)"
        @pointerenter="$emit('pause', toast.id)"
        @pointerleave="$emit('resume', toast.id)"
      >
        <button
          type="button"
          class="toast-close-btn toast-timer-close"
          title="关闭"
          aria-label="关闭通知"
          @click="$emit('dismiss', toast.id)"
        >
          <span class="toast-timer" aria-hidden="true">{{ remainingSeconds(toast) }}s</span>
          <span class="toast-close-mark" aria-hidden="true">×</span>
        </button>
        <strong>{{ toast.title }}</strong>
        <span class="toast-message">{{ toast.message }}</span>
      </article>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  left: 50%;
  top: calc(var(--shadow-padding, 0px) + 14px);
  z-index: 80;
  width: min(292px, calc(100vw - 40px));
  display: grid;
  gap: 6px;
  transform: translateX(-50%);
  pointer-events: none;
}

.toast-item {
  --toast-accent: #081012;
  --toast-border: var(--theme-modal-border, rgba(8, 16, 18, 0.1));
  --toast-bg: var(--theme-modal-background, rgba(248, 251, 251, 0.95));

  min-width: 0;
  display: grid;
  position: relative;
  gap: 3px;
  overflow: hidden;
  border: 1px solid var(--toast-border);
  border-radius: 9px;
  padding: 9px 52px 9px 14px;
  color: var(--ink, #081012);
  background: var(--toast-bg);
  box-shadow: 0 10px 26px rgba(8, 16, 18, 0.16);
  backdrop-filter: blur(14px);
  text-align: left;
  pointer-events: auto;
}

.toast-item::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--toast-accent);
  content: "";
}

.toast-item.success {
  --toast-accent: #16a34a;
  --toast-border: rgba(22, 163, 74, 0.26);
  --toast-bg: rgba(240, 253, 244, 0.96);
  color: #081012;
}

.toast-item.warning::before {
  background: var(--toast-accent);
}

.toast-item.warning {
  --toast-accent: #f59e0b;
  --toast-border: rgba(245, 158, 11, 0.34);
  --toast-bg: rgba(255, 251, 235, 0.96);
  color: #081012;
}

.toast-item.error::before {
  background: var(--toast-accent);
}

.toast-item.error {
  --toast-accent: #dc2626;
  --toast-border: rgba(220, 38, 38, 0.28);
  --toast-bg: rgba(254, 242, 242, 0.96);
  color: #081012;
}

.toast-close-btn {
  position: absolute;
  top: 6px;
  right: 7px;
  min-width: 40px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  padding: 0 6px;
  color: currentColor;
  background: transparent;
  cursor: pointer;
  opacity: 0.58;
  transition: background 0.16s ease, opacity 0.16s ease;
}

.toast-close-btn:hover,
.toast-close-btn:focus-visible {
  background: rgba(8, 16, 18, 0.1);
  opacity: 1;
}

.toast-timer {
  color: currentColor;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  opacity: 0.74;
}

.toast-close-mark {
  color: currentColor;
  font-size: 17px;
  line-height: 1;
}

.toast-item strong {
  font-size: 12px;
  line-height: 1.25;
  font-weight: 600;
}

.toast-message {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.35;
  color: var(--muted-ink, rgba(8, 16, 18, 0.68));
}

.toast-item.success .toast-message,
.toast-item.warning .toast-message,
.toast-item.error .toast-message {
  color: rgba(8, 16, 18, 0.68);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.16s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
