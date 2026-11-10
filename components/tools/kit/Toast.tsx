'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './kit.module.css'
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons'
import { dismissToast, enqueueToast, toastDuration, type Toast, type ToastTone } from './toastRules'

/**
 * Toasts for events that have no inline home (roadmap §5.2): "Copied", "Saved
 * again", a background failure. A tool owns its queue through this hook — no
 * global store (CLAUDE.md §6) — and renders <ToastRegion> once.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const notify = useCallback((tone: ToastTone, message: string) => {
    nextId.current += 1
    const toast = { id: nextId.current, tone, message }
    setToasts((queue) => enqueueToast(queue, toast))
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((queue) => dismissToast(queue, id))
  }, [])

  return { toasts, notify, dismiss }
}

const ICONS: Record<ToastTone, () => ReactNode> = {
  info: () => <InfoIcon />,
  success: () => <CheckIcon />,
  warning: () => <WarningIcon />,
  error: () => <ErrorIcon />,
}

/** Bottom-centre on phones, bottom-right on desktop. Polite region; errors are alerts. */
export function ToastRegion({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className={styles.toastRegion} aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const duration = toastDuration(toast.tone)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(duration ?? 0)

  /* Hover or keyboard focus holds the timer; it resumes with the time that was left. */
  useEffect(() => {
    if (duration === null || paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [duration, paused, onDismiss, toast.id])

  return (
    <div
      className={styles.toast}
      data-tone={toast.tone}
      role={toast.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {ICONS[toast.tone]()}
      <p className={styles.toastText}>{toast.message}</p>
      <button type="button" className={styles.toastClose} onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  )
}
