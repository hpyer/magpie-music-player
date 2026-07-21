import { ref } from 'vue';
import type { ConfirmKind } from '../components/AppConfirm.vue';
import type { ToastItem } from '../components/AppToast.vue';

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  kind: ConfirmKind;
  optionLabel?: string;
  optionDescription?: string;
  optionChecked: boolean;
  resolve?: (value: boolean) => void;
  resolveWithOption?: (value: { confirmed: boolean; optionChecked: boolean }) => void;
}

export const useAppFeedback = () => {
  const toasts = ref<ToastItem[]>([]);
  const confirmDialog = ref<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    kind: 'default',
    optionChecked: false,
  });
  let nextToastId = 1;
  let toastTickTimer: number | undefined;

  const stopToastTickerIfIdle = () => {
    if (toasts.value.length || toastTickTimer === undefined) return;

    window.clearInterval(toastTickTimer);
    toastTickTimer = undefined;
  };

  const tickToasts = () => {
    const now = Date.now();
    const nextToasts = toasts.value.flatMap(toast => {
      if (toast.isPaused) return [toast];

      const remainingMs = Math.max(0, toast.expiresAt - now);
      if (remainingMs <= 0) return [];

      return [{
        ...toast,
        remainingMs,
      }];
    });

    toasts.value = nextToasts;
    stopToastTickerIfIdle();
  };

  const ensureToastTicker = () => {
    if (toastTickTimer !== undefined) return;
    toastTickTimer = window.setInterval(tickToasts, 250);
  };

  const dismissToast = (id: number) => {
    toasts.value = toasts.value.filter(toast => toast.id !== id);
    stopToastTickerIfIdle();
  };

  const pauseToast = (id: number) => {
    const now = Date.now();
    toasts.value = toasts.value.map(toast => (
      toast.id === id && !toast.isPaused
        ? {
            ...toast,
            isPaused: true,
            remainingMs: Math.max(0, toast.expiresAt - now),
          }
        : toast
    ));
  };

  const resumeToast = (id: number) => {
    const now = Date.now();
    toasts.value = toasts.value.map(toast => (
      toast.id === id && toast.isPaused
        ? {
            ...toast,
            isPaused: false,
            expiresAt: now + Math.max(0, toast.remainingMs),
          }
        : toast
    ));
    ensureToastTicker();
  };

  const showToast = (
    message: string,
    options: { title?: string; kind?: ToastItem['kind']; duration?: number } = {},
  ) => {
    const id = nextToastId;
    nextToastId += 1;
    const durationMs = options.duration ?? (options.kind === 'error' ? 5200 : 3600);
    const now = Date.now();
    const toast: ToastItem = {
      id,
      title: options.title ?? '提示',
      message,
      kind: options.kind ?? 'info',
      durationMs,
      remainingMs: durationMs,
      expiresAt: now + durationMs,
      isPaused: false,
    };

    toasts.value = [...toasts.value.slice(-3), toast];
    ensureToastTicker();
  };

  const requestConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    kind?: ConfirmKind;
  }) => new Promise<boolean>(resolve => {
    confirmDialog.value = {
      open: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      kind: options.kind ?? 'default',
      optionChecked: false,
      resolve,
    };
  });

  const requestConfirmWithOption = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    kind?: ConfirmKind;
    optionLabel: string;
    optionDescription?: string;
    optionChecked?: boolean;
  }) => new Promise<{ confirmed: boolean; optionChecked: boolean }>(resolve => {
    confirmDialog.value = {
      open: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      kind: options.kind ?? 'default',
      optionLabel: options.optionLabel,
      optionDescription: options.optionDescription,
      optionChecked: options.optionChecked ?? false,
      resolveWithOption: resolve,
    };
  });

  const updateConfirmOptionChecked = (value: boolean) => {
    confirmDialog.value = {
      ...confirmDialog.value,
      optionChecked: value,
    };
  };

  const closeConfirmDialog = (value: boolean) => {
    confirmDialog.value.resolveWithOption?.({
      confirmed: value,
      optionChecked: confirmDialog.value.optionChecked,
    });
    confirmDialog.value.resolve?.(value);
    confirmDialog.value = {
      ...confirmDialog.value,
      open: false,
      optionLabel: undefined,
      optionDescription: undefined,
      optionChecked: false,
      resolve: undefined,
      resolveWithOption: undefined,
    };
  };

  return {
    closeConfirmDialog,
    confirmDialog,
    dismissToast,
    pauseToast,
    requestConfirm,
    requestConfirmWithOption,
    resumeToast,
    showToast,
    toasts,
    updateConfirmOptionChecked,
  };
};
