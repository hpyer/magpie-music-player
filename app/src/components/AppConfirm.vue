<script setup lang="ts">
import type { CSSProperties } from 'vue';

export type ConfirmKind = 'default' | 'danger';

defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  kind?: ConfirmKind;
  themeStyle?: CSSProperties;
  optionLabel?: string;
  optionDescription?: string;
  optionChecked?: boolean;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
  'update:optionChecked': [value: boolean];
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div v-if="open" class="confirm-backdrop" :style="themeStyle" @pointerdown.self="$emit('cancel')">
        <section class="confirm-card" role="alertdialog" aria-modal="true" :aria-label="title">
          <h2>{{ title }}</h2>
          <p>{{ message }}</p>
          <label v-if="optionLabel" class="confirm-option">
            <input
              type="checkbox"
              :checked="optionChecked"
              @change="$emit('update:optionChecked', ($event.target as HTMLInputElement).checked)"
            >
            <span class="switch-track" aria-hidden="true"></span>
            <span class="confirm-option-copy">
              <strong>{{ optionLabel }}</strong>
              <small v-if="optionDescription">{{ optionDescription }}</small>
            </span>
          </label>
          <footer>
            <button type="button" class="confirm-secondary" @click="$emit('cancel')">
              {{ cancelText ?? '取消' }}
            </button>
            <button type="button" class="confirm-primary" :class="kind ?? 'default'" @click="$emit('confirm')">
              {{ confirmText ?? '确定' }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: var(--shadow-padding, 0);
  z-index: 75;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: rgba(8, 16, 18, 0.24);
}

:global(html[data-platform="linux"]) .confirm-backdrop,
:global(html[data-platform="windows"]) .confirm-backdrop {
  border-radius: 0;
}

@supports ((-webkit-backdrop-filter: blur(4px)) or (backdrop-filter: blur(4px))) {
  .confirm-backdrop {
    background: rgba(8, 16, 18, 0.18);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }
}

@supports not ((-webkit-backdrop-filter: blur(4px)) or (backdrop-filter: blur(4px))) {
  .confirm-backdrop {
    background: rgba(8, 16, 18, 0.36);
  }
}

.confirm-card {
  width: min(286px, calc(100vw - 64px));
  display: grid;
  gap: 10px;
  box-sizing: border-box;
  border: 1px solid var(--theme-modal-border, rgba(255, 255, 255, 0.72));
  border-radius: 12px;
  padding: 14px;
  color: var(--ink, #081012);
  background: var(--theme-modal-background, rgba(248, 251, 251, 0.96));
  box-shadow: 0 16px 36px rgba(8, 16, 18, 0.18);
}

.confirm-card h2,
.confirm-card p {
  margin: 0;
}

.confirm-card h2 {
  font-size: 15px;
  line-height: 1.25;
}

.confirm-card p {
  color: var(--muted-ink, rgba(8, 16, 18, 0.68));
  font-size: 12px;
  line-height: 1.45;
}

.confirm-option {
  position: relative;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 7px 8px;
  background: var(--theme-field, rgba(8, 16, 18, 0.08));
  cursor: pointer;
}

.confirm-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.confirm-option .switch-track {
  width: 34px;
  height: 20px;
}

.confirm-option .switch-track::after {
  width: 16px;
  height: 16px;
}

.confirm-option input:checked + .switch-track {
  background: var(--theme-control, #081012);
}

.confirm-option input:checked + .switch-track::after {
  background: var(--theme-control-ink, #ffffff);
  transform: translateX(14px);
}

.confirm-option-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.confirm-option-copy strong {
  color: var(--ink, #081012);
  font-size: 12px;
  line-height: 1.25;
}

.confirm-option-copy small {
  color: var(--muted-ink, rgba(8, 16, 18, 0.68));
  font-size: 11px;
  line-height: 1.3;
}

.confirm-card footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 2px;
}

.confirm-card button {
  height: 34px;
  border: 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.confirm-secondary {
  color: var(--muted-ink, rgba(8, 16, 18, 0.72));
  background: var(--theme-field, rgba(8, 16, 18, 0.08));
}

.confirm-secondary:hover {
  color: var(--ink, #081012);
  background: var(--theme-field-hover, rgba(8, 16, 18, 0.13));
}

.confirm-primary {
  color: var(--theme-control-ink, #ffffff);
  background: var(--theme-control, #081012);
}

.confirm-primary:hover {
  background: var(--theme-control, #05090a);
}

.confirm-primary.danger {
  border: 1px solid color-mix(in srgb, #d92d3a 30%, var(--theme-line, rgba(8, 16, 18, 0.1)));
  color: color-mix(in srgb, #d92d3a 76%, var(--ink, #081012));
  background: color-mix(in srgb, #d92d3a 13%, var(--theme-field, rgba(8, 16, 18, 0.08)));
}

.confirm-primary.danger:hover {
  color: color-mix(in srgb, #d92d3a 86%, var(--ink, #081012));
  background: color-mix(in srgb, #d92d3a 19%, var(--theme-field-hover, rgba(8, 16, 18, 0.13)));
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.16s ease;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
</style>
