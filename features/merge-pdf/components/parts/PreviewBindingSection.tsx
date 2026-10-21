import styles from '../MergePdfTool.module.css'
import type { PageSizeOption, OrientationOption, SourcePdfFile, TrayItem } from './types'
import { formatDimensions } from './types'
import { PageViewer } from './PageViewer'

/**
 * The final preview — the result leads the page.
 *
 * The stage shows one sheet at the *output* proportion, so changing the page
 * size or orientation visibly reshapes the sheet before anything is written.
 * The output settings (size, orientation, name) sit on the right rail; the
 * merge action itself lives in the bottom action bar so it closes the page.
 */
export function PreviewBindingSection({
  tray,
  currentPreviewIndex,
  currentTrayItem,
  currentTraySource,
  targetDimensions,
  pageSizeChoice,
  orientation,
  sizeDistribution,
  outputName,
  onPrev,
  onNext,
  onPageSizeChange,
  onOrientationChange,
  onOutputNameChange,
}: {
  tray: TrayItem[]
  currentPreviewIndex: number
  currentTrayItem: TrayItem | null
  currentTraySource: SourcePdfFile | null | undefined
  targetDimensions: [number, number]
  pageSizeChoice: PageSizeOption
  orientation: OrientationOption
  sizeDistribution: [string, number][]
  outputName: string
  onPrev: () => void
  onNext: () => void
  onPageSizeChange: (value: PageSizeOption) => void
  onOrientationChange: (value: OrientationOption) => void
  onOutputNameChange: (value: string) => void
}) {
  const hasTray = tray.length > 0
  const [targetWidth, targetHeight] = targetDimensions

  return (
    <section className={styles.panel}>
      <div className={`${styles.panelHead} ${styles.panelHeadResult}`}>
        <h2>
          <span className={styles.stageTag} aria-hidden="true">
            03
          </span>
          Final preview
        </h2>
        <span className={styles.badge}>
          {currentTrayItem ? `${Math.round(targetWidth)}×${Math.round(targetHeight)} pt` : '—'}
        </span>
      </div>

      <div className={styles.previewBody}>
        <div className={styles.previewCol}>
          {currentTrayItem && currentTraySource ? (
            <PageViewer
              doc={currentTraySource.doc}
              pageNumber={currentTrayItem.pageNumber}
              boxDimensions={[targetWidth, targetHeight]}
            />
          ) : (
            <div className={styles.previewStage}>
              <div className={styles.previewEmpty}>
                {hasTray ? 'Rendering the sheet…' : 'Select pages to preview the result'}
              </div>
            </div>
          )}

          <div className={styles.previewNav}>
            <button
              type="button"
              className={styles.link}
              disabled={!hasTray}
              onClick={onPrev}
              aria-label="Previous sheet in the merged stack"
            >
              ◀ Prev
            </button>
            <span className={styles.navLabel}>
              {hasTray ? `${currentPreviewIndex + 1} / ${tray.length}` : '0 / 0'}
            </span>
            <button
              type="button"
              className={styles.link}
              disabled={!hasTray}
              onClick={onNext}
              aria-label="Next sheet in the merged stack"
            >
              Next ▶
            </button>
          </div>

          <div className={styles.previewCaption}>
            {currentTrayItem && currentTraySource ? (
              <>
                <div>
                  <b style={{ color: currentTraySource.color }}>{currentTraySource.letterBadge}</b> ·{' '}
                  <b>{currentTraySource.name}</b> — page {currentTrayItem.pageNumber}
                </div>
                <div className={styles.captionMeta}>
                  original{' '}
                  {currentTraySource.sizes[currentTrayItem.pageNumber - 1]
                    ? formatDimensions(currentTraySource.sizes[currentTrayItem.pageNumber - 1])
                    : 'unknown'}
                </div>
              </>
            ) : (
              'Nothing on the bench yet'
            )}
          </div>
        </div>

        <div className={styles.optionsPanel}>
          <div className={styles.optGroup}>
            <label className={styles.optLabel} htmlFor="am-output-size">
              Output page size
            </label>
            <select
              id="am-output-size"
              className={styles.select}
              value={pageSizeChoice}
              onChange={(event) => onPageSizeChange(event.target.value as PageSizeOption)}
            >
              <option value="first">Same as first page</option>
              <option value="orig">Keep each page&apos;s original size</option>
              <option value="A4">A4 — 210 × 297 mm</option>
              <option value="A3">A3 — 297 × 420 mm</option>
              <option value="A5">A5 — 148 × 210 mm</option>
              <option value="Letter">Letter — 8.5 × 11 in</option>
              <option value="Legal">Legal — 8.5 × 14 in</option>
              <option value="Tabloid">Tabloid — 11 × 17 in</option>
            </select>

            <div className={styles.segCtrl} role="group" aria-label="Output orientation">
              <button
                type="button"
                className={
                  orientation === 'auto' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn
                }
                aria-pressed={orientation === 'auto'}
                onClick={() => onOrientationChange('auto')}
              >
                Auto orient
              </button>
              <button
                type="button"
                className={
                  orientation === 'portrait'
                    ? `${styles.segBtn} ${styles.segBtnActive}`
                    : styles.segBtn
                }
                aria-pressed={orientation === 'portrait'}
                onClick={() => onOrientationChange('portrait')}
              >
                Portrait
              </button>
              <button
                type="button"
                className={
                  orientation === 'landscape'
                    ? `${styles.segBtn} ${styles.segBtnActive}`
                    : styles.segBtn
                }
                aria-pressed={orientation === 'landscape'}
                onClick={() => onOrientationChange('landscape')}
              >
                Landscape
              </button>
            </div>

            {sizeDistribution.length > 0 && (
              <div className={styles.chips}>
                {sizeDistribution.map(([sizeName, count]) => (
                  <span key={sizeName} className={styles.chip}>
                    {sizeName} × {count}
                  </span>
                ))}
              </div>
            )}

            {sizeDistribution.length > 1 && pageSizeChoice !== 'orig' && (
              <div className={styles.sizeAlert}>
                {sizeDistribution.length} page sizes detected. Every sheet is fitted into your chosen
                size without cropping.
              </div>
            )}
          </div>

          <div className={styles.optGroup}>
            <label className={styles.optLabel} htmlFor="am-output-name">
              Output name
            </label>
            <div className={styles.nameInputWrap}>
              <input
                id="am-output-name"
                className={styles.nameInput}
                value={outputName}
                placeholder="merged-document"
                onChange={(event) => onOutputNameChange(event.target.value)}
              />
              <span className={styles.nameExt}>.pdf</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
