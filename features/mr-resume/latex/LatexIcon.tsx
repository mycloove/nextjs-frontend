/** Small, local instrument icons; no shared editor or icon-library dependency. */
const paths = {
  files: 'M4 5h16v14H4z M9 5v14',
  file: 'M14 3H6v18h12V7z M14 3v5h4 M9 12h6 M9 16h6',
  image: 'M4 5h16v14H4z M4 17l5-5 4 4 3-3 4 4 M9 9h.01',
  plus: 'M12 5v14 M5 12h14',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 17v3h14v-3',
  download: 'M12 4v12 M7 11l5 5 5-5 M5 17v3h14v-3',
  play: 'M8 4.5v15l12-7.5z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l4 4L19 6',
  alert: 'M12 4L3 20h18z M12 10v4 M12 17h.01',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M13 5h4v4h-4z M7 15h4v4H7z',
  undo: 'M9 4L4 9l5 5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 4l5 5-5 5 M20 9H10a6 6 0 0 0 0 12h3',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6',
  hash: 'M5 9h14 M5 15h14 M10 4L8 20 M16 4l-2 16',
  fold: 'M7 4l5 5 5-5 M7 20l5-5 5 5',
  unfold: 'M7 9l5-5 5 5 M7 15l5 5 5-5',
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
  terminal: 'M3 5h18v14H3z M7 9l3 3-3 3 M13 15h4',
  layers: 'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  rename: 'M4 20l1-5L16 4l4 4L9 19z M13 7l4 4',
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13 M10 11v5 M14 11v5',
  target: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 10v4 M10 12h4',
  copy: 'M8 8h12v13H8z M16 8V3H3v13h5',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9 M20 3v6h-6',
  shield: 'M12 3L5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z M9 12l2 2 4-4',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
} as const

export default function LatexIcon({ name, className }: { name: keyof typeof paths; className?: string }) {
  return <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
