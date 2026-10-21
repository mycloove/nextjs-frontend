import styles from '../MergePdfTool.module.css'
import type { SourcePdfFile } from './types'
import { PagePickerCard } from './Cards'
import { ScanLoader } from './ScanLoader'

/**
 * Middle column: the open document's pages.
 *
 * The range box and the thumbnail grid are two views of one selection — the
 * range text is rewritten from the ticked pages on every change, and applying
 * a range rewrites the ticks. Neither can drift from the other.
 */
export function PagePickerSection({
  activeSource,
  isImporting,
  onApplyRange,
  onSelectAll,
  onInvert,
  onClear,
  onRangeInputChange,
  onTogglePage,
  onPreview,
  onOpenFiles,
  onLoadSamples,
  renderThumbnail,
}: {
  activeSource: SourcePdfFile | null
  isImporting: boolean
  onApplyRange: (sourceId: number, range: string) => void
  onSelectAll: (sourceId: number) => void
  onInvert: (sourceId: number) => void
  onClear: (sourceId: number) => void
  onRangeInputChange: (sourceId: number, value: string) => void
  onTogglePage: (sourceId: number, pageNumber: number) => void
  onPreview: (sourceId: number, pageNumber: number) => void
  onOpenFiles: () => void
  onLoadSamples: () => void
  renderThumbnail: (sourceId: number, pageNumber: number, width: number) => Promise<string | null>
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>
          <span className={styles.stageTag} aria-hidden="true">
            01
          </span>
          {activeSource ? (
            <>
              <span
                aria-hidden="true"
                style={{
                  flex: '0 0 auto',
                  width: 10,
                  height: 10,
                  backgroundColor: activeSource.color,
                  display: 'inline-block',
                }}
              />
              <span className={styles.panelTitle}>{activeSource.name}</span>
            </>
          ) : (
            'Pages'
          )}
        </h2>
        <span className={styles.badge}>
          {activeSource
            ? `${activeSource.selectedPages.size} / ${activeSource.pageCount} selected`
            : '0 files'}
        </span>
      </div>

      {activeSource ? (
        <>
          <div className={styles.pickerToolbar}>
            <div className={styles.rangeBox}>
              <input
                className={styles.rangeInput}
                value={activeSource.rangeInput}
                placeholder="Range: 1-3, 5, 8-10"
                autoComplete="off"
                aria-label="Page range"
                onChange={(event) => onRangeInputChange(activeSource.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onApplyRange(activeSource.id, activeSource.rangeInput)
                }}
              />
              <button
                type="button"
                className={styles.rangeBtn}
                onClick={() => onApplyRange(activeSource.id, activeSource.rangeInput)}
              >
                Apply
              </button>
            </div>

            <div className={styles.quickLinks}>
              <button
                type="button"
                className={styles.link}
                onClick={() => onSelectAll(activeSource.id)}
              >
                Select all
              </button>
              <button
                type="button"
                className={styles.link}
                onClick={() => onInvert(activeSource.id)}
              >
                Invert
              </button>
              <button
                type="button"
                className={styles.link}
                onClick={() => onClear(activeSource.id)}
              >
                Clear
              </button>
            </div>
          </div>

          <div className={styles.pickerHint}>
            Type a range, or click sheets to tick them one by one. Both stay in sync, and every
            choice is kept while you switch between files.
          </div>

          <div className={styles.pagesGrid}>
            {Array.from({ length: activeSource.pageCount }, (_, offset) => {
              const pageNumber = offset + 1
              const [width, height] = activeSource.sizes[offset] ?? [595.28, 841.89]

              return (
                <PagePickerCard
                  key={`${activeSource.id}_${pageNumber}`}
                  sourceId={activeSource.id}
                  pageNumber={pageNumber}
                  color={activeSource.color}
                  aspectRatio={`${width} / ${height}`}
                  isSelected={activeSource.selectedPages.has(pageNumber)}
                  onToggle={() => onTogglePage(activeSource.id, pageNumber)}
                  onPreview={() => onPreview(activeSource.id, pageNumber)}
                  renderThumbnail={renderThumbnail}
                />
              )
            })}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <h3>Start with your PDFs</h3>
          <p>Drop files anywhere on this page. Everything is processed in your browser.</p>
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnFill}`}
              onClick={onOpenFiles}
              disabled={isImporting}
              aria-busy={isImporting}
            >
              {isImporting ? (
                <>
                  <ScanLoader />
                  Reading PDFs…
                </>
              ) : (
                'Choose PDFs'
              )}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={onLoadSamples}
              disabled={isImporting}
            >
              Try sample files
            </button>
          </div>
        </div>
      )}
    </section>
  )
}


