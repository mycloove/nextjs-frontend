'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readPageSizes } from '@/lib/pdf/pdfjsClient'
import styles from './kit.module.css'
import { PageThumb } from './PageThumb'
import {
  describeSelection,
  invertSelection,
  moveFocus,
  rangeToSelection,
  selectAllPages,
  selectSpan,
  selectionToRange,
  togglePage,
  type PageSet,
} from './pageSelection'

const A4: [number, number] = [595.28, 841.89]

/**
 * PageGrid (roadmap §6.2) — the one page picker for page-based tools
 * (Merge, Split, Rotate, PDF→Images, Compress preview).
 *
 * Selection model, mouse and keyboard alike:
 *   click            toggle a page              Space        toggle the focused page
 *   Shift+click      add the span from anchor   Shift+arrow  extend the span
 *   double-click     view the page (onPreview)  Enter        view the focused page
 *   arrows/Home/End  move focus (one tab stop)  Ctrl/⌘+A     select all
 *
 * The typed range field and the grid are two views of one controlled `selected`
 * set, so they cannot drift. The grid reads every page's size once before it
 * draws, so frames never jump when thumbnails arrive.
 */
export function PageGrid({
  document,
  selected,
  onSelectionChange,
  onPreview,
  label,
}: {
  document: PDFDocumentProxy
  selected: PageSet
  onSelectionChange: (next: Set<number>) => void
  onPreview?: (page: number) => void
  /** Accessible name, e.g. "Pages of report.pdf". */
  label: string
}) {
  const pageCount = document.numPages
  const sizes = usePageSizes(document)
  const gridRef = useRef<HTMLDivElement>(null)
  const [focusPage, setFocusPage] = useState(1)
  const anchorRef = useRef(1)
  const summaryId = useId()

  const focusOption = useCallback((page: number) => {
    setFocusPage(page)
    gridRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.focus()
  }, [])

  /* Columns from the rendered layout, so arrow keys match what the eye sees at any width. */
  const columns = () => {
    const items = gridRef.current?.querySelectorAll<HTMLElement>('[data-page]')
    if (!items || items.length === 0) return 1
    const top = items[0].offsetTop
    let count = 0
    for (const item of items) {
      if (item.offsetTop !== top) break
      count += 1
    }
    return count
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelectionChange(selectAllPages(pageCount))
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      anchorRef.current = focusPage
      onSelectionChange(togglePage(selected, focusPage))
      return
    }
    if (event.key === 'Enter' && onPreview) {
      event.preventDefault()
      onPreview(focusPage)
      return
    }
    const next = moveFocus(focusPage, event.key, columns(), pageCount)
    if (next === null) return
    event.preventDefault()
    if (event.shiftKey) onSelectionChange(selectSpan(selected, anchorRef.current, next, true))
    else anchorRef.current = next
    focusOption(next)
  }

  const onClick = (event: MouseEvent, page: number) => {
    setFocusPage(page)
    if (event.shiftKey) {
      onSelectionChange(selectSpan(selected, anchorRef.current, page, true))
      return
    }
    anchorRef.current = page
    onSelectionChange(togglePage(selected, page))
  }

  return (
    <div className={styles.pageGridWrap}>
      <div className={styles.pageGridBar}>
        <p id={summaryId} className={styles.pageGridSummary} aria-live="polite">
          {describeSelection(selected, pageCount)}
        </p>
        <div className={styles.pageGridLinks}>
          <button type="button" className={styles.chipAction} onClick={() => onSelectionChange(selectAllPages(pageCount))}>Select all</button>
          <button type="button" className={styles.chipAction} onClick={() => onSelectionChange(invertSelection(selected, pageCount))}>Invert</button>
          <button type="button" className={styles.chipAction} onClick={() => onSelectionChange(new Set())} disabled={selected.size === 0}>Clear</button>
        </div>
      </div>
      {sizes === null ? (
        <p className={styles.pageGridSummary} role="status">Reading {pageCount} {pageCount === 1 ? 'page' : 'pages'}…</p>
      ) : (
        <div
          ref={gridRef}
          className={styles.pageGrid}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          aria-describedby={summaryId}
          onKeyDown={onKeyDown}
        >
          {sizes.map(([width, height], index) => {
            const page = index + 1
            const isSelected = selected.has(page)
            return (
              <div
                key={page}
                data-page={page}
                role="option"
                aria-selected={isSelected}
                aria-label={`Page ${page}`}
                tabIndex={page === focusPage ? 0 : -1}
                className={styles.pageCell}
                onClick={(event) => onClick(event, page)}
                onDoubleClick={() => onPreview?.(page)}
                onFocus={() => setFocusPage(page)}
              >
                <PageThumb document={document} pageNumber={page} aspect={width / height} />
                <span className={styles.pageNumber} aria-hidden="true">{page}</span>
                {/* The tick is the non-colour cue for "selected". */}
                <span className={styles.pageTick} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {onPreview && <p className={styles.pageGridHint}>Double-click a page, or press Enter, to view it larger.</p>}
    </div>
  )
}

function usePageSizes(document: PDFDocumentProxy): Array<[number, number]> | null {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; sizes: Array<[number, number]> } | null>(null)
  useEffect(() => {
    let cancelled = false
    readPageSizes(document)
      .then((sizes) => { if (!cancelled) setState({ doc: document, sizes }) })
      // A page whose size cannot be read still gets a frame (A4) rather than no grid.
      .catch(() => { if (!cancelled) setState({ doc: document, sizes: Array.from({ length: document.numPages }, () => A4) }) })
    return () => { cancelled = true }
  }, [document])
  return state?.doc === document ? state.sizes : null
}

/**
 * The typed half of the selection: shows the selection as range text and
 * applies typed text on Enter or blur. An invalid range is reported and left
 * in the field to fix; it never silently replaces the selection.
 */
export function PageRangeField({
  pageCount,
  selected,
  onSelectionChange,
  label = 'Pages',
}: {
  pageCount: number
  selected: PageSet
  onSelectionChange: (next: Set<number>) => void
  label?: string
}) {
  const canonical = selectionToRange(selected)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  const apply = () => {
    if (draft === null) return
    const parsed = rangeToSelection(draft, pageCount)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    setError(null)
    setDraft(null)
    onSelectionChange(parsed.pages)
  }

  return (
    <div className={styles.rangeField}>
      <label htmlFor={inputId} className={styles.optionsLegend}>{label}</label>
      <input
        id={inputId}
        className={styles.rangeInput}
        value={draft ?? canonical}
        placeholder={`e.g. 1-3, 5, 8-${pageCount}`}
        autoComplete="off"
        inputMode="text"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => { setDraft(event.target.value); setError(null) }}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply()
          if (event.key === 'Escape') { setDraft(null); setError(null) }
        }}
      />
      {error && <p id={errorId} className={styles.rangeError} role="alert">{error}</p>}
    </div>
  )
}
