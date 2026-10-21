'use client'

/* ═════════════════════════════════════════════════════════════════════════
   Editor widgets — Phase 1 professional upgrades
   ──────────────────────────────────────────────────────────────────────────
   Self-contained popovers/toolbars used by the Workspace editor:
     • EmojiPicker      — categorized, searchable, remembers recents
     • EmojiAutocomplete— inline `:foo` autocomplete popover
     • SlashMenu        — Notion-style `/` command menu
     • FindReplaceBar   — Ctrl+F / Ctrl+H bar with regex / case options
     • TablePicker      — interactive rows×cols grid
     • LangSelect       — dropdown to pick code fence language

   All components are dumb — parent owns state + textarea ref.
   ═════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ic } from './icons'
import {
  EMOJI_CATEGORIES,
  EmojiEntry,
  loadRecentEmojis,
  pushRecentEmoji,
  searchEmojis,
} from './emoji'
import { cx } from './utils'

const VIEWPORT_GUTTER = 12
const POPOVER_GAP = 7

/**
 * Viewport-clamped placement for a floating popover/tip anchored to an element:
 * opens below the anchor, flips above when there is no room, and never leaves the
 * gutter. Shared by the editor popovers below and the Workspace sidebar's
 * provenance plate, so the whole surface flips and clamps the same way.
 */
export function getAnchoredPopoverStyle(
  anchorRect: DOMRect | null | undefined,
  width: number,
  height: number,
  position?: { top: number; left: number },
): React.CSSProperties {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const fittedWidth = Math.min(width, viewportWidth - VIEWPORT_GUTTER * 2)
  const fittedHeight = Math.min(height, viewportHeight - VIEWPORT_GUTTER * 2)
  const requestedLeft = position?.left ?? anchorRect?.left ?? VIEWPORT_GUTTER
  const roomBelow = anchorRect ? viewportHeight - anchorRect.bottom - VIEWPORT_GUTTER : fittedHeight
  const roomAbove = anchorRect ? anchorRect.top - VIEWPORT_GUTTER : fittedHeight
  const openAbove = Boolean(anchorRect && roomBelow < Math.min(fittedHeight, 240) && roomAbove > roomBelow)
  const requestedTop = position?.top ?? (anchorRect
    ? openAbove
      ? anchorRect.top - fittedHeight - POPOVER_GAP
      : anchorRect.bottom + POPOVER_GAP
    : VIEWPORT_GUTTER)

  return {
    top: Math.max(VIEWPORT_GUTTER, Math.min(requestedTop, viewportHeight - fittedHeight - VIEWPORT_GUTTER)),
    left: Math.max(VIEWPORT_GUTTER, Math.min(requestedLeft, viewportWidth - fittedWidth - VIEWPORT_GUTTER)),
    width: fittedWidth,
    maxHeight: fittedHeight,
    transformOrigin: openAbove ? 'bottom left' : 'top left',
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   EMOJI PICKER
   ═════════════════════════════════════════════════════════════════════════ */

export interface EmojiPickerProps {
  open: boolean
  anchorRect?: DOMRect | null
  onPick: (entry: EmojiEntry) => void
  onClose: () => void
  /** Optional position override (px). If not set, positions under anchorRect. */
  position?: { top: number; left: number }
}

export function EmojiPicker(props: EmojiPickerProps) {
  // Conditional-mount pattern lets `EmojiPickerInner` use its
  // useState initializer for reset (no cascading setState in effect).
  if (!props.open) return null
  if (typeof document === 'undefined') return null

  const portalTarget = document.querySelector('.mr-markdown-workspace') ?? document.body
  return createPortal(<EmojiPickerInner {...props} />, portalTarget)
}

function EmojiPickerInner({
  anchorRect,
  onPick,
  onClose,
  position,
}: EmojiPickerProps) {
  const initialRecents = useMemo(() => loadRecentEmojis(), [])
  const [q, setQ] = useState('')
  const [recents, setRecents] = useState<EmojiEntry[]>(initialRecents)
  const [cat, setCat] = useState<string>(
    initialRecents.length ? 'recent' : EMOJI_CATEGORIES[0].id,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Focus search input on first render (does not touch state)
  useEffect(() => {
    const id = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  // Escape + outside-click handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocDown)
    }
  }, [onClose])

  const results = useMemo<EmojiEntry[]>(() => {
    if (q.trim()) return searchEmojis(q, 80)
    if (cat === 'recent') return recents
    const c = EMOJI_CATEGORIES.find((x) => x.id === cat)
    return c ? c.items : []
  }, [q, cat, recents])

  const handlePick = (e: EmojiEntry) => {
    pushRecentEmoji(e)
    setRecents((prev) => [e, ...prev.filter((r) => r.e !== e.e)].slice(0, 24))
    onPick(e)
  }


  const style = getAnchoredPopoverStyle(anchorRect, 328, 356, position)

  return (
    <div ref={rootRef} className="pm-emoji-popover" style={style} role="dialog">
      <div className="pm-emoji-head">
        <div className="pm-emoji-search">
          {Ic.search(14)}
          <input
            ref={searchRef}
            placeholder="Search emoji…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {!q.trim() && (
        <div className="pm-emoji-cats">
          <button
            className={cx('pm-emoji-cat', cat === 'recent' && 'pm-active')}
            onClick={() => setCat('recent')}
            title="Recent"
            disabled={recents.length === 0}
          >
            <span>🕐</span>
          </button>
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={cx('pm-emoji-cat', cat === c.id && 'pm-active')}
              onClick={() => setCat(c.id)}
              title={c.label}
            >
              <span>{c.icon}</span>
            </button>
          ))}
        </div>
      )}

      <div className="pm-emoji-grid">
        {results.length === 0 && (
          <div className="pm-emoji-empty">
            {q.trim() ? `No matches for "${q}"` : 'Pick a category above'}
          </div>
        )}
        {results.map((entry) => (
          <button
            key={entry.n + entry.e}
            className="pm-emoji-tile"
            onClick={() => handlePick(entry)}
            title={`:${entry.n}:`}
            type="button"
          >
            <span className="pm-emoji-char">{entry.e}</span>
          </button>
        ))}
      </div>

      <div className="pm-emoji-foot">
        <span className="pm-kbd">ESC</span> close
        <span style={{ opacity: 0.6, marginLeft: 'auto' }}>
          {results.length} emoji · click to insert
        </span>
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════
   INLINE EMOJI AUTOCOMPLETE (triggered by `:xxx`)
   ═════════════════════════════════════════════════════════════════════════ */

