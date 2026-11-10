/* Kit glyphs. Stroke icons at currentColor so status colour is set by CSS
   and always sits next to words (colour is never the only cue). */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

export function CheckIcon({ drawClass }: { drawClass?: string }) {
  return <svg {...base}><path className={drawClass} d="M20 6 9 17l-5-5" /></svg>
}

export function WarningIcon() {
  return <svg {...base}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
}

export function ErrorIcon() {
  return <svg {...base}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>
}

export function InfoIcon() {
  return <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
}

export function ArrowIcon({ className }: { className?: string }) {
  return <svg {...base} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}

export function DownloadIcon() {
  return <svg {...base}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
}

export function UploadIcon() {
  return <svg {...base}><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
}
