import React from 'react'
import styles from '../MergePdfTool.module.css'
import type { SourcePdfFile } from './types'
import { fmtBytes } from './types'
import { ScanLoader } from './ScanLoader'

/**
 * Left column: the ordered stack of source documents.
 *
 * Every row carries its identity colour, so the letter badge here, the page
 * grid in the middle and the tray tag at the bottom all agree on which
 * document a sheet came from. Reordering is a true move-to-position, and the
 * progress bar under each name is the persistent record of how much of that
 * document is currently in the output.
 */
export function SourcesRail({
  sources,
  activeSourceId,
  onSelectSource,
  onMoveSource,
  onMoveSourceTo,
  onRemoveSource,
  onAddFiles,
  isImporting,
  dragSourceItemRef,
}: {
  sources: SourcePdfFile[]
  activeSourceId: number | null
  onSelectSource: (id: number) => void
  onMoveSource: (index: number, direction: -1 | 1) => void
  onMoveSourceTo: (fromIndex: number, toIndex: number) => void
  onRemoveSource: (id: number) => void
  onAddFiles: () => void
  isImporting: boolean
  dragSourceItemRef: React.MutableRefObject<{ type: 'source' | 'tray'; index: number } | null>
}) {
  return (
    <aside className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>
          <span className={styles.stageTag} aria-hidden="true">
            01
          </span>
          Sources
        </h2>
        <span className={styles.badge}>
          {sources.length} {sources.length === 1 ? 'file' : 'files'}
        </span>
      </div>

      <div className={styles.rail}>
        {sources.map((source, index) => {
          const selectedCount = source.selectedPages.size
          const isActive = source.id === activeSourceId

          return (
            <div
              key={source.id}
              className={
                isActive ? `${styles.sourceItem} ${styles.sourceItemActive}` : styles.sourceItem
              }
              style={{ '--item-color': source.color } as React.CSSProperties}
              onClick={() => onSelectSource(source.id)}
              draggable
              onDragStart={() => {
                dragSourceItemRef.current = { type: 'source', index }
              }}
              onDragOver={(event) => {
                if (dragSourceItemRef.current?.type === 'source') event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragSourceItemRef.current?.type !== 'source') return
                onMoveSourceTo(dragSourceItemRef.current.index, index)
                dragSourceItemRef.current = null
              }}
            >
              <div className={styles.sourceBadge}>{source.letterBadge}</div>

              <div className={styles.sourceInfo}>
                <div className={styles.sourceName} title={source.name}>
                  {source.name}
                </div>

                <div className={styles.sourceMeta}>
                  {source.pageCount} pp · {fmtBytes(source.size)}
                </div>

                <div className={styles.sourceProgress}>
                  <span
                    className={styles.sourceProgressBar}
                    style={{ width: `${(selectedCount / source.pageCount) * 100}%` }}
                  />
                </div>

                <div
                  className={selectedCount ? styles.sourceCountHot : styles.sourceCount}
                >
                  {selectedCount
                    ? `${selectedCount} of ${source.pageCount} selected`
                    : 'nothing selected'}
                </div>
              </div>

              <div className={styles.sourceActions} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Move up in the merge order"
                  aria-label={`Move ${source.name} up in the merge order`}
                  disabled={index === 0}
                  onClick={() => onMoveSource(index, -1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Move down in the merge order"
                  aria-label={`Move ${source.name} down in the merge order`}
                  disabled={index === sources.length - 1}
                  onClick={() => onMoveSource(index, 1)}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  title="Remove this file"
                  aria-label={`Remove ${source.name}`}
                  onClick={() => onRemoveSource(source.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className={styles.addSourceBtn}
        onClick={onAddFiles}
        disabled={isImporting}
        aria-busy={isImporting}
      >
        {isImporting ? (
          <>
            <ScanLoader />
            Reading PDFs…
          </>
        ) : (
          '+ Add PDF'
        )}
      </button>
    </aside>
  )
}


