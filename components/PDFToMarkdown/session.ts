/* ═════════════════════════════════════════════════════════════════════════
   Mr. Markdown — workspace session persistence
   ──────────────────────────────────────────────────────────────────────────
   The orchestrator keeps the whole "where am I" in React state, which a reload
   wipes, dropping the user back to the entry hero. This module is the single
   place that serializes that session to localStorage and rebuilds it on boot.

   Only `status === 'done'` documents are stored: they are all the workspace
   renders, and they are the only jobs whose content survives without the PDF
   `File` object (which cannot be serialized). In-flight uploads are counted so
   the orchestrator can say so honestly once, rather than pretend they returned.
   ═════════════════════════════════════════════════════════════════════════ */

import { Job, Mode, computeStats, renderMarkdownToHtml, stripName } from './utils'

export const SESSION_KEY = 'pm.session.v1'
export const WORKSPACE_PREFS_KEY = 'pm.workspace.prefs.v1'
const SESSION_VERSION = 1

/* Bounds so a long-lived session cannot grow without limit. The active document
   is always kept; the cap applies to the rest. */
const MAX_DOCS = 20
const MAX_TOTAL_CHARS = 2 * 1024 * 1024

export type MrSessionOptions = {
  mode: Mode
  bijoy: boolean
  bilingual: boolean
  pageRange: string
  language: string
  activePreset: string | null
}

export type MrSessionDoc = {
  id: string
  title: string
  /** Original upload filename, so exports/frontmatter keep their `source`. */
  sourceName: string
  markdown: string
  confidence: number
  pages?: number
  processedAt?: number
  /** Provenance key (e.g. a GitHub file), so identity survives a reload. */
  sourceId?: string
  /**
   * The GitHub baseline, persisted **only while the document is edited**. A clean
   * document's baseline equals its content, so it is redundant and is dropped to
   * save space; on hydrate it is rebuilt from the content. Keeping it while dirty
   * is what makes "edited, not committed" survive a reload.
   */
  githubBase?: { markdown: string; sha: string | null }
}

export type MrSession = {
  version: number
  savedAt: number
  view: 'upload' | 'workspace'
  newDocumentMode: boolean
  focusMode: boolean
  activeJobId: string | null
  options: MrSessionOptions
  docs: MrSessionDoc[]
  /** Non-done jobs at save time — unrecoverable after reload. */
  lostInFlight: number
  /** Done docs dropped by the size/count cap at save time. */
  droppedCount: number
}

type SerializeInput = {
  jobs: Job[]
  activeJobId: string | null
  view: 'upload' | 'workspace'
  newDocumentMode: boolean
  focusMode: boolean
  options: MrSessionOptions
}

const toDoc = (job: Job): MrSessionDoc => {
  const dirty = job.githubBase && job.markdown !== job.githubBase.markdown
  return {
    id: job.id,
    title: job.title,
    sourceName: job.file?.name ?? `${job.title || 'Untitled document'}.md`,
    markdown: job.markdown,
    confidence: job.confidence,
    pages: job.pages,
    processedAt: job.processedAt,
    sourceId: job.sourceId,
    // Only a dirty baseline is stored: when the document is clean the baseline is
    // the content, so storing both would double its weight for nothing.
    ...(dirty ? { githubBase: job.githubBase } : {}),
  }
}

/** Characters a stored doc will occupy: the body plus a persisted dirty baseline. */
const docChars = (doc: MrSessionDoc): number => doc.markdown.length + (doc.githubBase?.markdown.length ?? 0)

/** Build the persisted session, ordered active-first then most-recent, and
 *  apply the count/size caps. Returns the session plus how many docs it dropped. */
export function serializeSession(input: SerializeInput): { session: MrSession; droppedCount: number } {
  const done = input.jobs.filter((j) => j.status === 'done')
  const ordered = [...done].sort((a, b) => {
    if (a.id === input.activeJobId) return -1
    if (b.id === input.activeJobId) return 1
    return (b.processedAt ?? 0) - (a.processedAt ?? 0)
  })

  const docs: MrSessionDoc[] = []
  let total = 0
  let droppedCount = 0
  for (const job of ordered) {
    const doc = toDoc(job)
    // The cap must count the baseline too, or a dirty document would look smaller
    // than it really is and the limit would silently lie.
    const chars = docChars(doc)
    if (docs.length >= MAX_DOCS || (docs.length > 0 && total + chars > MAX_TOTAL_CHARS)) {
      droppedCount++
      continue
    }
    docs.push(doc)
    total += chars
  }

  return {
    session: {
      version: SESSION_VERSION,
      savedAt: Date.now(),
      view: input.view,
      newDocumentMode: input.newDocumentMode,
      focusMode: input.focusMode,
      activeJobId: input.activeJobId,
      options: input.options,
      docs,
      lostInFlight: input.jobs.filter((j) => j.status !== 'done').length,
      droppedCount,
    },
    droppedCount,
  }
}

