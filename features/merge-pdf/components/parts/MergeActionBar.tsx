import styles from '../MergePdfTool.module.css'
import { fmtBytes } from './types'
import { ScanLoader } from './ScanLoader'

/**
 * Bottom action bar — the last step of the page.
 *
 * It closes the priority flow: a live readiness line and a one-line summary of
 * what is about to be built on the left, and the merge button (with the success
 * box above it) on the right. Progress is shown inside the button, so the same
 * control that starts the merge reports it honestly.
 *
 * The bar is pinned as a sticky liquid-glass pane, so the merge control stays
 * in reach no matter how far the workbench has scrolled.
 */
export function MergeActionBar({
  pageCount,
  isProcessing,
  progressPercent,
  lastMergedResult,
  onExecuteMerge,
  onDownload,
}: {
  pageCount: number
  isProcessing: boolean
  progressPercent: number
  lastMergedResult: { name: string; size: number; blob: Blob } | null
  onExecuteMerge: () => void
  onDownload: () => void
}) {
  const hasTray = pageCount > 0
  const busy = isProcessing
  const statusLabel = busy ? 'Binding' : hasTray ? 'Ready to merge' : 'Awaiting pages'

  return (
    <section className={styles.actionBar} aria-label="Merge and download">
      <div className={styles.actionInfo}>
        <span className={styles.actionStatus} aria-live="polite">
          <span
            className={`${styles.statusDot} ${hasTray && !busy ? styles.statusDotReady : ''}`}
            aria-hidden="true"
          />
          {statusLabel}
        </span>
        <b>
          {busy
            ? `Binding ${pageCount} page${pageCount > 1 ? 's' : ''}…`
            : hasTray
              ? `${pageCount} page${pageCount > 1 ? 's' : ''} ready to merge`
              : 'Nothing to merge yet'}
        </b>
        <small>
          {hasTray
            ? 'Built in your browser — nothing is uploaded.'
            : 'Add a PDF and choose its pages to enable merging.'}
        </small>
      </div>

      <div className={styles.actionControls}>
        {lastMergedResult && (
          <div className={styles.successBox}>
            <div className={styles.successDetails}>
              Bound successfully
              <br />
              <b>{lastMergedResult.name}</b> · {fmtBytes(lastMergedResult.size)}
            </div>
            <button type="button" className={styles.successBtn} onClick={onDownload}>
              Download
            </button>
          </div>
        )}

        <button
          type="button"
          className={styles.mergeBtn}
          disabled={!hasTray || isProcessing}
          onClick={onExecuteMerge}
        >
          <i className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          <span className={styles.mergeLabel} aria-live="polite">
            {isProcessing ? (
              <>
                <ScanLoader className={styles.mergeScan} />
                {`Binding… ${progressPercent}%`}
              </>
            ) : hasTray ? (
              `Merge ${pageCount} page${pageCount > 1 ? 's' : ''}`
            ) : (
              'Merge PDFs'
            )}
          </span>
        </button>
      </div>
    </section>
  )
}
