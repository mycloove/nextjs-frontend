'use client'

/* ═════════════════════════════════════════════════════════════════════════
   PDF → Markdown · Premium UI orchestrator
   ──────────────────────────────────────────────────────────────────────────
   Backend contract (see app/api/pdf-to-markdown/route.ts):
     POST /api/pdf-to-markdown  (multipart/form-data)
       pdf            : File  (required)
       mode           : 'standard' | 'ocr' | 'tables'
       include_images : 'true' | 'false'
       preserve_fmt   : 'true' | 'false'
       lang           : supported OCR language hint (for example 'eng', 'ben', 'mixed')
       preview        : 'true'  ← we always send this so we get JSON back
       bijoy_mode     : 'true' | 'false'
       page_range     : e.g. '1-5,7'
       password       : (optional)
     → 200 JSON { markdown, confidence?, pages?, credits_used? }
     → 423       { error: 'password_required' }
     → 4xx/5xx   { error }
   ═════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { getApiErrorMessage, toolRequest } from '@/lib/api/client'
import 'katex/dist/katex.min.css'
import AuthNavButton from '@/components/AuthNavButton'
import CreditCost from '@/components/tools/CreditCost'
import ToolSwitcher from '@/components/tools/ToolSwitcher'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import './premium.css'
import { REVIEW_PILOT_ENABLED, acknowledgeReview, createExtractionReview, matchesReviewSource, reviseExtractionReview, sha256Bytes } from './review/model'
import './math.css'
import { Ic } from './icons'
import { MrMarkdownBrandLogo } from './MrMarkdownBrandLogo'
import {
  Job, HistoryEntry, Toast, Mode,
  cx, genId, stripName, downloadBlob, sanitizeExportFilename, escapeHtml, timeAgo,
  createStructuredExport, MrMarkdownExportFormat,
  computeStats, computeConfidence, renderMarkdownToHtml, validatePageRange,
  generateTOC, cleanupMarkdown, injectFrontmatter, chunkMarkdown,
  resolveSourcedDocumentId,
} from './utils'
import {
  UploadHero, PresetsRow, OptionsPanel, JobItem,
  HistoryPanel, Workspace, CommandPalette, ToastStack, ShortcutsModal,
  CmdAction,
} from './views'
import { assertCompleteDiagramExport } from './diagrams/export-contract'
import { diagramExportStyles, renderMarkdownForExport } from './diagrams/export'
import { KATEX_CLASS, KATEX_VERSION } from './math'
import { loadSession, saveSession, serializeSession, hydrateJob } from './session'
import type { OpenDocumentResult } from './settings/settingsContext'

/* ── Config ─────────────────────────────────────────────────── */
const BATCH_LIMIT      = 15
const CONCURRENCY      = 2
const HISTORY_KEY      = 'pm.history.v2'
const HISTORY_MAX      = 40
/* "Pick up where you left off": how many recent items rest collapsed in the
   entry rail. "View all" reveals the rest in place (the list scrolls), so the
   reveal never bounces the page down to the full history section. */
const HISTORY_PREVIEW    = 3
const CHUNK_TOKEN_LIMIT = 3000

function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): File {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error(`Invalid export asset: ${filename}`)
  const metadata = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  const bytes = metadata.includes(';base64')
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return new File([bytes], filename, { type: mimeType })
}

/**
 * The one place a job's Markdown is written: content plus every field derived
 * from it (`stats`, `html`) are recomputed together, so a new write path can
 * never leave the document's derived data stale.
 */
function withMarkdown(job: Job, markdown: string): Job {
  const stats = computeStats(markdown)
  return {
    ...job, markdown, stats, html: renderMarkdownToHtml(markdown),
    ...(job.extractionReview ? { extractionReview: reviseExtractionReview(job.extractionReview, job.markdown, markdown) } : {}),
  }
}

