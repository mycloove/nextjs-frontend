'use client'

/* ── Markdown Merge — the collation table ──────────────────────────────────
   Instrument concept: a binder's collation table. Loose converted leaves are
   stacked on a spine, ordered, and bound into one document — with the *seam*
   between every pair of leaves visible and adjustable, because the join is the
   whole act. The rail is the signature device; everything around it stays
   quiet (one bold idea, not decoration everywhere).

   Presentational only: all state is `useMergeSession`, the engine is pure, and
   the preview renders through the *same* `renderMarkdownToHtml` the workspace
   uses, so what is previewed is what is saved. */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { Ic } from '../icons'
import { cx, renderMarkdownToHtml } from '../utils'
import { MERGE_PRESETS, type MergeDoc, type MergeOptions, type SeparatorStyle } from './types'
import { parseDocument } from './parse'
import { useMergeSession } from './useMergeSession'

const SEPARATOR_CYCLE: SeparatorStyle[] = ['rule', 'blank', 'heading', 'custom']

/* The four joins, each shown with the honest bytes it inserts. Kept beside the
   cycle so the tiles, the seam glyph and the engine's separator style can never
   drift out of step. */
const SEPARATOR_META: Record<SeparatorStyle, { label: string; glyph: string }> = {
  rule: { label: 'Thematic break', glyph: '---' },
  blank: { label: 'Blank line', glyph: 'no marker' },
  heading: { label: 'Next title', glyph: '## Title' },
  custom: { label: 'Custom text', glyph: 'exact string' },
}

/* Pixel settings mark — 2px cells, the same engraved grid as the sidebar's
   pixel-plus and the two-tone teal of the Merge Markdown brand, so the dialog's
   own control speaks the surface's language instead of importing a generic
   stroke gear. Eight cells across: cardinal teeth, a 2×2 hub, left face solid,
   right face dimmed for the two-tone read. */
function PixelSettingsMark({ size = 17 }: { size?: number }) {
  const left: [number, number, number][] = [
    [6, 0, 2], [2, 2, 6], [0, 4, 8], [0, 6, 6],
    [0, 8, 6], [0, 10, 8], [2, 12, 6], [6, 14, 2],
  ]
  const right: [number, number, number][] = [
    [8, 0, 2], [8, 2, 6], [8, 4, 8], [10, 6, 6],
    [10, 8, 6], [8, 10, 8], [8, 12, 6], [8, 14, 2],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
      {left.map(([x, y, w]) => (
        <rect key={`l${x}-${y}`} x={x} y={y} width={w} height="2" />
      ))}
      {right.map(([x, y, w]) => (
        <rect key={`r${x}-${y}`} x={x} y={y} width={w} height="2" opacity=".6" />
      ))}
    </svg>
  )
}

/* Merge Markdown mark, drawn in `currentColor` so it inherits whatever it sits
   on — on the primary button that means the button's own foreground, legible in
   both themes, instead of the fixed-grey asset that washed out. The two-tone of
   the brand is kept as a 72% second face rather than a second hard colour. */
function MergeMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M26 8H12a6 6 0 0 0-6 6V50a6 6 0 0 0 6 6H26" />
        <path d="M38 8H52a6 6 0 0 1 6 6V50a6 6 0 0 1-6 6H38" opacity=".72" />
      </g>
      <g fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M17.1 17.1h3.8v3.8h-3.8zM17.1 23.6h3.8v3.8h-3.8zM17.1 30.1h3.8v3.8h-3.8zM17.1 36.6h3.8v3.8h-3.8zM17.1 43.1h3.8v3.8h-3.8zM23.6 23.6h3.8v3.8h-3.8z" />
        <path d="M43.1 17.1h3.8v3.8h-3.8zM43.1 23.6h3.8v3.8h-3.8zM43.1 30.1h3.8v3.8h-3.8zM43.1 36.6h3.8v3.8h-3.8zM43.1 43.1h3.8v3.8h-3.8zM36.6 23.6h3.8v3.8h-3.8z" opacity=".72" />
      </g>
      <path fill="currentColor" d="M32.1 29.5H30.7a1.2 1.2 0 0 0-1.2 1.2v2.6a1.2 1.2 0 0 0 1.2 1.2h1.4Z" />
      <path fill="currentColor" opacity=".72" d="M32 29.5h1.3a1.2 1.2 0 0 1 1.2 1.2v2.6a1.2 1.2 0 0 1-1.2 1.2H32Z" />
    </svg>
  )
}

