'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import styles from './kit.module.css'
import { ActionButton } from './ActionButton'
import { UploadIcon } from './icons'
import { acceptsLabel, describeLimits, summarizeDrag, type DragSummary, type IntakeSpec } from './intakeRules'

/**
 * Intake (roadmap §6.1): one primary button that is always visible, the
 * limits stated before anything is dropped, and drag-and-drop / paste as
 * extras rather than the only way in. Validation is the caller's job via
 * `validateIntake`, so every tool reports refusals in the same words.
 */
export function Intake({
  spec,
  onFiles,
  title,
  buttonLabel,
  disabled = false,
}: {
  spec: IntakeSpec
  onFiles: (files: File[]) => void
  title?: string
  /** Defaults to "Choose a PDF" / "Choose PDF files" from the registry entry. */
  buttonLabel?: string
  disabled?: boolean
}) {
  const picker = useFilePicker(spec, onFiles)
  const hintId = useId()
  const pasteKey = usePasteShortcutLabel()
  const kinds = acceptsLabel(spec.accepts)
  const multiple = spec.limits.maxFiles > 1
  const label = buttonLabel ?? (multiple ? `Choose ${kinds} files` : `Choose a ${kinds}`)

  return (
    <div className={styles.intake}>
      {title && <p className={styles.intakeTitle}>{title}</p>}
      <ActionButton
        icon={<UploadIcon />}
        onClick={picker.open}
        disabled={disabled}
        aria-describedby={hintId}
      >
        {label}
      </ActionButton>
      <div id={hintId}>
        <p className={styles.intakeHint}>
          {multiple ? 'or drop them anywhere on this page' : 'or drop it anywhere on this page'}
          {pasteKey ? ` · ${pasteKey} pastes` : ''}
        </p>
        <p className={styles.limits}>{describeLimits(spec)}</p>
      </div>
      {picker.input}
    </div>
  )
}

/**
 * The native file picker, filtered by the registry entry. Returned as an
 * `open` function plus the hidden input to render, so a "Replace" button and
 * the Intake button open the same picker.
 */
export function useFilePicker(spec: IntakeSpec, onFiles: (files: File[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const accept = spec.accepts.flatMap((type) => [type.mime, ...type.extensions]).join(',')
  const input = (
    <input
      ref={inputRef}
      className={styles.visuallyHidden}
      type="file"
      accept={accept}
      multiple={spec.limits.maxFiles > 1}
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        // Reset so picking the same file again still fires a change.
        event.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { open: () => inputRef.current?.click(), input }
}

/**
 * "Ctrl+V" or "⌘V" on devices with a keyboard-and-pointer setup; nothing on
 * touch devices, where the shortcut does not exist. Resolved after mount so
 * the server render and the first client render agree.
 */
function usePasteShortcutLabel(): string | null {
  return useSyncExternalStore(subscribeNever, readPasteShortcutLabel, () => null)
}

const subscribeNever = () => () => {}

function readPasteShortcutLabel(): string | null {
  if (!window.matchMedia('(pointer: fine)').matches) return null
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  return /mac|iphone|ipad/i.test(platform) ? '⌘V' : 'Ctrl+V'
}

/**
 * The whole page is the drop target (§5.2). While a drag carrying files is
 * over the window, an inset accent frame and a label say what will happen,
 * read from `DataTransfer.items`; a type the tool cannot take turns the frame
 * to the error colour before the drop. Ctrl+V pastes take the same path.
 *
 * When `enabled` is false (e.g. a run is in flight) drops are still swallowed:
 * otherwise the browser would open the dropped PDF and navigate away from the
 * user's work.
 */
export function DropAnywhere({
  spec,
  onFiles,
  enabled = true,
}: {
  spec: IntakeSpec
  onFiles: (files: File[]) => void
  enabled?: boolean
}) {
  const [drag, setDrag] = useState<DragSummary | null>(null)
  const onFilesRef = useRef(onFiles)
  useEffect(() => {
    onFilesRef.current = onFiles
  }, [onFiles])

  usePasteFiles(onFiles, enabled)

  useEffect(() => {
    let depth = 0
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (!enabled) return
      depth += 1
      const items = Array.from(event.dataTransfer?.items ?? []).map((item) => ({ kind: item.kind, type: item.type }))
      setDrag(summarizeDrag(items, spec))
    }
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    }
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event) || !enabled) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDrag(null)
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setDrag(null)
      if (!enabled) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) onFilesRef.current(files)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      setDrag(null)
    }
  }, [enabled, spec])

  if (!drag || drag.count === 0) return null
  return (
    <div className={styles.dropFrame} data-acceptable={drag.acceptable} aria-hidden="true">
      <span className={styles.dropLabel}>{drag.label}</span>
    </div>
  )
}
