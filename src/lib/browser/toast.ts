import { create } from "zustand";

export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

type ToastState = { toast: Toast | null; show: (text: string, action?: Toast["action"]) => void; hide: () => void };

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (text, action) => {
    clearTimeout(timer);
    set({ toast: { id: Date.now(), text, action } });
    timer = setTimeout(() => set({ toast: null }), action ? 4500 : 2600);
  },
  hide: () => {
    clearTimeout(timer);
    set({ toast: null });
  },
}));

export const toast = (text: string, action?: Toast["action"]) => useToast.getState().show(text, action);
