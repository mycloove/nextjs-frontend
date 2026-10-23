'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import type { ToolId } from '@/lib/tools/registry'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import { LayeredIconGlyph } from './layered-icons/LayeredIcon'
import { filterNavigation, isNavigationUnavailable, navigationGroups, type NavigationAvailability, type NavigationEntry } from './toolNavigation'
import styles from './ToolNavigation.module.css'

type Props = { toolId: ToolId; availability: NavigationAvailability; className?: string }

function positionDialog(dialog: HTMLDialogElement, trigger: HTMLButtonElement) {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const x = viewport?.offsetLeft ?? 0
  const y = viewport?.offsetTop ?? 0
  const narrow = width <= 700
  const gutter = narrow ? 8 : 16
  const panelWidth = Math.min(720, width - gutter * 2)
  const anchor = trigger.getBoundingClientRect()
  const top = narrow ? y + gutter : Math.max(y + gutter, Math.min(anchor.bottom + 8, y + height - 240))
  dialog.style.width = `${panelWidth}px`
  dialog.style.left = `${narrow ? x + gutter : Math.max(x + gutter, Math.min(anchor.right - panelWidth, x + width - panelWidth - gutter))}px`
  dialog.style.top = `${top}px`
  dialog.style.maxHeight = `${Math.max(0, y + height - top - gutter)}px`
}

function EntryGlyph({ entry }: { entry: NavigationEntry }) {
  if (entry.id === 'document-ai' || entry.id === 'image-editor') return <span className={styles.formatGlyph}>{entry.format}</span>
  const variant = entry.id === 'batch-process' ? 'batch' : entry.id === 'fasta-tools' ? 'fasta-tool' : entry.id
  return <LayeredIconGlyph variant={variant} />
}

