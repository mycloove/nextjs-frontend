'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './bench.module.css'

export type ConfirmSpec = {
  eyebrow: string
  title: string
  body: React.ReactNode
  /** Field name pairs shown as a small ledger, e.g. the cap about to change. */
  facts?: { label: string; value: string }[]
  /** The safe way out. Labelled without naming a direction, e.g. "Leave it off". */
  cancelLabel: string
  confirmLabel: string
  tone?: 'accent' | 'danger'
  /** When set, the operator must type this exact string to arm the confirm. */
  typeToConfirm?: string
  /**
   * Parent-owned fields rendered inside the dialog. Reset-tally needs an optional
   * email scope, and rebuilding a dialog per action would mean a second focus
   * trap and a second Escape handler to keep in sync with this one.
   */
  extra?: React.ReactNode
  /**
   * A single value field the dialog owns and hands back on confirm — a secret to
   * paste, for example. Owning it here (rather than passing a frozen element in
   * `extra`) is what keeps typing and paste working: a controlled input stored in
   * parent state would see its `value` prop reset on every render.
   */
  input?: {
    label: string
    placeholder?: string
    /** Renders as a password field; confirm stays disabled until it is filled. */
    secret?: boolean
  }
  busy?: boolean
}

export function ConfirmDialog({
  spec,
  onCancel,
  onConfirm,
}: {
  spec: ConfirmSpec | null
  onCancel: () => void
  onConfirm: (value: string) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')
  const [value, setValue] = useState('')

  const open = spec !== null
  const needsTyping = Boolean(spec?.typeToConfirm)
  const needsInput = Boolean(spec?.input)
  const armed =
    (!needsTyping || typed.trim() === (spec?.typeToConfirm ?? '').trim()) &&
    (!spec?.input?.secret || value.trim().length > 0)

  /*
   * Clear the typed gate and the value field when the dialog changes rather than
   * in an effect. React's own guidance for "this state came from a prop that just
   * changed" is to adjust it during render — an effect would fire an extra commit
   * just to empty a field, and this dialog opens on an already-typed value's
   * replacement.
   */
  const [seen, setSeen] = useState(spec)
  if (spec !== seen) {
    setSeen(spec)
    setTyped('')
    setValue('')
  }

  /*
   * Every irreversible action on this bench used to be a window.confirm: a
   * native sheet the house design cannot style, which cannot show the values
   * about to change, and which traps no focus. This replaces it with a dialog
   * that opens on the *safe* control, closes on Escape or an outside click, and
   * returns focus to whatever opened it.
   */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    if (needsInput) inputRef.current?.focus()
    else cancelRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !spec?.busy) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = scrimRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled)',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [open, onCancel, needsInput, spec?.busy])

  if (!spec) return null

  return (
    <div
      className={styles.scrim}
      ref={scrimRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !spec.busy) onCancel()
      }}
    >
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bench-dialog-title"
        aria-describedby="bench-dialog-body"
      >
        <p className={styles.dialogEyebrow}>{spec.eyebrow}</p>
        <h2 className={styles.dialogTitle} id="bench-dialog-title">
          {spec.title}
        </h2>
        <div className={styles.dialogBody} id="bench-dialog-body">
          {spec.body}
        </div>

        {spec.facts?.length ? (
          <ul className={styles.dialogList}>
            {spec.facts.map((fact) => (
              <li key={fact.label} className={styles.dialogListRow}>
                <span className={styles.dialogListKey}>{fact.label}</span>
                <span className={styles.dialogListValue}>{fact.value}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {spec.extra}

        {spec.input ? (
          <div className={styles.dialogField}>
            <label className={styles.dialogFieldLabel} htmlFor="bench-dialog-input">
              {spec.input.label}
            </label>
            <input
              id="bench-dialog-input"
              ref={inputRef}
              className={styles.dialogConfirm}
              type={spec.input.secret === false ? 'text' : 'password'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={spec.input.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}

        {spec.typeToConfirm ? (
          <input
            className={styles.dialogConfirm}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={`Type ${spec.typeToConfirm} to confirm`}
            aria-label={`Type ${spec.typeToConfirm} to confirm`}
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}

        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.btn}
            onClick={onCancel}
            disabled={Boolean(spec.busy)}
            ref={cancelRef}
          >
            {spec.cancelLabel}
          </button>
          <button
            type="button"
            className={spec.tone === 'danger' ? `${styles.btn} ${styles.btnDanger}` : `${styles.btn} ${styles.btnPrimary}`}
            onClick={() => onConfirm(value)}
            disabled={Boolean(spec.busy) || !armed}
            ref={confirmRef}
          >
            {spec.busy ? 'Working…' : spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}