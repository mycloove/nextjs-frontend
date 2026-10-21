import { Baloo_2 } from 'next/font/google'

import styles from './MyclooveWordmark.module.css'

/*
  mycloove wordmark — the brand name in the homepage lockup.

  Concept: "clove" (a small bud) / "cleave" (to join). The name's one distinctive
  feature is its doubled O, so the two O's are drawn as two overlapping beads — the
  single jewel on an otherwise plain set of letters. Abstract, minimal, and specific
  to this name (it could not be lifted onto another word unchanged).

  The beads are the brand's one accent. Their material is a glass bead lit from the
  top-left, tuned per surface — the canonical pair is the orange brand-v2 octopus's
  family (sampled from that artwork); the earlier cyan → sapphire pair stays available
  via `accent="blue"`. A deeper fill with a soft drop shadow on light, a brighter
  luminescent fill on dark. The letters themselves stay theme-monochrome, so the
  colour means identity, never atmosphere. The beads are sized to match the letters
  so the pair sits level with the word, not as an oversized graphic.

  Type: Baloo 2 at weight 700, tracking -0.01em — the reference lock. Loaded here,
  scoped to this component, deliberately NOT in app/layout.tsx.

  The wordmark is a single non-wrapping row (see the CSS module): the flex row cannot
  break, so the name never wraps in the topbar or footer.

  Canonical brand rules:  /branding/mycloove/README.md
  Directions to compare:  /branding/mycloove/wordmark-directions.html
*/
const brandFont = Baloo_2({ subsets: ['latin'], display: 'swap', variable: '--mycl-font' })

type MyclooveWordmarkSize = 'sm' | 'md' | 'lg' | 'xl'
type MyclooveWordmarkTone = 'auto' | 'light' | 'dark' | 'gradient'
type MyclooveWordmarkVariant = 'rings' | 'plain'
type MyclooveWordmarkAccent = 'blue' | 'orange'

type MyclooveWordmarkProps = {
  /** Size ladder step. `md` is the topbar/footer default. */
  size?: MyclooveWordmarkSize
  /**
   * `auto` (default) follows the theme: ink on light surfaces, cream on dark.
   * `light` / `dark` force a colour; `gradient` is the accent variant.
   */
  tone?: MyclooveWordmarkTone
  /**
   * `rings` (default) draws the doubled O as two overlapping beads — the signature.
   * `plain` sets all eight letters as text, for contexts where the ligature would be
   * too small to read.
   */
  variant?: MyclooveWordmarkVariant
  /**
   * Bead colour family. `orange` (default) is the brand-v2 octopus's family —
   * colours sampled from that artwork, not invented — and is the canonical
   * identity everywhere. `blue` keeps the older cyan → sapphire glass pair for
   * a surface that explicitly asks for it.
   */
  accent?: MyclooveWordmarkAccent
  className?: string
}

export default function MyclooveWordmark({
  size = 'md',
  tone = 'auto',
  variant = 'rings',
  accent = 'orange',
  className = '',
}: MyclooveWordmarkProps) {
  return (
    <span
      className={`${styles.wordmark} ${brandFont.variable} ${styles[size]} ${styles[tone]}${accent === 'orange' ? ` ${styles.orange}` : ''} ${className}`.trim()}
    >
      {/* Visible glyphs are decorative; the accessible name is the plain word below. */}
      <span className={styles.mark} aria-hidden="true">
        <span className={styles.glyph}>mycl</span>
        {variant === 'rings' ? (
          <span className={styles.oo}>
            <span className={styles.bead} />
            <span className={styles.bead} />
          </span>
        ) : (
          <span className={styles.glyph}>oo</span>
        )}
        <span className={styles.glyph}>ve</span>
      </span>
      <span className={styles.srOnly}>mycloove</span>
    </span>
  )
}
