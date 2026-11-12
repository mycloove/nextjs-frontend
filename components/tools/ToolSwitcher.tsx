'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import type { ToolId } from '@/lib/tools/registry'
import { getRecentConversions } from '@/lib/history/recentConversions'
import ToolIndexMark from './ToolIndexMark'
import { filterNavigation, isNavigationUnavailable, isPaletteShortcut, navigationGroups, recentNavigation, type NavigationAvailability, type NavigationEntry } from './toolNavigation'
import styles from './ToolNavigation.module.css'

type Props = {
  toolId: ToolId
  availability: NavigationAvailability
  className?: string
  /* Opt-in Ctrl/⌘K (roadmap §7.2). Off by default because three surfaces
     already own that chord: the home page (focus search), Mr. Markdown (its
     own palette, and "insert link" in the editor) and Document AI. A host
     turns it on only where nothing else listens. */
  shortcut?: boolean
}

/* Results the arrow keys walk through, in reading order (Recent row first). */
const RESULT_LINKS = 'a[data-recent-tool-link], a[data-tool-link]'

/* Hover intent: a short dwell before the index unfolds, so a pointer crossing
   the bar on its way elsewhere never flashes it open; a slightly longer grace
   before a hover-opened index folds away, so a diagonal path from the trigger
   into the panel does not drop it. */
const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 280

type OpenMode = 'hover' | 'pinned'

/*
  The index hangs from the bar's bottom hairline, full width, as if the bar
  itself unfolds downward. Its top sits 1px up so the panel's edge covers the
  bar's own border instead of doubling it. If the bar has scrolled out of
  view, the index hangs from the top of the viewport. --tn-origin is the
  trigger's centre — where the travelling edge first draws out from — and
  --tn-veil-top keeps the bar itself un-dimmed behind the backdrop.
*/
function positionDialog(dialog: HTMLDialogElement, trigger: HTMLButtonElement) {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const x = viewport?.offsetLeft ?? 0
  const y = viewport?.offsetTop ?? 0
  const bar = trigger.closest('header') ?? trigger
  const edge = bar.getBoundingClientRect().bottom - 1
  const top = Math.max(y, Math.min(edge, y + height - 200))
  const anchor = trigger.getBoundingClientRect()
  dialog.style.left = `${x}px`
  dialog.style.width = `${width}px`
  dialog.style.top = `${top}px`
  dialog.style.maxHeight = `${Math.max(0, y + height - top)}px`
  dialog.style.setProperty('--tn-origin', `${Math.round(anchor.left + anchor.width / 2 - x)}px`)
  dialog.style.setProperty('--tn-veil-top', `${Math.max(0, Math.round(top - y))}px`)
}

const within = (rect: DOMRect, px: number, py: number, slop = 0) =>
  px >= rect.left - slop && px <= rect.right + slop && py >= rect.top - slop && py <= rect.bottom + slop

/* The pointer path a hover-opened index tolerates: the panel, the trigger, and
   the strip of bar between the trigger and the panel's top edge. */
function inHoverZone(dialog: HTMLDialogElement, trigger: HTMLButtonElement, px: number, py: number) {
  const panel = dialog.getBoundingClientRect()
  const button = trigger.getBoundingClientRect()
  if (within(panel, px, py)) return true
  return px >= button.left - 12 && px <= button.right + 12 && py >= button.top - 8 && py <= panel.top + 1
}

const subscribeNever = () => () => {}

/* "⌘K" on Apple devices, "Ctrl K" elsewhere, nothing without a fine pointer
   (touch devices have no such chord). Null on the server so hydration matches. */
function readShortcutLabel(): string | null {
  if (!window.matchMedia('(pointer: fine)').matches) return null
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K'
}

function pickKeys(event: KeyboardEvent) {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    defaultPrevented: event.defaultPrevented,
  }
}

/* ↓ from the search box enters the results; ↑/↓ walk them; ↑ from the first
   returns to the search box; Home/End jump (but not while typing, where they
   move the caret). Enter is the link's own native activation. */