export interface EmojiAutocompleteProps {
  open: boolean
  query: string
  position: { top: number; left: number } | null
  onPick: (entry: EmojiEntry) => void
  onClose: () => void
  activeIndex: number
  setActiveIndex: (i: number) => void
}

export function EmojiAutocomplete({
  open, query, position, onPick, activeIndex, setActiveIndex,
}: EmojiAutocompleteProps) {
  const items = useMemo(() => searchEmojis(query, 8), [query])

  useEffect(() => {
    if (!open) return
    if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1))
  }, [items.length, activeIndex, open, setActiveIndex])

  if (!open || !position || items.length === 0) return null
  return (
    <div
      className="pm-emoji-ac"
      style={{ top: position.top, left: position.left }}
      role="listbox"
    >
      {items.map((entry, i) => (
        <button
          key={entry.n + entry.e}
          className={cx('pm-emoji-ac-item', i === activeIndex && 'pm-active')}
          onMouseEnter={() => setActiveIndex(i)}
          onClick={() => onPick(entry)}
          type="button"
        >
          <span className="pm-emoji-ac-char">{entry.e}</span>
          <span className="pm-emoji-ac-name">:{entry.n}:</span>
        </button>
      ))}
      <div className="pm-emoji-ac-foot">
        <span className="pm-kbd">↑↓</span>
        <span className="pm-kbd">↵</span> to insert · <span className="pm-kbd">ESC</span> to dismiss
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════
   SLASH COMMAND MENU
   ═════════════════════════════════════════════════════════════════════════ */

export interface SlashItem {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  keywords?: string
  /** Called with the textarea slice metadata; must return updated markdown + caret index. */
  apply: (ctx: SlashApplyCtx) => { text: string; caret: number }
}

export interface SlashApplyCtx {
  value: string
  /** Absolute index of the `/` character in the textarea. */
  slashIndex: number
  /** Absolute caret index right after the query text. */
  caretIndex: number
}

/** Default slash items. Kept outside the component so it's tree-shakeable. */
export const DEFAULT_SLASH_ITEMS: SlashItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Large section heading',
    icon: Ic.h1(14),
    keywords: 'heading title h1',
    apply: (c) => insertLine(c, '# '),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Medium section heading',
    icon: Ic.h2(14),
    keywords: 'heading subtitle h2',
    apply: (c) => insertLine(c, '## '),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Small subsection heading',
    icon: Ic.h3(14),
    keywords: 'heading h3',
    apply: (c) => insertLine(c, '### '),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    hint: 'Unordered list',
    icon: Ic.list(14),
    keywords: 'list bullet ul',
    apply: (c) => insertLine(c, '- '),
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    hint: 'Ordered list',
    icon: Ic.list(14),
    keywords: 'list numbered ol ordered',
    apply: (c) => insertLine(c, '1. '),
  },
  {
    id: 'task',
    label: 'Task list',
    hint: 'Todo checkboxes',
    icon: Ic.task(14),
    keywords: 'checkbox todo task',
    apply: (c) => insertLine(c, '- [ ] '),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Blockquote',
    icon: Ic.quote(14),
    keywords: 'blockquote quote',
    apply: (c) => insertLine(c, '> '),
  },
  {
    id: 'callout-note',
    label: 'Callout · Note',
    hint: 'GitHub-flavored callout',
    icon: Ic.callout(14),
    keywords: 'callout note admonition',
    apply: (c) => insertBlock(c, '> [!NOTE]\n> ', ''),
  },
  {
    id: 'callout-tip',
    label: 'Callout · Tip',
    hint: 'GitHub-flavored callout',
    icon: Ic.callout(14),
    keywords: 'callout tip admonition',
    apply: (c) => insertBlock(c, '> [!TIP]\n> ', ''),
  },
  {
    id: 'callout-warning',
    label: 'Callout · Warning',
    hint: 'GitHub-flavored callout',
    icon: Ic.callout(14),
    keywords: 'callout warning admonition',
    apply: (c) => insertBlock(c, '> [!WARNING]\n> ', ''),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Fenced code block',
    icon: Ic.code(14),
    keywords: 'code fence block',
    apply: (c) => insertBlock(c, '```\n', '\n```\n'),
  },
  {
    id: 'inline-code',
    label: 'Inline code',
    hint: 'Backticks around selection',
    icon: Ic.code(14),
    keywords: 'code inline',
    apply: (c) => insertBlock(c, '`', '`'),
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'Insert 3×2 table',
    icon: Ic.table(14),
    keywords: 'table grid',
    apply: (c) => insertBlock(
      c,
      '\n| Column A | Column B | Column C |\n|----------|----------|----------|\n| Row 1    | Row 1    | Row 1    |\n| Row 2    | Row 2    | Row 2    |\n',
      ''
    ),
  },
  {
    id: 'link',
    label: 'Link',
    hint: 'Inline link',
    icon: Ic.link(14),
    keywords: 'link url hyperlink',
    apply: (c) => insertBlock(c, '[', '](https://)'),
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Image reference',
    icon: Ic.image(14),
    keywords: 'image picture img',
    apply: (c) => insertBlock(c, '![alt text](', ')'),
  },
  {
    id: 'hr',
    label: 'Divider',
    hint: 'Horizontal rule',
    icon: Ic.hr(14),
    keywords: 'divider hr line separator',
    apply: (c) => insertBlock(c, '\n---\n', ''),
  },
  {
    id: 'math-inline',
    label: 'Math (inline)',
    hint: 'LaTeX equation inline',
    icon: Ic.math(14),
    keywords: 'math latex equation formula',
    apply: (c) => insertBlock(c, '$', '$'),
  },
  {
    id: 'math-block',
    label: 'Math (block)',
    hint: 'LaTeX equation block',
    icon: Ic.math(14),
    keywords: 'math latex equation formula block',
    apply: (c) => insertBlock(c, '\n$$\n', '\n$$\n'),
  },
  {
    id: 'mermaid',
    label: 'Diagram (Mermaid)',
    hint: 'Flowchart, sequence, gantt',
    icon: Ic.mermaid(14),
    keywords: 'diagram mermaid flowchart chart',
    apply: (c) => insertBlock(
      c,
      '\n```mermaid\ngraph LR\n  A[Start] --> B{Choice}\n  B -->|Yes| C[Done]\n  B -->|No| D[Retry]\n```\n',
      ''
    ),
  },
  {
    id: 'toc',
    label: 'Table of contents',
    hint: 'Auto-generated marker',
    icon: Ic.toc(14),
    keywords: 'toc table of contents',
    apply: (c) => insertBlock(c, '\n[[toc]]\n', ''),
  },
  {
    id: 'footnote',
    label: 'Footnote',
    hint: 'Numbered footnote reference',
    icon: Ic.file(14),
    keywords: 'footnote note reference',
    apply: (c) => insertBlock(c, '[^1]', '\n\n[^1]: Footnote text'),
  },
  {
    id: 'date',
    label: 'Today\'s date',
    hint: new Date().toISOString().slice(0, 10),
    icon: Ic.file(14),
    keywords: 'date today',
    apply: (c) => insertBlock(c, new Date().toISOString().slice(0, 10), ''),
  },
]

