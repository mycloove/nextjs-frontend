'use client'

import { useEffect, useRef, useState } from 'react'

// Editor-scoped theme toggle. Persists to `smilepdf-theme-editor` and
// not touch the global `data-theme`. Parent can pass `onToggle` to apply
// the theme to the editor container.
export default function ThemeToggle2({ onToggle }: { onToggle?: (isDark: boolean) => void }) {
  // Start with a deterministic server-friendly default (light).
  // Read persisted theme and sync to parent only after mount to avoid
  // hydration mismatches between server HTML and client state.
  const [isDark, setIsDark] = useState<boolean>(false)
  const didSyncRef = useRef(false)

  useEffect(() => {
    if (didSyncRef.current) return
    didSyncRef.current = true
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem('smilepdf-theme-editor')
      const next = saved === 'dark'
      // Schedule the state update asynchronously to avoid a synchronous
      // setState inside the effect body which some linters flag.
      requestAnimationFrame(() => {
        setIsDark(next)
        onToggle?.(next)
      })
    } catch {
      // ignore
    }
  }, [onToggle])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    try { localStorage.setItem('smilepdf-theme-editor', next ? 'dark' : 'light') } catch {}
    if (onToggle) onToggle(next)
  }

  return (
    <>
      <style>{`
        .sp-theme-toggle { position: relative; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; padding:0; border:1px solid transparent; cursor:pointer; transition: transform 180ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease; }
        .sp-theme-toggle.is-dark { color: rgba(255,255,255,0.94); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.09); }
        .sp-theme-toggle.is-light { color: #111827; background: rgba(17,24,39,0.04); border-color: rgba(17,24,39,0.12); }
        .sp-theme-toggle.is-dark .icon-moon svg { stroke: rgba(255,255,255,0.94); }
        .sp-theme-toggle.is-light .icon-sun svg { stroke: #111827; }
        .sp-theme-toggle:hover { transform: scale(1.04); }
        .sp-theme-toggle:active { transform: scale(0.96); }
        .sp-theme-toggle:focus { outline: none; }
        .sp-theme-toggle:focus-visible { outline: 2px solid rgba(0,0,0,0.12); outline-offset: 2px; }
        .sp-theme-toggle .icon-wrap { position:relative; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; }
        .sp-theme-toggle .icon-sun, .sp-theme-toggle .icon-moon { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; transition: transform 360ms cubic-bezier(.2,.9,.2,1), opacity 260ms ease; }
        /* default: show moon */
        .sp-theme-toggle.is-dark .icon-moon { opacity:1; transform: rotate(0deg) scale(1); }
        .sp-theme-toggle.is-dark .icon-sun  { opacity:0; transform: rotate(90deg) scale(0.6); }
        /* light state: show sun */
        .sp-theme-toggle:not(.is-dark) .icon-sun  { opacity:1; transform: rotate(0deg) scale(1); }
        .sp-theme-toggle:not(.is-dark) .icon-moon { opacity:0; transform: rotate(-90deg) scale(0.6); }
      `}</style>

      <button
        type="button"
        className={`sp-theme-toggle ${isDark ? 'is-dark' : 'is-light'}`}
        onClick={toggle}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        <span className="icon-wrap">
          <span className="icon-sun" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="3.5"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>
            </svg>
          </span>
          <span className="icon-moon" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 13A8 8 0 0 1 7 3a7 7 0 1 0 10 10z"/>
            </svg>
          </span>
        </span>
      </button>
    </>
  )
}