/* ── Preset → option map ────────────────────────────────────── */
const applyPresetOptions = (
  id: string,
): { mode: Mode; bijoy: boolean; bilingual: boolean } => {
  switch (id) {
    case 'research': return { mode: 'standard', bijoy: false, bilingual: false }
    case 'contract': return { mode: 'tables',   bijoy: false, bilingual: false }
    case 'report':   return { mode: 'tables',   bijoy: false, bilingual: false }
    case 'bangla':   return { mode: 'standard', bijoy: true,  bilingual: true  }
    case 'code':     return { mode: 'standard', bijoy: false, bilingual: false }
    default:         return { mode: 'standard', bijoy: false, bilingual: false }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export default function PDFToMarkdown({ publicInfo }: { publicInfo?: ReactNode }) {
  // Both MR views share one resolved actor and one authoritative balance.
  const accountState = useAccountViewer()
  const creditState = useCreditBalance(accountState.status === 'loading' ? null : accountState.viewer?.id ?? 'guest')
  const navigationAvailability = useToolAvailability()
  const converterRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pulseTimer = useRef<number | null>(null)
  /* Session restore bookkeeping — see the hydration effect below. */
  const hydratedRef = useRef(false)
  const workspacePushedRef = useRef(false)
  const [booted, setBooted] = useState(false)
  const [bootNotice, setBootNotice] = useState<string | null>(null)
  /* ── Views ─────────────────────────────────────────────────── */
  const [view, setView] = useState<'upload' | 'workspace'>('upload')
  const [newDocumentMode, setNewDocumentMode] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [converterPulse, setConverterPulse] = useState(false)

  /* ── Options ───────────────────────────────────────────────── */
  const [mode, setMode] = useState<Mode>('standard')
  const [bijoy, setBijoy] = useState(false)
  const [bilingual, setBilingual] = useState(false)
  const [pageRange, setPageRange] = useState('')
  const [language, setLanguage] = useState('auto')
  const [activePreset, setActivePreset] = useState<string | null>(null)

  /* ── Job queue ─────────────────────────────────────────────── */
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  /* ── History (persisted) ───────────────────────────────────── */
  const [history, setHistory] = useState<HistoryEntry[]>([])
  /* The entry rail reveals the rest of the recent list in place instead of
     bouncing the page down to the full history section. */
  const [historyExpanded, setHistoryExpanded] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) setHistory(JSON.parse(raw))
    } catch {}
  }, [])
  const pushHistory = useCallback((h: HistoryEntry) => {
    setHistory((prev) => {
      const next = [h, ...prev.filter((x) => x.name !== h.name)].slice(0, HISTORY_MAX)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])
  const clearHistory = () => {
    setHistory([])
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
  }

  /* ── Toast stack ──────────────────────────────────────────── */
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((kind: Toast['kind'], msg: string) => {
    const t: Toast = { id: genId(), kind, msg }
    setToasts((s) => [...s, t])
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== t.id)), 3200)
  }, [])

  /* ── Overlays ─────────────────────────────────────────────── */
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  /* ── AI busy state (which action is in-flight) ────────────── */
  const [aiBusy, setAiBusy] = useState<string | null>(null)

  /* ═══════════════════════════════════════════════════════════════════════
     WORKSPACE SESSION — restore on boot, autosave on change
     ═══════════════════════════════════════════════════════════════════════ */

  /*
    A reload must land the user back in the workspace with their latest edits, so
    the whole session — documents, active doc, view, options, focus — is restored
    from localStorage before first paint. Docs are rebuilt as synthetic done jobs
    (the same shape openHistoryEntry uses); the PDF File itself cannot survive, so
    only done docs are stored and any lost in-flight upload is reported once and
    honestly, never faked as restored.
  */
  useEffect(() => {
    const loaded = loadSession()
    if (loaded) {
      const restored = loaded.docs.map(hydrateJob)
      const canOpen =
        loaded.view === 'workspace' &&
        !!loaded.activeJobId &&
        restored.some((j) => j.id === loaded.activeJobId)
      const noDocs = restored.length === 0

      setJobs(restored)
      setActiveJobId(canOpen ? loaded.activeJobId : null)
      setView(canOpen ? 'workspace' : 'upload')
      setNewDocumentMode(canOpen ? false : noDocs ? true : loaded.newDocumentMode)
      setFocusMode(loaded.focusMode)
      setMode(loaded.options.mode)
      setBijoy(loaded.options.bijoy)
      setBilingual(loaded.options.bilingual)
      setPageRange(loaded.options.pageRange)
      setLanguage(loaded.options.language)
      setActivePreset(loaded.options.activePreset ?? null)

      if (canOpen && !workspacePushedRef.current) {
        // Re-push so Back still returns to the entry screen after a reload.
        workspacePushedRef.current = true
        window.history.pushState({ pmView: 'workspace' }, '')
      }

      if (loaded.lostInFlight > 0) {
        setBootNotice('Some un-finished uploads could not be restored after the reload.')
      } else if (loaded.droppedCount > 0) {
        setBootNotice('Older documents were trimmed to keep this session within its storage limit.')
      }
    }
    hydratedRef.current = true
    setBooted(true)
  }, [])

  useEffect(() => {
    if (!bootNotice) return
    toast('info', bootNotice)
    setBootNotice(null)
  }, [bootNotice, toast])

  /*
    Autosave the session, debounced so typing settles first. Guarded by
    hydratedRef so it never writes before the restore above has run — otherwise
    the empty initial state would clobber a real session on the first render.
  */
  useEffect(() => {
    if (!hydratedRef.current) return
    const handle = window.setTimeout(() => {
      const { session } = serializeSession({
        jobs,
        activeJobId,
        view,
        newDocumentMode,
        focusMode,
        options: { mode, bijoy, bilingual, pageRange, language, activePreset },
      })
      saveSession(session)
    }, 400)
    return () => window.clearTimeout(handle)
  }, [jobs, activeJobId, view, newDocumentMode, focusMode, mode, bijoy, bilingual, pageRange, language, activePreset])

  /*
    Browser Back returns to the entry screen instead of leaving the page. One
    marker is pushed when entering the workspace; on pop we drop back to the
    dashboard — with its "recent documents" rail — and keep the restored documents.
    The entry mode is restored too so Back lands on the same screen the in-app
    Back button shows, not a stray queue view.
  */
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (event.state && (event.state as { pmView?: string }).pmView === 'workspace') return
      workspacePushedRef.current = false
      setView((current) => (current === 'workspace' ? 'upload' : current))
      setNewDocumentMode(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* ═══════════════════════════════════════════════════════════════════════
     FILE INTAKE
     ═══════════════════════════════════════════════════════════════════════ */

  const addFiles = useCallback((files: File[]) => {
    const pdfFiles = files.filter((file) => (
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ))
    const rejectedCount = files.length - pdfFiles.length
    if (rejectedCount > 0) {
      toast('error', 'PDF to Markdown accepts PDF files only')
    }
    if (!pdfFiles.length) return

    setNewDocumentMode(false)
    setJobs((prev) => {
      const room = BATCH_LIMIT - prev.length
      if (room <= 0) {
        toast('error', `Batch limit is ${BATCH_LIMIT} files`)
        return prev
      }
      const accepted = pdfFiles.slice(0, room).map<Job>((f) => ({
        id: genId(),
        file: f,
        title: stripName(f.name) || 'Untitled document',
        status: 'idle',
        progress: 0,
        markdown: '',
        html: '',
        confidence: 0,
        stats: { headings: 0, lists: 0, codeBlocks: 0, tables: 0, links: 0, words: 0, tokens: 0 },
        passwordAttempts: 0,
        aiActions: {},
      }))
      if (pdfFiles.length > room) toast('info', `Only added first ${room} — batch limit reached`)
      else toast('success', `${accepted.length} file${accepted.length > 1 ? 's' : ''} queued`)
      return [...prev, ...accepted]
    })
  }, [toast])

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setActiveJobId((cur) => (cur === id ? null : cur))
  }, [])

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERSION — preserves backend contract
     ═══════════════════════════════════════════════════════════════════════ */

  const convertOne = useCallback(async (job: Job, passwordOverride?: string) => {
    if (!validatePageRange(pageRange)) {
      updateJob(job.id, { status: 'error', error: 'Bad page range' })
      return
    }
    // No honest percentage is available — the backend streams no progress — so
    // the per-file bar is indeterminate. (The old random ticker fabricated a
    // number that climbed to 88% and then jumped, which is exactly the "never
    // lie about progress" rule this repo holds.)
    updateJob(job.id, { status: 'converting', progress: 0, error: undefined })

    try {
      // Backend contract (see nextjs-frontend/app/api/pdf-to-markdown/route.ts):
      //   pdf, mode, include_images, preserve_fmt, lang, preview,
      //   bijoy_mode, page_range, password
      // We request preview=true so the API returns JSON { markdown, ... }
      // instead of a downloadable ZIP.
      const fd = new FormData()
      fd.append('pdf', job.file)
      fd.append('mode', mode)
      fd.append('preview', 'true')
      fd.append('include_images', 'true')
      fd.append('preserve_fmt', 'true')
      fd.append('bijoy_mode', String(bijoy))
      // Normalize UI language codes to the OCR engine's supported hints.
      const langMap: Record<string, string> = {
        auto: 'auto',
        en: 'eng',
        bn: 'ben',
        hi: 'hin',
        ar: 'ara',
        es: 'es',
        fr: 'fr',
        zh: 'zh',
        ja: 'ja',
        mixed: 'mixed',
      }
      const backendLang = bilingual ? 'mixed' : (langMap[language] || 'auto')
      fd.append('lang', backendLang)
      if (pageRange.trim()) fd.append('page_range', pageRange.trim())
      const pw = passwordOverride ?? job.password
      if (pw) fd.append('password', pw)

      const res = await toolRequest('/api/pdf-to-markdown', { method: 'POST', body: fd })

      if (res.status === 423) {
        const err = await res.json().catch(() => ({ code: 'password_required' }))
        const invalidPassword = err.code === 'invalid_password'
        updateJob(job.id, {
          status: 'password',
          progress: 0,
          error: invalidPassword ? 'Incorrect password. Try again.' : undefined,
          passwordAttempts: job.passwordAttempts + 1,
        })
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        updateJob(job.id, { status: 'error', progress: 0, error: err.error || 'Conversion failed' })
        toast('error', `${stripName(job.file.name)}: ${err.error || 'failed'}`)
        return
      }
      const data = await res.json()
      if (!data || typeof data.markdown !== 'string') throw new Error('The processor did not return a Markdown document.')
      const md: string = data.markdown
      const stats = computeStats(md)
      const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 100 ? data.confidence : computeConfidence(md, stats)
      const html = renderMarkdownToHtml(md)
      const sourceHash = REVIEW_PILOT_ENABLED ? await job.file.arrayBuffer().then(sha256Bytes).catch(() => null) : null
      const extractionReview = REVIEW_PILOT_ENABLED ? createExtractionReview(data, { name: job.file.name, size: job.file.size, sha256: sourceHash }) : undefined
      updateJob(job.id, {
        status: 'done',
        progress: 100,
        markdown: md,
        html,
        confidence,
        stats,
        pages: data.pages,
        processedAt: Date.now(),
        ...(extractionReview ? { extractionReview, sourcePdf: job.file } : {}),
      })
      pushHistory({
        id: job.id, name: job.file.name, markdown: md,
        ts: Date.now(), words: stats.words, confidence,
      })
      const hasNotices = Array.isArray(data.warnings) && data.warnings.length > 0
      toast(hasNotices ? 'info' : 'success', hasNotices
        ? `${stripName(job.file.name)} returned extraction notices. Compare the output with the original before using it.`
        : `${stripName(job.file.name)} converted. Review the result against the original.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      updateJob(job.id, { status: 'error', progress: 0, error: msg })
      toast('error', msg)
    }
  }, [mode, bijoy, bilingual, pageRange, language, updateJob, pushHistory, toast])

  /*
    Entering the workspace pushes exactly one history entry, so browser Back has
    somewhere to return to (the dashboard) instead of leaving /mr-markdown. The
    guard keeps repeat activations inside the workspace from stacking entries.
  */
  const enterWorkspace = useCallback(() => {
    setView('workspace')
    if (typeof window !== 'undefined' && !workspacePushedRef.current) {
      workspacePushedRef.current = true
      window.history.pushState({ pmView: 'workspace' }, '')
    }
  }, [])

  const runQueue = useCallback(async () => {
    const queue = jobs.filter((j) => j.status === 'idle' || j.status === 'error')
    if (queue.length === 0) { toast('info', 'Nothing to convert'); return }
    setConverting(true)
    // Concurrency limiter
    const workers = new Array(CONCURRENCY).fill(0).map(async () => {
      while (true) {
        const next = queue.shift()
        if (!next) break
        await convertOne(next)
      }
    })
    await Promise.all(workers)
    setConverting(false)
    // Auto-open workspace if any succeeded
    setJobs((prev) => {
      const firstDone = prev.find((j) => j.status === 'done')
      if (firstDone && !activeJobId) {
        setActiveJobId(firstDone.id)
        enterWorkspace()
      }
      return prev
    })
  }, [jobs, convertOne, toast, activeJobId, enterWorkspace])

  const submitPassword = useCallback((id: string, pw: string) => {
    const j = jobs.find((x) => x.id === id)
    if (!j) return
    updateJob(id, { password: pw })
    convertOne({ ...j, password: pw }, pw)
  }, [jobs, convertOne, updateJob])

  const retryJob = useCallback((id: string) => {
    const j = jobs.find((x) => x.id === id)
    if (j) convertOne({ ...j, status: 'idle' })
  }, [jobs, convertOne])

  const openJob = useCallback((id: string) => {
    setActiveJobId(id)
    enterWorkspace()
  }, [enterWorkspace])

  const openHistoryEntry = useCallback((h: HistoryEntry) => {
    // Rehydrate as a synthetic done job so user can edit / export
    const synth: Job = {
      id: h.id, file: new File([h.markdown], h.name, { type: 'text/markdown' }),
      title: stripName(h.name) || 'Untitled document',
      status: 'done', progress: 100, markdown: h.markdown,
      html: renderMarkdownToHtml(h.markdown),
      confidence: h.confidence,
      stats: computeStats(h.markdown),
      passwordAttempts: 0, aiActions: {},
      processedAt: h.ts,
    }
    setJobs((prev) => (prev.find((j) => j.id === synth.id) ? prev : [synth, ...prev]))
    setActiveJobId(synth.id)
    enterWorkspace()
  }, [enterWorkspace])

  const openBlankEditor = useCallback(() => {
    const title = 'Untitled document'
    const blank: Job = {
      id: genId(),
      file: new File([''], `${title}.md`, { type: 'text/markdown' }),
      title,
      status: 'done', progress: 100, markdown: '', html: '', confidence: 100,
      stats: computeStats(''), passwordAttempts: 0, aiActions: {}, processedAt: Date.now(),
    }
    setJobs((prev) => [blank, ...prev])
    setActiveJobId(blank.id)
    setNewDocumentMode(false)
    enterWorkspace()
  }, [enterWorkspace])

  /*
    Build a finished document job from markdown. Both the collation result and a
    document handed over from Connections (a GitHub file) arrive this way, so the
    Job shape lives in one place; `sourceId` carries the provenance that hand-over
    needs to recognise a document it has already opened, and `baseMarkdown` /
    `baseSha` record the GitHub version the document is edited against so "edited"
    is a later comparison rather than a guess.
  */
  const buildDocument = useCallback((
    markdown: string,
    name: string,
    sourceId?: string,
    baseMarkdown?: string,
    baseSha?: string | null,
  ): Job => {
    const stats = computeStats(markdown)
    return {
      id: genId(),
      file: new File([markdown], `${name}.md`, { type: 'text/markdown' }),
      title: name,
      status: 'done', progress: 100, markdown,
      html: renderMarkdownToHtml(markdown),
      confidence: computeConfidence(markdown, stats),
      stats,
      passwordAttempts: 0, aiActions: {}, processedAt: Date.now(),
      sourceId,
      // A baseline only exists for a sourced document; a merge or a blank canvas
      // has nothing to be "edited" against.
      ...(sourceId && baseMarkdown !== undefined ? { githubBase: { markdown: baseMarkdown, sha: baseSha ?? null } } : {}),
    }
  }, [])

  /*
    Commit the collation result. A merge is non-destructive: the sources keep
    their ids, their files and their content; the joined markdown arrives as a
    brand-new `done` job, exactly like a restored history entry, and becomes the
    active document. This is the whole contract of MergeDialog's `onCreate`.
  */
  const addMergedDocument = useCallback((markdown: string, title: string) => {
    const name = title.trim() || 'Merged document'
    const merged = buildDocument(markdown, name)
    setJobs((prev) => [merged, ...prev])
    setActiveJobId(merged.id)
    setMergeOpen(false)
    enterWorkspace()
    toast('success', `Collated ${name}.md`)
  }, [buildDocument, enterWorkspace, toast])

  /*
    Open a document handed over from Connections — today a GitHub file. Identity
    is the whole point: the same source must never fork into two documents, so a
    source that is already open is *focused*, not cloned. Same-source focusing is
    deliberately non-destructive: the open document keeps whatever the owner has
    typed into it, rather than being overwritten by the repo copy.

    It reports the outcome to the caller instead of raising a global toast: the
    connection panel stays open, so the confirmation belongs beside the button
    that was pressed, not over the workspace.
  */
  const openSourcedDocument = useCallback((input: { markdown: string; title: string; sourceId?: string; baseMarkdown?: string; baseSha?: string | null }): OpenDocumentResult => {
    const { markdown, title, sourceId, baseMarkdown, baseSha } = input
    const existingId = resolveSourcedDocumentId(jobs, sourceId)
    if (existingId) {
      const existing = jobs.find((job) => job.id === existingId)
      const name = existing?.title ?? 'document'
      setActiveJobId(existingId)
      setMergeOpen(false)
      enterWorkspace()
      return { outcome: 'focused', title: name }
    }
    const name = title.trim() || 'Untitled document'
    const created = buildDocument(markdown, name, sourceId, baseMarkdown, baseSha)
    setJobs((prev) => [created, ...prev])
    setActiveJobId(created.id)
    setMergeOpen(false)
    enterWorkspace()
    return { outcome: 'created', title: name }
  }, [jobs, buildDocument, enterWorkspace])

  /*
    Return to the dashboard. If we pushed a history entry on the way in, walk it
    back (popstate then flips the view); otherwise just switch the view, which
    covers restoring straight into the workspace with no pushed marker.
  */
  const goToDashboard = useCallback(() => {
    setNewDocumentMode(true)
    if (workspacePushedRef.current) {
      workspacePushedRef.current = false
      window.history.back()
    } else {
      setView('upload')
    }
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }, [])

  /*
    Remove a document from the workspace (the sidebar's confirm-gated × calls
    this). If it was the active document, move to the next one, or return to the
    dashboard when the last document goes. The removal is also picked up by the
    session autosave, so a reload won't bring it back.
  */
  const removeDocument = useCallback((id: string) => {
    const target = jobs.find((j) => j.id === id)
    const remaining = jobs.filter((j) => j.id !== id && j.status === 'done')
    setJobs((prev) => prev.filter((j) => j.id !== id))
    if (activeJobId === id) {
      const next = remaining[0]
      if (next) setActiveJobId(next.id)
      else goToDashboard()
    }
    if (target) toast('success', `Removed “${target.title}.md” from the workspace`)
  }, [jobs, activeJobId, goToDashboard, toast])

  const renameDocument = useCallback((id: string, nextTitle: string) => {
    const title = nextTitle.trim().replace(/\.md$/i, '') || 'Untitled document'
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, title } : j)))
    setHistory((prev) => {
      const next = prev.map((entry) => (entry.id === id ? { ...entry, name: `${title}.md` } : entry))
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  /* ═══════════════════════════════════════════════════════════════════════
     EDITING + EXPORTS
     ═══════════════════════════════════════════════════════════════════════ */

  const editMarkdown = useCallback((id: string, md: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? withMarkdown(j, md) : j)))
  }, [])

  const acknowledgeExtraction = useCallback((id: string, issue: string, revision: number, checked: boolean) => {
    setJobs((prev) => prev.map((job) => job.id === id && job.extractionReview?.source.sha256 && job.sourcePdf
      ? { ...job, extractionReview: acknowledgeReview(job.extractionReview, issue, revision, checked) }
      : job))
  }, [])

  const attachReviewSource = useCallback(async (id: string, file: File) => {
    const current = jobs.find((job) => job.id === id)?.extractionReview
    if (!current?.source.sha256) throw new Error('This document has no source fingerprint. Import the original PDF again.')
    if (!await matchesReviewSource(file, current.source)) throw new Error('This file does not match the original PDF. The draft and its source record are unchanged.')
    setJobs((prev) => prev.map((job) => job.id === id && job.extractionReview?.source.sha256 === current.source.sha256 && job.extractionReview.capturedAt === current.capturedAt
      ? { ...job, sourcePdf: file }
      : job))
  }, [jobs])

  /*
    Write-through from the Connections panel: the panel's editor and the workspace
    document are the *same* content, so an edit keyed by provenance lands on the
    document the panel is showing. Routed through the same derived-field helper as
    `editMarkdown`, so stats/html can never drift between the two entry points.
  */
  const editSourcedDocument = useCallback((sourceId: string, md: string) => {
    setJobs((prev) => prev.map((j) => (j.sourceId === sourceId ? withMarkdown(j, md) : j)))
  }, [])

  /*
    Advance a document's baseline after a commit that actually landed: the content
    just published becomes the new "previous", so the document reads as clean and
    its chip clears. `sha` is the new blob version when known, else null — never a
    guessed value.
  */
  const markGithubCommitted = useCallback((sourceId: string, md: string, sha: string | null) => {
    setJobs((prev) => prev.map((j) => (
      j.sourceId === sourceId ? { ...j, githubBase: { markdown: md, sha } } : j
    )))
  }, [])

  /*
    Adopt the remote copy wholesale — the explicit "Re-read from GitHub" path. Both
    the content and the baseline move to the freshly read version, so the document
    is clean against what is actually on GitHub. Destructive to local edits, which
    is why the panel only offers it behind a confirmation.
  */
  const resetSourcedDocument = useCallback((sourceId: string, md: string, sha: string | null) => {
    setJobs((prev) => prev.map((j) => (
      j.sourceId === sourceId ? { ...withMarkdown(j, md), githubBase: { markdown: md, sha } } : j
    )))
  }, [])

  const copyActive = useCallback(async () => {
    const j = jobs.find((x) => x.id === activeJobId)
    if (!j) return
    try {
      await navigator.clipboard.writeText(j.markdown)
      toast('success', 'Copied to clipboard')
    } catch {
      toast('error', 'Clipboard blocked')
    }
  }, [jobs, activeJobId, toast])

  const downloadActive = useCallback(async (fmt: MrMarkdownExportFormat) => {
    const j = jobs.find((x) => x.id === activeJobId)
    if (!j) return
    const base = `mycloove_${sanitizeExportFilename(j.title || stripName(j.file.name))}`
    try {
      if (fmt === 'md') {
        const exported = await renderMarkdownForExport(
          j.markdown,
          document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        )
        if (!exported.assets.length) {
          downloadBlob(j.markdown, `${base}.md`, 'text/markdown;charset=utf-8')
        } else {
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()
          zip.file(`${base}.md`, exported.markdown)
          for (const asset of exported.assets) {
            const comma = asset.dataUrl.indexOf(',')
            const payload = comma >= 0 ? asset.dataUrl.slice(comma + 1) : asset.dataUrl
            const isBase64 = asset.dataUrl.slice(0, comma).includes(';base64')
            zip.file(`images/${asset.filename}`, isBase64 ? payload : decodeURIComponent(payload), { base64: isBase64 })
          }
          downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}-gfm.zip`, 'application/zip')
          if (exported.warnings.length) toast('info', `${exported.warnings.length} diagram(s) kept as source`)
        }
      } else if (fmt === 'pdf') {
        const exported = await renderMarkdownForExport(j.markdown, 'light')
        assertCompleteDiagramExport(exported)
        const fd = new FormData()
        fd.append('md_file', new File([j.markdown], `${base}.md`, { type: 'text/markdown' }))
        fd.append('rendered_html', exported.html)
        fd.append('expected_diagram_count', String(exported.expectedDiagramCount))
        fd.append('rendered_diagram_count', String(exported.renderedDiagramCount))
        fd.append('export_contract_version', '2')
        fd.append('rendered_css', diagramExportStyles())
        const response = await toolRequest('/api/markdown-to-pdf', { method: 'POST', body: fd })
        if (!response.ok) throw new Error(await getApiErrorMessage(response, 'The PDF export could not be created.'))
        downloadBlob(await response.blob(), `${base}.pdf`, 'application/pdf')
        if (exported.warnings.length) toast('info', `${exported.warnings.length} diagram(s) exported as source`)
      } else if (fmt === 'html') {
        const exported = await renderMarkdownForExport(
          j.markdown,
          document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        )
        // Standalone artifacts must render math on their own: inject the KaTeX
        // stylesheet (CDN) and the block styles only when math is present, so
        // math-free documents stay fully offline-identical.
        const usesMath = exported.html.includes(`class="${KATEX_CLASS}`)
        const mathExportHead = usesMath
          ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css" crossorigin="anonymous">`
          : ''
        const mathExportStyles = usesMath
          ? '.pm-math-block{display:block;margin:1.25em 0;text-align:center;overflow-x:auto;padding:4px 0}.pm-math-error{color:#b91c1c;font-family:monospace}'
          : ''
        // Keep the canonical Markdown inside the standalone HTML artifact. It is
        // entity-escaped so characters such as "&copy;" round-trip unchanged.
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${mathExportHead}<title>${escapeHtml(base)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.65;color:#1f2328}pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}code{font-family:SFMono-Regular,Consolas,monospace;font-size:.92em}table{border-collapse:collapse;margin:14px 0;max-width:100%;border:1.5px solid #d0d7de;border-radius:6px;overflow:hidden}th,td{border:1px solid #d0d7de;padding:8px 12px;vertical-align:top}th{background:#f6f8fa;font-weight:600}tbody tr:nth-child(2n){background:#f6f8fa80}img{max-width:100%;height:auto}ul,ol{padding-left:26px}ul{list-style:disc}ul ul{list-style:circle}ul ul ul{list-style:square}ol{list-style:decimal}li{margin:2px 0}pre{position:relative}pre[data-lang]::before{content:attr(data-lang);position:absolute;top:8px;right:12px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#57606a;background:#eaeff3;border-radius:5px;padding:2px 8px}.hljs-keyword,.hljs-selector-tag,.hljs-doctag,.hljs-built_in{color:#cf222e;font-weight:600}.hljs-string,.hljs-regexp,.hljs-addition{color:#0a3069}.hljs-literal,.hljs-number,.hljs-symbol,.hljs-bullet{color:#953800}.hljs-comment,.hljs-quote{color:#6e7781;font-style:italic}.hljs-title,.hljs-title.function_,.hljs-section{color:#0550ae}.hljs-title.class_,.hljs-type{color:#8250df}.hljs-attr,.hljs-attribute,.hljs-property{color:#0550ae}.hljs-variable,.hljs-template-variable,.hljs-params{color:#1f2328}.hljs-selector-id,.hljs-selector-class,.hljs-selector-attr,.hljs-deletion{color:#cf222e}.hljs-tag{color:#116329}.hljs-name{color:#116329;font-weight:600}.hljs-meta{color:#6e7781;font-style:italic}.hljs-meta .hljs-keyword,.hljs-meta .hljs-operator{color:inherit;font-weight:400;font-style:inherit}.hljs-punctuation{color:#6e7781}.hljs-operator{color:#0550ae}${mathExportStyles}${diagramExportStyles()}</style></head><body>${exported.html}<template id="mr-markdown-source">${escapeHtml(j.markdown)}</template></body></html>`

        downloadBlob(html, `${base}.html`, 'text/html;charset=utf-8')
        if (exported.warnings.length) toast('info', `${exported.warnings.length} diagram(s) kept as source`)
      } else if (fmt === 'json') {
        const exported = await renderMarkdownForExport(
          j.markdown,
          document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        )
        const payload = createStructuredExport({
          source: j.file.name,
          pages: j.pages,
          confidence: j.confidence,
          stats: j.stats,
          markdown: exported.markdown,
          html: exported.html,
          assets: exported.assets.map((asset) => ({
            filename: asset.filename,
            mime_type: asset.mimeType,
            data_url: asset.dataUrl,
            alt: asset.alt,
          })),
          warnings: exported.warnings,
        })
        downloadBlob(JSON.stringify(payload, null, 2), `${base}.json`, 'application/json;charset=utf-8')
        if (exported.warnings.length) toast('info', `${exported.warnings.length} diagram(s) kept as source`)
      } else if (fmt === 'docx') {
        const exported = await renderMarkdownForExport(j.markdown, 'light')
        const fd = new FormData()
        fd.append('markdown', exported.markdown)
        fd.append('filename', base)
        for (const asset of exported.assets) {
          fd.append('assets', dataUrlToFile(asset.dataUrl, asset.filename, asset.mimeType))
        }
        const response = await toolRequest('/api/export/docx', {
          method: 'POST',
          body: fd,
        })
        if (!response.ok) throw new Error(await getApiErrorMessage(response, 'The Word export could not be created.'))
        downloadBlob(await response.blob(), `${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        if (exported.warnings.length) toast('info', `${exported.warnings.length} diagram(s) kept as source`)
      } else if (fmt === 'chunks') {
        const chunks = chunkMarkdown(j.markdown, CHUNK_TOKEN_LIMIT)
        const payload = {
          source: j.file.name,
          chunk_count: chunks.length,
          token_limit: CHUNK_TOKEN_LIMIT,
          markdown: j.markdown,
          exported_at: new Date().toISOString(),
          chunks,
        }
        downloadBlob(JSON.stringify(payload, null, 2), `${base}.chunks.json`, 'application/json;charset=utf-8')
      }
      toast('success', `Downloaded ${fmt.toUpperCase()}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The export could not be completed.'
      toast('error', message)
    }
  }, [jobs, activeJobId, toast])

  /* ═══════════════════════════════════════════════════════════════════════
     DOCUMENT ACTIONS — deterministic edits; remote text actions fail closed
     ═══════════════════════════════════════════════════════════════════════ */

  const runAiAction = useCallback(async (
    kind: 'cleanup' | 'toc' | 'summarize' | 'translate' | 'frontmatter' | 'chunk',
  ) => {
    const j = jobs.find((x) => x.id === activeJobId)
    if (!j) return
    // Document AI's RAG endpoint requires indexed document IDs. Sending a draft
    // there can return a refusal as text, not a safe rewrite. Never substitute it
    // for this document or silently send only a prefix of the user's content.
    if (kind === 'summarize' || kind === 'translate') {
      toast('info', 'Summary and translation are unavailable for editor drafts. Your document has not been sent or changed.')
      return
    }
    setAiBusy(kind)
    try {
      if (kind === 'toc') {
        const toc = generateTOC(j.markdown)
        editMarkdown(j.id, toc + '\n\n' + j.markdown)
        toast('success', 'Table of contents added')
      } else if (kind === 'frontmatter') {
        const withFm = injectFrontmatter(j.markdown, {
          title: j.title || stripName(j.file.name),
          source: j.file.name,
          pages: j.pages,
          language: language !== 'auto' ? language : undefined,
          tokens: j.stats.tokens,
          confidence: j.confidence,
        })
        editMarkdown(j.id, withFm)
        toast('success', 'Frontmatter added')
      } else if (kind === 'cleanup') {
        editMarkdown(j.id, cleanupMarkdown(j.markdown))
        toast('success', 'Local cleanup applied')
      } else if (kind === 'chunk') {
        await downloadActive('chunks')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI action failed'
      toast('error', msg)
    } finally {
      setAiBusy(null)
    }
  }, [jobs, activeJobId, editMarkdown, downloadActive, language, toast])

  /* ═══════════════════════════════════════════════════════════════════════
     PRESETS
     ═══════════════════════════════════════════════════════════════════════ */

  const pickPreset = useCallback((id: string) => {
    setActivePreset(id)
    const o = applyPresetOptions(id)
    setMode(o.mode); setBijoy(o.bijoy); setBilingual(o.bilingual)
    toast('info', `Preset applied: ${id}`)
  }, [toast])

  /* ═══════════════════════════════════════════════════════════════════════
     COMMAND PALETTE ACTIONS
     ═══════════════════════════════════════════════════════════════════════ */

  const cmdActions: CmdAction[] = useMemo(() => {
    const acts: CmdAction[] = []
    acts.push({ id: 'new-document', group: 'Actions', label: 'Open blank editor', icon: Ic.edit(13), kbd: '⌘↵', fn: openBlankEditor })
    acts.push({ id: 'collate', group: 'Actions', label: 'Collate documents', icon: Ic.collate(13), fn: () => setMergeOpen(true) })
    acts.push({ id: 'run', group: 'Actions', label: 'Convert queued files', icon: Ic.play(13), fn: runQueue })
    acts.push({ id: 'back', group: 'Navigation', label: 'New document dashboard', icon: Ic.chevron(13), fn: goToDashboard })
    acts.push({ id: 'focus', group: 'Navigation', label: focusMode ? 'Exit focus mode' : 'Enter focus mode', icon: Ic.focus(13), kbd: '⌘/', fn: () => setFocusMode(!focusMode) })
    acts.push({ id: 'help', group: 'Help', label: 'Show keyboard shortcuts', icon: Ic.kbd(13), kbd: '?', fn: () => setHelpOpen(true) })
    if (activeJobId) {
      acts.push({ id: 'copy', group: 'Editor', label: 'Copy markdown', icon: Ic.copy(13), kbd: '⌘C', fn: copyActive })
      acts.push({ id: 'dl-md', group: 'Export', label: 'Download .md', icon: Ic.download(13), kbd: '⌘S', fn: () => downloadActive('md') })
      acts.push({ id: 'dl-html', group: 'Export', label: 'Download .html', icon: Ic.download(13), fn: () => downloadActive('html') })
      acts.push({ id: 'dl-json', group: 'Export', label: 'Download .json', icon: Ic.download(13), fn: () => downloadActive('json') })
      acts.push({ id: 'dl-docx', group: 'Export', label: 'Download .docx', icon: Ic.download(13), fn: () => downloadActive('docx') })
      acts.push({ id: 'dl-chunks', group: 'Export', label: 'Split for AI (chunks.json)', icon: Ic.chunks(13), fn: () => downloadActive('chunks') })
      acts.push({ id: 'ai-clean', group: 'Editor', label: 'Clean up Markdown locally', icon: Ic.broom(13), fn: () => runAiAction('cleanup') })
      acts.push({ id: 'ai-toc', group: 'Editor', label: 'Add table of contents', icon: Ic.toc(13), fn: () => runAiAction('toc') })
      acts.push({ id: 'ai-fm', group: 'Editor', label: 'Add YAML frontmatter', icon: Ic.file(13), fn: () => runAiAction('frontmatter') })
    }
    jobs.forEach((j) => {
      if (j.status === 'done') acts.push({
        id: `open-${j.id}`, group: 'Files',
        label: `Open ${j.title}.md`,
        icon: Ic.markdown(13),
        fn: () => openJob(j.id),
      })
    })
    return acts
  }, [runQueue, focusMode, activeJobId, copyActive, downloadActive, runAiAction, jobs, openJob, openBlankEditor, goToDashboard])

  /* ═══════════════════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
     ═══════════════════════════════════════════════════════════════════════ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      const inField = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen((s) => !s); return }
      if (mod && e.key === 'Enter')             { e.preventDefault(); openBlankEditor(); return }
      if (mod && e.key === '/')                 { e.preventDefault(); setFocusMode((s) => !s); return }

      if (view === 'workspace' && activeJobId) {
        if (mod && e.key.toLowerCase() === 'c' && !inField) {
          /* If the user selected text with mouse/keyboard (rich editor,
             preview, anywhere), native copy must win — no toast, no
             hijack. The "Copy markdown" behaviour stays for the toolbar
             button and when nothing is selected. */
          const selection = window.getSelection()
          const hasTextSelection = !!selection && !selection.isCollapsed && selection.toString().length > 0
          if (hasTextSelection) return
          e.preventDefault()
          copyActive()
          return
        }
        if (mod && e.key.toLowerCase() === 's')             { e.preventDefault(); downloadActive('md'); return }
      }

      if (e.key === '?' && !inField)        { e.preventDefault(); setHelpOpen((s) => !s); return }
      if (e.key === 'Escape') {
        if (mergeOpen)     setMergeOpen(false)
        else if (cmdkOpen) setCmdkOpen(false)
        else if (helpOpen) setHelpOpen(false)
        else if (view === 'workspace' && !focusMode) { /* stay */ }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openBlankEditor, view, activeJobId, copyActive, downloadActive, cmdkOpen, helpOpen, mergeOpen, focusMode])

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  const doneCount   = jobs.filter((j) => j.status === 'done').length
  const errorCount  = jobs.filter((j) => j.status === 'error').length
  const queuedCount = jobs.filter((j) => j.status === 'idle').length
  const canRun      = queuedCount + errorCount > 0 && !converting

  const scrollToConverter = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    converterRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    if (reduced) return
    // One gentle emphasis pulse so the eye lands where the CTA pointed.
    setConverterPulse(true)
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current)
    pulseTimer.current = window.setTimeout(() => setConverterPulse(false), 1100)
  }, [])

  /*
    The rail is "recent documents", not just completed conversions: it merges the
    persisted conversion history with every finished document in the current
    workspace (blank canvases and restored sessions included), de-duped by id and
    ordered newest-first. So after a conversion, a blank draft or a browser Back,
    the work just done is right here instead of an empty rail.
  */
  const recentDocs = useMemo<HistoryEntry[]>(() => {
    const byId = new Map<string, HistoryEntry>()
    for (const entry of history) byId.set(entry.id, entry)
    for (const job of jobs) {
      if (job.status !== 'done' || byId.has(job.id)) continue
      const name = job.file?.name ?? `${job.title || 'Untitled document'}.md`
      byId.set(job.id, {
        id: job.id,
        name,
        markdown: job.markdown,
        ts: job.processedAt ?? Date.now(),
        words: job.stats?.words ?? 0,
        confidence: job.confidence,
      })
    }
    return [...byId.values()].sort((a, b) => b.ts - a.ts)
  }, [history, jobs])

  /*
    Inline reveal. Collapsed shows a short preview; expanded shows the full list
    right inside the rail (with its own scroll), so "View all" never throws the
    reader to the bottom of the page.
  */
  const inlineHistory = useMemo(
    () => (historyExpanded ? recentDocs : recentDocs.slice(0, HISTORY_PREVIEW)),
    [recentDocs, historyExpanded],
  )
  const hasMoreHistory = recentDocs.length > HISTORY_PREVIEW
  const toggleHistoryExpanded = useCallback(() => setHistoryExpanded((open) => !open), [])

  /* Back to the dashboard — the same handler the command palette uses, so the
     history entry is walked back in one place. */
  const returnToStart = goToDashboard

  /*
    First paint is held until the session restore above has decided where we are,
    so a hard reload inside the workspace never flashes the entry screen. The
    public information is the same server-owned content used below the entry
    screen. No intake UI or document state is mounted before restoration.
  */
  if (!booted) {
    return (
      <div className="pm-root mr-markdown-upload" style={{ minHeight: '100vh' }}>
        <div className="pm-shell">
          <p className="pm-public-info-status" role="status" aria-busy="true">Restoring your workspace...</p>
          {publicInfo}
        </div>
      </div>
    )
  }

  if (view === 'workspace' && activeJobId) {
    return (
      <div className={cx('pm-root', focusMode && 'pm-focus-mode')}>
        <Workspace
          accountState={accountState}
          creditState={creditState}
          navigationAvailability={navigationAvailability}
          jobs={jobs.filter((j) => j.status === 'done')}
          activeId={activeJobId}
          focusMode={focusMode}
          onActivate={setActiveJobId}
          onRemove={removeDocument}
          onBack={returnToStart}
          onEdit={editMarkdown}
          onAcknowledgeExtraction={acknowledgeExtraction}
          onAttachReviewSource={attachReviewSource}
          onRename={renameDocument}
          onCopy={copyActive}
          onDownload={downloadActive}
          onAiAction={runAiAction}
          onOpenCmdk={() => setCmdkOpen(true)}
          onToggleFocus={() => setFocusMode(!focusMode)}
          onNewFile={openBlankEditor}
          mergeOpen={mergeOpen}
          onOpenMerge={() => setMergeOpen(true)}
          onCloseMerge={() => setMergeOpen(false)}
          onCreateMerged={addMergedDocument}
          onOpenDocument={openSourcedDocument}
          onEditSourcedDocument={editSourcedDocument}
          onMarkGithubCommitted={markGithubCommitted}
          onResetSourcedDocument={resetSourcedDocument}
          aiBusy={aiBusy}
        />
        <CommandPalette open={cmdkOpen} actions={cmdActions} creditState={creditState} onClose={() => setCmdkOpen(false)} />
        <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        <ToastStack toasts={toasts} />
      </div>
    )
  }

  return (
    <div className="pm-root mr-markdown-upload">
      <header className="pm-studio-topbar" data-tool-navbar="pdf-to-markdown">
        <div className="pm-studio-topbar-inner">
          <Link className="pm-studio-brand" href="/" aria-label="mycloove home">
            <MrMarkdownBrandLogo className="mr-nav-brand-logo" />
            <span>Mr. Markdown</span>
            <small>Studio</small>
          </Link>
          <nav className="pm-studio-nav" aria-label="Workspace navigation">
            <a href="#converter">Converter</a>
            <a href="#options">Options</a>
            <button type="button" onClick={() => setHelpOpen(true)}>Shortcuts</button>
          </nav>
          <div className="pm-studio-account">
            <ToolSwitcher toolId="pdf-to-markdown" availability={navigationAvailability} />
            <AuthNavButton chrome="tool" accountState={accountState} creditState={creditState} creditDisplayToolId="pdf-to-markdown" />
            {creditState.snapshot?.prices['pdf-to-markdown']?.enabled !== false && <div className="pm-conversion-cost"><CreditCost toolId="pdf-to-markdown" creditState={creditState} showActionLabel={false} /></div>}
          </div>
        </div>
      </header>
      <div className="pm-shell">
        {newDocumentMode && (
          <section className="pm-studio-hero">
            <div className="pm-studio-hero-copy">
              <div className="pm-studio-eyebrow">Document workspace</div>
              {/* Signature: the line arrives as raw Markdown syntax and resolves.
                  aria-label carries the rendered sentence; the word spans are
                  decorative choreography only. */}
              <h1 className="pm-entry-headline" aria-label="Bring every document into clean Markdown.">
                <span className="pm-md-mark pm-md-mark-left" aria-hidden="true">**</span><span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '140ms' }}>Bring</span>{' '}
                <span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '200ms' }}>every</span>{' '}
                <span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '260ms' }}>document</span>{' '}
                <span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '320ms' }}>into</span>{' '}
                <em><span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '380ms' }}>clean</span>{' '}<span className="pm-entry-word" aria-hidden="true" style={{ animationDelay: '440ms' }}>Markdown.</span></em><span className="pm-md-mark pm-md-mark-right" aria-hidden="true">**</span>
              </h1>
              <p>Convert digital or scanned PDFs into structured Markdown, or start with a blank canvas and write exactly what you need.</p>
              <p lang="bn" className="pm-entry-bangla">লিগ্যাসি বাংলা লেখায় বিজয় থেকে ইউনিকোডের বিকল্প ব্যবহার করুন। রূপান্তরের পরে মূল লেখার সঙ্গে ফলাফল মিলিয়ে নিন।</p>
              <div className="pm-studio-actions">
                <button type="button" className="pm-btn pm-btn-lg pm-entry-cta" onClick={scrollToConverter}>{Ic.upload(15)} Import a document</button>
              </div>
              <div className="pm-entry-meta">
                <span><span className="pm-kbd">⌘ K</span> Command palette</span>
                <span><span className="pm-kbd">⌘ ↵</span> Blank editor</span>
              </div>
            </div>
            <aside
              className={cx('pm-continuation', 'pm-anim-in', historyExpanded && 'is-expanded')}
              style={{ animationDelay: '120ms' }}
              aria-label="Recent documents"
            >
              <div className="pm-continuation-head">
                <span>Pick up where you left off</span>
                {hasMoreHistory && (
                  <button
                    type="button"
                    className={cx('pm-continuation-toggle', historyExpanded && 'is-open')}
                    onClick={toggleHistoryExpanded}
                    aria-expanded={historyExpanded}
                    aria-controls="pm-continuation-list"
                  >
                    <span className="pm-continuation-toggle-label">{historyExpanded ? 'Show less' : 'View all'}</span>
                    <span className="pm-continuation-count" aria-hidden="true">{recentDocs.length}</span>
                    <span className="pm-continuation-chevron" aria-hidden="true">{Ic.chevronDown(12)}</span>
                  </button>
                )}
              </div>
              {recentDocs.length === 0 ? (
                <div className="pm-continuation-empty">Your recent documents will appear here.</div>
              ) : (
                <div
                  id="pm-continuation-list"
                  className={cx('pm-continuation-list', historyExpanded && 'is-expanded')}
                >
                  {inlineHistory.map((h, index) => (
                    <button
                      key={h.id}
                      type="button"
                      className={cx(
                        'pm-continuation-item',
                        index >= HISTORY_PREVIEW && 'is-extra',
                        index === inlineHistory.length - 1 && 'is-last',
                      )}
                      style={index >= HISTORY_PREVIEW ? { animationDelay: `${(index - HISTORY_PREVIEW) * 45}ms` } : undefined}
                      onClick={() => openHistoryEntry(h)}
                    >
                      <span className="pm-continuation-icon">{Ic.markdown(14)}</span>
                      <span className="pm-continuation-body">
                        <strong>{stripName(h.name) || 'Untitled document'}</strong>
                        <small>{h.words.toLocaleString()} words · {h.confidence}/100 text signal</small>
                      </span>
                      <span className="pm-continuation-tail">
                        <span className="pm-continuation-time">{timeAgo(h.ts)}</span>
                        <span className="pm-continuation-go" aria-hidden="true">{Ic.chevron(13)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </section>
        )}
        {newDocumentMode && (
          <section id="converter" ref={converterRef} className={cx('pm-new-document-grid', converterPulse && 'pm-converter-pulse')}>
            <UploadHero onFiles={addFiles} onOpenBlankEditor={openBlankEditor} />
            <aside className="pm-start-panel pm-anim-in" style={{ animationDelay: '160ms' }} aria-label="Start a new document">
              <div className="pm-start-panel-eyebrow">Quick start</div>
              <h2>Open a canvas, or preset the conversion.</h2>
              <button type="button" className="pm-start-choice" onClick={openBlankEditor}>
                <span className="pm-fresh-glyph" aria-hidden="true"><i /><i /><i /></span>
                <span className="pm-start-choice-copy"><strong>Blank Markdown</strong><small>Write from scratch</small></span>
                <span className="pm-start-choice-tail"><span className="pm-kbd">⌘ ↵</span>{Ic.arrow(15)}</span>
              </button>
              <div className="pm-start-panel-divider" />
              <div className="pm-start-presets-head"><span>Conversion preset</span><small>mode · language</small></div>
              <PresetsRow active={activePreset} onPick={pickPreset} />
              <div className="pm-start-panel-note">{Ic.info(13)} A preset sets the mode and Bangla handling for the next import.</div>
            </aside>
          </section>
        )}

        {!newDocumentMode && jobs.length > 0 && (
          <div className="pm-card pm-anim-in" style={{ animationDelay: '40ms' }}>
            <div className="pm-section-head">
              <div className="pm-section-title">
                {Ic.files(14)} Queue · {jobs.length} file{jobs.length !== 1 ? 's' : ''}
                {doneCount > 0 && <span className="pm-chip pm-chip-success" style={{ marginLeft: 8 }}>{doneCount} done</span>}
                {errorCount > 0 && <span className="pm-chip pm-chip-danger" style={{ marginLeft: 4 }}>{errorCount} failed</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="pm-btn pm-btn-sm pm-btn-ghost"
                  onClick={() => { setJobs([]); setActiveJobId(null); setNewDocumentMode(true) }}
                  disabled={converting}
                >
                  {Ic.trash(12)} Clear
                </button>
                <button
                  className="pm-btn pm-btn-sm pm-btn-primary"
                  onClick={runQueue}
                  disabled={!canRun}
                >
                  {converting ? <>{Ic.spinner(13)} Converting…</> : <>{Ic.play(13)} Convert ({queuedCount + errorCount})</>}
                </button>
              </div>
            </div>
            {creditState.snapshot?.prices['pdf-to-markdown']?.enabled !== false ? <div className="pm-conversion-cost pm-queue-credit-cost">
              <span>Per PDF</span><CreditCost toolId="pdf-to-markdown" creditState={creditState} showActionLabel={false} />
            </div> : null}
            <div className="pm-queue">
              {jobs.map((j) => (
                <JobItem
                  key={j.id}
                  job={j}
                  onRemove={removeJob}
                  onRetry={retryJob}
                  onSubmitPassword={submitPassword}
                  onOpen={openJob}
                />
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <UploadHero onFiles={addFiles} compact disabled={jobs.length >= BATCH_LIMIT} />
            </div>
          </div>
        )}

        <div id="options">
          <OptionsPanel
            mode={mode} setMode={setMode}
            bijoy={bijoy} setBijoy={setBijoy}
            bilingual={bilingual} setBilingual={setBilingual}
            pageRange={pageRange} setPageRange={setPageRange}
            language={language} setLanguage={setLanguage}
          />
        </div>

        <div id="history" ref={historyRef}>
          <HistoryPanel
            items={history}
            onOpen={openHistoryEntry}
            onClear={clearHistory}
          />
        </div>

        <footer className="pm-footer">
          <div className="pm-footer-main">
            <div className="pm-footer-assurance">
              <span className="pm-footer-assurance-icon" aria-hidden="true">{Ic.shield(17)}</span>
              <span>
                <strong>Private by design</strong>
                <small>Your documents stay within the configured infrastructure.</small>
              </span>
            </div>
            <div className="pm-footer-actions" aria-label="Workspace help">
              <button className="pm-footer-action" type="button" onClick={() => setHelpOpen(true)}>
                {Ic.kbd(13)} <span>Shortcuts</span> <span className="pm-kbd">?</span>
              </button>
              <button className="pm-footer-action" type="button" onClick={() => setCmdkOpen(true)}>
                {Ic.cmd(13)} <span>Command palette</span> <span className="pm-kbd">⌘K</span>
              </button>
            </div>
          </div>
          <div className="pm-footer-meta">
            <span>Mr. Markdown Studio <strong>v2.0</strong></span>
            <span className="pm-footer-status" lang="bn">বাংলা · EN</span>
            <a href="https://github.com/ahmed-jishan/pdf-smile" target="_blank" rel="noreferrer">GitHub {Ic.arrow(11)}</a>
          </div>
        </footer>
        {publicInfo}
      </div>

      <CommandPalette open={cmdkOpen} actions={cmdActions} creditState={creditState} onClose={() => setCmdkOpen(false)} />
      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <ToastStack toasts={toasts} />
    </div>
  )
}
