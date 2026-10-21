/**
 * A small, dependency-free line diff for the GitHub "Compare" view.
 *
 * The write panel lets an owner edit a repository file and review a change
 * before it is committed, so it needs to show **previous (GitHub) → yours** as a
 * unified diff. There is no diff library in this repo and none is wanted here:
 * this is the one place a diff is needed, the input is line-oriented Markdown,
 * and a tiny LCS implementation is easier to test than a dependency is to trust.
 *
 * Two deliberate honesty rules, because the console must never appear to hang or
 * invent an answer:
 *  - **Bounded work.** An LCS table is O(lines²). Past `DIFF_MAX_LINES` (or a
 *    quadratic-cell cap) it degrades to a *coarse* diff that matches the common
 *    prefix and suffix and marks the whole middle as changed. That is a truthful
 *    diff — just not the minimal one — and it can never lock the panel.
 *  - **Line endings are normalised before comparing** so a file that only differs
 *    by CRLF vs LF is not reported as wholly rewritten.
 */

export type DiffLineKind = 'same' | 'add' | 'remove'

export type DiffLine = {
  kind: DiffLineKind
  text: string
  /** 1-based line number in the "before" text, when this line exists there. */
  aLine?: number
  /** 1-based line number in the "after" text, when this line exists there. */
  bLine?: number
}

/** Above this many lines on either side, `diffLines` uses the coarse path. */
export const DIFF_MAX_LINES = 4000
/** Above this many LCS cells (lines × lines), `diffLines` uses the coarse path. */
const DIFF_MAX_CELLS = 4_000_000

/** Split into lines on any of \r\n, \r or \n, so line endings never skew a diff. */
function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export function countDiffLines(text: string): number {
  return toLines(text).length
}

export function isDiffTooLarge(before: string, after: string): boolean {
  const a = countDiffLines(before)
  const b = countDiffLines(after)
  return a > DIFF_MAX_LINES || b > DIFF_MAX_LINES || a * b > DIFF_MAX_CELLS
}

/** Minimal LCS diff. Only called when the input is within the size cap. */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const width = m + 1
  // Lengths are ≤ DIFF_MAX_LINES, so a Uint16 table is ample and keeps the
  // transient allocation small when the inputs are at the cap.
  const table = new Uint16Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let aLine = 1
  let bLine = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], aLine: aLine++, bLine: bLine++ })
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      out.push({ kind: 'remove', text: a[i], aLine: aLine++ })
      i++
    } else {
      out.push({ kind: 'add', text: b[j], bLine: bLine++ })
      j++
    }
  }
  while (i < n) {
    out.push({ kind: 'remove', text: a[i], aLine: aLine++ })
    i++
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j], bLine: bLine++ })
    j++
  }
  return out
}

/** Common prefix + suffix kept, the middle marked wholly changed. Linear, safe. */
function coarseDiff(a: string[], b: string[]): DiffLine[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++

  let tailA = a.length
  let tailB = b.length
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA--
    tailB--
  }

  const out: DiffLine[] = []
  for (let k = 0; k < head; k++) out.push({ kind: 'same', text: a[k], aLine: k + 1, bLine: k + 1 })
  for (let k = head; k < tailA; k++) out.push({ kind: 'remove', text: a[k], aLine: k + 1 })
  for (let k = head; k < tailB; k++) out.push({ kind: 'add', text: b[k], bLine: k + 1 })
  for (let k = tailA; k < a.length; k++) {
    const bIndex = tailB + (k - tailA)
    out.push({ kind: 'same', text: a[k], aLine: k + 1, bLine: bIndex + 1 })
  }
  return out
}

/**
 * A unified list of diff rows for `before → after`. Minimal within the cap;
 * coarse (common prefix/suffix + whole middle changed) beyond it, never hanging.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  if (before === after) return toLines(before).map((text, index) => ({ kind: 'same', text, aLine: index + 1, bLine: index + 1 }))
  const a = toLines(before)
  const b = toLines(after)
  return isDiffTooLarge(before, after) ? coarseDiff(a, b) : lcsDiff(a, b)
}

export type DiffSummary = { added: number; removed: number; changed: boolean }

/**
 * Honest headline counts for the compare header. Counts rows in the same diff
 * the view renders, so the number beside the header always matches what is on
 * screen — including on the coarse path, where it simply reports more.
 */
export function summariseDiff(before: string, after: string): DiffSummary {
  let added = 0
  let removed = 0
  for (const line of diffLines(before, after)) {
    if (line.kind === 'add') added++
    else if (line.kind === 'remove') removed++
  }
  return { added, removed, changed: added > 0 || removed > 0 }
}