function SectionOutline({ markdown }: { markdown: string }) {
  const sections = useMemo(() => parseDocument(markdown).sections.slice(0, 14), [markdown])
  if (!sections.length) return <div className="pm-mg-outline-empty">No headings — collates as one block</div>
  return (
    <ul className="pm-mg-outline">
      {sections.map((section, index) => (
        <li key={`${section.title}-${index}`} style={{ paddingLeft: (section.level - 1) * 11 }}>
          {section.title}
        </li>
      ))}
    </ul>
  )
}

function PremiumSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  /* Portal target resolved in the open handler, never read from the ref during
     render: reading `rootRef.current` while rendering is both a React rule
     violation and unreliable, because the first render happens before the
     trigger has been attached. */
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const current = options[selectedIndex]

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    /* The menu matches its trigger's width (floored so a very narrow field
       still lists legibly), so every dropdown in the sheet opens the same
       width it presents — no mismatched list boxes. */
    const width = Math.min(Math.max(rect.width, 172), viewportWidth - 24)
    const desiredHeight = Math.min(220, options.length * 34 + 8)
    const spaceBelow = viewportHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
    const maxHeight = Math.max(100, Math.min(desiredHeight, openUp ? spaceAbove : spaceBelow))
    const left = Math.min(Math.max(12, rect.left), viewportWidth - width - 12)
    const top = openUp ? rect.top - maxHeight - 6 : rect.bottom + 6
    setMenuStyle({ top, left, width, maxHeight })
  }, [options.length])

  const openMenu = useCallback(() => {
    const host = rootRef.current?.closest('.mr-markdown-workspace')
    setPortalHost(host instanceof HTMLElement ? host : document.body)
    setActiveIndex(selectedIndex)
    updateMenuPosition()
    setOpen(true)
  }, [selectedIndex, updateMenuPosition])

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="pm-mg-select-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="pm-mg-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => {
          if (open) setOpen(false)
          else openMenu()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (!open) {
              openMenu()
            } else choose(activeIndex)
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <span className="pm-mg-select-value">{current?.label ?? value}</span>
        <span className="pm-mg-select-chevron" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          className="pm-mg-select-menu"
          style={menuStyle}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-option-${activeIndex}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const delta = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((index) => (index + delta + options.length) % options.length)
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              choose(activeIndex)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              triggerRef.current?.focus()
            } else if (event.key === 'Tab') {
              setOpen(false)
            }
          }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={cx('pm-mg-select-option', activeIndex === index && 'pm-active')}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              <span className="pm-mg-select-check" aria-hidden="true">
                {option.value === value ? Ic.check(12) : null}
              </span>
            </div>
          ))}
        </div>,
        portalHost ?? document.body,
      )}
    </div>
  )
}