/** Delete the `/query` slice then insert `prefix` before the caret. */
function insertLine(c: SlashApplyCtx, prefix: string): { text: string; caret: number } {
  const before = c.value.slice(0, c.slashIndex)
  const after = c.value.slice(c.caretIndex)
  // Move to start of current line
  const lineStart = before.lastIndexOf('\n') + 1
  const lineBefore = before.slice(0, lineStart)
  const text = lineBefore + prefix + after
  return { text, caret: lineBefore.length + prefix.length }
}

function insertBlock(c: SlashApplyCtx, prefix: string, suffix: string) {
  const before = c.value.slice(0, c.slashIndex)
  const after = c.value.slice(c.caretIndex)
  const text = before + prefix + suffix + after
  return { text, caret: before.length + prefix.length }
}

export interface SlashMenuProps {
  open: boolean
  query: string
  position: { top: number; left: number } | null
  items?: SlashItem[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  onPick: (item: SlashItem) => void
  onClose: () => void
}

export function SlashMenu({
  open, query, position, items = DEFAULT_SLASH_ITEMS,
  activeIndex, setActiveIndex, onPick,
}: SlashMenuProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => {
      const hay = (it.label + ' ' + (it.hint || '') + ' ' + (it.keywords || '')).toLowerCase()
      return hay.includes(q)
    })
  }, [items, query])

  useEffect(() => {
    if (!open) return
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIndex, open, setActiveIndex])

  if (!open || !position || filtered.length === 0) return null
  return (
    <div
      className="pm-slash-menu"
      style={{ top: position.top, left: position.left }}
      role="listbox"
    >
      <div className="pm-slash-head">
        {Ic.slash(12)} <span>Insert block</span>
        <span className="pm-slash-count">{filtered.length}</span>
      </div>
      <div className="pm-slash-list">
        {filtered.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={cx('pm-slash-item', i === activeIndex && 'pm-active')}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => onPick(it)}
          >
            <div className="pm-slash-icon">{it.icon}</div>
            <div className="pm-slash-body">
              <div className="pm-slash-label">{it.label}</div>
              {it.hint && <div className="pm-slash-hint">{it.hint}</div>}
            </div>
          </button>
        ))}
      </div>
      <div className="pm-slash-foot">
        <span className="pm-kbd">↑↓</span> navigate
        <span className="pm-kbd">↵</span> select
        <span className="pm-kbd">ESC</span> close
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════
   FIND & REPLACE BAR
   ═════════════════════════════════════════════════════════════════════════ */

