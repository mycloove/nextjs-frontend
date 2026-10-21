import React, { useEffect, useState } from 'react'
import styles from '../MergePdfTool.module.css'
import type { SourcePdfFile, TrayItem } from './types'

/**
 * The two sheet renderers of the studio. Both paint the page as a CSS
 * background on a paper-coloured box rather than an <img>: the real page
 * aspect ratio drives the box, and any part the render does not cover shows
 * paper instead of a transparent gap — which is what makes a mixed-size
 * stack readable at a glance.
 */

type ThumbnailRenderer = (
  sourceId: number,
  pageNumber: number,
  width: number
) => Promise<string | null>

function useThumbnail(
  renderThumbnail: ThumbnailRenderer,
  sourceId: number,
  pageNumber: number,
  width: number
) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    renderThumbnail(sourceId, pageNumber, width).then((next) => {
      if (!cancelled) setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [renderThumbnail, sourceId, pageNumber, width])

  return url
}

export function PagePickerCard({
  sourceId,
  pageNumber,
  color,
  aspectRatio,
  isSelected,
  onToggle,
  onPreview,
  renderThumbnail,
}: {
  sourceId: number
  pageNumber: number
  color: string
  aspectRatio: string
  isSelected: boolean
  onToggle: () => void
  onPreview: () => void
  renderThumbnail: ThumbnailRenderer
}) {
  const thumbUrl = useThumbnail(renderThumbnail, sourceId, pageNumber, 240)

  return (
    <div
      className={isSelected ? `${styles.pageCard} ${styles.pageCardSelected}` : styles.pageCard}
      style={{ '--card-color': color } as React.CSSProperties}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onToggle()
        }
      }}
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`Page ${pageNumber}`}
      tabIndex={0}
    >
      <div
        className={thumbUrl ? styles.pageThumbWrap : `${styles.pageThumbWrap} ${styles.pageThumbIdle}`}
        style={{
          aspectRatio,
          ...(thumbUrl ? { backgroundImage: `url(${thumbUrl})` } : null),
        }}
      >
        {thumbUrl ? null : pageNumber}
      </div>

      <span className={styles.selectIndicator} aria-hidden="true">
        ✓
      </span>

      <div className={styles.pageFooterRow}>
        <span className={styles.pageFooter}>Page {pageNumber}</span>
        <button
          type="button"
          className={styles.previewBtn}
          title={`Preview page ${pageNumber}`}
          aria-label={`Preview page ${pageNumber}`}
          onClick={(event) => {
            event.stopPropagation()
            onPreview()
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
      </div>
    </div>
  )
}

export function TrayCard({
  item,
  index,
  source,
  aspectRatio,
  isCurrent,
  onSelect,
  onRemove,
  onDragReorder,
  renderThumbnail,
}: {
  item: TrayItem
  index: number
  source?: SourcePdfFile
  aspectRatio: string
  isCurrent: boolean
  onSelect: () => void
  onRemove: () => void
  onDragReorder: (from: number, to: number) => void
  renderThumbnail: ThumbnailRenderer
}) {
  const thumbUrl = useThumbnail(renderThumbnail, item.sourceId, item.pageNumber, 180)
  const color = source?.color || 'var(--am-brass)'

  return (
    <div
      className={isCurrent ? `${styles.trayItem} ${styles.trayItemActive}` : styles.trayItem}
      style={{ '--item-color': color } as React.CSSProperties}
      onClick={onSelect}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(index))
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const fromIndex = Number.parseInt(event.dataTransfer.getData('text/plain'), 10)
        if (!Number.isNaN(fromIndex) && fromIndex !== index) onDragReorder(fromIndex, index)
      }}
    >
      <div className={styles.trayThumbWrap}>
        <div
          className={thumbUrl ? styles.pageThumbWrap : `${styles.pageThumbWrap} ${styles.pageThumbIdle}`}
          style={{
            aspectRatio,
            ...(thumbUrl ? { backgroundImage: `url(${thumbUrl})` } : null),
          }}
        >
          {thumbUrl ? null : `p.${item.pageNumber}`}
        </div>

        {/* The identity tag is anchored to the sheet's bottom edge, not to a
            magic bottom offset — it stays put whatever the filename's height. */}
        <span className={styles.trayTag}>
          {source?.letterBadge || '?'} · p{item.pageNumber}
        </span>
      </div>

      <span className={styles.traySeq}>{index + 1}</span>

      <button
        type="button"
        className={styles.trayRemove}
        title={`Remove page ${item.pageNumber} from the merged stack`}
        aria-label={`Remove page ${item.pageNumber} from the merged stack`}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        ✕
      </button>

      <div className={styles.trayFilename} title={source?.name || ''}>
        {source?.name ? source.name.replace(/\.pdf$/i, '') : `Source ${item.sourceId}`}
      </div>
    </div>
  )
}


