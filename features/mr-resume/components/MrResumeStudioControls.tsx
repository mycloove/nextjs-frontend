'use client'

import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import styles from './MrResumeStudio.module.css'

export type GlyphName = 'page' | 'plus' | 'chevron' | 'download' | 'globe' | 'type' | 'space' | 'check' | 'back' | 'grip' | 'edit' | 'close' | 'up' | 'down' | 'lock' | 'settings' | 'list' | 'numbered' | 'clear' | 'undo' | 'redo' | 'preview' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'shapeCircle' | 'shapeSquare' | 'resize'

export function Glyph({ name }: { name: GlyphName }) {
  const paths: Record<GlyphName, ReactNode> = {
    page: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 19h14"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    type: <><path d="M4 6V4h16v2M12 4v16M8 20h8"/></>,
    space: <><path d="M4 5h16M4 19h16M7 9v6m5-6v6m5-6v6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    back: <><path d="m15 18-6-6 6-6"/><path d="M9 12h11"/></>,
    grip: <><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>,
    edit: <path d="m15 4 5 5L9 20H4v-5zM13 6l5 5"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    up: <path d="m6 14 6-6 6 6"/>,
    down: <path d="m6 10 6 6 6-6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4M16 10v4M10 16v4"/></>,
    list: <><path d="M9 5h11M9 12h11M9 19h11"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/></>,
    numbered: <><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1v3M4 8h2M4 11h2l-2 2h2M4 17c0-1 2-1 2 0 0 1-2 1-2 2h2"/></>,
    clear: <><path d="m4 16 8-8 6 6-8 8H4zM13 7l2-2 6 6-2 2"/><path d="M4 20h10"/></>,
    undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 0 12h-2"/></>,
    redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9h-9a6 6 0 0 0 0 12h2"/></>,
    preview: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    alignLeft: <path d="M4 5h16M4 12h10M4 19h13"/>,
    alignCenter: <path d="M4 5h16M7 12h10M6 19h12"/>,
    alignRight: <path d="M4 5h16M10 12h10M7 19h13"/>,
    shapeCircle: <circle cx="12" cy="12" r="7"/>,
    shapeSquare: <rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/>,
    resize: <><path d="M15 3h6v6"/><path d="m21 3-6 6"/><path d="M9 21H3v-6"/><path d="m3 21 6-6"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function StudioDropdown({ value, options, onChange, label, icon }: {
  value: string
  options: string[]
  onChange: (value: string) => void
  label: string
  icon?: GlyphName
}) {
  const [open, setOpen] = useState(false)
  const id = `resume-dropdown-${useId()}`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.indexOf(value))

  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus()
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % options.length
    else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    } else return
    event.preventDefault()
    optionRefs.current[next]?.focus()
  }

  return (
    <div ref={rootRef} className={styles.dropdown} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button ref={triggerRef} type="button" className={styles.dropdownTrigger} role="combobox" aria-label={label} aria-haspopup="listbox" aria-controls={open ? id : undefined} aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
        } else if (event.key === 'Escape' && open) setOpen(false)
      }}>
        <span className={styles.dropdownValue}>{icon && <Glyph name={icon} />}{value}</span>
        <span className={styles.dropdownCaret} aria-hidden="true"><Glyph name="chevron" /></span>
      </button>
      {open && <div id={id} className={styles.dropdownMenu} role="listbox" aria-label={label}>
        {options.map((option, index) => <button key={option} ref={(element) => { optionRefs.current[index] = element }} type="button" role="option" aria-selected={option === value} className={option === value ? styles.dropdownOptionSelected : ''} onClick={() => { onChange(option); setOpen(false); triggerRef.current?.focus() }} onKeyDown={(event) => moveFocus(event, index)}>
          <span>{option}</span>{option === value && <Glyph name="check" />}
        </button>)}
      </div>}
    </div>
  )
}
