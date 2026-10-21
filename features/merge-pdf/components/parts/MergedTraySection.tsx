import styles from '../MergePdfTool.module.css'
import type { SourcePdfFile, TrayItem } from './types'
import { TrayCard } from './Cards'
import { useHorizontalDragAutoScroll } from './useDragAutoScroll'

/**
 * Full-width strip: the assembled output, one sheet per page.
 *
 * This strip is the authority on output order — the exporters read it top to
 * bottom. Reordering is drag-to-position, and each sheet keeps its source's
 * colour stripe and letter tag so the stack can be audited without opening
 * the source files again.
 */
export function MergedTraySection({
  tray,
  sources,
  currentPreviewIndex,
  onSelectTrayItem,
  onRemoveTrayItem,
  onMoveTrayItem,
  onGroupBySources,
  onReverseTray,
  onClearTray,
  renderThumbnail,
}: {
  tray: TrayItem[]
  sources: SourcePdfFile[]
  currentPreviewIndex: number
  onSelectTrayItem: (index: number) => void
  onRemoveTrayItem: (id: string) => void
  onMoveTrayItem: (from: number, to: number) => void
  onGroupBySources: () => void
  onReverseTray: () => void
  onClearTray: () => void
  renderThumbnail: (sourceId: number, pageNumber: number, width: number) => Promise<string | null>
}) {
  /* The strip scrolls itself while a sheet is dragged near either edge, so a
     page can be dropped against any page in a long stack (CLAUDE.md §3.15). */
  const { ref: stripRef, onDragOver, stop: stopAutoScroll } = useHorizontalDragAutoScroll()

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>
          <span className={styles.stageTag} aria-hidden="true">
            02
          </span>
          <span className={styles.panelTitle}>Merged document — drag to arrange</span>
        </h2>
        <div className={styles.tools}>
          <span className={styles.badge}>
            {tray.length} {tray.length === 1 ? 'page' : 'pages'}
          </span>
          <button
            type="button"
            className={styles.link}
            onClick={onGroupBySources}
            title="Order the stack by the source order on the left"
          >
            Group by source
          </button>
          <button type="button" className={styles.link} onClick={onReverseTray}>
            Reverse
          </button>
          <button type="button" className={styles.link} onClick={onClearTray}>
            Clear
          </button>
        </div>
      </div>

      <div
        className={styles.trayStrip}
        ref={stripRef}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          /* dragleave also fires when moving onto a child sheet; only stop when
             the pointer has genuinely left the strip. */
          const next = event.relatedTarget as Node | null
          if (!next || !event.currentTarget.contains(next)) stopAutoScroll()
        }}
        onDragEnd={stopAutoScroll}
        onDrop={stopAutoScroll}
      >
        {tray.length === 0 ? (
          <div className={styles.trayEmptyHint}>
            Sheets you tick will assemble here, tagged with the file they came from.
          </div>
        ) : (
          tray.map((item, index) => {
            const source = sources.find((candidate) => candidate.id === item.sourceId)
            const [width, height] = source?.sizes[item.pageNumber - 1] ?? [595.28, 841.89]

            return (
              <TrayCard
                key={item.id}
                item={item}
                index={index}
                source={source}
                aspectRatio={`${width} / ${height}`}
                isCurrent={index === currentPreviewIndex}
                onSelect={() => onSelectTrayItem(index)}
                onRemove={() => onRemoveTrayItem(item.id)}
                onDragReorder={onMoveTrayItem}
                renderThumbnail={renderThumbnail}
              />
            )
          })
        )}
      </div>
    </section>
  )
}


