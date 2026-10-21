import type { ReactNode } from 'react'

/**
 * Pixel glyphs for the calibration console.
 *
 * The workspace already speaks in 2px pixel cells — the sidebar's "New" plus
 * (`mr-sidebar-pixel-plus`) and the Merge dialog's settings mark are both drawn
 * that way — so the console's own rail uses the same engraved grid instead of a
 * heavier stroke set. The marks are 2px pixel cells with
 * `shape-rendering: crispEdges`, so they stay sharp at 16px with no antialiasing
 * blur. Simple shapes use an 8×8 grid (a padlock, a bar trace, a contrast disc, a
 * pencil, a key); the glyphs that need real detail — the operator's bust, the info
 * badge, and the GitHub octocat — use a 16×16 grid (1px cells) instead.
 *
 * The two-tone is the house lighting: the left face solid, the right face at 60%,
 * so each mark looks lit from the left. Colour is `currentColor`, so the rail's
 * own token drives it (muted at rest, accent when active) and it stays legible in
 * both themes without a second palette.
 *
 * GitHub is the one outside mark in the set: its glyph is a faithful 16×16
 * pixelation of the real octicons octocat silhouette, drawn in the same two-tone,
 * so Connections reads as GitHub while still belonging to the rail's pixel family.
 * (The provider card inside the section uses the same glyph, at a larger size.)
 *
 * Exported as ready-made elements (not components) so JSX-free modules — the
 * registry and the provider contract — can reference them directly.
 */

/** Render a square cell map (rows of 'X'/'.') as a two-tone pixel glyph. The grid
 *  is derived from the row count so the mark always fills the 16px box: a house
 *  8×8 glyph lands on 2px cells, the 16×16 octocat on 1px cells (its real
 *  resolution — the house grid is too coarse to hold the octocat's shape). */
function pixel(rows: string[]): ReactNode {
  const grid = rows.length
  return (
    <svg
      width={16}
      height={16}
      viewBox={`0 0 ${grid} ${grid}`}
      fill="currentColor"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === 'X' ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              opacity={x < grid / 2 ? undefined : 0.6}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

/** Identity — the operator: an avatar bust, head over shoulders. */
export const accountGlyph: ReactNode = pixel([
  '................',
  '................',
  '.....XXXXXX.....',
  '....XXXXXXXX....',
  '...XXXXXXXXXX...',
  '...XXXXXXXXXX...',
  '....XXXXXXXX....',
  '.....XXXXXX.....',
  '................',
  '....XXXXXXXX....',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '................',
])

/** Security — a padlock: shackle over a body with a solid keyway. */
export const securityGlyph: ReactNode = pixel([
  '........',
  '..XXXX..',
  '.X....X.',
  '.X....X.',
  'XXXXXXXX',
  'XXX..XXX',
  'XXX..XXX',
  'XXXXXXXX',
])

/** Activity — the run trace: three bars rising to the right over a baseline. */
export const activityGlyph: ReactNode = pixel([
  '........',
  '......X.',
  '...X..X.',
  '...X..X.',
  '.X.X..X.',
  '.X.X..X.',
  '.X.X..X.',
  'XXXXXXXX',
])

/** Appearance — the contrast disc: light and dark meet on one diameter. */
export const appearanceGlyph: ReactNode = pixel([
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
])

/** Editor defaults — the writing instrument: a pencil at a working angle. */
export const editorGlyph: ReactNode = pixel([
  '......XX',
  '.....XXX',
  '....XXX.',
  '...XXX..',
  '..XXX...',
  '.XXX....',
  'XXX.....',
  'XX......',
])

/** Shortcuts — a keycap: a keyed plate with its centre mark. */
export const shortcutsGlyph: ReactNode = pixel([
  '........',
  '.XXXXXX.',
  'X......X',
  'X..XX..X',
  'X..XX..X',
  'X......X',
  '.XXXXXX.',
  '........',
])

/** About — an info badge: a filled disc with its 'i' cut out. */
export const aboutGlyph: ReactNode = pixel([
  '................',
  '.....XXXXXX.....',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXX..XXXXXXX',
  'XXXXXXX..XXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXX..XXXXXXX',
  'XXXXXXX..XXXXXXX',
  'XXXXXXX..XXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '.....XXXXXX.....',
])

/**
 * GitHub — the octocat, pixelated from the real mark.
 *
 * The octocat is far too detailed for the house 8×8 grid: sampled there it
 * collapses into an unreadable arch. It only resolves at 16×16 (1px cells at
 * 16px), which is how GitHub's own favicon carries the mark, so Connections uses
 * a finer grid for this glyph alone while keeping the same crispEdges and
 * left-lit two-tone as the rest of the rail.
 */
export const githubGlyph: ReactNode = pixel([
  '.....XXXXXX.....',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  '.XXX........XXX.',
  'XXXX........XXXX',
  'XXX..........XXX',
  'XXX..........XXX',
  'XXX..........XXX',
  'XXX..........XXX',
  'XXXX........XXXX',
  '.XXXXX....XXXXX.',
  '.XX.XX....XXXXX.',
  '..XX......XXXX..',
  '...XXX....XXX...',
  '.....X....X.....',
])

/** Connections — providers Mr. Markdown can hand a document to; today GitHub is the one. */
export const connectionsGlyph: ReactNode = githubGlyph

/**
 * Repository visibility — the public/private pair.
 *
 * These belong to the repo list and the link spec sheet, where the owner has to
 * see *who can see this repo* before they publish to it. The marks are the
 * material itself: a globe for public, a padlock for private. The padlock is the
 * same form as the Security rail mark (a lock is a lock — drawing a second one
 * would be duplication, not iconography); the globe is new, an outline with a
 * solid equator so it stays readable at chip size (11px).
 */
export const repoPublicGlyph: ReactNode = pixel([
  '..XXXX..',
  '.XX..XX.',
  'X.XXXX.X',
  'XXXXXXXX',
  'XXXXXXXX',
  'X.XXXX.X',
  '.XX..XX.',
  '..XXXX..',
])

export const repoPrivateGlyph: ReactNode = securityGlyph
