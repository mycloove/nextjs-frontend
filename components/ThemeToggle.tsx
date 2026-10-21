// 'use client';

// import { useEffect, useState } from 'react';

// export default function ThemeToggle() {
//   const [isDark, setIsDark] = useState(() => {
//     if (typeof window !== 'undefined') {
//       const savedTheme = localStorage.getItem('theme');
//       return savedTheme !== 'light';
//     }
//     return true;
//   });

//   // শুধু একবার (মাউন্টের সময়) এবং যখন isDark পরিবর্তন হয় তখন DOM ক্লাস আপডেট করা
//   useEffect(() => {
//     if (isDark) {
//       document.documentElement.classList.remove('light-mode');
//     } else {
//       document.documentElement.classList.add('light-mode');
//     }
//   }, [isDark]);

//   const toggleTheme = () => {
//     const newIsDark = !isDark;
//     setIsDark(newIsDark);
//     if (newIsDark) {
//       document.documentElement.classList.remove('light-mode');
//       localStorage.setItem('theme', 'dark');
//     } else {
//       document.documentElement.classList.add('light-mode');
//       localStorage.setItem('theme', 'light');
//     }
//   };

//   return (
//     <button
//       onClick={toggleTheme}
//       className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
//       aria-label="Toggle theme"
//     >
//       {isDark ? <span className="text-xl">☀️</span> : <span className="text-xl">🌙</span>}
//     </button>
//   );
// }


////////////////new toogle added 28 april////////
'use client'

import { useCallback, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'smilepdf-theme'

// ── Icons ──────────────────────────────────────
const SunIcon = () => (
  <svg
    width="16" height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1"  x2="12" y2="3"  />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1"  y1="12" x2="3"  y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
    <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
  </svg>
)

const MoonIcon = () => (
  <svg
    width="15" height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

// ── Component ──────────────────────────────────
export default function ThemeToggle() {
  // Use deterministic server-safe default (dark).
  // Read persisted theme on client mount and apply it asynchronously
  // to avoid SSR/client markup mismatch.
  const [theme, setTheme] = useState<Theme>('dark')
  
  const applyTheme = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t)
    document.documentElement.style.colorScheme = t
  }, [])

  // On mount, read localStorage and apply theme asynchronously
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
      let next: Theme = 'dark'
      if (saved === 'light' || saved === 'dark') {
        next = saved
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        next = prefersDark ? 'dark' : 'light'
      }
      if (next === theme) return
      requestAnimationFrame(() => {
        setTheme(next)
        applyTheme(next)
      })
    } catch {
      // ignore localStorage errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Theme still applies for this session. */ }
  }

  return (
    <button
      type="button"
      className="sp-theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="icon-wrap">
        <span className="icon-moon"><MoonIcon /></span>
        <span className="icon-sun"><SunIcon /></span>
      </span>
    </button>
  )
}
