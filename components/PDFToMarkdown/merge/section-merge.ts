/* ── Markdown Merge — section-aware merge ──────────────────────────────────
   The structural engine: each source is broken into sections and reassembled
   under explicit, reported decisions — duplicate headings, heading level,
   frontmatter, footnotes, relative paths. Every transform is counted in the
   report so a preview change is never silent, and the output is a *new*
   document (sources are never touched).

   Pure: no DOM, no React, no network. */

import type { MergeChange, MergeDoc, MergeIntermediate, MergeOptions } from './types.ts'
import { parseDocument, type MdSection } from './parse.ts'
import {
  countRelativePaths,
  countWords,
  footnoteMax,
  hasFenceImbalance,
  remapFootnotes,
  resolveFrontmatterBlocks,
  rewriteRelativePaths,
  slugify,
} from './normalize.ts'

interface OutSection {
  level: number
  title: string
  body: string
}

const clampLevel = (n: number): number => Math.min(6, Math.max(1, n))

export function mergeSectionDocuments(docs: MergeDoc[], opts: MergeOptions): MergeIntermediate {
  const changes: MergeChange[] = []
  const warnings: string[] = []
  if (docs.length === 0) return { markdown: '', changes, warnings: ['No sources selected.'] }

  const parsed = docs.map((doc) => ({ doc, p: parseDocument(doc.markdown) }))

  const { block, dropped } = resolveFrontmatterBlocks(
    parsed.map((x) => x.p.frontmatter),
    opts,
  )
  if (dropped > 0) changes.push({ key: 'frontmatter', label: 'Frontmatter blocks dropped', count: dropped })

  // Heading-level reconciliation, relative to the shallowest heading present.
  const levels = parsed.flatMap((x) => x.p.sections.map((s) => s.level))
  const minLevel = levels.length ? Math.min(...levels) : 1
  const demote = opts.headingLevel === 'demote'
  const delta =
    opts.headingLevel === 'promote' ? 1 - minLevel : demote ? 1 : 0

  const out: OutSection[] = []
  const seen = new Map<string, number>()
  const renameCounts = new Map<string, number>()

  let shifted = 0
  let dupRenamed = 0
  let dupNested = 0
  let dupMerged = 0
  let footnotes = 0
  let pathRewrites = 0
  let pathAudit = 0
  let setextConverted = 0
  let runningFootMax = 0

  parsed.forEach(({ doc, p }, docIndex) => {
    setextConverted += p.setextCount

    const docFootMax = footnoteMax(doc.markdown)
    const offset = docIndex === 0 ? 0 : runningFootMax
    runningFootMax += docFootMax

    const apply = (text: string): string => {
      let t = text
      if (opts.renumberFootnotes && offset > 0) {
        const r = remapFootnotes(t, offset)
        t = r.text
        footnotes += r.count
      }
      if (opts.rewriteLinks) {
        const r = rewriteRelativePaths(t, `${slugify(doc.title)}/`)
        t = r.text
        pathRewrites += r.count
      } else {
        pathAudit += countRelativePaths(t)
      }
      return t
    }

    // A heading-less source still collates: treat it as one titled section so
    // nothing is dropped, and fold any preamble into the first section body.
    let sections: MdSection[] = p.sections
    if (sections.length === 0 && doc.markdown.trim()) {
      sections = [
        { level: 1, title: doc.title, anchor: slugify(doc.title), body: p.body.trim(), startLine: 0, style: 'atx' },
      ]
    }

    sections.forEach((s, idx) => {
      const title = apply(s.title)
      const bodySource = idx === 0 && p.preamble ? `${p.preamble}\n\n${s.body}` : s.body
      const body = apply(bodySource).trim()
      if (!title.trim() && !body) return

      const level = clampLevel(s.level + delta)
      if (level !== s.level) shifted++

      const key = title.trim().toLowerCase()
      const existing = seen.get(key)
      if (existing === undefined) {
        out.push({ level, title, body })
        seen.set(key, out.length - 1)
        return
      }

      switch (opts.duplicateHeading) {
        case 'rename': {
          const n = (renameCounts.get(key) ?? 1) + 1
          renameCounts.set(key, n)
          out.push({ level, title: `${title} (${n})`, body })
          dupRenamed++
          break
        }
        case 'nest': {
          out.push({ level: clampLevel(level + 1), title, body })
          dupNested++
          break
        }
        case 'merge': {
          const target = out[existing]
          target.body = [target.body, body].filter((t) => t.trim()).join('\n\n')
          dupMerged++
          break
        }
        case 'keep':
        default:
          out.push({ level, title, body })
      }
    })
  })

  const blocks = out.map((s) => {
    const heading = `${'#'.repeat(s.level)} ${s.title}`.trim()
    return s.body ? `${heading}\n\n${s.body}` : heading
  })

  const bookH1 = demote && opts.documentTitle.trim() ? `# ${opts.documentTitle.trim()}` : ''
  const core = [bookH1, blocks.join('\n\n')].filter((t) => t.trim()).join('\n\n')

  let markdown = (block ? `${block}\n\n` : '') + (core ? `${core}\n` : '')
  if (opts.collapseBlankLines) markdown = markdown.replace(/\n{3,}/g, '\n\n')

  if (!out.length) warnings.push('No headings or content found to organise.')
  for (const d of docs) {
    if (hasFenceImbalance(d.markdown)) {
      warnings.push(`“${d.title}” has an unclosed code fence — check the result.`)
    }
  }

  if (dupRenamed) changes.push({ key: 'renamed', label: 'Duplicate headings renamed', count: dupRenamed })
  if (dupNested) changes.push({ key: 'nested', label: 'Duplicate headings nested', count: dupNested })
  if (dupMerged) changes.push({ key: 'merged', label: 'Duplicate sections merged', count: dupMerged })
  if (footnotes) changes.push({ key: 'footnotes', label: 'Footnotes renumbered', count: footnotes })
  if (shifted) changes.push({ key: 'levels', label: 'Heading levels adjusted', count: shifted })
  if (setextConverted) changes.push({ key: 'setext', label: 'Setext headings normalised', count: setextConverted })
  if (pathRewrites) changes.push({ key: 'paths', label: 'Relative paths rebased', count: pathRewrites })
  else if (pathAudit) changes.push({ key: 'paths-audit', label: 'Relative paths detected', count: pathAudit })
  changes.push({ key: 'words', label: 'Words in result', count: countWords(markdown) })

  return { markdown, changes, warnings }
}
