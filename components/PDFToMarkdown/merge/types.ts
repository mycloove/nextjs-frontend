/* ── Markdown Merge — shared contract ──────────────────────────────────────
   Pure types only. No imports, no DOM, no React: this module is the boundary
   every other file in `merge/` speaks through, and it is what a future sibling
   feature would depend on instead of reaching into the engine's internals
   (CLAUDE.md §0.2 — contract at the boundary, never internals). */

/** Two engines, two intents: faithful order-preserving join vs structure-aware merge. */
export type MergeMode = 'concat' | 'section'

/** One mergeable source: a completed document, in or out of the workspace. */
export interface MergeDoc {
  id: string
  title: string
  markdown: string
}

/**
 * What is laid at the seam between two sources.
 * — `blank`  → the plain paragraph gap, nothing visible added
 * — `rule`   → a `---` thematic break
 * — `heading`→ the following source's title as an H2, so the join is labelled
 * — `custom` → an exact string the user typed (shown in mono, bytes are honest)
 */
export type SeparatorStyle = 'blank' | 'rule' | 'heading' | 'custom'

export interface SeparatorOption {
  style: SeparatorStyle
  custom: string
}

/** How a heading whose title already appeared in the collation is handled. */
export type DuplicateHeadingPolicy = 'keep' | 'rename' | 'nest' | 'merge'

/** How section levels are reconciled across sources. */
export type HeadingLevelPolicy = 'as-is' | 'promote' | 'demote'

/** What happens to each source's leading YAML frontmatter block. */
export type FrontmatterPolicy = 'keep-first' | 'merge' | 'strip' | 'new-title'

export interface MergeOptions {
  mode: MergeMode
  separator: SeparatorOption
  duplicateHeading: DuplicateHeadingPolicy
  headingLevel: HeadingLevelPolicy
  frontmatter: FrontmatterPolicy
  /** Sequential renumbering of `[^n]` refs/defs so colliding ids stop colliding. */
  renumberFootnotes: boolean
  /** Rebase relative link/image targets under a per-source folder. */
  rewriteLinks: boolean
  /** Collapse runs of 3+ newlines to a single blank line. */
  collapseBlankLines: boolean
  /** Title used by `new-title` frontmatter and the book H1 under `demote`. */
  documentTitle: string
}

/** One line of the honest change report — a real count, never a vibe. */
export interface MergeChange {
  key: string
  label: string
  count: number
}

/** What each source actually is, for the badges and the header meta. */
export interface MergeSourceStat {
  id: string
  title: string
  sections: number
  words: number
  /** Local heuristic; the server's `detected_bijoy` is authoritative. */
  bijoy: boolean
}

export interface MergeReport {
  changes: MergeChange[]
  warnings: string[]
  sources: MergeSourceStat[]
  sections: number
  words: number
}

export interface MergeResult {
  markdown: string
  report: MergeReport
}

/** What each engine returns before the report is completed and the sources
    stats are attached (engine.ts adds those). Kept in the shared contract so
    both engines can declare it without importing each other. */
export interface MergeIntermediate {
  markdown: string
  changes: MergeChange[]
  warnings: string[]
}

export const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  mode: 'concat',
  separator: { style: 'rule', custom: '---' },
  duplicateHeading: 'rename',
  headingLevel: 'as-is',
  frontmatter: 'keep-first',
  renumberFootnotes: true,
  rewriteLinks: false,
  collapseBlankLines: false,
  documentTitle: 'Merged document',
}

/** A named starting point from the plan's workflow table (§7). */
export interface MergePreset {
  id: string
  label: string
  hint: string
  patch: Partial<MergeOptions> & {
    separator?: SeparatorOption
    headingLevel?: HeadingLevelPolicy
  }
}

export const MERGE_PRESETS: MergePreset[] = [
  {
    id: 'notes',
    label: 'Note consolidation',
    hint: 'Many short notes, faithful order',
    patch: {
      mode: 'concat',
      separator: { style: 'rule', custom: '---' },
      duplicateHeading: 'keep',
      headingLevel: 'as-is',
      frontmatter: 'merge',
      renumberFootnotes: true,
    },
  },
  {
    id: 'sections',
    label: 'Document sections',
    hint: 'Chapters bound under one title',
    patch: {
      mode: 'section',
      duplicateHeading: 'rename',
      headingLevel: 'demote',
      frontmatter: 'new-title',
      renumberFootnotes: true,
    },
  },
  {
    id: 'version',
    label: 'Version merge',
    hint: 'Reconcile two drafts by section',
    patch: {
      mode: 'section',
      duplicateHeading: 'merge',
      headingLevel: 'as-is',
      frontmatter: 'keep-first',
      renumberFootnotes: false,
    },
  },
]
