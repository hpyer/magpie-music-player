<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  closeIcon: string;
  size?: 'default' | 'wide';
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <transition name="modal">
    <div v-if="open" class="modal-backdrop" @pointerdown.stop>
      <section class="app-modal" :class="`size-${size ?? 'default'}`" role="dialog" aria-modal="true" :aria-label="title">
        <header class="modal-header">
          <h2>{{ title }}</h2>
          <button type="button" class="modal-close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
            <img class="modal-close-icon" :src="closeIcon" alt="" aria-hidden="true">
          </button>
        </header>

        <slot />
      </section>
    </div>
  </transition>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: var(--shadow-padding);
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 16px;
  background: rgba(6, 14, 16, 0.28);
  overflow: hidden;
}

:global(html[data-platform="linux"]) .modal-backdrop,
:global(html[data-platform="windows"]) .modal-backdrop {
  border-radius: 0;
}

@supports ((-webkit-backdrop-filter: blur(4px)) or (backdrop-filter: blur(4px))) {
  .modal-backdrop {
    background: rgba(6, 14, 16, 0.2);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }
}

@supports not ((-webkit-backdrop-filter: blur(4px)) or (backdrop-filter: blur(4px))) {
  .modal-backdrop {
    background: rgba(6, 14, 16, 0.38);
  }
}

.app-modal {
  width: 100%;
  max-width: 288px;
  max-height: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  padding: 12px;
  color: var(--ink, #081012);
  background: var(--theme-modal-background, #f8fbfb);
  border: 1px solid var(--theme-modal-border, rgba(255, 255, 255, 0.74));
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.2);
  overflow: auto;
}

.app-modal.size-wide {
  max-width: 324px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
}

.modal-close-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--muted-ink, rgba(8, 16, 18, 0.72));
  background: transparent;
  cursor: pointer;
  transition: background 0.16s ease;
}

.modal-close-btn:hover {
  background: var(--theme-field-hover, rgba(8, 16, 18, 0.08));
}

.modal-close-icon {
  display: block;
  width: 15px;
  height: 15px;
  object-fit: contain;
  filter: var(--theme-icon-filter, brightness(0) saturate(100%));
  pointer-events: none;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .app-modal,
.modal-leave-active .app-modal {
  transition: transform 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .app-modal,
.modal-leave-to .app-modal {
  transform: translateY(8px) scale(0.98);
}
</style>