function moveThroughResults(event: KeyboardEvent, dialog: HTMLDialogElement, input: HTMLInputElement | null) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const links = [...dialog.querySelectorAll<HTMLElement>(RESULT_LINKS)]
  if (links.length === 0) return
  const active = document.activeElement
  const index = links.indexOf(active as HTMLElement)
  let next: HTMLElement | null = null
  if (active === input) {
    if (event.key === 'ArrowDown') next = links[0]
  } else if (index !== -1) {
    if (event.key === 'ArrowDown') next = links[Math.min(links.length - 1, index + 1)]
    if (event.key === 'ArrowUp') next = index === 0 ? input : links[index - 1]
    if (event.key === 'Home') next = links[0]
    if (event.key === 'End') next = links[links.length - 1]
  }
  if (!next) return
  event.preventDefault()
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest' })
}

export default function ToolSwitcher({ toolId, availability, className, shortcut = false }: Props) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropPress = useRef(false)
  const navigating = useRef(false)
  /* 'hover': unfolded by pointer dwell — folds away when the pointer leaves.
     'pinned': opened by click, keyboard or ⌘K, or a hover-opened index the
     user has started to use — stays until Esc, a choice or an outside press. */
  const mode = useRef<OpenMode>('pinned')
  const hoverArmed = useRef(true)
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const rearmListener = useRef<((event: PointerEvent) => void) | null>(null)
  const releaseScroll = useRef<(() => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('All tools')
  const [recent, setRecent] = useState<NavigationEntry[]>([])
  const matchingGroups = filterNavigation(query)
  const groups = activeGroup === 'All tools' ? matchingGroups : matchingGroups.filter(({ group }) => group === activeGroup)
  const matchingCount = matchingGroups.reduce((total, group) => total + group.entries.length, 0)
  const count = groups.reduce((total, group) => total + group.entries.length, 0)
  const showRecent = recent.length > 0 && query === '' && activeGroup === 'All tools'
  const toolGroups = groups.filter(({ group }) => group !== 'Workspaces')
  const workspaceGroup = groups.find(({ group }) => group === 'Workspaces') ?? null
  const shortcutLabel = useSyncExternalStore(subscribeNever, readShortcutLabel, () => null)

  const clearTimer = (timer: { current: number }) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = 0
  }

  /* The scroll lock is taken before the index is positioned, so the page's
     scrollbar is already gone when the panel measures the viewport; the
     gutter it leaves is padded so the page under the veil does not jump. */
  const lockScroll = () => {
    if (releaseScroll.current) return
    const body = document.body
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
    const gutter = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gutter > 0) body.style.paddingRight = `${gutter}px`
    releaseScroll.current = () => {
      if (body.style.overflow === 'hidden') body.style.overflow = previous.overflow
      body.style.paddingRight = previous.paddingRight
      releaseScroll.current = null
    }
  }

  /* After the index closes with the pointer still on the trigger (Esc, a
     second press), the trigger must not unfold it again on the next stray
     pointer event — only once the pointer has left the trigger and come back. */
  const disarmHover = () => {
    hoverArmed.current = false
    if (rearmListener.current) return
    const rearm = (event: PointerEvent) => {
      const trigger = triggerRef.current
      if (trigger && within(trigger.getBoundingClientRect(), event.clientX, event.clientY)) return
      hoverArmed.current = true
      window.removeEventListener('pointermove', rearm)
      rearmListener.current = null
    }
    rearmListener.current = rearm
    window.addEventListener('pointermove', rearm, { passive: true })
  }

  const openSwitcher = (how: OpenMode = 'pinned') => {
    clearTimer(openTimer)
    clearTimer(closeTimer)
    const dialog = dialogRef.current
    const trigger = triggerRef.current
    if (!dialog || !trigger || dialog.open) return
    navigating.current = false
    mode.current = how
    setQuery('')
    setActiveGroup('All tools')
    // Read on open, not on render: the log lives in localStorage, which the server render cannot see.
    setRecent(recentNavigation(getRecentConversions(), toolId))
    lockScroll()
    dialog.showModal()
    positionDialog(dialog, trigger)
    setOpen(true)
    // A hover never takes the caret: typing still goes nowhere until the user
    // chooses to use the index, and closing hands focus back where it was.
    if (how === 'hover') dialog.focus({ preventScroll: true })
    else inputRef.current?.focus({ preventScroll: true })
  }
  const openRef = useRef(openSwitcher)
  useEffect(() => {
    openRef.current = openSwitcher
  })

  /* A hover-opened index the user starts to use becomes a pinned one. */
  const pin = (focusSearch = false) => {
    clearTimer(closeTimer)
    if (mode.current === 'pinned') return
    mode.current = 'pinned'
    if (focusSearch) inputRef.current?.focus({ preventScroll: true })
  }
  const pinRef = useRef(pin)
  useEffect(() => {
    pinRef.current = pin
  })

  const scheduleHoverClose = () => {
    if (mode.current !== 'hover' || closeTimer.current) return
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = 0
      if (mode.current === 'hover') dialogRef.current?.close()
    }, HOVER_CLOSE_MS)
  }

  const onTriggerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || !hoverArmed.current) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (dialogRef.current?.open || document.querySelector('dialog[open]')) return
    clearTimer(openTimer)
    openTimer.current = window.setTimeout(() => openRef.current('hover'), HOVER_OPEN_MS)
  }

  const trackHover = (event: ReactPointerEvent<HTMLDialogElement>) => {
    if (mode.current !== 'hover' || !triggerRef.current) return
    if (inHoverZone(event.currentTarget, triggerRef.current, event.clientX, event.clientY)) clearTimer(closeTimer)
    else scheduleHoverClose()
  }

  useEffect(() => {
    if (!shortcut) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const targetIsEditable = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const modalOpen = !!document.querySelector('dialog[open]')
      if (!isPaletteShortcut({ ...pickKeys(event), targetIsEditable, modalOpen })) return
      event.preventDefault()
      openRef.current('pinned')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Native containment runs before document/window editor shortcuts and paste listeners.
    // Because it stops propagation, React never sees keydown inside the dialog,
    // so arrow-key movement through the results lives here too.
    const contain = (event: Event) => {
      event.stopPropagation()
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        event.preventDefault()
        dialog.close()
        return
      }
      // Any key used inside a hover-opened index is intent: keep it open.
      if (event instanceof KeyboardEvent && event.type === 'keydown') {
        pinRef.current()
        moveThroughResults(event, dialog, inputRef.current)
      }
      if (event.type === 'drop' || event.type === 'dragover') event.preventDefault()
    }
    const events = ['keydown', 'keyup', 'paste', 'dragover', 'drop'] as const
    for (const event of events) dialog.addEventListener(event, contain)
    return () => { for (const event of events) dialog.removeEventListener(event, contain) }
  }, [])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const position = () => {
      if (dialogRef.current && triggerRef.current) positionDialog(dialogRef.current, triggerRef.current)
    }
    // The unfold choreography runs once per opening (its last block lands
    // ~1s in); after it, the index is settled.
    const settle = window.setTimeout(() => dialog?.setAttribute('data-settled', ''), 1100)
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      window.clearTimeout(settle)
      dialog?.removeAttribute('data-settled')
      releaseScroll.current?.()
      window.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])

  useEffect(() => () => {
    clearTimer(openTimer)
    clearTimer(closeTimer)
    if (rearmListener.current) window.removeEventListener('pointermove', rearmListener.current)
    releaseScroll.current?.()
  }, [])

  const dismiss = () => dialogRef.current?.close()

  const renderEntry = (entry: NavigationEntry) => {
    const unavailable = isNavigationUnavailable(entry, availability)
    const current = entry.id === toolId
    const content = (
      <>
        <span className={styles.mark}><ToolIndexMark id={entry.id} /></span>
        <span className={styles.entryCopy}>
          <span className={styles.entryTitle}>{entry.label}{current && <span className={styles.current}>Current</span>}</span>
          <span className={styles.description}>{unavailable ? 'Unavailable' : entry.description}</span>
        </span>
      </>
    )
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
  }

  /* Stagger index for the unfold: each block rises in order behind the travelling edge. */
  const rise = (index: number) => ({ '--i': index }) as CSSProperties
  const headingId = (group: string) => `${id}-${group.replaceAll(' ', '-')}`

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
        aria-keyshortcuts={shortcut ? 'Control+K Meta+K' : undefined}
        onClick={() => openSwitcher('pinned')}
        onPointerEnter={onTriggerEnter}
        onPointerLeave={() => clearTimer(openTimer)}
      >
        <span>Tools</span>
        {/* aria-hidden: the accessible name stays exactly "Tools"; the chord is announced via aria-keyshortcuts. */}
        {shortcut && shortcutLabel && <kbd className={styles.shortcutHint} aria-hidden="true">{shortcutLabel}</kbd>}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <dialog
        ref={dialogRef}
        id={id}
        className={styles.dialog}
        tabIndex={-1}
        data-tool-switcher-dialog
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-note`}
        onCancel={(event) => { event.preventDefault(); dismiss() }}
        onClose={() => {
          const wasHover = mode.current === 'hover'
          mode.current = 'pinned'
          clearTimer(closeTimer)
          releaseScroll.current?.()
          setOpen(false)
          disarmHover()
          // A hover-opened index never took focus from the page: the dialog's
          // own focus restoration hands it back to wherever it was.
          if (!wasHover && !navigating.current && triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true })
        }}
        onPointerMove={trackHover}
        onPointerLeave={scheduleHoverClose}
        onPointerDown={(event) => {
          const dialog = event.currentTarget
          const outside = event.target === dialog && !within(dialog.getBoundingClientRect(), event.clientX, event.clientY)
          const trigger = triggerRef.current
          if (outside && mode.current === 'hover' && trigger && within(trigger.getBoundingClientRect(), event.clientX, event.clientY)) {
            // Pressing Tools after it unfolded on hover keeps it open; it does not close it.
            event.preventDefault()
            backdropPress.current = false
            pin(true)
            return
          }
          if (!outside) pin()
          backdropPress.current = outside
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
            {/* No wordmark here: the bar the index hangs from already carries it. */}
            <span className={styles.eyebrow}>TOOL INDEX</span>
            <h2 id={`${id}-title`}>Choose a tool</h2>
          </div>
          <div className={styles.search}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="m10 10 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <label className={styles.srOnly} htmlFor={`${id}-search`}>Search tools or formats</label>
            <input ref={inputRef} id={`${id}-search`} type="search" value={query} onChange={(event) => { pin(); setQuery(event.target.value) }} placeholder="Search tools or formats" autoComplete="off" spellCheck={false} />
            {query && <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear tool search">Clear</button>}
          </div>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close tool switcher">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
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
            <div className={`${styles.layout}${workspaceGroup && toolGroups.length > 0 ? '' : ` ${styles.layoutSingle}`}`}>
              {toolGroups.length > 0 && (
                <div className={styles.main}>
                  {showRecent && (
                    <section className={styles.recent} style={rise(0)} aria-labelledby={`${id}-recent`}>
                      <h3 id={`${id}-recent`}>Recent</h3>
                      <ul>
                        {recent.map((entry) => {
                          const unavailable = isNavigationUnavailable(entry, availability)
                          const content = <><span className={`${styles.mark} ${styles.markSmall}`}><ToolIndexMark id={entry.id} /></span><span className={styles.recentLabel}>{entry.label}{unavailable && <span className={styles.recentNote}> · Unavailable</span>}</span></>
                          return (
                            <li key={`recent-${entry.id}`}>
                              {/* data-recent-tool-link, not data-tool-link: the index keeps exactly one link per destination. */}
                              {unavailable ? <span className={styles.recentChip} aria-disabled="true">{content}</span> : (
                                <Link className={styles.recentChip} href={entry.href} prefetch={false} data-recent-tool-link={entry.id} onNavigate={() => { navigating.current = true }}>{content}</Link>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  )}
                  <div className={`${styles.columns}${toolGroups.length === 1 ? ` ${styles.columnsOne}` : ''}`}>
                    {toolGroups.map(({ group, entries }, index) => (
                      <section key={group} className={styles.group} style={rise(index + 1)} aria-labelledby={headingId(group)}>
                        <h3 id={headingId(group)}>{group.replace(' And ', ' & ')}</h3>
                        <ul>{entries.map(renderEntry)}</ul>
                      </section>
                    ))}
                  </div>
                </div>
              )}
              {workspaceGroup && (
                <section className={styles.rail} style={rise(toolGroups.length + 1)} aria-labelledby={headingId('Workspaces')}>
                  <h3 id={headingId('Workspaces')}>Workspaces</h3>
                  <p className={styles.railNote}>Standalone apps — each opens in its own full-screen layout.</p>
                  <ul>{workspaceGroup.entries.map(renderEntry)}</ul>
                </section>
              )}
            </div>
          )}
        </nav>
        <div className={styles.dialogFoot}>
          <p id={`${id}-note`}>Switching tools does not transfer files. Open in a new tab to keep this workspace open. Use ↑ ↓ to move through results.</p>
          <span role="status" className={styles.results}>{count} {count === 1 ? 'destination' : 'destinations'}{availability.status !== 'ready' && <span className={styles.availabilityNote}> · Availability not confirmed</span>}</span>
        </div>
      </dialog>
    </div>
  )
}