export interface FindReplaceState {
  find: string
  replace: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  showReplace: boolean
}

export interface FindReplaceBarProps {
  open: boolean
  state: FindReplaceState
  setState: (patch: Partial<FindReplaceState>) => void
  totalMatches: number
  activeMatch: number
  onNext: () => void
  onPrev: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function FindReplaceBar({
  open, state, setState, totalMatches, activeMatch,
  onNext, onPrev, onReplaceOne, onReplaceAll, onClose,
}: FindReplaceBarProps) {
  const findRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => findRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const noMatch = state.find && totalMatches === 0

  return (
    <div className="pm-find-bar" role="search">
      <div className="pm-find-row">
        <div className={cx('pm-find-input-wrap', noMatch && 'pm-find-nomatch')}>
          {Ic.find(13)}
          <input
            ref={findRef}
            className="pm-find-input"
            placeholder="Find in editor…"
            value={state.find}
            onChange={(e) => setState({ find: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) onPrev()
                else onNext()
              }
            }}
          />
          <div className="pm-find-count">
            {state.find
              ? totalMatches > 0
                ? `${activeMatch + 1} / ${totalMatches}`
                : 'no results'
              : ''}
          </div>
        </div>

        <div className="pm-find-flags">
          <button
            type="button"
            className={cx('pm-find-flag', state.caseSensitive && 'pm-active')}
            onClick={() => setState({ caseSensitive: !state.caseSensitive })}
            title="Match case (Aa)"
          >Aa</button>
          <button
            type="button"
            className={cx('pm-find-flag', state.wholeWord && 'pm-active')}
            onClick={() => setState({ wholeWord: !state.wholeWord })}
            title="Whole word"
          >W</button>
          <button
            type="button"
            className={cx('pm-find-flag', state.regex && 'pm-active')}
            onClick={() => setState({ regex: !state.regex })}
            title="Regex"
          >.*</button>
        </div>

        <div className="pm-find-nav">
          <button className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onPrev} title="Previous (Shift+Enter)">
            <span style={{ transform: 'rotate(-90deg)', display: 'inline-flex' }}>{Ic.chevron(12)}</span>
          </button>
          <button className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onNext} title="Next (Enter)">
            <span style={{ transform: 'rotate(90deg)', display: 'inline-flex' }}>{Ic.chevron(12)}</span>
          </button>
          <button
            className={cx('pm-btn pm-btn-icon pm-btn-icon-sm', state.showReplace && 'pm-btn-icon-active')}
            onClick={() => setState({ showReplace: !state.showReplace })}
            title="Toggle replace (Ctrl+H)"
          >
            {Ic.replace(13)}
          </button>
          <button className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onClose} title="Close (Esc)">
            {Ic.close(12)}
          </button>
        </div>
      </div>

      {state.showReplace && (
        <div className="pm-find-row pm-find-row-replace">
          <div className="pm-find-input-wrap">
            {Ic.replace(12)}
            <input
              className="pm-find-input"
              placeholder="Replace with…"
              value={state.replace}
              onChange={(e) => setState({ replace: e.target.value })}
            />
          </div>
          <button
            className="pm-btn pm-btn-sm pm-btn-ghost"
            onClick={onReplaceOne}
            disabled={totalMatches === 0}
          >
            Replace
          </button>
          <button
            className="pm-btn pm-btn-sm pm-btn-secondary"
            onClick={onReplaceAll}
            disabled={totalMatches === 0}
          >
            Replace all ({totalMatches})
          </button>
        </div>
      )}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════
   TABLE PICKER (interactive rows×cols grid)
   ═════════════════════════════════════════════════════════════════════════ */

