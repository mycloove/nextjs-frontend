'use client'

import styles from './kit.module.css'
import { formatBytes } from './intakeRules'

/**
 * A file the tool is holding: name, real size, and whatever else the tool
 * actually knows (page count, kind) — never a guessed property. The paper
 * glyph is the one raised object, the same material as page thumbnails.
 */
export function FileChip({
  name,
  sizeBytes,
  meta,
  onReplace,
  onRemove,
  disabled = false,
}: {
  name: string
  sizeBytes: number
  /** Extra facts after the size, e.g. "12 pages". */
  meta?: string
  onReplace?: () => void
  onRemove?: () => void
  disabled?: boolean
}) {
  return (
    <div className={styles.chip}>
      <span className={styles.chipPaper} aria-hidden="true" />
      <span className={styles.chipText}>
        <span className={styles.chipName} title={name}>{name}</span>
        <span className={styles.chipMeta}>
          {formatBytes(sizeBytes)}
          {meta ? ` · ${meta}` : ''}
        </span>
      </span>
      {onReplace && (
        <button type="button" className={styles.chipAction} onClick={onReplace} disabled={disabled}>
          Replace
        </button>
      )}
      {onRemove && (
        <button type="button" className={styles.chipAction} onClick={onRemove} disabled={disabled} aria-label={`Remove ${name}`}>
          Remove
        </button>
      )}
    </div>
  )
}