export default function ToolSwitcher({ toolId, availability, className }: Props) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropPress = useRef(false)
  const navigating = useRef(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('All tools')
  const matchingGroups = filterNavigation(query)
  const groups = activeGroup === 'All tools' ? matchingGroups : matchingGroups.filter(({ group }) => group === activeGroup)
  const matchingCount = matchingGroups.reduce((total, group) => total + group.entries.length, 0)
  const count = groups.reduce((total, group) => total + group.entries.length, 0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Native containment runs before document/window editor shortcuts and paste listeners.
    const contain = (event: Event) => {
      event.stopPropagation()
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        event.preventDefault()
        dialog.close()
      }
      if (event.type === 'drop' || event.type === 'dragover') event.preventDefault()
    }
    const events = ['keydown', 'keyup', 'paste', 'dragover', 'drop'] as const
    for (const event of events) dialog.addEventListener(event, contain)
    return () => { for (const event of events) dialog.removeEventListener(event, contain) }
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const position = () => {
      if (dialogRef.current && triggerRef.current) positionDialog(dialogRef.current, triggerRef.current)
    }
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = previousOverflow
      window.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])

  const dismiss = () => dialogRef.current?.close()

  return (
    <div className={`${styles.switcher} ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-tool-switcher-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const dialog = dialogRef.current
          const trigger = triggerRef.current
          if (!dialog || !trigger || dialog.open) return
          navigating.current = false
          setQuery('')
          setActiveGroup('All tools')
          dialog.showModal()
          positionDialog(dialog, trigger)
          setOpen(true)
          inputRef.current?.focus({ preventScroll: true })
        }}
      >
        <span>Tools</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <dialog
        ref={dialogRef}
        id={id}
        className={styles.dialog}
        data-tool-switcher-dialog
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-note`}
        onCancel={(event) => { event.preventDefault(); dismiss() }}
        onClose={() => {
          setOpen(false)
          if (!navigating.current && triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true })
        }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          backdropPress.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        }}
        onClick={(event) => {
          event.stopPropagation()
          if (event.defaultPrevented || (event.target as Element).closest('[data-account-surface]')) return
          if (backdropPress.current && event.target === event.currentTarget) dismiss()
          backdropPress.current = false
        }}
      >
        <div className={styles.dialogHeading}>
          <div className={styles.headingCopy}>
            <div className={styles.brandLine}><MyclooveWordmark size="sm" tone="auto" accent="orange" /><span className={styles.eyebrow}>TOOL INDEX</span></div>
            <h2 id={`${id}-title`}>Choose a tool</h2>
          </div>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close tool switcher">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="m10 10 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <label className={styles.srOnly} htmlFor={`${id}-search`}>Search tools or formats</label>
          <input ref={inputRef} id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools or formats" autoComplete="off" spellCheck={false} />
          {query && <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear tool search">Clear</button>}
        </div>
        <div className={styles.categoryBar} role="group" aria-label="Filter tools by category">
          <button type="button" className={activeGroup === 'All tools' ? styles.categoryActive : ''} aria-pressed={activeGroup === 'All tools'} onClick={() => setActiveGroup('All tools')}>
            <span>All tools</span><span className={styles.categoryCount}>{matchingCount}</span>
          </button>
          {navigationGroups.map((group) => {
            const resultCount = matchingGroups.find((item) => item.group === group)?.entries.length ?? 0
            return <button key={group} type="button" className={activeGroup === group ? styles.categoryActive : ''} aria-pressed={activeGroup === group} onClick={() => setActiveGroup(group)}>
              <span>{group.replace(' And ', ' & ')}</span><span className={styles.categoryCount}>{resultCount}</span>
            </button>
          })}
        </div>
        <nav className={styles.index} aria-label="Tools and workspaces">
          {count === 0 ? (
            <div className={styles.empty}><strong>No matching tools</strong><p>Try another category or search for a tool, format, or workflow.</p><button type="button" onClick={() => { setQuery(''); setActiveGroup('All tools'); inputRef.current?.focus() }}>Show all tools</button></div>
          ) : (
            <div className={styles.groups}>
              {groups.map(({ group, entries }) => (
                <section key={group} className={group === 'Workspaces' ? styles.workspaces : styles.group} aria-labelledby={`${id}-${group.replaceAll(' ', '-')}`}>
                  <h3 id={`${id}-${group.replaceAll(' ', '-')}`}>{group.replace(' And ', ' & ')}</h3>
                  <ul>
                    {entries.map((entry) => {
                      const unavailable = isNavigationUnavailable(entry, availability)
                      const current = entry.id === toolId
                      const content = <><span className={styles.glyph} aria-hidden="true"><EntryGlyph entry={entry} /></span><span className={styles.entryCopy}><span className={styles.entryTitle}>{entry.label}{current && <span className={styles.current}>Current</span>}</span><span className={styles.description}>{unavailable ? 'Unavailable' : entry.description}</span></span></>
                      return (
                        <li key={entry.id} className={current ? styles.currentRow : undefined}>
                          {unavailable ? <span className={styles.entry} aria-disabled="true" data-tool-link={entry.id}>{content}</span> : (
                            <Link className={styles.entry} href={entry.href} prefetch={false} data-tool-link={entry.id} aria-current={current ? 'page' : undefined}
                              onClick={(event) => {
                                if (current && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); dismiss() }
                              }}
                              onNavigate={() => { navigating.current = true }}
                            >{content}</Link>
                          )}
                          {!unavailable && <Link href={entry.href} prefetch={false} target="_blank" rel="noopener noreferrer" className={styles.newTab} aria-label={`Open ${entry.label} in new tab`} title={`Open ${entry.label} in new tab`}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 3h4v4m0-4L7 9M6 3H3v10h10v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </Link>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </nav>
        <div className={styles.dialogFoot}>
          <p id={`${id}-note`}>Switching tools does not transfer files. Open in a new tab to keep this workspace open.</p>
          <span role="status" className={styles.results}>{count} {count === 1 ? 'destination' : 'destinations'}{availability.status !== 'ready' && <span className={styles.availabilityNote}> · Availability not confirmed</span>}</span>
        </div>
      </dialog>
    </div>
  )
}
