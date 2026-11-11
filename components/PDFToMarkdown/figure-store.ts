/* ═════════════════════════════════════════════════════════════════════════
   Mr. Markdown — figure persistence (IndexedDB)
   ──────────────────────────────────────────────────────────────────────────
   The workspace session lives in localStorage, which a few figures would
   overflow, so figure bytes live here, keyed by document id. Every call is
   best-effort and reports whether it worked: a browser without IndexedDB (or
   private mode) keeps figures for the tab's life only, and the caller says so
   instead of pretending they were saved.
   ═════════════════════════════════════════════════════════════════════════ */

import type { FigureMap } from './figures.ts'

const DB_NAME = 'mr-markdown-figures'
const STORE = 'figures'
const VERSION = 1

let opening: Promise<IDBDatabase | null> | null = null

function openStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (opening) return opening
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }).then((db) => {
    // A failed open is retried next time rather than cached as "no store".
    if (!db) opening = null
    return db
  })
  opening = attempt
  return attempt
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<{ ok: boolean; value?: T }> {
  return openStore().then((db) => new Promise((resolve) => {
    if (!db) { resolve({ ok: false }); return }
    try {
      const transaction = db.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve({ ok: true, value: request ? request.result : undefined })
      transaction.onerror = () => resolve({ ok: false })
      transaction.onabort = () => resolve({ ok: false })
    } catch {
      resolve({ ok: false })
    }
  }))
}

export async function saveFigures(documentId: string, figures: FigureMap): Promise<boolean> {
  if (!Object.keys(figures).length) return true
  return (await run('readwrite', (store) => store.put(figures, documentId))).ok
}

export async function loadFigures(documentId: string): Promise<FigureMap | null> {
  const result = await run<unknown>('readonly', (store) => store.get(documentId))
  const value = result.value
  return result.ok && value && typeof value === 'object' ? value as FigureMap : null
}

export async function deleteFigures(documentId: string): Promise<void> {
  await run('readwrite', (store) => store.delete(documentId))
}

/** Drop figures no document or history entry can reach any more. */
export async function pruneFigures(keepIds: ReadonlySet<string>): Promise<void> {
  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  const stale = (keys.value ?? []).filter((key): key is string => typeof key === 'string' && !keepIds.has(key))
  if (!stale.length) return
  await run('readwrite', (store) => { for (const key of stale) store.delete(key) })
}