export interface TablePickerProps {
  open: boolean
  anchorRect?: DOMRect | null
  position?: { top: number; left: number } | null
  onPick: (rows: number, cols: number) => void
  onClose: () => void
}

export function TablePicker(props: TablePickerProps) {
  if (!props.open) return null
  if (typeof document === 'undefined') return null

  const portalTarget = document.querySelector('.mr-markdown-workspace') ?? document.body
  return createPortal(<TablePickerInner {...props} />, portalTarget)
}

function TablePickerInner({ anchorRect, position, onPick, onClose }: TablePickerProps) {
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const MAX_R = 8
  const MAX_C = 8

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const style = getAnchoredPopoverStyle(anchorRect, 218, 232, position ?? undefined)

  return (
    <div ref={rootRef} className="pm-table-picker" style={style} role="dialog">
      <div className="pm-table-picker-head">
        {hover.r > 0 && hover.c > 0
          ? `${hover.r} × ${hover.c} table`
          : 'Hover to size · click to insert'}
      </div>
      <div
        className="pm-table-grid"
        style={{ gridTemplateColumns: `repeat(${MAX_C}, 20px)` }}
        onMouseLeave={() => setHover({ r: 0, c: 0 })}
      >
        {Array.from({ length: MAX_R * MAX_C }, (_, i) => {
          const r = Math.floor(i / MAX_C) + 1
          const c = (i % MAX_C) + 1
          const filled = r <= hover.r && c <= hover.c
          return (
            <button
              key={i}
              className={cx('pm-table-cell', filled && 'pm-filled')}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r, c)}
              type="button"
              aria-label={`${r} rows by ${c} columns`}
            />
          )
        })}
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════
   LANGUAGE DROPDOWN (for code fence insert)
   ═════════════════════════════════════════════════════════════════════════ */

