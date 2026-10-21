import styles from '../MergePdfTool.module.css'

/**
 * The bench's busy mark: a single sheet with a scan line tracing it.
 *
 * Chosen from the LoaderUI reference set — the "Blueprint Scan" document
 * processor — because it is the one loader whose literal subject is a document
 * being read, which is exactly what this bench does while it opens a PDF or
 * binds a page. The generic spinner is the category default and is rejected:
 * this surface is instrumentation, not a web app.
 *
 * It draws entirely in `currentColor`, so it inherits the ink of whatever it is
 * placed on (the accent merge button's own label colour, the quiet panel text)
 * without a second palette or a bare hex (CLAUDE.md §0.2). It is 16×20 — both
 * on the 4px grid — and it is `aria-hidden`: the parent control already
 * announces its state in text, so the mark must not be read twice.
 *
 * Honest state (Astrolabe doctrine 5): this is the *working* mark, never the
 * progress. The merge button keeps reporting its real percentage beside it; the
 * loader never fakes a completion it cannot measure.
 */
export function ScanLoader({ className }: { className?: string }) {
  return <span className={className ? `${styles.scan} ${className}` : styles.scan} aria-hidden="true" />
}
