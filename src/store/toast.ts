import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  /** ms ; 0 = persistant */
  duration: number
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, opts?: Partial<Omit<ToastItem, 'id' | 'message'>>) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (message, opts) => {
    const id = nextId++
    set((s) => ({
      toasts: [...s.toasts, { id, message, kind: 'info', duration: 3500, ...opts }],
    }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Raccourci utilisable hors composants : toast('Salut') / toast.success('Bravo') */
export const toast = Object.assign(
  (message: string, opts?: Partial<Omit<ToastItem, 'id' | 'message'>>) =>
    useToasts.getState().show(message, opts),
  {
    success: (message: string, opts?: Partial<Omit<ToastItem, 'id' | 'message'>>) =>
      useToasts.getState().show(message, { kind: 'success', ...opts }),
    error: (message: string, opts?: Partial<Omit<ToastItem, 'id' | 'message'>>) =>
      useToasts.getState().show(message, { kind: 'error', ...opts }),
  },
)
