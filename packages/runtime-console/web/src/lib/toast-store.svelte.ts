export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

const DURATION_MS = 3_600;

let nextId = 1;
export const toasts: ToastItem[] = $state([]);

function push(kind: ToastKind, message: string): void {
  const id = nextId++;
  toasts.push({ id, kind, message });
  setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, DURATION_MS);
}

export const toast = {
  success(message: string): void {
    push("success", message);
  },
  error(message: string): void {
    push("error", message);
  },
  info(message: string): void {
    push("info", message);
  }
};