export const CODE_LANGUAGES = [
  { id: '',           label: 'Plain text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python',     label: 'Python' },
  { id: 'bash',       label: 'Bash' },
  { id: 'json',       label: 'JSON' },
  { id: 'yaml',       label: 'YAML' },
  { id: 'html',       label: 'HTML' },
  { id: 'css',        label: 'CSS' },
  { id: 'sql',        label: 'SQL' },
  { id: 'go',         label: 'Go' },
  { id: 'rust',       label: 'Rust' },
  { id: 'java',       label: 'Java' },
  { id: 'kotlin',     label: 'Kotlin' },
  { id: 'swift',      label: 'Swift' },
  { id: 'c',          label: 'C' },
  { id: 'cpp',        label: 'C++' },
  { id: 'csharp',     label: 'C#' },
  { id: 'ruby',       label: 'Ruby' },
  { id: 'php',        label: 'PHP' },
  { id: 'markdown',   label: 'Markdown' },
  { id: 'xml',        label: 'XML' },
  { id: 'diff',       label: 'Diff' },
]

export interface LangSelectProps {
  open: boolean
  anchorRect?: DOMRect | null
  onPick: (lang: string) => void
  onClose: () => void
}

export function LangSelect(props: LangSelectProps) {
  if (!props.open) return null
  if (typeof document === 'undefined') return null

  const portalTarget = document.querySelector('.mr-markdown-workspace') ?? document.body
  return createPortal(<LangSelectInner {...props} />, portalTarget)
}

function LangSelectInner({ anchorRect, onPick, onClose }: LangSelectProps) {
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusId = window.setTimeout(() => searchRef.current?.focus(), 0)
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(focusId)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return CODE_LANGUAGES
    return CODE_LANGUAGES.filter((l) =>
      l.label.toLowerCase().includes(qq) || l.id.toLowerCase().includes(qq)
    )
  }, [q])

  const style = getAnchoredPopoverStyle(anchorRect, 224, 294)

  return (
    <div ref={rootRef} className="pm-lang-select" style={style} role="dialog">
      <div className="pm-lang-search">
        {Ic.search(12)}
        <input
          ref={searchRef}
          placeholder="Search language…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="pm-lang-list">
        {list.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--pm-text-muted)', textAlign: 'center' }}>
            No language matches
          </div>
        )}
        {list.map((l) => (
          <button
            key={l.id || 'plain'}
            type="button"
            className="pm-lang-item"
            onClick={() => onPick(l.id)}
          >
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