export function MergeDialog({
  sources,
  onClose,
  onCreate,
}: {
  sources: MergeDoc[]
  onClose: () => void
  onCreate: (markdown: string, title: string) => void
}) {
  const s = useMergeSession(sources)
  const [view, setView] = useState<'result' | 'edit' | 'sources'>('result')
  const [advOpen, setAdvOpen] = useState(false)
  const [advMounted, setAdvMounted] = useState(false)
  const advCloseTimer = useRef<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /* Which generated text the user acknowledged as stale, so "Keep my edits"
     hides the banner until the collation actually changes again. */
  const [staleAck, setStaleAck] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editInputRef = useRef<HTMLTextAreaElement | null>(null)
  const editGutterRef = useRef<HTMLDivElement | null>(null)
  const dragId = useRef<string | null>(null)
  const sourceListRef = useRef<HTMLOListElement | null>(null)
  const dragPointerY = useRef<number | null>(null)
  const dragScrollFrame = useRef<number | null>(null)
  const leafRefs = useRef(new Map<string, HTMLDivElement>())
  const prevRects = useRef(new Map<string, DOMRect>())

  const stopSourceAutoScroll = useCallback(() => {
    dragPointerY.current = null
    if (dragScrollFrame.current !== null) cancelAnimationFrame(dragScrollFrame.current)
    dragScrollFrame.current = null
  }, [])

  const updateSourceAutoScroll = useCallback((clientY: number) => {
    dragPointerY.current = clientY
    if (dragScrollFrame.current !== null) return

    const scrollFrame = () => {
      const list = sourceListRef.current
      const pointerY = dragPointerY.current
      if (!list || pointerY === null) {
        dragScrollFrame.current = null
        return
      }

      const rect = list.getBoundingClientRect()
      const edgeZone = Math.min(64, Math.max(36, rect.height * .16))
      let delta = 0
      if (pointerY < rect.top + edgeZone) {
        const strength = Math.min(1, (rect.top + edgeZone - pointerY) / edgeZone)
        delta = -Math.max(1, Math.round(strength * 8))
      } else if (pointerY > rect.bottom - edgeZone) {
        const strength = Math.min(1, (pointerY - (rect.bottom - edgeZone)) / edgeZone)
        delta = Math.max(1, Math.round(strength * 8))
      }

      if (delta === 0) {
        dragScrollFrame.current = null
        return
      }
      const previousTop = list.scrollTop
      list.scrollTop += delta
      if (list.scrollTop === previousTop) {
        dragScrollFrame.current = null
        return
      }
      dragScrollFrame.current = requestAnimationFrame(scrollFrame)
    }

    dragScrollFrame.current = requestAnimationFrame(scrollFrame)
  }, [])

  useEffect(() => () => {
    if (dragScrollFrame.current !== null) cancelAnimationFrame(dragScrollFrame.current)
  }, [])

  /* Open/close the advanced panel from event handlers only. The panel stays
     mounted for one short closing transition; owning that timer here avoids a
     synchronous `setState` inside an effect, which triggers a second render
     pass on every toggle. */
  const setAdvancedOpen = useCallback((open: boolean) => {
    if (advCloseTimer.current !== null) {
      window.clearTimeout(advCloseTimer.current)
      advCloseTimer.current = null
    }
    if (open) {
      setAdvMounted(true)
      setAdvOpen(true)
      return
    }
    setAdvOpen(false)
    advCloseTimer.current = window.setTimeout(() => {
      setAdvMounted(false)
      advCloseTimer.current = null
    }, 150)
  }, [])

  useEffect(() => () => {
    if (advCloseTimer.current !== null) window.clearTimeout(advCloseTimer.current)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (advOpen) setAdvancedOpen(false)
        /* Never close on Escape while a manual overlay is live — that would
           discard the user's edits with no confirmation. */
        else if (!(view === 'edit' && s.resultEdited)) onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [advOpen, onClose, setAdvancedOpen, view, s.resultEdited])

  /* Focus once on mount, in its own effect: the keydown effect above re-runs
     when the edit overlay flips, and re-focusing the dialog there would steal
     the caret out of the editor mid-keystroke. */
  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.focus())
  }, [])

  /* FLIP for the collation rail: when a leaf is reordered, the others settle
     with spring physics from where they were — the honest "collation" motion,
     and the one orchestrated moment this dialog spends. Transform/opacity only,
     fully skipped under prefers-reduced-motion. */
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, DOMRect>()
    leafRefs.current.forEach((el, id) => {
      if (!el.isConnected) return
      const rect = el.getBoundingClientRect()
      next.set(id, rect)
      const prev = prevRects.current.get(id)
      if (!prev || reduced) return
      const dy = prev.top - rect.top
      if (Math.abs(dy) > 1) {
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        )
      }
    })
    prevRects.current = next
  })

  const outputMarkdown = s.outputMarkdown
  const report = s.result?.report ?? null
  /* The Edit tab needs a result to edit; if the selection is emptied while it
     is open, fall back to the rendered result rather than mounting an empty
     editor. Derived, so no effect and no extra render. */
  const effectiveView = view === 'edit' && s.selectedCount === 0 ? 'result' : view
  const canCreate = s.selectedCount > 0 && outputMarkdown.trim().length > 0
  const showStale = s.editsStale && staleAck !== (s.result?.markdown ?? '')
  const seamInteractive = s.options.mode === 'concat'

  const sourcesHtml = useMemo(
    () => s.sources.filter((x) => x.selected).map((x) => `## ${x.title}\n\n${x.markdown}`).join('\n\n---\n\n'),
    [s.sources],
  )
  const previewHtml = useMemo(
    () => renderMarkdownToHtml(effectiveView === 'sources' ? sourcesHtml : outputMarkdown),
    [effectiveView, sourcesHtml, outputMarkdown],
  )
  const gutterLines = useMemo(() => {
    const count = outputMarkdown.length ? outputMarkdown.split('\n').length : 1
    return Array.from({ length: count }, (_, i) => i + 1).join('\n')
  }, [outputMarkdown])

  const regenerate = () => {
    setStaleAck(null)
    s.resetEdits()
  }

  const seamLabel = (nextTitle: string): string => {
    switch (s.options.separator.style) {
      case 'blank':
        return 'blank line'
      case 'heading':
        return `## ${nextTitle}`
      case 'custom':
        return s.options.separator.custom || '---'
      case 'rule':
      default:
        return '---'
    }
  }

  const cycleSeam = () => {
    const i = SEPARATOR_CYCLE.indexOf(s.options.separator.style)
    s.setSeparator(SEPARATOR_CYCLE[(i + 1) % SEPARATOR_CYCLE.length])
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outputMarkdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* Clipboard refused (permissions): the user can still select the preview. */
    }
  }

  const create = () => {
    if (!canCreate) return
    onCreate(outputMarkdown, s.options.documentTitle.trim() || 'Merged document')
  }

  const dismissOnBackdrop = () => {
    if (!(view === 'edit' && s.resultEdited)) onClose()
  }

  return (
    <div className="pm-overlay pm-overlay-center pm-mg-overlay" onClick={dismissOnBackdrop}>
      <div
        className="pm-mg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-mg-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => {
          event.stopPropagation()
          if (advOpen && event.target instanceof Element && !event.target.closest('#pm-mg-options, .pm-mg-settings, .pm-mg-select-menu')) {
            setAdvancedOpen(false)
          }
        }}
      >
        <header className="pm-mg-head">
          <div className="pm-mg-head-id">
            <span className="pm-mg-head-mark">
              <img src="/merge-markdown-color.svg" alt="" aria-hidden="true" />
            </span>
            <div className="pm-mg-head-copy">
              <div className="pm-mg-title" id="pm-mg-title">Collate documents</div>
              <div className="pm-mg-sub">
                <span className="pm-mg-tnum">{s.selectedCount}</span> selected
                <i className="pm-mg-dot" />
                <span className="pm-mg-tnum">{report?.sections ?? 0}</span> sections
                <i className="pm-mg-dot" />
                <span className="pm-mg-tnum">{report?.words ?? 0}</span> words
                {s.converting && (<><i className="pm-mg-dot" />normalising…</>)}
              </div>
            </div>
          </div>
          <nav className="pm-mg-head-nav" aria-label="Collation controls">
            <div className="pm-mg-seg pm-mg-mode-nav" role="group" aria-label="Merge mode">
              <button
                type="button"
                className={cx('pm-mg-seg-btn', s.options.mode === 'concat' && 'pm-on')}
                onClick={() => s.setOption('mode', 'concat')}
                aria-pressed={s.options.mode === 'concat'}
              >
                <span>Concatenate</span>
                <small>faithful order</small>
              </button>
              <button
                type="button"
                className={cx('pm-mg-seg-btn', s.options.mode === 'section' && 'pm-on')}
                onClick={() => s.setOption('mode', 'section')}
                aria-pressed={s.options.mode === 'section'}
              >
                <span>Section merge</span>
                <small>structure-aware</small>
              </button>
            </div>
            <button
              type="button"
              className={cx('pm-mg-settings', advOpen && 'pm-on')}
              onClick={() => setAdvancedOpen(!advOpen)}
              aria-expanded={advOpen}
              aria-controls="pm-mg-options"
              aria-label="Settings"
              data-tooltip="Settings"
            >
              <PixelSettingsMark size={17} />
            </button>
            <div className="pm-mg-seg pm-mg-seg-sm pm-mg-preview-nav" role="group" aria-label="Preview view">
              <button type="button" className={cx('pm-mg-seg-btn', effectiveView === 'result' && 'pm-on')} onClick={() => setView('result')} aria-pressed={effectiveView === 'result'}>Result</button>
              <button
                type="button"
                className={cx('pm-mg-seg-btn', effectiveView === 'edit' && 'pm-on')}
                onClick={() => setView('edit')}
                disabled={s.selectedCount === 0}
                aria-pressed={effectiveView === 'edit'}
                title={s.selectedCount === 0 ? 'Select sources to edit the collation' : 'Edit the collated markdown'}
              >
                Edit
              </button>
              <button type="button" className={cx('pm-mg-seg-btn', effectiveView === 'sources' && 'pm-on')} onClick={() => setView('sources')} aria-pressed={effectiveView === 'sources'}>Sources</button>
            </div>
          </nav>
          <button type="button" className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onClose} aria-label="Close">
            {Ic.close(12)}
          </button>
        </header>

        {s.notice && (
          <div className="pm-mg-notice" role="status">
            <span>{Ic.info(13)} {s.notice}</span>
            <button type="button" className="pm-mg-icon" onClick={s.dismissNotice} aria-label="Dismiss">
              {Ic.close(11)}
            </button>
          </div>
        )}

        <div className="pm-mg-body">
          {/* ── Left: the collation rail ─────────────────────────────── */}
          <section className="pm-mg-rail" aria-label="Sources">
            <div className="pm-mg-rail-head">
              <span>Sources</span>
              <div className="pm-mg-rail-actions">
                <button type="button" className="pm-mg-link" onClick={s.selectAll}>All</button>
                <button type="button" className="pm-mg-link" onClick={s.clearAll}>None</button>
              </div>
            </div>

            {s.sources.length === 0 ? (
              <p className="pm-mg-rail-empty">No documents in this workspace yet. Add markdown files from disk to collate.</p>
            ) : (
              <ol
                ref={sourceListRef}
                className="pm-mg-stack"
                onDragOver={(event) => {
                  event.preventDefault()
                  if (dragId.current) {
                    event.dataTransfer.dropEffect = 'move'
                    updateSourceAutoScroll(event.clientY)
                  }
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget as Node | null
                  if (!nextTarget || !event.currentTarget.contains(nextTarget)) stopSourceAutoScroll()
                }}
                onDrop={stopSourceAutoScroll}
              >
                {s.sources.map((source, index) => {
                  const stat = report?.sources.find((x) => x.id === source.id)
                  return (
                    <li key={source.id} className="pm-mg-item">
                      <div
                        ref={(el) => {
                          if (el) leafRefs.current.set(source.id, el)
                          else leafRefs.current.delete(source.id)
                        }}
                        className={cx('pm-mg-leaf', source.selected && 'pm-on')}
                        draggable
                        onDragStart={(event) => {
                          dragId.current = source.id
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={stopSourceAutoScroll}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (dragId.current) s.reorder(dragId.current, source.id)
                          dragId.current = null
                          stopSourceAutoScroll()
                        }}
                      >
                        <span className="pm-mg-no">{index + 1}</span>
                        <button
                          type="button"
                          className={cx('pm-mg-tick', source.selected && 'pm-on')}
                          onClick={() => s.toggle(source.id)}
                          aria-pressed={source.selected}
                          aria-label={`${source.selected ? 'Deselect' : 'Select'} ${source.title}`}
                        >
                          {source.selected && Ic.check(11)}
                        </button>
                        <button
                          type="button"
                          className="pm-mg-leaf-copy"
                          onClick={() => setExpanded(expanded === source.id ? null : source.id)}
                          aria-expanded={expanded === source.id}
                        >
                          <strong>{source.title}</strong>
                          <small>
                            {stat ? `${stat.words} words · ${stat.sections} sections` : '…'}
                            {source.origin === 'disk' && ' · from disk'}
                          </small>
                        </button>
                        {stat?.bijoy && <span className="pm-mg-badge" title="Looks Bijoy-encoded">Bijoy</span>}
                        <div className="pm-mg-move">
                          <button type="button" className="pm-mg-icon pm-up" onClick={() => s.move(source.id, 'up')} disabled={index === 0} aria-label="Move up">
                            {Ic.chevron(13)}
                          </button>
                          <button type="button" className="pm-mg-icon pm-down" onClick={() => s.move(source.id, 'down')} disabled={index === s.sources.length - 1} aria-label="Move down">
                            {Ic.chevron(13)}
                          </button>
                        </div>
                        <span className="pm-mg-grip" aria-hidden="true">{Ic.grip(14)}</span>
                        <button type="button" className="pm-mg-icon pm-mg-remove" onClick={() => s.removeSource(source.id)} aria-label={`Remove ${source.title}`}>
                          {Ic.close(11)}
                        </button>
                      </div>

                      {expanded === source.id && <SectionOutline markdown={source.markdown} />}

                      {index < s.sources.length - 1 && (
                        <button
                          type="button"
                          className={cx('pm-mg-seam', !seamInteractive && 'pm-static')}
                          onClick={seamInteractive ? cycleSeam : undefined}
                          disabled={!seamInteractive}
                          title={seamInteractive ? 'Click to change what joins these sources' : 'Section merge joins by heading'}
                        >
                          <span className="pm-mg-seam-line" />
                          <span className="pm-mg-seam-glyph">{seamInteractive ? seamLabel(s.sources[index + 1].title) : 'merged by heading'}</span>
                          <span className="pm-mg-seam-line" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}

            <button
              type="button"
              className="pm-mg-add"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (event.dataTransfer.files?.length) s.addFiles(Array.from(event.dataTransfer.files))
              }}
            >
              {Ic.plus(13)} Add file from disk
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) s.addFiles(Array.from(event.target.files))
                event.target.value = ''
              }}
            />
          </section>

          {/* ── Right: the bench ─────────────────────────────────────── */}
          <section className="pm-mg-bench" aria-label="Result">
            {advMounted && (
              <div
                className={cx('pm-mg-options', !advOpen && 'pm-closing')}
                id="pm-mg-options"
                role="region"
                aria-label="Collation settings"
                aria-hidden={!advOpen}
                inert={!advOpen}
              >
                <section className="pm-mg-opt-group">
                  <div className="pm-mg-opt-eyebrow">Starting point</div>
                  <div className="pm-mg-tabs" role="group" aria-label="Starting point">
                    {MERGE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={cx('pm-mg-tab', s.activePreset === preset.id && 'pm-on')}
                        onClick={() => s.applyPreset(preset)}
                        aria-pressed={s.activePreset === preset.id}
                        title={preset.hint}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </section>

                {s.options.mode === 'concat' && (
                  <section className="pm-mg-opt-group">
                    <div className="pm-mg-opt-eyebrow">Separator between sources</div>
                    <div className="pm-mg-seps" role="radiogroup" aria-label="Separator between sources">
                      {SEPARATOR_CYCLE.map((style) => (
                        <button
                          key={style}
                          type="button"
                          role="radio"
                          aria-checked={s.options.separator.style === style}
                          className={cx('pm-mg-sep-tile', s.options.separator.style === style && 'pm-on')}
                          onClick={() => s.setSeparator(style)}
                        >
                          <span className="pm-mg-sep-name">{SEPARATOR_META[style].label}</span>
                          <span className="pm-mg-sep-glyph">{SEPARATOR_META[style].glyph}</span>
                        </button>
                      ))}
                    </div>
                    {s.options.separator.style === 'custom' && (
                      <input
                        className="pm-mg-input pm-mg-mono"
                        value={s.options.separator.custom}
                        onChange={(event) => s.setCustomSeparator(event.target.value)}
                        placeholder="exact separator text"
                        aria-label="Custom separator text"
                      />
                    )}
                  </section>
                )}

                <section className="pm-mg-opt-group">
                  <div className="pm-mg-opt-eyebrow">Document</div>
                  <div className="pm-mg-fields">
                    {s.options.mode === 'section' && (
                      <>
                        <div className="pm-mg-field">
                          <span className="pm-mg-field-label">Duplicate headings</span>
                          <PremiumSelect
                            label="Duplicate headings"
                            value={s.options.duplicateHeading}
                            onChange={(value) => s.setOption('duplicateHeading', value as MergeOptions['duplicateHeading'])}
                            options={[
                              { value: 'keep', label: 'Keep both' },
                              { value: 'rename', label: 'Rename with numbers' },
                              { value: 'nest', label: 'Nest under the first' },
                              { value: 'merge', label: 'Merge bodies' },
                            ]}
                          />
                        </div>
                        <div className="pm-mg-field">
                          <span className="pm-mg-field-label">Heading level</span>
                          <PremiumSelect
                            label="Heading level"
                            value={s.options.headingLevel}
                            onChange={(value) => s.setOption('headingLevel', value as MergeOptions['headingLevel'])}
                            options={[
                              { value: 'as-is', label: 'As-is' },
                              { value: 'promote', label: 'Promote to H1' },
                              { value: 'demote', label: 'Demote under a title' },
                            ]}
                          />
                        </div>
                      </>
                    )}
                    <div className="pm-mg-field">
                      <span className="pm-mg-field-label">Frontmatter</span>
                      <PremiumSelect
                        label="Frontmatter"
                        value={s.options.frontmatter}
                        onChange={(value) => s.setOption('frontmatter', value as MergeOptions['frontmatter'])}
                        options={[
                          { value: 'keep-first', label: 'Keep the first' },
                          { value: 'merge', label: 'Merge keys' },
                          { value: 'strip', label: 'Strip' },
                          { value: 'new-title', label: 'New title' },
                        ]}
                      />
                    </div>
                  </div>
                </section>

                <section className="pm-mg-opt-group">
                  <div className="pm-mg-opt-eyebrow">Cleanup</div>
                  <div className="pm-mg-switches">
                    <label className="pm-mg-switch-row">
                      <span className="pm-mg-switch-copy">
                        <span className="pm-mg-switch-name">Renumber footnotes</span>
                        <span className="pm-mg-switch-sub">Rebuild [^n] ids so they no longer collide</span>
                      </span>
                      <input
                        type="checkbox"
                        className="pm-mg-switch-input"
                        checked={s.options.renumberFootnotes}
                        onChange={(event) => s.setOption('renumberFootnotes', event.target.checked)}
                      />
                    </label>
                    <label className="pm-mg-switch-row">
                      <span className="pm-mg-switch-copy">
                        <span className="pm-mg-switch-name">Rebase relative links</span>
                        <span className="pm-mg-switch-sub">Point each source&rsquo;s links and images back to its folder</span>
                      </span>
                      <input
                        type="checkbox"
                        className="pm-mg-switch-input"
                        checked={s.options.rewriteLinks}
                        onChange={(event) => s.setOption('rewriteLinks', event.target.checked)}
                      />
                    </label>
                    <label className="pm-mg-switch-row">
                      <span className="pm-mg-switch-copy">
                        <span className="pm-mg-switch-name">Collapse blank lines</span>
                        <span className="pm-mg-switch-sub">Fold runs of 3+ newlines into a single blank line</span>
                      </span>
                      <input
                        type="checkbox"
                        className="pm-mg-switch-input"
                        checked={s.options.collapseBlankLines}
                        onChange={(event) => s.setOption('collapseBlankLines', event.target.checked)}
                      />
                    </label>
                    <label className="pm-mg-switch-row">
                      <span className="pm-mg-switch-copy">
                        <span className="pm-mg-switch-name">Auto-normalise Bijoy</span>
                        <span className="pm-mg-switch-sub">Convert legacy Bangla encoding before collating</span>
                      </span>
                      <input
                        type="checkbox"
                        className="pm-mg-switch-input"
                        checked={s.autoNormalize}
                        onChange={(event) => s.setAutoNormalize(event.target.checked)}
                      />
                    </label>
                  </div>
                </section>
              </div>
            )}

            {effectiveView === 'edit' ? (
              <div className="pm-mg-edit">
                {/* Segmented status pill — a status segment (dot + label) divided
                    from the action segment, pinned to the header hairline. */}
                <div className="pm-mg-edit-float">
                  <span className={cx('pm-mg-edit-chip', s.resultEdited && 'pm-on')}>
                    {s.resultEdited ? 'Edited' : 'Generated'}
                  </span>
                  {s.editsStale && showStale ? (
                    <>
                      <span className="pm-mg-edit-flag" role="status" title="Sources or settings changed — your edits no longer match the collation.">
                        {Ic.alert(10)}<span>Out of date</span>
                      </span>
                      <button type="button" className="pm-mg-edit-act" onClick={() => setStaleAck(s.result?.markdown ?? '')}>
                        {Ic.check(10)}<span>Keep</span>
                      </button>
                      <button type="button" className="pm-mg-edit-act pm-on" onClick={regenerate}>
                        {Ic.rotate(10)}<span>Regenerate</span>
                      </button>
                    </>
                  ) : (
                    s.resultEdited && (
                      <button type="button" className="pm-mg-edit-act" onClick={regenerate}>
                        {Ic.rotate(10)}<span>Reset</span>
                      </button>
                    )
                  )}
                </div>
                <div className="pm-mg-edit-split">
                  <div className="pm-mg-edit-pane">
                    <div className="pm-mg-edit-gutter" aria-hidden>
                      <div className="pm-mg-edit-gutter-inner" ref={editGutterRef}>{gutterLines}</div>
                    </div>
                    <textarea
                      ref={editInputRef}
                      className="pm-mg-edit-input"
                      value={outputMarkdown}
                      onChange={(event) => {
                        if (!s.resultEdited) s.beginEdit()
                        s.setEditedMarkdown(event.target.value)
                      }}
                      onScroll={(event) => {
                        /* Mirror the exact offset so the numbers track their lines
                           regardless of scrollbar heights. */
                        const gutter = editGutterRef.current
                        if (gutter) gutter.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`
                      }}
                      spellCheck={false}
                      placeholder="Your collated markdown appears here…"
                      aria-label="Edit collated markdown"
                    />
                  </div>
                  <div className="pm-mg-preview pm-preview-body pm-mg-edit-preview">
                    <div className="pm-preview-inner">
                      <article className="pm-mg-render" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="pm-mg-preview pm-preview-body">
                {s.selectedCount === 0 ? (
                  <div className="pm-mg-preview-empty">
                    <span className="pm-mg-preview-mark">
                      <img src="/merge-markdown-gray.svg" alt="" aria-hidden="true" />
                    </span>
                    <p>Choose sources from the rail to begin.</p>
                    <button type="button" className="pm-btn pm-btn-secondary pm-btn-sm" onClick={s.selectAll}>Select all sources</button>
                  </div>
                ) : (
                  <div className="pm-preview-inner">
                    <article className="pm-mg-render" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                )}
              </div>
            )}

            {report && (report.changes.length > 0 || report.warnings.length > 0) && (
              <div className="pm-mg-report">
                <span className="pm-mg-report-mark" aria-hidden="true">
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" shapeRendering="crispEdges">
                    <rect x="1" y="1" width="2" height="2" />
                    <rect x="4" y="4" width="2" height="2" />
                    <rect x="7" y="7" width="2" height="2" />
                    <rect x="4" y="10" width="2" height="2" />
                    <rect x="1" y="13" width="2" height="2" />
                  </svg>
                </span>
                <div className="pm-mg-report-content">
                  {report.changes
                    .filter((change) => change.count > 0 && change.key !== 'words')
                    .map((change) => (
                      <span key={change.key} className="pm-mg-change">
                        <b>{change.count}</b> {change.label}
                      </span>
                    ))}
                  {report.warnings.map((warning) => (
                    <span key={warning} className="pm-mg-warn">{Ic.alert(12)} {warning}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="pm-mg-foot">
          <label className="pm-mg-title-field">
            <span>Save as</span>
            <input
              className="pm-mg-title-input"
              value={s.options.documentTitle}
              onChange={(event) => s.setOption('documentTitle', event.target.value)}
              placeholder="Merged document"
            />
          </label>
          <div className="pm-mg-foot-actions">
            <button type="button" className="pm-btn pm-btn-ghost pm-btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="pm-btn pm-btn-ghost pm-btn-sm" onClick={copy} disabled={!outputMarkdown}>
              {copied ? Ic.check(12) : Ic.copy(12)} {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="pm-btn pm-btn-primary pm-btn-sm" onClick={create} disabled={!canCreate}>
              <MergeMark size={16} /> Create document
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
