/* ── Markdown Merge — concatenation (byte-faithful) ────────────────────────
   The honest join. Sources are placed in the chosen order with a separator at
   each seam and nothing else rewritten: the inner bytes of every source survive
   verbatim, only the seam whitespace and the final newline are normalised. That
   is the whole promise of this mode and the colocated tests pin it.

   Pure: no DOM, no React, no network. */

import type { MergeChange, MergeDoc, MergeIntermediate, MergeOptions } from './types.ts'
import {
  countWords,
  hasFenceImbalance,
  resolveFrontmatterBlocks,
  splitFrontmatter,
  trimSeam,
} from './normalize.ts'

/** The literal text dropped between source `a` and the source titled `nextTitle`. */
export function separatorText(opts: MergeOptions, nextTitle: string): string {
  switch (opts.separator.style) {
    case 'blank':
      return '\n\n'
    case 'heading':
      return `\n\n## ${nextTitle}\n\n`
    case 'custom':
      return `\n\n${opts.separator.custom || '---'}\n\n`
    case 'rule':
    default:
      return '\n\n---\n\n'
  }
}

interface Part {
  title: string
  body: string
  rawFrontmatter: string | null
}

export function concatDocuments(docs: MergeDoc[], opts: MergeOptions): MergeIntermediate {
  const changes: MergeChange[] = []
  const warnings: string[] = []

  if (docs.length === 0) {
    return { markdown: '', changes, warnings: ['No sources selected.'] }
  }

  const parts: Part[] = docs.map((d) => {
    const { frontmatter, body } = splitFrontmatter(d.markdown)
    return { title: d.title, body: trimSeam(body), rawFrontmatter: frontmatter }
  })

  for (const d of docs) {
    if (hasFenceImbalance(d.markdown)) {
      warnings.push(`“${d.title}” has an unclosed code fence — check the result around its seam.`)
    }
  }

  const { block, dropped } = resolveFrontmatterBlocks(parts.map((p) => p.rawFrontmatter), opts)
  const nonEmpty = parts.filter((p) => p.body.trim().length > 0)
  if (nonEmpty.length < parts.length) {
    warnings.push(`${parts.length - nonEmpty.length} selected source(s) are empty and were skipped.`)
  }

  let body = nonEmpty[0]?.body ?? ''
  for (let i = 1; i < nonEmpty.length; i++) {
    body += separatorText(opts, nonEmpty[i].title) + nonEmpty[i].body
  }

  let markdown = (block ? `${block}\n\n` : '') + body + (body ? '\n' : '')
  if (opts.collapseBlankLines) markdown = markdown.replace(/\n{3,}/g, '\n\n')

  if (nonEmpty.length > 1) {
    changes.push({ key: 'joined', label: 'Sources joined in order', count: nonEmpty.length })
    changes.push({ key: 'seams', label: 'Seams inserted', count: nonEmpty.length - 1 })
  }
  if (dropped > 0) {
    changes.push({ key: 'frontmatter', label: 'Frontmatter blocks dropped', count: dropped })
  }
  changes.push({ key: 'words', label: 'Words in result', count: countWords(markdown) })

  return { markdown, changes, warnings }
}
