'use client'

import { useCallback, useRef, useState } from 'react'
import BenchIcon from './BenchIcon'
import styles from './bench.module.css'

export type BenchToast = {
  id: number
  tone: 'ok' | 'bad' | 'info'
  message: string
}

const AUTO_DISMISS_MS = 5000

/**
 * Bench toasts, local to this app.
 *
 * No provider, no portal, no context: each desk owns the two lines of state it
 * needs, which keeps the whole bench dependency-free apart from React. The one
 * rule that matters here is that a failure does not disappear on its own — an
 * operator who pressed "turn off" and walked away must still find out it did not
 * stick. Successes clear themselves because they need no decision.
 */
export function useBenchToasts() {
  const [toasts, setToasts] = useState<BenchToast[]>([])
  const nextId = useRef(1)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: number) => {
    const timer = timers.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timers.current[id]
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (tone: BenchToast['tone'], message: string) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-3), { id, tone, message }])
      if (tone !== 'bad') {
        timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      }
      return id
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}

export function BenchToasts({
  toasts,
  onDismiss,
}: {
  toasts: BenchToast[]
  onDismiss: (id: number) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${
            toast.tone === 'ok' ? styles.toastOk : toast.tone === 'bad' ? styles.toastBad : styles.toastInfo
          }`}
        >
          <BenchIcon
            className={styles.toastIcon}
            name={toast.tone === 'ok' ? 'check' : toast.tone === 'bad' ? 'alert' : 'info'}
          />
          <span className={styles.toastText}>{toast.message}</span>
          <button
            type="button"
            className={styles.btnIcon}
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            <BenchIcon className={styles.navIcon} name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}