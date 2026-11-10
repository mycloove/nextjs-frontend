'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './kit.module.css'

/**
 * Modal dialog on the native <dialog> element (roadmap §5.2 "Dialog"):
 * showModal() gives the focus trap, inert background and Escape for free;
 * this wrapper adds the house motion, a labelled heading, backdrop-click to
 * close, and returns focus to whatever opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'md' | 'full'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // Fires for Escape, the close button and programmatic close alike.
    const handleClose = () => {
      onCloseRef.current()
      returnTo.current?.focus()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-size={size}
      aria-labelledby={titleId}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself, never on its content.
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
    >
      {open && (
        <div className={styles.dialogBody}>
          <header className={styles.dialogHead}>
            <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
            <button type="button" className={styles.dialogClose} onClick={() => ref.current?.close()} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
