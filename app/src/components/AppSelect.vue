<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface AppSelectOption {
  value: string;
  label: string;
  meta?: string;
}

const props = withDefaults(defineProps<{
  modelValue: string | null;
  options: AppSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>(), {
  placeholder: '请选择',
  disabled: false,
  ariaLabel: '下拉选择',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  select: [value: string];
}>();

const root = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue) ?? null);

const close = () => {
  isOpen.value = false;
};

const toggle = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
};

const selectOption = (value: string) => {
  close();
  emit('update:modelValue', value);
  emit('select', value);
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node)) {
    close();
  }
};

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
});
</script>

<template>
  <div ref="root" class="app-select" :class="{ open: isOpen, disabled }">
    <button
      type="button"
      class="app-select-trigger"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-expanded="isOpen"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="app-select-value" :class="{ placeholder: !selectedOption }">
        {{ selectedOption?.label ?? placeholder }}
      </span>
      <small v-if="selectedOption?.meta" class="app-select-meta">{{ selectedOption.meta }}</small>
      <span class="app-select-chevron" aria-hidden="true"></span>
    </button>

    <transition name="app-select-menu">
      <div v-if="isOpen" class="app-select-menu" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="app-select-option"
          :class="{ active: option.value === modelValue }"
          role="option"
          :aria-selected="option.value === modelValue"
          @click="selectOption(option.value)"
        >
          <span>{{ option.label }}</span>
          <small v-if="option.meta">{{ option.meta }}</small>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  min-width: 0;
}

.app-select-trigger {
  position: relative;
  width: 100%;
  height: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 0;
  border-radius: 7px;
  padding: 0 34px 0 8px;
  color: var(--ink, #081012);
  background: var(--theme-field, rgba(255, 255, 255, 0.34));
  outline: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.16s ease, color 0.16s ease;
}

.app-select-trigger:hover,
.app-select.open .app-select-trigger {
  background: var(--theme-field-hover, rgba(255, 255, 255, 0.48));
}

.app-select-trigger:disabled {
  cursor: default;
  opacity: 0.62;
}

.app-select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-select-value.placeholder {
  color: var(--muted-ink, rgba(8, 16, 18, 0.58));
}

.app-select-meta,
.app-select-option small {
  font-size: 11px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  opacity: 0.72;
}

.app-select-chevron {
  position: absolute;
  right: 14px;
  top: 50%;
  width: 10px;
  height: 10px;
  transform: translateY(-50%) rotate(0deg);
  transform-origin: center;
  opacity: 0.86;
  transition: transform 0.18s ease;
}

.app-select-chevron::before {
  content: '';
  position: absolute;
  inset: 1px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg) translate(-1px, -1px);
  transform-origin: center;
}

.app-select.open .app-select-chevron {
  transform: translateY(-50%) rotate(180deg);
}

.app-select-menu {
  position: absolute;
  z-index: 6;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 210px;
  overflow: auto;
  display: grid;
  gap: 2px;
  border: 1px solid var(--theme-line, rgba(8, 16, 18, 0.1));
  border-radius: 9px;
  padding: 4px;
  background: var(--theme-modal-background, rgba(248, 251, 251, 0.96));
  box-shadow: 0 12px 28px rgba(8, 16, 18, 0.18);
  backdrop-filter: blur(14px);
  transform-origin: top center;
}

.app-select-menu-enter-active,
.app-select-menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.app-select-menu-enter-from,
.app-select-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scaleY(0.98);
}

.app-select-menu-enter-to,
.app-select-menu-leave-from {
  opacity: 1;
  transform: translateY(0) scaleY(1);
}

.app-select-option {
  min-width: 0;
  height: 30px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 7px;
  padding: 0 8px;
  color: var(--muted-ink, rgba(8, 16, 18, 0.72));
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  transition: background 0.16s ease, color 0.16s ease;
}

.app-select-option:hover {
  color: var(--ink, #081012);
  background: var(--theme-field-hover, rgba(8, 16, 18, 0.08));
}

.app-select-option.active {
  color: var(--theme-control-ink, #ffffff);
  background: var(--theme-control, #081012);
}

.app-select-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
