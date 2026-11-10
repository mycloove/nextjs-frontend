/**
 * Toast rules (roadmap §5.2) — pure, so timing and queue behaviour are tested
 * without a browser. Info/success leave on their own after 4s; an error
 * never does, because an error the user did not get to read is a lie by
 * omission. The queue keeps the newest few and never drops an error to make
 * room for a success.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export type Toast = {
  id: number
  tone: ToastTone
  message: string
}

export const TOAST_MS = 4000
export const MAX_TOASTS = 3

/** null = stays until dismissed. */
export function toastDuration(tone: ToastTone): number | null {
  return tone === 'error' ? null : TOAST_MS
}

/**
 * Add a toast, keeping at most MAX_TOASTS. When full, the oldest non-error
 * toast leaves first; only when every slot is an error does the oldest error go.
 * An identical message already on screen is not stacked a second time.
 */
export function enqueueToast(queue: readonly Toast[], toast: Toast): Toast[] {
  if (queue.some((item) => item.tone === toast.tone && item.message === toast.message)) return [...queue]
  const next = [...queue, toast]
  while (next.length > MAX_TOASTS) {
    const removable = next.findIndex((item) => item.tone !== 'error' && item.id !== toast.id)
    next.splice(removable === -1 ? 0 : removable, 1)
  }
  return next
}

export function dismissToast(queue: readonly Toast[], id: number): Toast[] {
  return queue.filter((item) => item.id !== id)
}
