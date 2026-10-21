/* ── Markdown Merge — engine entry ─────────────────────────────────────────
   The one pure function the UI calls. It owns no state, touches no network,
   never reads localStorage — the Unicode conversion that needs a transport is
   injected by `useMergeSession` *before* docs reach here, so every branch below
   is synchronously unit-testable (CLAUDE.md §5, PDF-editor dependency-injection
   pattern applied to this subsystem). */

import type {
  MergeDoc,
  MergeReport,
  MergeResult,
  MergeSourceStat,
} from './types.ts'
import type { MergeOptions } from './types.ts'
import { concatDocuments } from './concat.ts'
import { mergeSectionDocuments } from './section-merge.ts'
import { parseDocument } from './parse.ts'
import { countWords } from './normalize.ts'
import { detectBijoy } from './unicode.ts'

/** Per-source facts for the badges and the header meta — measured, not guessed. */
export function describeSources(docs: MergeDoc[]): MergeSourceStat[] {
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    sections: parseDocument(d.markdown).sections.length,
    words: countWords(d.markdown),
    bijoy: detectBijoy(d.markdown),
  }))
}

export function mergeDocuments(docs: MergeDoc[], options: MergeOptions): MergeResult {
  const intermediate =
    options.mode === 'concat'
      ? concatDocuments(docs, options)
      : mergeSectionDocuments(docs, options)

  const sources = describeSources(docs)
  const report: MergeReport = {
    changes: intermediate.changes,
    warnings: intermediate.warnings,
    sources,
    sections: sources.reduce((n, s) => n + s.sections, 0),
    words: countWords(intermediate.markdown),
  }

  return { markdown: intermediate.markdown, report }
}