/** Rebuild a full editable Job from a stored doc — the same synthetic shape
 *  `openHistoryEntry` uses, with derived fields recomputed rather than stored. */
export function hydrateJob(doc: MrSessionDoc): Job {
  const name = doc.sourceName || `${doc.title || 'Untitled document'}.md`
  return {
    id: doc.id,
    file: new File([doc.markdown], name, { type: 'text/markdown' }),
    title: doc.title || stripName(name) || 'Untitled document',
    status: 'done',
    progress: 100,
    markdown: doc.markdown,
    html: renderMarkdownToHtml(doc.markdown),
    confidence: doc.confidence,
    stats: computeStats(doc.markdown),
    pages: doc.pages,
    processedAt: doc.processedAt,
    passwordAttempts: 0,
    aiActions: {},
    sourceId: doc.sourceId,
    // A clean sourced document lost its (redundant) baseline at save time; it is
    // exactly equal to the content, so rebuild it here. Without this the document
    // would look unsourced on the next edit and could never be committed.
    githubBase: doc.githubBase ?? (doc.sourceId ? { markdown: doc.markdown, sha: null } : undefined),
  }
}

export function loadSession(): MrSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MrSession> | null
    if (!parsed || parsed.version !== SESSION_VERSION) return null
    if (parsed.view !== 'upload' && parsed.view !== 'workspace') return null
    if (!Array.isArray(parsed.docs) || !parsed.options) return null
    return {
      version: SESSION_VERSION,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      view: parsed.view,
      newDocumentMode: Boolean(parsed.newDocumentMode),
      focusMode: Boolean(parsed.focusMode),
      activeJobId: typeof parsed.activeJobId === 'string' ? parsed.activeJobId : null,
      options: parsed.options,
      docs: parsed.docs.filter((d): d is MrSessionDoc => Boolean(d) && typeof d.id === 'string'),
      lostInFlight: typeof parsed.lostInFlight === 'number' ? parsed.lostInFlight : 0,
      droppedCount: typeof parsed.droppedCount === 'number' ? parsed.droppedCount : 0,
    }
  } catch {
    return null
  }
}

export function saveSession(session: MrSession): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* Quota or private-mode failure: the session is a convenience, never a
       hard requirement — the app stays fully usable without it. */
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {}
}

/* ── Workspace editor UI prefs (owned by views.tsx) ──────────────────────── */

export type WorkspacePrefs = {
  editorMode: 'raw' | 'rich'
  preview: 'preview' | 'raw' | 'outline'
  focusView: 'write' | 'split' | 'preview'
  panelCollapsed: boolean
  toolbarCollapsed: boolean
  splitRatio: number
  scrollSync: boolean
  previewOnly: boolean
}

export function loadWorkspacePrefs(): Partial<WorkspacePrefs> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFS_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Partial<Record<keyof WorkspacePrefs, unknown>> | null
    if (!p || typeof p !== 'object') return {}

    const out: Partial<WorkspacePrefs> = {}
    if (p.editorMode === 'raw' || p.editorMode === 'rich') out.editorMode = p.editorMode
    if (p.preview === 'preview' || p.preview === 'raw' || p.preview === 'outline') out.preview = p.preview
    if (p.focusView === 'write' || p.focusView === 'split' || p.focusView === 'preview') out.focusView = p.focusView
    if (typeof p.panelCollapsed === 'boolean') out.panelCollapsed = p.panelCollapsed
    if (typeof p.toolbarCollapsed === 'boolean') out.toolbarCollapsed = p.toolbarCollapsed
    if (typeof p.splitRatio === 'number' && Number.isFinite(p.splitRatio)) out.splitRatio = p.splitRatio
    if (typeof p.scrollSync === 'boolean') out.scrollSync = p.scrollSync
    if (typeof p.previewOnly === 'boolean') out.previewOnly = p.previewOnly
    return out
  } catch {
    return {}
  }
}

export function saveWorkspacePrefs(prefs: WorkspacePrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}
