'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   Markdown cheat sheet panel for the Mr. Markdown premium tool rail.
   ─────────────────────────────────────────────────────────────────────────
   Purely read-only: it renders the CHEATSHEET_ITEMS catalog with search,
   category chips, and tag filters. The only action is "Copy syntax" — it
   copies to the clipboard and never mutates editor state.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react'
import { Ic } from './icons'
import { CHEATSHEET_ITEMS, CHEAT_CATEGORIES, type CheatItem, type CheatCategory } from './cheatsheet-data'

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

function CheatCard({ item, onTagClick }: { item: CheatItem; onTagClick: (tag: string) => void }) {
  const [copied, setCopied] = useState(false)

  const copySyntax = async () => {
    try {
      await navigator.clipboard.writeText(item.syntax)
    } catch {
      // Clipboard may be unavailable (permissions/insecure context) — fail silently.
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <article className="mr-cheat-item">
      <header className="mr-cheat-item-head">
        <div className="mr-cheat-item-copy">
          <h4>{item.title}</h4>
          <p>{item.description}</p>
        </div>
        <button
          type="button"
          className={cx('mr-cheat-copy-btn', copied && 'is-copied')}
          onClick={copySyntax}
          aria-label={copied ? `${item.title} syntax copied` : `Copy ${item.title} syntax`}
        >
          {copied ? Ic.check(13) : Ic.copy(13)}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </header>
      <pre className="mr-cheat-syntax" tabIndex={0}><code>{item.syntax}</code></pre>
      <div className="mr-cheat-item-foot">
        <span className="mr-cheat-rendered-hint">{Ic.eye(12)} {item.rendered}</span>
        <div className="mr-cheat-item-tags">
          {item.tags.slice(0, 4).map((tag) => (
            <button key={tag} type="button" className="mr-cheat-tag" onClick={() => onTagClick(tag)} aria-label={`Filter cheat sheet by ${tag}`}>#{tag}</button>
          ))}
        </div>
      </div>
    </article>
  )
}

export default function CheatSheetPanel() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'All' | CheatCategory>('All')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CHEATSHEET_ITEMS.filter((item) => {
      if (category !== 'All' && item.category !== category) return false
      if (activeTag && !item.tags.includes(activeTag)) return false
      if (!q) return true
      const haystack = `${item.title} ${item.description} ${item.category} ${item.tags.join(' ')} ${item.syntax}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [query, category, activeTag])

  const hasFilters = category !== 'All' || activeTag !== null || query.trim() !== ''

  const resetFilters = () => {
    setQuery('')
    setCategory('All')
    setActiveTag(null)
  }

  const toggleTag = (tag: string) => setActiveTag((current) => (current === tag ? null : tag))

  return (
    <div className="mr-cheatsheet">
      <div className="mr-cheatsheet-search">
        {Ic.search(15)}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search markdown syntax…"
          aria-label="Search markdown cheat sheet"
        />
      </div>

      <div className="mr-cheatsheet-cats" role="group" aria-label="Filter by category">
        {CHEAT_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={cx('mr-cheat-cat-chip', category === cat && 'is-active')}
            onClick={() => setCategory(cat)}
            aria-pressed={category === cat}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mr-cheatsheet-toolbar">
        <span className="mr-cheatsheet-count">Showing {filtered.length} of {CHEATSHEET_ITEMS.length}{activeTag ? ` · #${activeTag}` : ''}</span>
        {hasFilters ? (
          <button type="button" className="mr-cheat-reset" onClick={resetFilters}>{Ic.refresh(12)} Reset filters</button>
        ) : null}
      </div>

      {filtered.length ? (
        <div className="mr-cheatsheet-list">
          {filtered.map((item) => <CheatCard key={item.id} item={item} onTagClick={toggleTag} />)}
        </div>
      ) : (
        <div className="mr-cheatsheet-empty">
          {Ic.search(18)}
          <strong>No syntax matches “{query.trim() || activeTag}”</strong>
          <p>Try a different keyword, or reset the filters to see everything.</p>
          <button type="button" onClick={resetFilters}>Reset filters</button>
        </div>
      )}
    </div>
  )
}
