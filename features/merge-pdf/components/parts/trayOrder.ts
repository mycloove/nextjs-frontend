import type { TrayItem } from './types.ts'

/**
 * Tray-order rules — the single authority on where a sheet lands in the
 * merged stack. Pure functions, pinned by `trayOrder.test.ts`.
 *
 * The tray is the output order (the exporter reads it top to bottom), so
 * every mutation must keep what the user already arranged and put anything
 * new where the user would expect it. Earlier handlers appended re-selected
 * pages to the end of the tray, which is how "Select all" on the first
 * document silently moved it behind the second one in the downloaded file.
 */

export type TrayIdFactory = (sourceId: number, pageNumber: number) => string

export function makeTrayId(sourceId: number, pageNumber: number): string {
  return `${sourceId}_p${pageNumber}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Where a page of `sourceId` naturally belongs:
 * - after the last sheet of the same document with a lower page number,
 * - else before that document's first (higher-numbered) sheet,
 * - else, when the document has nothing in the tray, before the first sheet
 *   of any document ordered after it in the sources rail (or at the end).
 */
function naturalInsertIndex(
  tray: readonly TrayItem[],
  sourceOrder: readonly number[],
  sourceId: number,
  pageNumber: number,
): number {
  let lastLower = -1
  let firstSame = -1
  for (let i = 0; i < tray.length; i++) {
    const item = tray[i]
    if (item.sourceId !== sourceId) continue
    if (firstSame < 0) firstSame = i
    if (item.pageNumber < pageNumber) lastLower = i
  }
  if (lastLower >= 0) return lastLower + 1
  if (firstSame >= 0) return firstSame

  const rank = sourceOrder.indexOf(sourceId)
  if (rank < 0) return tray.length
  for (let i = 0; i < tray.length; i++) {
    const otherRank = sourceOrder.indexOf(tray[i].sourceId)
    if (otherRank > rank) return i
  }
  return tray.length
}

/** Insert sheets at their natural positions without disturbing existing ones. */
export function insertInNaturalOrder(
  tray: readonly TrayItem[],
  sourceOrder: readonly number[],
  additions: readonly TrayItem[],
): TrayItem[] {
  const next = [...tray]
  const sorted = [...additions].sort(
    (a, b) =>
      sourceOrder.indexOf(a.sourceId) - sourceOrder.indexOf(b.sourceId) || a.pageNumber - b.pageNumber,
  )
  for (const item of sorted) {
    next.splice(naturalInsertIndex(next, sourceOrder, item.sourceId, item.pageNumber), 0, item)
  }
  return next
}

/**
 * Make one document's sheets in the tray equal `pages`: sheets that stay keep
 * their exact position (including any manual arrangement), deselected ones are
 * removed, and newly selected ones are inserted at their natural position.
 */
export function setSourcePages(
  tray: readonly TrayItem[],
  sourceOrder: readonly number[],
  sourceId: number,
  pages: readonly number[],
  makeId: TrayIdFactory = makeTrayId,
): TrayItem[] {
  const wanted = new Set(pages)
  const kept = tray.filter((item) => item.sourceId !== sourceId || wanted.has(item.pageNumber))
  const present = new Set(kept.filter((item) => item.sourceId === sourceId).map((item) => item.pageNumber))
  const additions = [...wanted]
    .filter((page) => !present.has(page))
    .map((pageNumber) => ({ id: makeId(sourceId, pageNumber), sourceId, pageNumber }))
  return insertInNaturalOrder(kept, sourceOrder, additions)
}

/** Toggle a single sheet in or out of the tray. */
export function toggleSourcePage(
  tray: readonly TrayItem[],
  sourceOrder: readonly number[],
  sourceId: number,
  pageNumber: number,
  makeId: TrayIdFactory = makeTrayId,
): TrayItem[] {
  const index = tray.findIndex((item) => item.sourceId === sourceId && item.pageNumber === pageNumber)
  if (index >= 0) return tray.filter((_, i) => i !== index)
  return insertInNaturalOrder(tray, sourceOrder, [{ id: makeId(sourceId, pageNumber), sourceId, pageNumber }])
}

/** True when every document's sheets form one contiguous block. */
export function isGroupedBySource(tray: readonly TrayItem[]): boolean {
  const closed = new Set<number>()
  let current: number | null = null
  for (const item of tray) {
    if (item.sourceId === current) continue
    if (closed.has(item.sourceId)) return false
    if (current !== null) closed.add(current)
    current = item.sourceId
  }
  return true
}

/**
 * Re-stack whole document blocks to follow `sourceOrder`, keeping each
 * document's own internal arrangement. Stable, so equal ranks never swap.
 */
export function orderBlocksBySource(tray: readonly TrayItem[], sourceOrder: readonly number[]): TrayItem[] {
  const rank = (id: number) => {
    const r = sourceOrder.indexOf(id)
    return r < 0 ? Number.MAX_SAFE_INTEGER : r
  }
  return tray
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.sourceId) - rank(b.item.sourceId) || a.index - b.index)
    .map(({ item }) => item)
}

/** "Group by source": document order from the rail, page order within each. */
export function groupBySource(tray: readonly TrayItem[], sourceOrder: readonly number[]): TrayItem[] {
  const rank = (id: number) => {
    const r = sourceOrder.indexOf(id)
    return r < 0 ? Number.MAX_SAFE_INTEGER : r
  }
  return [...tray].sort((a, b) => rank(a.sourceId) - rank(b.sourceId) || a.pageNumber - b.pageNumber)
}

/** Move one sheet to an absolute position (drag-to-position or the ◀ ▶ buttons). */
export function moveTrayItem(tray: readonly TrayItem[], fromIndex: number, toIndex: number): TrayItem[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= tray.length ||
    toIndex < 0 ||
    toIndex >= tray.length
  ) {
    return tray as TrayItem[]
  }
  const next = [...tray]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Files added in one pick or drop are ordered by name, numerically
 * ("2.pdf" before "10.pdf"). The OS hands multi-selections over in no
 * reliable order — Windows puts the last-clicked file first — so name order
 * is the only predictable one. The user can still reorder afterwards.
 */
export function sortFilesByName<T extends { name: string }>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => nameCollator.compare(a.file.name, b.file.name) || a.index - b.index)
    .map(({ file }) => file)
}
