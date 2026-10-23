'use client'

/* All presentational sub-views for PDF → Markdown premium UI.
   These are dumb components — main state lives in the parent hook. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

import { useDropzone } from 'react-dropzone'
import { Ic } from './icons'
import { MrMarkdownBrandLogo } from './MrMarkdownBrandLogo'
import PremiumToolRail from './PremiumToolRail'
import CheatSheetPanel from './CheatSheetPanel'
import MrMarkdownAccountMenu from './MrMarkdownAccountMenu'
import MrMarkdownSettingsConsole from './settings/MrMarkdownSettingsConsole'
import { useWorkspacePreferences } from './settings/useWorkspacePreferences'
import { GithubConnectionProvider } from './settings/connections/GithubConnectionProvider'
import GithubCommitPopover from './settings/connections/GithubCommitPopover'
import { buildGithubSourceId, parseGithubSourceId } from './settings/connections/githubSourceId'
import type { OpenDocument, SettingsSectionId, SourcedDocument } from './settings/settingsContext'
import type { GithubWriteResponse } from '@/lib/integrations/types'
import type { AccountViewerState } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import CreditCost from '@/components/tools/CreditCost'
import type { NavigationAvailability } from '@/components/tools/toolNavigation'
import { DiagramPreview } from './diagrams/DiagramPreview'
import { DiagramInsertMenu } from './diagrams/DiagramInsertMenu'
import type { DiagramTemplate } from './diagrams/types'
import { isSelectionInsideDiagramFence, normalizeDiagramClipboardText } from './diagrams/clipboard'
import { loadWorkspacePrefs, saveWorkspacePrefs } from './session'
import { MergeDialog } from './merge/MergeDialog'
import {
  Job, HistoryEntry, Mode, MrMarkdownExportFormat, humanBytes, timeAgo, renderMarkdownToHtml, cx, escapeHtml,
  createBrokenImagePlaceholder,
} from './utils'

import {
  EmojiPicker, EmojiAutocomplete,
  SlashMenu, DEFAULT_SLASH_ITEMS,
  FindReplaceBar, FindReplaceState,
  TablePicker, LangSelect,
  getAnchoredPopoverStyle,
} from './editor-widgets'
import { githubGlyph } from './settings/icons'
import { EmojiEntry } from './emoji'


import {
  caretCoordinates,
  buildFindRegex,
  findAllMatches,
  htmlToMarkdown,
  isProbablyUrl,
} from './editor-helpers'


/* ═══════════════════════════════════════════════════════════════════════
   FEATURE PRESETS / MODE DEFINITIONS
   ═══════════════════════════════════════════════════════════════════════ */

export const MODES: { id: Mode; name: string; sub: string; icon: (s?: number) => React.ReactNode }[] = [
  { id: 'standard', name: 'Standard', sub: 'Clean text, headings, links', icon: (s) => Ic.file(s) },
  { id: 'tables',   name: 'Tables Focus', sub: 'Preserve grids & forms',   icon: (s) => Ic.table(s) },
  { id: 'ocr',      name: 'OCR Mode',   sub: 'Scanned pages, images',      icon: (s) => Ic.eye(s) },
]

/* Preset bundles, drawn from the converter's real option axes rather than
   genre emoji: each entry mirrors the { mode, bijoy, bilingual } it applies
   (see applyPresetOptions in index.tsx), so the engraved icon and the mono
   effect name the same setting the preset actually turns on. Emoji were the
   wrong tool here — their glyphs differ per OS and could sit on any product's
   tag list; these come from the same icon hand as the rest of the workbench. */
export const PRESETS: {
  id: string
  icon: (s?: number) => React.ReactNode
  label: string
  effect: string
}[] = [
  { id: 'research', icon: (s) => Ic.toc(s),      label: 'Research paper', effect: 'headings · links' },
  { id: 'contract', icon: (s) => Ic.numbered(s), label: 'Contract',       effect: 'grids · forms' },
  { id: 'report',   icon: (s) => Ic.gauge(s),    label: 'Report',         effect: 'grids · forms' },
  { id: 'bangla',   icon: (s) => Ic.bengali(s),  label: 'Bangla legacy',  effect: 'bijoy · bilingual' },
  { id: 'code',     icon: (s) => Ic.code(s),     label: 'Code docs',      effect: 'headings · links' },
]

/* ═══════════════════════════════════════════════════════════════════════
   DROPZONE + HERO
   ═══════════════════════════════════════════════════════════════════════ */

export function UploadHero({
  onFiles, onOpenBlankEditor, compact = false, disabled = false,
}: {
  onFiles: (fs: File[]) => void
  onOpenBlankEditor?: () => void
  compact?: boolean
  disabled?: boolean
}) {
  const [commitName, setCommitName] = useState('')
  const commitTimer = useRef<number | null>(null)

  /* Commit type-in: on drop, the first file name types into the prompt's
     `source:` line before the queue card takes over. Optimistic — `onFiles`
     runs immediately, so intake is never blocked by the choreography. The
     compact variant is untouched. */
  const handleDrop = useCallback((files: File[]) => {
    if (compact) { onFiles(files); return }
    onFiles(files)
    const first = files[0]
    if (!first) return
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const name = first.name
    if (reduced) { setCommitName(name); return }
    setCommitName('')
    if (commitTimer.current) window.clearInterval(commitTimer.current)
    const step = Math.max(12, Math.min(18, Math.floor(700 / Math.max(name.length, 1))))
    let cut = 0
    commitTimer.current = window.setInterval(() => {
      cut += 1
      setCommitName(name.slice(0, cut))
      if (cut >= name.length && commitTimer.current) {
        window.clearInterval(commitTimer.current)
        commitTimer.current = null
      }
    }, step)
  }, [onFiles, compact])

  useEffect(() => () => {
    if (commitTimer.current) window.clearInterval(commitTimer.current)
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: handleDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    disabled,
    noClick: false,
    multiple: true,
  })

  if (compact) {
    return (
      <div
        {...getRootProps({
          className: cx('pm-dropzone', 'pm-dropzone-compact', isDragActive && 'pm-dropzone-active'),
        })}
      >
        <input {...getInputProps()} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="pm-drop-icon" style={{ width: 40, height: 40, margin: 0, borderRadius: 12 }}>
            {Ic.upload(20)}
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div className="pm-drop-title" style={{ fontSize: 13, marginBottom: 2 }}>Add more files</div>
            <div className="pm-drop-sub" style={{ fontSize: 11, margin: 0 }}>Drop PDFs or click to browse</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pm-hero pm-anim-in">
      {/* Frontmatter head: the card opens like the top of a `.md` file, so the
          document being created is legible before a byte is dropped. */}
      <div className="pm-converter-head">
        <div className="pm-head-doc">
          <span className="pm-head-rule" aria-hidden="true">---</span>
          <dl className="pm-head-fields">
            <div>
              <dt>title</dt>
              <dd><h2 className="pm-head-title">Import and convert your source</h2></dd>
            </div>
            <div>
              <dt>batch</dt>
              <dd>up to 15 files · one session</dd>
            </div>
            <div>
              <dt>privacy</dt>
              <dd>{Ic.lock(12)} private by default</dd>
            </div>
          </dl>
          <span className="pm-head-rule" aria-hidden="true">---</span>
        </div>
      </div>

      <div
        {...getRootProps({
          className: cx('pm-dropzone', isDragActive && 'pm-dropzone-active'),
        })}
      >
        <input {...getInputProps()} />
        {/* Editor gutter: frames the surface as a source file. Decorative. */}
        <span className="pm-drop-gutter" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <i key={i}>{i + 1}</i>)}
        </span>
        <div className="pm-drop-stage">
          <span className="pm-drop-insert" aria-hidden="true" />
          {/* Live syntax line — the state of the source, in Markdown. */}
          <div className="pm-drop-prompt" aria-hidden="true">
            <span className="pm-drop-prompt-key">source:</span>
            {/* Caret is the insert point: it exists only while a drag is live.
                Rendering it at rest reserved a 2px slot plus the flex gap on
                both sides, opening a phantom gap after `source:` in the idle
                line. */}
            {isDragActive && <span className="pm-drop-caret" />}
            <span className="pm-drop-prompt-value">
              {commitName || (isDragActive ? 'release to import' : 'drop a PDF to begin')}
            </span>
          </div>
          <div className="pm-drop-title">
            {isDragActive ? 'Release to import' : 'Drop your documents here'}
          </div>
          <div className="pm-drop-sub">Upload a digital or scanned PDF. Password-protected PDFs are supported.</div>
          <div className="pm-drop-actions" onClick={(e) => e.stopPropagation()}>
            <div className="pm-drop-actions-row">
              <button type="button" className="pm-btn pm-entry-cta" onClick={open}>
                {Ic.upload(14)} <span>Browse files</span>
              </button>
              {onOpenBlankEditor && (
                <button type="button" className="pm-write-editor-link" onClick={onOpenBlankEditor}>
                  Write in editor {Ic.arrow(13)}
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Syntax-as-capability ledger: real Markdown tokens, each naming what
            converts. Replaces the loose spec plate and the generic tiles. */}
        <ul className="pm-drop-ledger" aria-label="What converts to Markdown">
          <li><code>#</code><span>Headings &amp; hierarchy</span></li>
          <li><code>-</code><span>Lists &amp; nesting</span></li>
          <li><code>|</code><span>Tables &amp; forms</span></li>
          <li><code>{'```'}</code><span>Code blocks</span></li>
          <li><code>&gt;</code><span>Quotes &amp; notes</span></li>
          <li><code>[]()</code><span>Links</span></li>
          <li><code>---</code><span>Frontmatter</span></li>
          <li><code>অ</code><span>Bijoy → Unicode</span></li>
        </ul>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   PRESETS ROW
   ═══════════════════════════════════════════════════════════════════════ */

export function PresetsRow({
  active, onPick,
}: { active: string | null; onPick: (id: string) => void }) {
  return (
    <div className="pm-presets pm-anim-in" style={{ animationDelay: '80ms' }} role="group" aria-label="Conversion presets">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cx('pm-preset', active === p.id && 'pm-preset-active')}
          aria-pressed={active === p.id}
          onClick={() => onPick(p.id)}
        >
          <span className="pm-preset-icon" aria-hidden="true">{p.icon(16)}</span>
          <span className="pm-preset-label">{p.label}</span>
          <span className="pm-preset-effect">{p.effect}</span>
        </button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   USAGE BAR
   ═══════════════════════════════════════════════════════════════════════ */

export function UsageBar({ used, limit, plan }: { used: number; limit: number; plan: string }) {
  const pct = Math.min(100, Math.round((used / limit) * 100))
  return (
    <div className="pm-usage">
      <div className="pm-usage-icon">{Ic.bolt(14)}</div>
      <div className="pm-usage-text">
        {used} / {limit} conversions used
        {plan ? ` · ${plan}` : ''}
      </div>
      <div className="pm-usage-track"><div className="pm-usage-fill" style={{ width: `${pct}%` }} /></div>
      <div className="pm-usage-plan">{plan}</div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   JOB QUEUE ITEM
   ═══════════════════════════════════════════════════════════════════════ */

export function JobItem({
  job, onRemove, onRetry, onSubmitPassword, onOpen,
}: {
  job: Job
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onSubmitPassword: (id: string, pw: string) => void
  onOpen: (id: string) => void
}) {
  const [pw, setPw] = useState('')
  return (
    <div className={cx('pm-queue-item', `pm-status-${job.status}`)}>
      <div className="pm-file-tile">
        {job.status === 'converting' ? Ic.spinner(20)
          : job.status === 'done' ? Ic.check(18)
          : job.status === 'error' ? Ic.alert(18)
          : job.status === 'password' ? Ic.lock(18)
          : Ic.pdf(20)}
      </div>
      <div className="pm-file-body">
        <div className="pm-file-name" title={job.file.name}>{job.file.name}</div>
        <div className="pm-file-meta">
          <span>{humanBytes(job.file.size)}</span>
          {job.pages && <span>· {job.pages} pages</span>}
          {job.status === 'done' && (
            <>
              <span>· {job.stats.words} words</span>
              <span>· ~{job.stats.tokens} tok</span>
              <span>· conf {job.confidence}%</span>
            </>
          )}
          {job.status === 'error' && <span style={{ color: 'var(--pm-danger)' }}>· {job.error}</span>}
        </div>
        {job.status === 'converting' && (
          <div className="pm-progress-track">
            <div className="pm-progress-fill pm-progress-indeterminate" />
          </div>
        )}
        {job.status === 'password' && (
          <div className="pm-password-row">
            {job.error && <span className="pm-password-error">{job.error}</span>}
            <input
              className="pm-input"
              type="password"
              placeholder="Enter PDF password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pw && onSubmitPassword(job.id, pw)}
              autoFocus
              style={{ padding: '6px 10px', fontSize: 12 }}
            />
            <button className="pm-btn pm-btn-sm pm-btn-primary" onClick={() => pw && onSubmitPassword(job.id, pw)}>
              {Ic.unlock(12)} Unlock
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {job.status === 'done' && (
          <button className="pm-btn pm-btn-sm pm-btn-primary" onClick={() => onOpen(job.id)}>
            {Ic.edit(12)} Open
          </button>
        )}
        {job.status === 'error' && (
          <button className="pm-btn pm-btn-sm pm-btn-secondary" onClick={() => onRetry(job.id)}>
            {Ic.refresh(12)} Retry
          </button>
        )}
        <button className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={() => onRemove(job.id)} title="Remove">
          {Ic.close(12)}
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   OPTIONS PANEL (mode picker + toggles)
   ═══════════════════════════════════════════════════════════════════════ */

export function OptionsPanel({
  mode, setMode,
  bijoy, setBijoy,
  bilingual, setBilingual,
  pageRange, setPageRange,
  language, setLanguage,
}: {
  mode: Mode; setMode: (m: Mode) => void
  bijoy: boolean; setBijoy: (v: boolean) => void
  bilingual: boolean; setBilingual: (v: boolean) => void
  pageRange: string; setPageRange: (v: string) => void
  language: string; setLanguage: (v: string) => void
}) {
  return (
    <div className="pm-card pm-anim-in" style={{ animationDelay: '120ms' }}>
      <div className="pm-section-head">
        <div className="pm-section-title">{Ic.cog(14)} Conversion options</div>
      </div>
      <div className="pm-panel-body">
        {/* Mode picker — three mutually exclusive strategies, one
            hairline-divided track. Native buttons carry keyboard support for
            free; role=radio tells assistive tech this is a choose-one set. */}
        <div className="pm-mode-grid" role="radiogroup" aria-label="Extraction mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={cx('pm-mode-card', mode === m.id && 'pm-mode-active', 'pm-focus')}
              onClick={() => setMode(m.id)}
            >
              <span className="pm-mode-icon">{m.icon(18)}</span>
              <span className="pm-mode-name">{m.name}</span>
              <span className="pm-mode-sub">{m.sub}</span>
            </button>
          ))}
        </div>

        {/* Toggle rows — one hairline-divided group: a switch is a setting
            row, not a boxed card. */}
        <div className="pm-switch-group">
          <div className="pm-toggle-row">
            <div className="pm-toggle-label">
              {Ic.bengali(14)}
              <div>
                <div className="pm-toggle-name">Bijoy Classic → Unicode</div>
                <div className="pm-toggle-sub">Auto-detects legacy Bangla and converts to modern Unicode</div>
              </div>
            </div>
            <button
              type="button"
              className={cx('pm-switch', bijoy && 'pm-switch-on')}
              onClick={() => setBijoy(!bijoy)}
              aria-pressed={bijoy}
              aria-label="Bijoy Classic to Unicode"
            />
          </div>

          <div className="pm-toggle-row">
            <div className="pm-toggle-label">
              {Ic.globe(14)}
              <div>
                <div className="pm-toggle-name">Mixed Bangla + English OCR</div>
                <div className="pm-toggle-sub">Use both Bangla and English recognition models</div>
              </div>
            </div>
            <button
              type="button"
              className={cx('pm-switch', bilingual && 'pm-switch-on')}
              onClick={() => setBilingual(!bilingual)}
              aria-pressed={bilingual}
              aria-label="Mixed Bangla and English OCR"
            />
          </div>
        </div>

        <div className="pm-fields">
          <label className="pm-field">
            <span className="pm-field-label">{Ic.page(14)} Page range</span>
            <input
              className="pm-input"
              placeholder="e.g. 1-5, 8, 10-12"
              value={pageRange}
              onChange={(e) => setPageRange(e.target.value)}
            />
          </label>

          <label className="pm-field">
            <span className="pm-field-label">{Ic.language(14)} Language hint</span>
            <select className="pm-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="bn">Bangla</option>
              <option value="hi">Hindi</option>
              <option value="ar">Arabic</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
            </select>
          </label>
        </div>

        <div className="pm-note">
          {Ic.info(14)}
          <div>Settings apply to every queued file and take effect when you convert.</div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   HISTORY PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function HistoryPanel({
  items, onOpen, onClear,
}: {
  items: HistoryEntry[]
  onOpen: (e: HistoryEntry) => void
  onClear: () => void
}) {
  if (items.length === 0) return null
  return (
    <section className="pm-card pm-history-panel pm-anim-in" style={{ animationDelay: '160ms' }} aria-labelledby="pm-history-title">
      <div className="pm-section-head">
        <div>
          <div id="pm-history-title" className="pm-section-title">{Ic.history(14)} Recent conversions</div>
          <div className="pm-section-meta">Open a previous result without leaving this workspace</div>
        </div>
        <button className="pm-btn pm-btn-ghost pm-btn-xs" onClick={onClear}>{Ic.trash(11)} Clear</button>
      </div>
      <div className="pm-history-list">
        {items.slice(0, 8).map((it) => (
          <button key={it.id} type="button" className="pm-history-item" onClick={() => onOpen(it)}>
            <span className="pm-history-file-icon" aria-hidden="true">{Ic.markdown(15)}</span>
            <span className="pm-history-name">{it.name}</span>
            <span className="pm-history-meta">{it.words} words · {it.confidence}%</span>
            <span className="pm-history-time">{timeAgo(it.ts)}</span>
            <span className="pm-history-open" aria-hidden="true">{Ic.chevron(13)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   WORKSPACE — 3-column post-conversion view
   ═══════════════════════════════════════════════════════════════════════ */

type FocusView = 'write' | 'split' | 'preview'

export function Workspace({
  accountState: account,
  creditState,
  navigationAvailability,
  jobs,
  activeId,
  focusMode,
  onActivate,
  onRemove,
  onBack,
  onEdit,
  onRename,
  onCopy,
  onDownload,
  onAiAction,
  onOpenCmdk,
  onToggleFocus,
  onNewFile,
  mergeOpen,
  onOpenMerge,
  onCloseMerge,
  onCreateMerged,
  onOpenDocument,
  onEditSourcedDocument,
  onMarkGithubCommitted,
  onResetSourcedDocument,
  aiBusy,
}: {
  accountState: AccountViewerState
  creditState: CreditBalanceState
  navigationAvailability: NavigationAvailability
  jobs: Job[]
  activeId: string | null
  focusMode: boolean
  onActivate: (id: string) => void
  onRemove: (id: string) => void
  onBack: () => void
  onEdit: (id: string, md: string) => void
  onRename: (id: string, title: string) => void
  onCopy: () => void
  onDownload: (fmt: MrMarkdownExportFormat) => void
  onAiAction: (kind: 'cleanup' | 'toc' | 'summarize' | 'translate' | 'frontmatter' | 'chunk') => void
  onOpenCmdk: () => void
  onToggleFocus: () => void
  onNewFile: () => void
  /** The collation dialog is controlled by the orchestrator so the command
      palette and the sidebar button open the same one surface. */
  mergeOpen: boolean
  onOpenMerge: () => void
  onCloseMerge: () => void
  onCreateMerged: (markdown: string, title: string) => void
  /**
   * Open a document the console hands over (today: a GitHub file). Carries an
   * optional `sourceId` so re-opening the same source focuses the document that
   * is already open instead of cloning it, plus the GitHub baseline it was read
   * at so the document can report "edited" later.
   */
  onOpenDocument: OpenDocument
  /** Write the panel's edits through to the sourced document (single writer). */
  onEditSourcedDocument: (sourceId: string, markdown: string) => void
  /** Advance a sourced document's baseline after a commit that landed. */
  onMarkGithubCommitted: (sourceId: string, markdown: string, sha: string | null) => void
  /** Adopt the remote copy wholesale (explicit "Re-read from GitHub"). */
  onResetSourcedDocument: (sourceId: string, markdown: string, sha: string | null) => void
  aiBusy: string | null
}) {
  const active = jobs.find((j) => j.id === activeId) || null
  const [preview, setPreview] = useState<'preview' | 'raw' | 'outline'>('preview')
  const [editorMode, setEditorMode] = useState<'raw' | 'rich'>('raw')
  const [focusView, setFocusView] = useState<FocusView>('write')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const richEditorRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [scrollSync, setScrollSync] = useState(true)
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false)
  const [splitRatio, setSplitRatio] = useState(1)
  const [mrTheme, setMrTheme] = useState<'light' | 'dark'>('light')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportWrapRef = useRef<HTMLDivElement>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [previewOnly, setPreviewOnly] = useState(false)
  const [focusCheatOpen, setFocusCheatOpen] = useState(false)
  const focusCheatWrapRef = useRef<HTMLDivElement>(null)
  const [saveState, setSaveState] = useState<'saved' | 'editing'>('saved')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  /* ── Identity + the calibration console ───────────────────────────────
     The MR parent supplies one identity/balance across upload and workspace;
     the seal and console still read the same identity after a profile edit. */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('identity')
  const openSettings = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])
  // Returning from the GitHub install flow lands on `?github=<status>`: open the
  // console straight to Connections so the owner sees the honest result. The
  // marker is read and cleared by the Connections hook itself, so this effect
  // only opens the pane — and it defers to the next frame so the setState never
  // runs synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('github')) return
    const raf = requestAnimationFrame(() => openSettings('connections'))
    return () => cancelAnimationFrame(raf)
  }, [openSettings])
  const activeDocumentId = active?.id
  const activeMarkdown = active?.markdown

  /* ── Sourced documents: workspace documents bound to a GitHub file ──────
     Derived from the documents themselves, never stored separately, so "edited"
     is always a live text comparison and can never disagree with the content.
     Only documents that carry both a provenance key and a baseline qualify;
     uploads, merges and blank canvases are invisible to every chip and gate. */
  const sourcedDocuments = useMemo<SourcedDocument[]>(() => {
    const list: SourcedDocument[] = []
    for (const job of jobs) {
      if (!job.sourceId || !job.githubBase) continue
      const parts = parseGithubSourceId(job.sourceId)
      if (!parts) continue
      list.push({
        documentId: job.id,
        sourceId: job.sourceId,
        title: job.title,
        repoFullName: parts.repoFullName,
        branch: parts.branch,
        path: parts.path,
        baseMarkdown: job.githubBase.markdown,
        baseSha: job.githubBase.sha,
        markdown: job.markdown,
        dirty: job.markdown !== job.githubBase.markdown,
      })
    }
    return list
  }, [jobs])

  /* Document id → its GitHub provenance, for the sidebar's per-row pin and plate.
     A map over the one derivation above keeps the lookup O(1) and means the
     sidebar can never disagree with the chips about what is GitHub-sourced. */
  const githubDocumentById = useMemo(() => {
    const map = new Map<string, SourcedDocument>()
    for (const doc of sourcedDocuments) map.set(doc.documentId, doc)
    return map
  }, [sourcedDocuments])

  const activeSourced = active ? sourcedDocuments.find((doc) => doc.documentId === active.id) ?? null : null

  /* The commit popover (editor fast path) and the console file focus share one
     `focusSourceId`, so "Commit…" here and "Manage in Connections" there land on
     the same file. */
  const [focusSourceId, setFocusSourceId] = useState<string | undefined>(undefined)
  const [commitPopoverSourceId, setCommitPopoverSourceId] = useState<string | null>(null)
  const commitPopoverDoc = commitPopoverSourceId
    ? sourcedDocuments.find((doc) => doc.sourceId === commitPopoverSourceId) ?? null
    : null

  /* ── Sidebar provenance plate ──────────────────────────────────────────
     The row's repo/path tip is a real element placed against the row's rect, not
     the `[data-tooltip]::after` idiom the topbar uses: the sidebar is a scroll
     container (`overflow-y:auto`), so a pseudo-element tip would be clipped for
     rows near an edge. Only the id + rect are held; the text is read back from
     the live map, so removing a document can never leave a stale plate. */
  const [githubTip, setGithubTip] = useState<{ id: string; rect: DOMRect } | null>(null)
  const githubTipDoc = githubTip ? githubDocumentById.get(githubTip.id) ?? null : null

  /* Collapsing the panel or entering focus mode hides the sidebar without a
     mouseleave, so a lingering plate is dismissed explicitly. */
  useEffect(() => {
    if (panelCollapsed || focusMode) setGithubTip(null)
  }, [panelCollapsed, focusMode])

  /*
    A confirmed publish reaches the workspace here. Only a direct commit advances
    the baseline: a pull request writes to a new branch, so the file on the base
    branch is unchanged and the document is still legitimately "edited" against it
    — marking it clean would be a lie.
  */
  const handleGithubPublished = useCallback((result: GithubWriteResponse) => {
    if (result.kind !== 'commit') return
    const sourceId = buildGithubSourceId(result.repo_full_name, result.branch, result.path)
    const doc = jobs.find((job) => job.sourceId === sourceId)
    if (!doc) return
    onMarkGithubCommitted(sourceId, doc.markdown, null)
  }, [jobs, onMarkGithubCommitted])

  useEffect(() => {
    const saved = window.localStorage.getItem('mr-markdown-theme')
    if (saved === 'light' || saved === 'dark') {
      setMrTheme(saved)
      return
    }
    setMrTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    if (activeDocumentId && !activeMarkdown && editorMode === 'raw') {
      requestAnimationFrame(() => editorRef.current?.focus())
    }
  }, [activeDocumentId, activeMarkdown, editorMode])

  /* Keep the line-number gutter locked to the textarea's vertical scroll so
     numbers never drift from their lines. The gutter scrollbar is hidden;
     only its scrollTop mirrors the textarea. */
  useEffect(() => {
    const ta = editorRef.current
    const gutter = gutterRef.current
    if (ta && gutter) gutter.scrollTop = ta.scrollTop
  }, [activeMarkdown, editorMode, activeDocumentId])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  const startTitleEdit = () => {
    if (!active) return
    setTitleDraft(active.title)
    setEditingTitle(true)
  }

  const commitTitleEdit = () => {
    if (active) onRename(active.id, titleDraft)
    setEditingTitle(false)
  }

  useEffect(() => {
    if (!exportMenuOpen) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!exportWrapRef.current?.contains(event.target as Node)) setExportMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [exportMenuOpen])

  // The workspace theme is the single writer of its own key (`mr-markdown-theme`)
  // so the topbar toggle and the console's Appearance pane can never diverge.
  const setMrThemePersisted = useCallback((next: 'light' | 'dark') => {
    try { window.localStorage.setItem('mr-markdown-theme', next) } catch { /* applied for the session regardless */ }
    setMrTheme(next)
  }, [])

  const toggleMrTheme = () => setMrThemePersisted(mrTheme === 'light' ? 'dark' : 'light')

  /* ── Preferences bridge for the calibration console ─────────────────────
     The console edits the same cells the inline controls use, so this exposes
     them as one object + one patch setter. No new persistence: `theme` keeps its
     own key above, everything else rides the existing saveWorkspacePrefs effect. */
  const { preferences, patchPreferences } = useWorkspacePreferences(
    { editorMode, scrollSync, previewOnly, splitRatio, panelCollapsed, toolbarCollapsed, focusView, theme: mrTheme },
    {
      editorMode: setEditorMode,
      scrollSync: setScrollSync,
      previewOnly: setPreviewOnly,
      splitRatio: setSplitRatio,
      panelCollapsed: setPanelCollapsed,
      toolbarCollapsed: setToolbarCollapsed,
      focusView: setFocusView,
      theme: setMrThemePersisted,
    },
  )

  /* ── Focus mode: professional exit affordances ─────────────────
     The utility rail is unmounted in focus mode, so Escape and Alt+F
     are bound here at the workspace level to guarantee a reliable,
     discoverable way out. Typing inside a field is always preserved.
     Alt+C mirrors the rail's cheat-sheet shortcut while the rail is
     unmounted; Escape closes the cheat-sheet popover before exiting. */
  useEffect(() => {
    if (!focusMode) return
    const onFocusKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        if (focusCheatOpen) {
          setFocusCheatOpen(false)
          return
        }
        onToggleFocus()
        return
      }
      if (event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        onToggleFocus()
        return
      }
      if (event.altKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setFocusCheatOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onFocusKey)
    return () => document.removeEventListener('keydown', onFocusKey)
  }, [focusMode, focusCheatOpen, onToggleFocus])

  useEffect(() => {
    if (!focusMode) {
      setFocusCheatOpen(false)
      return
    }
    setFocusView('write')
  }, [focusMode])

  /* ── Restore the editor UI mode across reload ──────────────────
     The panel mode (raw/rich, preview/split, collapsed panes, split ratio) is
     local to this view, so it rides its own small prefs key. It is applied in an
     effect rather than a lazy initial state so the server and client first
     render match; the one-tick default is acceptable here. Declared after the
     focus-mode effect so a restored focusView is not immediately reset to
     'write' on mount. */
  const prefsHydratedRef = useRef(false)
  useEffect(() => {
    const prefs = loadWorkspacePrefs()
    if (prefs.editorMode) setEditorMode(prefs.editorMode)
    if (prefs.preview) setPreview(prefs.preview)
    if (prefs.focusView) setFocusView(prefs.focusView)
    if (typeof prefs.panelCollapsed === 'boolean') setPanelCollapsed(prefs.panelCollapsed)
    if (typeof prefs.toolbarCollapsed === 'boolean') setToolbarCollapsed(prefs.toolbarCollapsed)
    if (typeof prefs.splitRatio === 'number') setSplitRatio(prefs.splitRatio)
    if (typeof prefs.scrollSync === 'boolean') setScrollSync(prefs.scrollSync)
    if (typeof prefs.previewOnly === 'boolean') setPreviewOnly(prefs.previewOnly)
    prefsHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (!prefsHydratedRef.current) return
    saveWorkspacePrefs({ editorMode, preview, focusView, panelCollapsed, toolbarCollapsed, splitRatio, scrollSync, previewOnly })
  }, [editorMode, preview, focusView, panelCollapsed, toolbarCollapsed, splitRatio, scrollSync, previewOnly])

  /* ── Remove a document (confirm-gated) ─────────────────────────
     Removing is destructive for the session, so it asks first. Focus moves to
     the confirm button on open and back to the trigger on cancel; Escape
     cancels. The parent decides what becomes active next, or returns to the
     dashboard when the last document goes. */
  const [removeTarget, setRemoveTarget] = useState<Job | null>(null)
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const removeConfirmRef = useRef<HTMLButtonElement | null>(null)

  const cancelRemove = useCallback(() => {
    setRemoveTarget(null)
    requestAnimationFrame(() => removeTriggerRef.current?.focus())
  }, [])

  const confirmRemove = useCallback(() => {
    const target = removeTarget
    setRemoveTarget(null)
    if (target) onRemove(target.id)
  }, [removeTarget, onRemove])

  useEffect(() => {
    if (!removeTarget) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancelRemove() }
    }
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => removeConfirmRef.current?.focus())
    return () => document.removeEventListener('keydown', onKey)
  }, [removeTarget, cancelRemove])

  /* Outside-click close for the focus cheat-sheet popover (same pattern
     as the export menu — pointerdown so it fires before click handlers). */
  useEffect(() => {
    if (!focusCheatOpen) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!focusCheatWrapRef.current?.contains(event.target as Node)) setFocusCheatOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [focusCheatOpen])

  useEffect(() => {
    if (!focusMode || focusView === 'preview') return
    requestAnimationFrame(() => {
      if (editorMode === 'raw') editorRef.current?.focus({ preventScroll: true })
      else richEditorRef.current?.focus({ preventScroll: true })
    })
  }, [focusMode, focusView, editorMode])

  /* ── Popover / widget anchors ──────────────────────────────── */
  const emojiBtnRef      = useRef<HTMLButtonElement>(null)
  const tableBtnRef      = useRef<HTMLButtonElement>(null)
  const codeLangBtnRef   = useRef<HTMLButtonElement>(null)
  const diagramBtnRef    = useRef<HTMLButtonElement>(null)

  const [emojiOpen, setEmojiOpen]     = useState(false)
  const [tableOpen, setTableOpen]     = useState(false)
  const [langOpen,  setLangOpen]      = useState(false)
  const [diagramOpen, setDiagramOpen] = useState(false)

  /* Where the table picker should appear. `null` = anchor to the editor
     toolbar's table button (default). The tool rail's Table builder panel sets
     an explicit position: its panel overlays the toolbar area, so anchoring to
     the (horizontally scrolled) toolbar button can land the picker over the
     preview pane instead of beside the rail. Computed from the rail panel's
     actual DOM rect so it stays correct in focus mode and at any viewport. */
  const [tablePickerPos, setTablePickerPos] = useState<{ top: number; left: number } | null>(null)
  const openTableFromRail = (panel: Element | null) => {
    const railPanelRect = panel?.getBoundingClientRect() ?? null
    const viewportWidth = window.innerWidth
    const PICKER_WIDTH = 218
    const PICKER_HEIGHT = 232
    const GUTTER = 12
    if (railPanelRect) {
      // Place beside the rail panel, vertically near its top, clamped to viewport.
      const left = Math.max(GUTTER, Math.min(railPanelRect.right + 8, viewportWidth - PICKER_WIDTH - GUTTER))
      const top = Math.max(GUTTER, Math.min(railPanelRect.top + 64, window.innerHeight - PICKER_HEIGHT - GUTTER))
      setTablePickerPos({ top, left })
    } else {
      // Fallback: hard-anchored to the rail itself (58px wide + gap), never past mid-editor.
      const left = Math.max(GUTTER, Math.min(66, Math.floor(viewportWidth / 2) - PICKER_WIDTH))
      setTablePickerPos({ top: 96, left })
    }
  }

  /* ── Slash-command state ───────────────────────────────────── */
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashActiveIdxRef = useRef<number>(-1) // position of `/` in text

  /* ── Emoji autocomplete `:xxx` state ───────────────────────── */
  const [acOpen, setAcOpen] = useState(false)
  const [acQuery, setAcQuery] = useState('')
  const [acPos, setAcPos] = useState<{ top: number; left: number } | null>(null)
  const [acIndex, setAcIndex] = useState(0)
  const acStartRef = useRef<number>(-1) // position of `:` in text

  /* ── Find / replace state ─────────────────────────────────── */
  const [findOpen, setFindOpen] = useState(false)
  const [findState, setFindState] = useState<FindReplaceState>({
    find: '',
    replace: '',
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    showReplace: false,
  })
  const [findActive, setFindActive] = useState(0)

  const findRegex = useMemo(
    () => buildFindRegex(findState.find, {
      regex: findState.regex,
      caseSensitive: findState.caseSensitive,
      wholeWord: findState.wholeWord,
    }),
    [findState.find, findState.regex, findState.caseSensitive, findState.wholeWord],
  )
  const findMatches = useMemo(
    () => (active ? findAllMatches(active.markdown, findRegex) : []),
    [active, findRegex],
  )

  // Effective active-match index — clamped without cascading setState.
  const effectiveFindActive = findMatches.length === 0
    ? 0
    : Math.min(findActive, findMatches.length - 1)



  const html = useMemo(() => (active ? renderMarkdownToHtml(active.markdown) : ''), [active])

  useEffect(() => {
    const richEditor = richEditorRef.current
    if (editorMode !== 'rich' || !richEditor || document.activeElement === richEditor) return
    if (richEditor.innerHTML !== html) richEditor.innerHTML = html
  }, [editorMode, html, activeId])

  /* Preview-only: failed <img> loads become a styled placeholder card instead of the
     browser's broken-image glyph. Capture-phase listener catches errors even for
     React-managed imgs (React never re-renders on load failure); the sweep handles
     images that were already broken before this effect ran. Rendered/exported HTML
     (jobs, exports, backend) is untouched — this only rewrites live preview DOM. */
  useEffect(() => {
    const root = previewRef.current
    if (!root) return
    const swapIn = (img: HTMLImageElement) => {
      if (!img.isConnected) return
      const tmpl = document.createElement('template')
      tmpl.innerHTML = createBrokenImagePlaceholder(img.getAttribute('alt') ?? '', img.getAttribute('src') ?? '')
      const placeholder = tmpl.content.firstElementChild
      if (!placeholder) return
      const anchor = img.closest('a')
      if (anchor && anchor.contains(img)) placeholder.setAttribute('data-was-clickable', 'true')
      img.replaceWith(placeholder)
    }
    const onError = (event: Event) => {
      const target = event.target as EventTarget | null
      if (target instanceof HTMLImageElement) swapIn(target)
    }
    root.addEventListener('error', onError, true)
    // Images that failed before the listener attached (e.g. re-entering preview)
    const alreadyBroken = Array.from(root.querySelectorAll('img')).filter((img) => img.complete && img.naturalWidth === 0)
    alreadyBroken.forEach(swapIn)
    return () => root.removeEventListener('error', onError, true)
  }, [preview, html, activeId])

  const commitRichText = () => {
    const richEditor = richEditorRef.current
    if (!active || !richEditor) return
    const markdown = htmlToMarkdown(richEditor.innerHTML)
    if (markdown !== active.markdown) onEdit(active.id, markdown)
    setSaveState('editing')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveState('saved'), 900)
  }

  const outline = useMemo(() => {
    if (!active) return []
    const entries: { id: string; title: string; level: number }[] = []
    const used = new Map<string, number>()
    let inCode = false
    active.markdown.split('\n').forEach((line) => {
      if (/^```/.test(line)) { inCode = !inCode; return }
      if (inCode) return
      const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/)
      if (!heading) return
      const title = heading[2].replace(/[*_`~]/g, '').trim()
      const base = heading[3] || heading[2].toLowerCase().replace(/[^\w]+/g, '-')
      const count = used.get(base) || 0
      used.set(base, count + 1)
      entries.push({ id: count ? `${base}-${count + 1}` : base, title, level: heading[1].length })
    })
    return entries
  }, [active])

  useEffect(() => {
    if (preview !== 'preview' || !previewRef.current || outline.length === 0) return
    const headings = outline
      .map((item) => previewRef.current?.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`))
      .filter((item): item is HTMLElement => Boolean(item))
    if (!headings.length) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
      if (visible.length) setActiveHeadingId((visible[0].target as HTMLElement).id)
    }, { root: previewRef.current, rootMargin: '-12% 0px -70% 0px', threshold: 0 })
    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [preview, outline, html])

  const jumpToHeading = (id: string) => {
    setActiveHeadingId(id)
    setPreview('preview')
    requestAnimationFrame(() => previewRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // Drag-to-resize split between editor and preview
  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return
    const handle = el.querySelector<HTMLDivElement>('.pm-ws-drag')
    if (!handle) return
    let dragging = false
    const onDown = (e: MouseEvent) => {
      dragging = true
      handle.classList.add('pm-dragging')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const rect = el.getBoundingClientRect()
      const sidebarW = focusMode ? 0 : 288
      const workAreaLeft = rect.left + sidebarW
      const workAreaWidth = rect.width - sidebarW
      const rel = (e.clientX - workAreaLeft) / workAreaWidth
      const clamped = Math.max(0.25, Math.min(0.75, rel))
      const ratio = clamped / (1 - clamped)
      setSplitRatio(ratio)
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      handle.classList.remove('pm-dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    handle.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      handle.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [focusMode, focusView])

  // Editor line-number gutter content
  const gutterLines = useMemo(() => {
    if (!active) return ''
    const n = active.markdown.split('\n').length
    return Array.from({ length: n }, (_, i) => i + 1).join('\n')
  }, [active])

  // Simple stats for footer status bar
  const cursorInfo = useMemo(() => {
    if (!active) return { lines: 0, chars: 0 }
    return {
      lines: active.markdown.split('\n').length,
      chars: active.markdown.length,
    }
  }, [active])


  // Bidirectional scroll sync
  useEffect(() => {
    if (!scrollSync || !active) return
    const e = editorRef.current
    const p = previewRef.current
    if (!e || !p) return
    let sync: 'e' | 'p' | null = null
    const onE = () => {
      if (sync === 'p') { sync = null; return }
      sync = 'e'
      const r = e.scrollTop / (e.scrollHeight - e.clientHeight || 1)
      p.scrollTop = r * (p.scrollHeight - p.clientHeight)
      requestAnimationFrame(() => { sync = null })
    }
    const onP = () => {
      if (sync === 'e') { sync = null; return }
      sync = 'p'
      const r = p.scrollTop / (p.scrollHeight - p.clientHeight || 1)
      e.scrollTop = r * (e.scrollHeight - e.clientHeight)
      requestAnimationFrame(() => { sync = null })
    }
    e.addEventListener('scroll', onE)
    p.addEventListener('scroll', onP)
    return () => {
      e.removeEventListener('scroll', onE)
      p.removeEventListener('scroll', onP)
    }
  }, [scrollSync, active])

  if (!active) return null

  const applyToolbar = (fn: (s: string, start: number, end: number) => { text: string; caret: number }) => {
    const ta = editorRef.current
    if (!ta) return
    const { selectionStart, selectionEnd, value, scrollTop, scrollLeft } = ta
    const { text, caret } = fn(value, selectionStart, selectionEnd)
    onEdit(active.id, text)
    // Snapshot the workspace/parent scroll positions so setSelectionRange
    // (which auto-scrolls the caret into view) does not yank the page down.
    const parents: { el: Element; top: number; left: number }[] = []
    let node: Element | null = ta.parentElement
    while (node) {
      parents.push({ el: node, top: node.scrollTop, left: node.scrollLeft })
      node = node.parentElement
    }
    requestAnimationFrame(() => {
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(caret, caret)
      // Restore textarea's own scroll — it can jump when the value changes.
      ta.scrollTop = scrollTop
      ta.scrollLeft = scrollLeft
      // Restore every ancestor scroll container.
      for (const anc of parents) {
        anc.el.scrollTop = anc.top
        anc.el.scrollLeft = anc.left
      }
    })

  }


  const wrap = (before: string, after = before) =>
    applyToolbar((s, a, b) => {
      const sel = s.slice(a, b) || ''
      const text = s.slice(0, a) + before + sel + after + s.slice(b)
      return { text, caret: a + before.length + sel.length + after.length }
    })
  const linePrefix = (prefix: string) =>
    applyToolbar((s, a) => {
      const lineStart = s.lastIndexOf('\n', a - 1) + 1
      const text = s.slice(0, lineStart) + prefix + s.slice(lineStart)
      return { text, caret: a + prefix.length }
    })

  const insertDiagramTemplate = (template: DiagramTemplate) => {
    const info = template.attributes ? ` {${template.attributes}}` : ''
    const fence = `\n\`\`\`${template.language}${info}\n${template.source}\n\`\`\`\n`
    insertAtCursor(fence)
    setDiagramOpen(false)
  }

  const confColor = active.confidence >= 85 ? 'var(--pm-success)'
                  : active.confidence >= 65 ? 'var(--pm-warning)'
                  : 'var(--pm-danger)'

  /* ═════════════════════════════════════════════════════════════════════
     TEXTAREA — insertion helpers + slash/emoji watchers + smart-paste
     ═════════════════════════════════════════════════════════════════════ */

  /** Insert plain text at the caret and place cursor at the end. */
  const insertAtCursor = (text: string) => {
    applyToolbar((s, a) => ({
      text: s.slice(0, a) + text + s.slice(a),
      caret: a + text.length,
    }))
  }

  const closeSlashMenu = () => {
    setSlashOpen(false)
    setSlashQuery('')
    setSlashPos(null)
    setSlashIndex(0)
    slashActiveIdxRef.current = -1
  }
  const closeEmojiAC = () => {
    setAcOpen(false)
    setAcQuery('')
    setAcPos(null)
    setAcIndex(0)
    acStartRef.current = -1
  }

  /** Compute pixel position for a popover anchored at `pos` inside textarea. */
  const positionFromCaret = (pos: number): { top: number; left: number } | null => {
    const ta = editorRef.current
    if (!ta) return null
    const c = caretCoordinates(ta, pos)
    const rect = ta.getBoundingClientRect()
    const top = rect.top + c.top - ta.scrollTop + c.height + 4
    const left = rect.left + c.left - ta.scrollLeft
    // Clamp inside viewport
    return {
      top: Math.min(Math.max(top, 8), window.innerHeight - 260),
      left: Math.min(Math.max(left, 8), window.innerWidth - 340),
    }
  }

  /** Update slash / emoji-autocomplete triggers after any text change. */
  const detectTriggers = (value: string, caret: number) => {
    // Slash menu: `/` at start of a token, capturing everything until whitespace
    if (slashActiveIdxRef.current >= 0) {
      const start = slashActiveIdxRef.current
      if (caret <= start) { closeSlashMenu(); return }
      const seg = value.slice(start + 1, caret)
      if (/[\s\n]/.test(seg) || seg.length > 24) closeSlashMenu()
      else setSlashQuery(seg)
    } else {
      // Detect `/` at line start OR after whitespace
      const ch = value[caret - 1]
      if (ch === '/') {
        const prev = caret >= 2 ? value[caret - 2] : ''
        if (!prev || prev === '\n' || prev === ' ' || prev === '\t') {
          slashActiveIdxRef.current = caret - 1
          setSlashOpen(true)
          setSlashQuery('')
          setSlashIndex(0)
          setSlashPos(positionFromCaret(caret - 1))
          return
        }
      }
    }

    // Emoji autocomplete: `:xxx`
    if (acStartRef.current >= 0) {
      const start = acStartRef.current
      if (caret <= start) { closeEmojiAC(); return }
      const seg = value.slice(start + 1, caret)
      if (!/^[a-z0-9_+-]*$/i.test(seg) || seg.length > 20) closeEmojiAC()
      else if (seg.length === 0) closeEmojiAC()
      else setAcQuery(seg)
    } else {
      const ch = value[caret - 1]
      if (ch === ':') {
        const prev = caret >= 2 ? value[caret - 2] : ''
        // Trigger only after whitespace, punctuation, or start-of-doc
        if (!prev || /[\s\n.,;!?(\[{]/.test(prev)) {
          acStartRef.current = caret - 1
        }
      }
    }
  }

  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    onEdit(active.id, val)
    setSaveState('editing')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveState('saved'), 900)
    const caret = e.target.selectionStart
    // Defer detection so state settles first
    requestAnimationFrame(() => detectTriggers(val, caret))
  }

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey

    // Slash-menu navigation takes precedence
    if (slashOpen) {
      const items = DEFAULT_SLASH_ITEMS.filter((it) => {
        const q = slashQuery.trim().toLowerCase()
        if (!q) return true
        const hay = (it.label + ' ' + (it.hint || '') + ' ' + (it.keywords || '')).toLowerCase()
        return hay.includes(q)
      })
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => Math.min(items.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex((i) => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const pick = items[slashIndex]
        if (pick && editorRef.current) {
          const ta = editorRef.current
          const applied = pick.apply({
            value: ta.value,
            slashIndex: slashActiveIdxRef.current,
            caretIndex: ta.selectionStart,
          })
          onEdit(active.id, applied.text)
          requestAnimationFrame(() => {
            ta.focus({ preventScroll: true })
            ta.setSelectionRange(applied.caret, applied.caret)
          })
        }
        closeSlashMenu()
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); return }
    }

    if (acOpen) {
      const items = /* handled inside EmojiAutocomplete via searchEmojis */ null
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex((i) => i + 1); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex((i) => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        // Replace `:query` with emoji character
        const ta = editorRef.current
        if (ta) {
          const start = acStartRef.current
          const end = ta.selectionStart
          const val = ta.value
          // We delegate the actual pick to the popover onPick; here we fake it
          // by simulating an Enter — but simplest: leave to EmojiAutocomplete's onPick
          // triggered by clicking. For keyboard, we need to know current item.
          // We compute again to stay in sync:
          import('./emoji').then(({ searchEmojis }) => {
            const results = searchEmojis(acQuery, 8)
            const picked = results[Math.min(acIndex, results.length - 1)]
            if (picked) {
              const before = val.slice(0, start)
              const after = val.slice(end)
              const text = before + picked.e + after
              onEdit(active.id, text)
              requestAnimationFrame(() => {
                ta.focus({ preventScroll: true })
                ta.setSelectionRange(before.length + picked.e.length, before.length + picked.e.length)
              })
            }
          })
        }
        closeEmojiAC()
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); closeEmojiAC(); return }
      void items
    }

    // Editor keyboard shortcuts (only when a widget is not intercepting)
    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'b') { e.preventDefault(); wrap('**'); return }
      if (key === 'i') { e.preventDefault(); wrap('*'); return }
      if (key === 'k') { e.preventDefault(); wrap('[', '](url)'); return }
      if (key === 'f') { e.preventDefault(); setFindOpen(true); return }
      if (key === 'h') { e.preventDefault(); setFindOpen(true); setFindState((s) => ({ ...s, showReplace: true })); return }
      if (e.key === '.') { e.preventDefault(); openEmojiPickerFromCaret(); return }
    }

    // Auto-continue list on Enter — small quality-of-life win
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const ta = e.currentTarget
      const caret = ta.selectionStart
      const val = ta.value
      const lineStart = val.lastIndexOf('\n', caret - 1) + 1
      const line = val.slice(lineStart, caret)
      const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/)
      if (m) {
        // If the line is only the bullet, exit list instead
        const isEmpty = /^(\s*)([-*+]|\d+\.)\s*(?:\[[ xX]\]\s*)?$/.test(line)
        e.preventDefault()
        if (isEmpty) {
          // Remove the bullet marker
          const before = val.slice(0, lineStart)
          const after = val.slice(caret)
          const text = before + after
          onEdit(active.id, text)
          requestAnimationFrame(() => {
            ta.focus({ preventScroll: true })
            ta.setSelectionRange(before.length, before.length)
          })
          return
        }
        // Insert new line with same marker (increment for ordered)
        let marker = m[2]
        if (/^\d+\.$/.test(marker)) marker = `${parseInt(marker) + 1}.`
        const task = /\[[ xX]\]/.test(line) ? '[ ] ' : ''
        const insert = '\n' + m[1] + marker + ' ' + task
        const text = val.slice(0, caret) + insert + val.slice(caret)
        onEdit(active.id, text)
        requestAnimationFrame(() => {
          ta.focus({ preventScroll: true })
          const p = caret + insert.length
          ta.setSelectionRange(p, p)
        })
      }
    }

    // Tab / Shift+Tab: indent / outdent
    if (e.key === 'Tab' && !mod) {
      e.preventDefault()
      const ta = e.currentTarget
      const s = ta.selectionStart, en = ta.selectionEnd, val = ta.value
      if (e.shiftKey) {
        // Outdent — remove up to 2 spaces at line start
        const lineStart = val.lastIndexOf('\n', s - 1) + 1
        const head = val.slice(lineStart, lineStart + 2)
        const trim = head.startsWith('  ') ? 2 : head.startsWith(' ') ? 1 : 0
        if (trim > 0) {
          const text = val.slice(0, lineStart) + val.slice(lineStart + trim)
          onEdit(active.id, text)
          requestAnimationFrame(() => {
            ta.focus({ preventScroll: true })
            ta.setSelectionRange(Math.max(lineStart, s - trim), Math.max(lineStart, en - trim))
          })
        }
      } else {
        const text = val.slice(0, s) + '  ' + val.slice(en)
        onEdit(active.id, text)
        requestAnimationFrame(() => {
          ta.focus({ preventScroll: true })
          ta.setSelectionRange(s + 2, s + 2)
        })
      }
    }
  }

  /** Open picker anchored at caret position (Ctrl+.). */
  const openEmojiPickerFromCaret = () => {
    setEmojiOpen(true)
  }

  /** Smart paste — diagrams stay structured, URLs linkify, and rich HTML becomes Markdown. */
  const handleEditorPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const cd = e.clipboardData
    const text = cd.getData('text/plain')
    const html = cd.getData('text/html')

    const diagram = text ? normalizeDiagramClipboardText(text) : null
    if (diagram) {
      e.preventDefault()
      const s = ta.selectionStart, en = ta.selectionEnd
      const insideDiagram = isSelectionInsideDiagramFence(ta.value, s, en)
      let inserted = insideDiagram ? diagram.source : diagram.markdown

      if (!insideDiagram) {
        const before = ta.value.slice(0, s)
        const after = ta.value.slice(en)
        const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''
        const suffix = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : ''
        inserted = prefix + inserted + suffix
      }

      const next = ta.value.slice(0, s) + inserted + ta.value.slice(en)
      onEdit(active.id, next)
      requestAnimationFrame(() => {
        ta.focus({ preventScroll: true })
        ta.setSelectionRange(s + inserted.length, s + inserted.length)
      })
      return
    }

    // URL on selection → linkify
    if (text && isProbablyUrl(text) && ta.selectionStart !== ta.selectionEnd) {
      e.preventDefault()
      const s = ta.selectionStart, en = ta.selectionEnd
      const sel = ta.value.slice(s, en)
      const inserted = `[${sel}](${text.trim()})`
      const next = ta.value.slice(0, s) + inserted + ta.value.slice(en)
      onEdit(active.id, next)
      requestAnimationFrame(() => {
        ta.focus({ preventScroll: true })
        ta.setSelectionRange(s + inserted.length, s + inserted.length)
      })
      return
    }

    // HTML → markdown
    if (html && html.trim().length > 12) {
      const md = htmlToMarkdown(html)
      if (md && md.length > 4) {
        e.preventDefault()
        const s = ta.selectionStart, en = ta.selectionEnd
        const next = ta.value.slice(0, s) + md + ta.value.slice(en)
        onEdit(active.id, next)
        requestAnimationFrame(() => {
          ta.focus({ preventScroll: true })
          ta.setSelectionRange(s + md.length, s + md.length)
        })
      }
    }
  }

  /* ═════════════════════════════════════════════════════════════════════
     FIND / REPLACE — jump, replaceOne, replaceAll
     ═════════════════════════════════════════════════════════════════════ */

  const scrollToMatch = (idx: number) => {
    const m = findMatches[idx]
    if (!m) return
    const ta = editorRef.current
    if (!ta) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(m.start, m.end)
    // Nudge into view — best-effort
    const c = caretCoordinates(ta, m.start)
    ta.scrollTop = Math.max(0, c.top - 80)
  }

  const nextMatch = () => {
    if (findMatches.length === 0) return
    const n = (effectiveFindActive + 1) % findMatches.length
    setFindActive(n)
    scrollToMatch(n)
  }
  const prevMatch = () => {
    if (findMatches.length === 0) return
    const n = (effectiveFindActive - 1 + findMatches.length) % findMatches.length
    setFindActive(n)
    scrollToMatch(n)
  }
  const replaceOne = () => {
    if (!findRegex || findMatches.length === 0) return
    const m = findMatches[effectiveFindActive]
    const before = active.markdown.slice(0, m.start)
    const after = active.markdown.slice(m.end)
    const next = before + findState.replace + after
    onEdit(active.id, next)
  }
  const replaceAll = () => {
    if (!findRegex || findMatches.length === 0) return
    const next = active.markdown.replace(findRegex, findState.replace)
    onEdit(active.id, next)
  }

  /** Line-highlight overlay for find matches. Runs each render — cheap. */
  const highlightHTML: string | null = (() => {
    if (!findState.find || findMatches.length === 0) return null
    const text = active.markdown
    let out = ''
    let cursor = 0
    findMatches.forEach((m, i) => {
      out += escapeHtml(text.slice(cursor, m.start))
      out += `<mark class="pm-find-hit${i === effectiveFindActive ? ' pm-find-hit-active' : ''}">${escapeHtml(text.slice(m.start, m.end))}</mark>`
      cursor = m.end
    })
    out += escapeHtml(text.slice(cursor))
    return out
  })()



  return (
    /* One connection for the whole surface: the console pane and the editor's
       commit chip read this single instance, so dirty / remote state stays in
       step and no second status fetch can drift from the first. */
    <GithubConnectionProvider onPublished={handleGithubPublished}>
    <div
      ref={workspaceRef}
      className={cx(
        'pm-workspace', 'mr-markdown-workspace', 'pm-anim-in',
        focusMode && 'pm-focus-mode', focusMode && `mr-focus-${focusView}`,
        panelCollapsed && 'mr-panel-closed', previewOnly && 'mr-preview-only',
      )}
      data-theme={mrTheme}
      style={{ ['--pm-ws-split' as unknown as string]: `${splitRatio}fr` }}
    >
      {/* Workspace navigation */}
      <header className="pm-ws-topbar" data-tool-navbar="pdf-to-markdown">
        <div className="mr-nav-identity">
          <div className="pm-ws-brand">
            <Link className="mr-brand-link" href="/" aria-label="Mr. Markdown home">
              <MrMarkdownBrandLogo className="mr-nav-brand-logo" />
              <span className="mr-brand-wordmark">
                <span className="mr-brand-name">Mr. Markdown</span>
                <span className="mr-studio-badge">Studio</span>
              </span>
            </Link>
          </div>
          <span className="mr-nav-divider" aria-hidden="true" />
          <div className="mr-document-title" title={`${active.title}.md`}>
            <span className="mr-document-icon" aria-hidden="true">{Ic.file(15)}</span>
            <span className="mr-document-copy">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  className="mr-document-title-input"
                  value={titleDraft}
                  aria-label="Document filename"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitleEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit() }
                    if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false) }
                  }}
                />
              ) : (
                <button type="button" className="mr-document-title-button" onClick={startTitleEdit} title="Rename document">
                  {active.title}.md
                </button>
              )}
              <span className="mr-document-meta">
                <small>Personal workspace</small>
                <span className="mr-meta-separator" aria-hidden="true">·</span>
                <span className={cx('mr-save-state', saveState === 'editing' && 'mr-unsaved')} aria-live="polite">
                  {saveState === 'editing' ? 'Unsaved changes' : 'Saved'}
                </span>
                {/* A GitHub-bound document states its sync where the owner reads
                    the filename. A clean document is quiet; an edited one carries
                    the one amber chip plus the fast path to commit it. */}
                {activeSourced ? (
                  <>
                    <span className="mr-meta-separator" aria-hidden="true">·</span>
                    {activeSourced.dirty ? (
                      <>
                        <span
                          className="mr-doc-commit-chip is-dirty"
                          title={`Edited — ${activeSourced.repoFullName}@${activeSourced.branch}:${activeSourced.path}`}
                        >
                          <span className="mr-doc-commit-dot" aria-hidden="true" />
                          Edited · not committed
                        </span>
                        <button
                          type="button"
                          className="mr-doc-commit-action"
                          onClick={() => setCommitPopoverSourceId(activeSourced.sourceId)}
                          title="Commit these changes to GitHub"
                        >
                          Commit…
                        </button>
                      </>
                    ) : (
                      <span
                        className="mr-doc-commit-chip is-synced"
                        title={`Synced with ${activeSourced.repoFullName}@${activeSourced.branch}:${activeSourced.path}`}
                      >
                        <span className="mr-doc-commit-dot" aria-hidden="true" />
                        Synced with GitHub
                      </span>
                    )}
                  </>
                ) : null}
              </span>
            </span>
          </div>
        </div>

        <div className="mr-navigation-tools">
          <button className="mr-command-trigger" onClick={onOpenCmdk} aria-label="Search or run a command" title="Command palette (Ctrl+K)">
          <span className="mr-command-icon" aria-hidden="true">{Ic.search(15)}</span>
          <span className="mr-command-label">Search tools and commands</span>
          <span className="mr-command-hint"><span>Ctrl</span><span>K</span></span>
          </button>
        </div>

        <div className="pm-ws-actions" aria-label="Document actions">
          <div className="mr-nav-control-group">
            <button type="button" className={cx('mr-icon-only', previewOnly && 'mr-icon-only-active')} onClick={() => setPreviewOnly((value) => !value)} aria-label={previewOnly ? 'Show editor' : 'Open preview only'} aria-pressed={previewOnly} data-tooltip={previewOnly ? 'Show editor' : 'Preview only'}>{Ic.eye(16)}</button>
            <button type="button" className="mr-icon-only mr-theme-toggle" onClick={toggleMrTheme} aria-label={`Switch to ${mrTheme === 'light' ? 'dark' : 'light'} theme`} data-tooltip={mrTheme === 'light' ? 'Dark theme' : 'Light theme'}>
              <span className="mr-theme-glyph" aria-hidden="true">{mrTheme === 'light' ? '☾' : '☀'}</span>
            </button>
            <button type="button" className="mr-icon-only" onClick={onCopy} aria-label="Copy markdown to clipboard" data-tooltip="Copy markdown">{Ic.copy(15)}</button>
          </div>
          <button type="button" className="mr-new-btn" onClick={onBack}>
            <span className="mr-new-plus" aria-hidden="true">＋</span><span>New</span>
          </button>
          <div className="mr-export-wrap" ref={exportWrapRef}>
            <button className="mr-export-btn" onClick={() => setExportMenuOpen((v) => !v)} aria-label="Export document" aria-expanded={exportMenuOpen} aria-haspopup="menu" aria-controls="mr-export-menu">
              {Ic.download(14)} <span className="mr-export-btn-label">Export</span><span className="mr-export-caret" aria-hidden="true" />
            </button>
            <div id="mr-export-menu" className={cx('mr-export-menu', exportMenuOpen && 'mr-export-menu-open')} role="menu" aria-hidden={!exportMenuOpen}>
                {([
                  ['md', 'Markdown', 'MD'], ['pdf', 'PDF document', 'PDF'], ['docx', 'Word document', 'DOCX'],
                  ['html', 'Web page', 'HTML'], ['json', 'Structured data', 'JSON'], ['chunks', 'AI-ready chunks', 'AI'],
                ] as const).map(([fmt, label, ext]) => (
                  <div key={fmt} role="none">
                    <button role="menuitem" tabIndex={exportMenuOpen ? 0 : -1} className={cx('mr-export-option', fmt === 'json' && 'mr-export-group-start')} aria-describedby={exportMenuOpen && (fmt === 'pdf' || fmt === 'docx') ? `mr-export-cost-${fmt}` : undefined} onClick={() => { onDownload(fmt); setExportMenuOpen(false) }}>
                      <span className="mr-export-format">{ext}</span><span className="mr-export-label">{label}</span>
                    </button>
                    {exportMenuOpen && (fmt === 'pdf' || fmt === 'docx') && creditState.snapshot?.prices[fmt === 'pdf' ? 'markdown-to-pdf' : 'pdf-to-markdown']?.enabled !== false ? <div id={`mr-export-cost-${fmt}`} className="mr-credit-cost mr-export-credit-cost"><CreditCost toolId={fmt === 'pdf' ? 'markdown-to-pdf' : 'pdf-to-markdown'} creditState={creditState} showActionLabel={false} /></div> : null}
                  </div>
                ))}
            </div>
          </div>
          {/* Only the visible header mounts a native account dialog. */}
          {!focusMode && <MrMarkdownAccountMenu
            key={account.status === 'loading' ? 'loading' : account.viewer?.id ?? 'guest'}
            status={account.status}
            viewer={account.viewer}
            signOut={account.signOut}
            onOpenSettings={openSettings}
            creditState={creditState}
          />}
        </div>
      </header>

      {focusMode && (
        <header className="mr-focus-header" aria-label="Focus mode controls">
          <div className="mr-focus-identity">
            <span className="mr-focus-mark" aria-hidden="true">{Ic.edit(14)}</span>
            <span className="mr-focus-title" title={`${active.title}.md`}>{active.title}.md</span>
            <span className={cx('mr-focus-status', saveState === 'editing' && 'is-editing')} aria-live="polite">
              <i aria-hidden="true" />{saveState === 'editing' ? 'Saving…' : 'Saved'}
            </span>
          </div>

          <div className="mr-focus-view-switcher" role="group" aria-label="Focus view">
            <button type="button" className={cx(focusView === 'write' && 'is-active')} onClick={() => setFocusView('write')} aria-pressed={focusView === 'write'}>
              {Ic.edit(12)}<span>Write</span>
            </button>
            <button type="button" className={cx(focusView === 'split' && 'is-active')} onClick={() => setFocusView('split')} aria-pressed={focusView === 'split'}>
              {Ic.columns(12)}<span>Split</span>
            </button>
            <button type="button" className={cx(focusView === 'preview' && 'is-active')} onClick={() => setFocusView('preview')} aria-pressed={focusView === 'preview'}>
              {Ic.eye(12)}<span>Preview</span>
            </button>
          </div>

          <div className="mr-focus-actions">
            <span className="mr-focus-metric">{active.stats.words.toLocaleString()} words</span>
            <div className="mr-focus-cheat-anchor" ref={focusCheatWrapRef}>
              <button
                type="button"
                className={cx('mr-focus-icon-btn', focusCheatOpen && 'is-active')}
                onClick={() => setFocusCheatOpen((open) => !open)}
                title="Markdown cheat sheet (Alt+C)"
                aria-label="Markdown cheat sheet"
                aria-haspopup="dialog"
                aria-expanded={focusCheatOpen}
              >
                {Ic.snippet(14)}
              </button>
              {focusCheatOpen ? (
                <div className="mr-focus-cheat-pop" role="dialog" aria-label="Markdown cheat sheet">
                  <header className="mr-focus-cheat-pop-head">
                    <div>
                      <span>Reference</span>
                      <strong>Markdown cheat sheet</strong>
                    </div>
                    <button type="button" className="mr-focus-cheat-pop-close" onClick={() => setFocusCheatOpen(false)} aria-label="Close cheat sheet">
                      {Ic.close(12)}
                    </button>
                  </header>
                  <div className="mr-focus-cheat-pop-body">
                    <CheatSheetPanel />
                  </div>
                </div>
              ) : null}
            </div>
            <button type="button" className="mr-focus-icon-btn" onClick={onCopy} title="Copy markdown" aria-label="Copy markdown">{Ic.copy(14)}</button>
            <button type="button" className="mr-focus-exit" onClick={onToggleFocus} aria-label="Exit focus mode">
              <span className="mr-focus-exit-icon" aria-hidden="true">{Ic.focus(14)}</span>
              <span className="mr-focus-exit-label">Exit</span>
              <kbd>Esc</kbd>
            </button>
            <MrMarkdownAccountMenu
              key={account.status === 'loading' ? 'loading' : account.viewer?.id ?? 'guest'}
              status={account.status}
              viewer={account.viewer}
              signOut={account.signOut}
              onOpenSettings={openSettings}
              creditState={creditState}
            />
          </div>
        </header>
      )}

      {/* Premium Markdown tool rail. Workspace sidebar remains a separate concern. */}
      {!focusMode && (
        <PremiumToolRail
          aiBusy={aiBusy}
          confidence={active.confidence}
          documentTitle={active.title}
          headings={outline}
          markdown={active.markdown}
          panelCollapsed={panelCollapsed}
          stats={active.stats}
          onAiAction={onAiAction}
          onCommand={onOpenCmdk}
          onFind={() => setFindOpen(true)}
          onFocus={onToggleFocus}
          onJumpToHeading={jumpToHeading}
          onOpenTable={() => {
            // The rail panel overlays the toolbar area; compute an explicit
            // picker position so it opens beside the rail, not over the preview.
            openTableFromRail(workspaceRef.current?.querySelector('.mr-premium-rail-panel') ?? null)
            setTableOpen(true)
          }}
          onToggleWorkspacePanel={() => setPanelCollapsed((collapsed) => !collapsed)}
        />
      )}

      {/* Sidebar */}
      {!focusMode && (
        <aside id="mr-workspace-panel" className="pm-ws-sidebar" aria-hidden={panelCollapsed} onScroll={() => setGithubTip(null)}>
          <div className="mr-sidebar-head">
            <span>Workspace</span>
            <div className="mr-sidebar-actions">
              <button
                type="button"
                className="mr-sidebar-merge"
                onClick={onOpenMerge}
                aria-label="Collate documents"
                title="Collate documents"
              >
                <img src="/merge-markdown-gray.svg" alt="" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="mr-sidebar-new"
                onClick={onNewFile}
                aria-label="New empty document"
                title="New empty document"
              >
                <svg className="mr-sidebar-pixel-plus" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
                  <rect x="6" y="0" width="2" height="2" />
                  <rect x="6" y="3" width="2" height="2" />
                  <rect x="0" y="6" width="2" height="2" />
                  <rect x="3" y="6" width="2" height="2" />
                  <rect x="6" y="6" width="2" height="2" />
                  <rect x="9" y="6" width="2" height="2" />
                  <rect x="12" y="6" width="2" height="2" />
                  <rect x="6" y="9" width="2" height="2" />
                  <rect x="6" y="12" width="2" height="2" />
                </svg>
              </button>
            </div>
          </div>
          <div className="pm-ws-section">Files <span className="mr-count-badge">{jobs.length}</span></div>
          <div className="pm-ws-file-list">
            {jobs.map((j) => {
              const githubDoc = githubDocumentById.get(j.id)
              const isActive = j.id === activeId
              return (
              <div key={j.id} className="pm-ws-file-entry">
                <button
                  type="button"
                  className={cx('pm-ws-file-pill', isActive && 'pm-active')}
                  onClick={() => onActivate(j.id)}
                  /* A GitHub-bound row states its provenance on hover/focus; a
                     plain row keeps the filename title it has today, so it never
                     shows two tooltips at once. */
                  title={githubDoc ? undefined : `${j.title}.md`}
                  onMouseEnter={githubDoc ? (event) => setGithubTip({ id: j.id, rect: event.currentTarget.getBoundingClientRect() }) : undefined}
                  onMouseLeave={githubDoc ? () => setGithubTip(null) : undefined}
                  onFocus={githubDoc ? (event) => setGithubTip({ id: j.id, rect: event.currentTarget.getBoundingClientRect() }) : undefined}
                  onBlur={githubDoc ? () => setGithubTip(null) : undefined}
                >
                  <span className="mr-file-icon">M↓</span>
                  <span className="mr-file-copy">
                    <strong>{j.title}</strong>
                    <small>{isActive ? 'Editing now' : `${j.stats.words} words`}</small>
                  </span>
                  {/* Provenance sits in the row's trailing metadata slot — a quiet
                      octocat on the row's own baseline, not a badge pinned over the
                      identity tile (which reads as a status, not a source). The
                      repo/branch/path arrive on hover of the row. */}
                  {githubDoc ? <span className="mr-file-source-mark" aria-hidden="true">{githubGlyph}</span> : null}
                  {githubDoc ? (
                    <span className="mr-ws-sr-only">
                      From GitHub — {githubDoc.repoFullName}, branch {githubDoc.branch}, file {githubDoc.path}
                    </span>
                  ) : null}
                  {isActive && <i className="mr-live-dot" />}
                </button>
                <button
                  type="button"
                  className="mr-file-remove"
                  onClick={(event) => {
                    removeTriggerRef.current = event.currentTarget
                    setRemoveTarget(j)
                  }}
                  aria-label={`Remove ${j.title}`}
                  title={`Remove ${j.title}`}
                >
                  {Ic.close(13)}
                </button>
              </div>
              )
            })}
          </div>

          {/* AI actions live on the utility rail (single source of truth).
              The sidebar keeps a single entry point to avoid duplicating them. */}
          <div className="pm-ws-section mr-section-spaced">
            <span>AI toolkit</span>
            <span className="mr-beta-badge mr-beta-badge-premium">Beta</span>
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <button
              type="button"
              className="mr-ws-ai-cta"
              onClick={onOpenCmdk}
              disabled={aiBusy !== null}
              aria-label="Open AI actions"
            >
              <span className="mr-ws-ai-cta-icon" aria-hidden="true">
                {aiBusy !== null ? Ic.spinner(15) : Ic.wand(15)}
              </span>
              <span className="mr-ws-ai-cta-copy">
                <strong>{aiBusy !== null ? 'Working…' : 'Open AI actions'}</strong>
                <small>Clean up · summarize · translate · split</small>
              </span>
              <span className="mr-ws-ai-cta-arrow" aria-hidden="true">{Ic.arrow(14)}</span>
            </button>
            {creditState.snapshot?.prices['document-ai']?.enabled !== false ? <div className="mr-credit-cost mr-ai-credit-cost">
              <span>AI refinement</span><CreditCost toolId="document-ai" creditState={creditState} showActionLabel={false} />
            </div> : null}
          </div>

          <div className="pm-ws-section mr-section-spaced">Document insights</div>
          <div className="pm-ws-stats pm-ws-stats-premium">
            <div className="pm-stat-cell pm-stat-cell-premium">
              <div className="pm-stat-cell-icon">{Ic.h1(13)}</div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Headings</div>
                <div className="pm-stat-cell-value">{active.stats.headings}</div>
              </div>
            </div>
            <div className="pm-stat-cell pm-stat-cell-premium">
              <div className="pm-stat-cell-icon">{Ic.list(13)}</div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Lists</div>
                <div className="pm-stat-cell-value">{active.stats.lists}</div>
              </div>
            </div>
            <div className="pm-stat-cell pm-stat-cell-premium">
              <div className="pm-stat-cell-icon">{Ic.code(13)}</div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Code blocks</div>
                <div className="pm-stat-cell-value">{active.stats.codeBlocks}</div>
              </div>
            </div>
            <div className="pm-stat-cell pm-stat-cell-premium">
              <div className="pm-stat-cell-icon">{Ic.table(13)}</div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Tables</div>
                <div className="pm-stat-cell-value">{active.stats.tables}</div>
              </div>
            </div>
            <div className="pm-stat-cell pm-stat-cell-premium">
              <div className="pm-stat-cell-icon">{Ic.link(13)}</div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Links</div>
                <div className="pm-stat-cell-value">{active.stats.links}</div>
              </div>
            </div>
            <div className="pm-stat-cell pm-stat-cell-premium pm-stat-cell-conf">
              <div className="pm-conf-ring pm-conf-ring-premium" style={{ ['--conf-value' as unknown as string]: active.confidence, ['--conf-color' as unknown as string]: confColor }}>
                <span>{active.confidence}</span>
              </div>
              <div className="pm-stat-cell-data">
                <div className="pm-stat-cell-label">Confidence</div>
                <div className="pm-stat-cell-quality">
                  {active.confidence >= 85 ? 'High' : active.confidence >= 65 ? 'Medium' : 'Low'}
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Editor */}
      <section className="pm-ws-editor">
        <div className="pm-ws-pane-head pm-ws-pane-head-premium">
          <div className="pm-ws-pane-title">{Ic.edit(13)} Markdown editor</div>
          <div className="pm-ws-pane-actions">
            <button type="button" className={cx('pm-btn pm-btn-icon pm-btn-icon-sm', scrollSync && 'pm-btn-icon-active')}
              onClick={() => setScrollSync(!scrollSync)} title="Toggle scroll sync" aria-label="Toggle scroll sync" aria-pressed={scrollSync}>
              {Ic.link(13)}
            </button>
            <button type="button" className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onCopy} title="Copy all" aria-label="Copy all markdown">
              {Ic.copy(13)}
            </button>
            <div className="mr-editor-view-switcher pm-view-switcher-premium" role="group" aria-label="Editor view">
              <button
                type="button"
                className={cx('pm-view-switcher-btn', editorMode === 'raw' && 'pm-view-switcher-btn-active')}
                onClick={() => setEditorMode('raw')}
                aria-pressed={editorMode === 'raw'}
              >
                {Ic.code(12)} <span>Raw</span>
              </button>
              <button
                type="button"
                className={cx('pm-view-switcher-btn', editorMode === 'rich' && 'pm-view-switcher-btn-active')}
                onClick={() => setEditorMode('rich')}
                aria-pressed={editorMode === 'rich'}
              >
                {Ic.edit(12)} <span>Rich text</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            className={cx('mr-editor-tools-toggle', toolbarCollapsed && 'is-collapsed')}
            onClick={() => setToolbarCollapsed((value) => !value)}
            aria-expanded={!toolbarCollapsed}
            aria-controls="mr-editor-tools"
            title={toolbarCollapsed ? 'Show formatting tools' : 'Hide formatting tools'}
            aria-label={toolbarCollapsed ? 'Show formatting tools' : 'Hide formatting tools'}
          >
            {Ic.chevronDown(13)}
          </button>
        </div>

        <div id="mr-editor-tools" className={cx('mr-editor-tools', toolbarCollapsed && 'is-collapsed')}>
          <div className={cx('pm-editor-toolbar', 'pm-editor-toolbar-premium', editorMode === 'rich' && 'mr-rich-toolbar')} role="toolbar" aria-label="Markdown formatting">
            <div className="pm-editor-tool-group pm-editor-tool-group-heading" aria-label="Headings">
              <span className="pm-editor-tool-group-label" aria-hidden="true">Structure</span>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('# ')} title="Heading 1" aria-label="Heading 1">{Ic.h1(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('## ')} title="Heading 2" aria-label="Heading 2">{Ic.h2(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('### ')} title="Heading 3" aria-label="Heading 3">{Ic.h3(13)}</button>
            </div>
            <div className="pm-editor-tool-group" aria-label="Inline formatting">
              <span className="pm-editor-tool-group-label" aria-hidden="true">Format</span>
              <button type="button" className="pm-editor-tool" onClick={() => wrap('**')} title="Bold (Ctrl+B)" aria-label="Bold">{Ic.bold(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => wrap('*')} title="Italic (Ctrl+I)" aria-label="Italic">{Ic.italic(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => wrap('~~')} title="Strikethrough" aria-label="Strikethrough">{Ic.strike(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => wrap('`')} title="Inline code" aria-label="Inline code">{Ic.code(13)}</button>
            </div>
            <div className="pm-editor-tool-group" aria-label="Lists and links">
              <span className="pm-editor-tool-group-label" aria-hidden="true">Blocks</span>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('- ')} title="Bullet list" aria-label="Bullet list">{Ic.list(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('1. ')} title="Numbered list" aria-label="Numbered list">{Ic.numbered(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('- [ ] ')} title="Task list" aria-label="Task list">{Ic.task(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => linePrefix('> ')} title="Blockquote" aria-label="Blockquote">{Ic.quote(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => wrap('[', '](url)')} title="Link (Ctrl+K)" aria-label="Link">{Ic.link(13)}</button>
            </div>
            <div className="pm-editor-tool-group" aria-label="Insert content">
              <span className="pm-editor-tool-group-label" aria-hidden="true">Insert</span>
              <button type="button" ref={codeLangBtnRef} className="pm-editor-tool" onClick={() => setLangOpen((value) => !value)} title="Code block with language" aria-label="Code block with language">
                {Ic.code(13)}
              </button>
              <button type="button" ref={tableBtnRef} className="pm-editor-tool" onClick={() => { setTablePickerPos(null); setTableOpen((value) => !value) }} title="Insert table" aria-label="Insert table">
                {Ic.table(13)}
              </button>
              <button type="button" className="pm-editor-tool" onClick={() => insertAtCursor('\n---\n')} title="Horizontal rule" aria-label="Horizontal rule">{Ic.hr(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => insertAtCursor('\n![Alt text](image-url)\n')} title="Image" aria-label="Insert image">{Ic.image(13)}</button>
              <button type="button" ref={emojiBtnRef} className="pm-editor-tool" onClick={() => setEmojiOpen((value) => !value)} title="Emoji (Ctrl + .)" aria-label="Insert emoji">
                {Ic.smile(14)}
              </button>
            </div>
            <div className="pm-editor-tool-group pm-editor-tool-group-advanced" aria-label="Advanced blocks">
              <span className="pm-editor-tool-group-label" aria-hidden="true">Advanced</span>
              <button type="button" className="pm-editor-tool" onClick={() => insertAtCursor('\n> [!NOTE]\n> Add a note here\n')} title="Callout" aria-label="Insert callout">{Ic.callout(13)}</button>
              <button type="button" className="pm-editor-tool" onClick={() => insertAtCursor('\n$$\n\n$$\n')} title="Math block" aria-label="Insert math block">{Ic.math(13)}</button>
              <button type="button" ref={diagramBtnRef} className={cx('pm-editor-tool', diagramOpen && 'pm-editor-tool-active')} onClick={() => setDiagramOpen((value) => !value)} title="Insert diagram" aria-label="Insert diagram" aria-pressed={diagramOpen}>{Ic.mermaid(13)}</button>
            </div>
            <div className="pm-editor-tool-group pm-editor-tool-group-search" aria-label="Search">
              <button
                type="button"
                className={cx('pm-editor-tool', findOpen && 'pm-editor-tool-active')}
                onClick={() => setFindOpen((value) => !value)}
                title="Find & Replace (Ctrl+F)"
                aria-label="Find and replace"
                aria-pressed={findOpen}
              >
                {Ic.find(14)}
              </button>
            </div>
            <div className="pm-editor-stats" aria-label={`${active.markdown.length.toLocaleString()} characters`}>
              {Ic.file(11)}<span>{active.markdown.length.toLocaleString()} chars</span>
            </div>
          </div>
        </div>

        {/* ── Popover widgets ───────────────────────────────── */}
        <div className="pm-editor-overlay-host">
        <EmojiPicker
          open={emojiOpen}
          anchorRect={emojiBtnRef.current?.getBoundingClientRect() ?? null}
          onPick={(em: EmojiEntry) => {
            insertAtCursor(em.e)
            setEmojiOpen(false)
          }}
          onClose={() => setEmojiOpen(false)}
        />
        <TablePicker
          open={tableOpen}
          anchorRect={tableBtnRef.current?.getBoundingClientRect() ?? null}
          position={tablePickerPos}
          onPick={(rows, cols) => {
            const header = '| ' + Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(' | ') + ' |'
            const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'
            const body = Array.from({ length: rows }, () =>
              '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |').join('\n')
            insertAtCursor('\n' + header + '\n' + sep + '\n' + body + '\n')
            setTableOpen(false)
          }}
          onClose={() => setTableOpen(false)}
        />
        <LangSelect
          open={langOpen}
          anchorRect={codeLangBtnRef.current?.getBoundingClientRect() ?? null}
          onPick={(lang) => {
            insertAtCursor('\n```' + lang + '\n\n```\n')
            setLangOpen(false)
            requestAnimationFrame(() => {
              const ta = editorRef.current
              if (ta) {
                const pos = ta.selectionStart - '\n```\n'.length
                ta.setSelectionRange(pos, pos)
              }
            })
          }}
          onClose={() => setLangOpen(false)}
        />
        <DiagramInsertMenu
          open={diagramOpen}
          anchorRect={diagramBtnRef.current?.getBoundingClientRect() ?? null}
          onPick={insertDiagramTemplate}
          onClose={() => setDiagramOpen(false)}
        />

        <SlashMenu
          open={slashOpen}
          query={slashQuery}
          position={slashPos}
          activeIndex={slashIndex}
          setActiveIndex={setSlashIndex}
          onPick={(item) => {
            const ta = editorRef.current
            if (!ta) return
            const applied = item.apply({
              value: ta.value,
              slashIndex: slashActiveIdxRef.current,
              caretIndex: ta.selectionStart,
            })
            onEdit(active.id, applied.text)
            closeSlashMenu()
            requestAnimationFrame(() => {
              ta.focus({ preventScroll: true })
              ta.setSelectionRange(applied.caret, applied.caret)
            })
          }}
          onClose={closeSlashMenu}
        />

        <EmojiAutocomplete
          open={acOpen}
          query={acQuery}
          position={acPos}
          activeIndex={acIndex}
          setActiveIndex={setAcIndex}
          onPick={(em) => {
            const ta = editorRef.current
            if (!ta) return
            const start = acStartRef.current
            const end = ta.selectionStart
            const val = ta.value
            const text = val.slice(0, start) + em.e + val.slice(end)
            onEdit(active.id, text)
            closeEmojiAC()
            requestAnimationFrame(() => {
              ta.focus({ preventScroll: true })
              const p = start + em.e.length
              ta.setSelectionRange(p, p)
            })
          }}
          onClose={closeEmojiAC}
        />
        </div>

        <FindReplaceBar
          open={findOpen}
          state={findState}
          setState={(patch) => setFindState((state) => ({ ...state, ...patch }))}
          totalMatches={findMatches.length}
          activeMatch={effectiveFindActive}
          onNext={nextMatch}
          onPrev={prevMatch}
          onReplaceOne={replaceOne}
          onReplaceAll={replaceAll}
          onClose={() => setFindOpen(false)}
        />

        <div className={cx('pm-editor-body', editorMode === 'rich' && 'mr-rich-editor-body')}>
          {editorMode === 'raw' ? <div className="pm-editor-gutter" aria-hidden ref={gutterRef}>{gutterLines}</div> : null}
          {editorMode === 'raw' && highlightHTML && (
            <div
              className="pm-editor-highlight"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: highlightHTML }}
            />
          )}
          {editorMode === 'raw' ? (
            <textarea
              ref={editorRef}
              className="pm-editor-textarea"
              value={active.markdown}
              onChange={handleEditorChange}
              onKeyDown={handleEditorKeyDown}
              onPaste={handleEditorPaste}
              onScroll={(event) => {
                const gutter = gutterRef.current
                if (gutter) gutter.scrollTop = event.currentTarget.scrollTop
              }}
              spellCheck={false}
              placeholder="Your markdown appears here..."
              aria-label="Markdown source editor"
            />
          ) : (
            <div
              ref={richEditorRef}
              className="mr-rich-editor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Rich text editor"
              aria-multiline="true"
              onInput={commitRichText}
              onBlur={commitRichText}
              spellCheck
            />
          )}
        </div>
      </section>

      {/* Preview */}
      <section className="pm-ws-preview">
        <div className="pm-ws-pane-head pm-ws-pane-head-premium">
          <div className="pm-ws-pane-title">{Ic.eye(13)} Live preview</div>
          <div className="pm-ws-pane-actions">
            <div className="pm-view-switcher pm-view-switcher-premium">
              <button className={cx('pm-view-switcher-btn', preview === 'preview' && 'pm-view-switcher-btn-active')} onClick={() => setPreview('preview')}>
                {Ic.eye(12)} <span>Rendered</span>
              </button>
              <button className={cx('pm-view-switcher-btn', preview === 'raw' && 'pm-view-switcher-btn-active')} onClick={() => setPreview('raw')}>
                {Ic.code(12)} <span>Raw</span>
              </button>
              <button className={cx('pm-view-switcher-btn', preview === 'outline' && 'pm-view-switcher-btn-active')} onClick={() => setPreview('outline')} aria-label="Show document outline">
                {Ic.list(12)} <span>Outline</span>
              </button>
            </div>
          </div>
        </div>
        <div className="pm-preview-body" ref={previewRef}>
          <div className="pm-preview-inner">
            {preview === 'outline' ? (
              <nav className="mr-outline" aria-label="Document outline">
                <div className="mr-outline-head"><span>Document outline</span><span>{outline.length} sections</span></div>
                {outline.length ? (
                  <div className="mr-outline-list">
                    {outline.map((item) => (
                      <button key={item.id} type="button" className={cx('mr-outline-item', activeHeadingId === item.id && 'mr-outline-item-active')} style={{ paddingLeft: `${14 + (item.level - 1) * 16}px` }} onClick={() => jumpToHeading(item.id)}>
                        <span className="mr-outline-level">H{item.level}</span><span>{item.title}</span>
                      </button>
                    ))}
                  </div>
                ) : <div className="mr-outline-empty">Add Markdown headings to build a navigable outline.</div>}
              </nav>
            ) : preview === 'preview' ? (
              active.markdown.trim()
                ? <DiagramPreview markdown={active.markdown} theme={mrTheme} />
                : (
                  <div className="pm-preview-empty">
                    {Ic.markdown(40)}
                    <div>Your rendered markdown will appear here</div>
                  </div>
                )
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontFamily: 'var(--pm-font-mono)', fontSize: 13, margin: 0 }}>
                {active.markdown}
              </pre>
            )}
          </div>
        </div>
        <div className="pm-export-bar pm-export-bar-premium">
          <div className="pm-export-formats">
            {([
              { fmt: 'md', label: 'MD', icon: Ic.markdown(12) },
              { fmt: 'pdf', label: 'PDF', icon: Ic.file(12) },
              { fmt: 'html', label: 'HTML', icon: Ic.code(12) },
              { fmt: 'json', label: 'JSON', icon: Ic.code(12) },
              { fmt: 'docx', label: 'DOCX', icon: Ic.file(12) },
              { fmt: 'chunks', label: 'AI', icon: Ic.chunks(12) },
            ] as const).map(({ fmt, label, icon }) => (
              <button
                key={fmt}
                className={cx('pm-export-format-btn', fmt === 'md' && 'pm-export-format-btn-active')}
                onClick={() => onDownload(fmt)}
                title={`Download ${label}`}
              >
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
          <button className="pm-export-copy-btn" onClick={onCopy} title="Copy markdown to clipboard">
            {Ic.copy(13)}<span>Copy</span>
          </button>
        </div>
      </section>

      {/* Draggable split handle */}
      {(!focusMode || focusView === 'split') && <div className="pm-ws-drag" role="separator" aria-orientation="vertical" aria-label="Resize editor and preview" />}

      {/* Footer status bar — premium */}
      <div className="pm-ws-footer pm-ws-footer-premium">
        <div className="pm-ws-foot-primary">
          <span className="pm-ws-foot-item pm-ws-foot-status">
            <span className="pm-ws-foot-dot" /> Ready
          </span>
          <span className="pm-ws-foot-sep" />
          <span className="pm-ws-foot-item pm-ws-foot-format">{Ic.markdown(11)} Markdown</span>
          <span className="pm-ws-foot-sep pm-ws-foot-sep-format" />
          <div className="pm-ws-foot-metrics">
            <span className="pm-ws-foot-item pm-ws-foot-line">Ln {cursorInfo.lines}</span>
            <span className="pm-ws-foot-item pm-ws-foot-chars">{cursorInfo.chars.toLocaleString()} chars</span>
            <span className="pm-ws-foot-item pm-ws-foot-words">{active.stats.words.toLocaleString()} words</span>
            <span className="pm-ws-foot-item pm-ws-foot-read">~{Math.max(1, Math.ceil(active.stats.words / 200))} min read</span>
          </div>
          <span className="pm-ws-foot-sep pm-ws-foot-sep-conf" />
          <span className="pm-ws-foot-item pm-ws-foot-conf">
            {Ic.check(10)} Conf {active.confidence}%
          </span>
        </div>
        <div className="pm-ws-foot-right">
          <span className="pm-ws-foot-item pm-ws-foot-sync">{scrollSync ? '↔ Scroll linked' : 'Scroll independent'}</span>
          <span className="pm-ws-foot-sep" />
          <span className="pm-ws-foot-item pm-ws-foot-encoding">UTF-8</span>
          <span className="pm-ws-foot-sep" />
          <span className="pm-ws-foot-item pm-ws-foot-eol">LF</span>
        </div>
      </div>

      {/* Destructive remove is confirm-gated. Rendered last so it sits above the
          workspace; position:fixed keeps it out of the grid's flow. */}
      {removeTarget && (
        <div className="pm-overlay pm-overlay-center" onClick={cancelRemove}>
          <div
            className="pm-modal pm-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mr-remove-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pm-modal-head">
              <div className="pm-modal-title" id="mr-remove-title">{Ic.trash(14)} Remove document</div>
              <button type="button" className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={cancelRemove} aria-label="Cancel">{Ic.close(12)}</button>
            </div>
            <div className="pm-modal-body pm-confirm-body">
              <p>Remove <strong>{removeTarget.title}.md</strong> from this workspace?</p>
              <p className="pm-confirm-note">This closes the document here. Your original file and the recent-conversions history are untouched.</p>
            </div>
            <div className="pm-confirm-actions">
              <button type="button" className="pm-btn pm-btn-ghost pm-btn-sm" onClick={cancelRemove}>Cancel</button>
              <button type="button" className="pm-btn pm-btn-danger pm-btn-sm" ref={removeConfirmRef} onClick={confirmRemove}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* The collation table. Mounted only while open, so the session takes a
          fresh snapshot of the workspace each time and nothing runs behind a
          closed dialog. Rendered inside the workspace root so it inherits the
          workspace skin tokens + data-theme. */}
      {mergeOpen && (
        <MergeDialog
          sources={jobs}
          onClose={onCloseMerge}
          onCreate={onCreateMerged}
        />
      )}

      {/* The sidebar row's provenance plate. Rendered at the workspace root, not
          inside the sidebar, because the sidebar scrolls and would clip it; its
          position comes from the hovered row's rect via the module's own popover
          placement helper. Decorative — the row's sr-only text carries the same
          information to assistive tech. */}
      {githubTip && githubTipDoc ? (
        <div className="mr-gh-file-tip" aria-hidden="true" style={getAnchoredPopoverStyle(githubTip.rect, 280, 54)}>
          <span className="mr-gh-file-tip-repo">
            {githubGlyph}
            <strong>{githubTipDoc.repoFullName}</strong>
          </span>
          <span className="mr-gh-file-tip-path">{githubTipDoc.branch} · {githubTipDoc.path}</span>
        </div>
      ) : null}

      {/* The editor's commit fast path. Opened from the filename chip; a sibling
          of the console over the same workspace, sharing the one connection
          instance and the same publish/compare code as the panel. */}
      {commitPopoverDoc ? (
        <GithubCommitPopover
          doc={commitPopoverDoc}
          onClose={() => setCommitPopoverSourceId(null)}
          onManageInConnections={() => {
            setFocusSourceId(commitPopoverDoc.sourceId)
            setCommitPopoverSourceId(null)
            openSettings('connections')
          }}
          onResetFromRemote={(markdown, sha) => onResetSourcedDocument(commitPopoverDoc.sourceId, markdown, sha)}
        />
      ) : null}

      {/* The calibration console. Rendered inside the workspace root (not
          portalled) on purpose: it must keep the workspace palette tokens and
          `data-theme`, which only exist under `.mr-markdown-workspace`. Mounted
          only while open, so closing restores focus to the seal and no pane
          state leaks between openings. */}
      {settingsOpen && (
        <MrMarkdownSettingsConsole
          key={settingsSection}
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
          status={account.status}
          viewer={account.viewer}
          refreshViewer={account.refresh}
          signOut={account.signOut}
          preferences={preferences}
          patchPreferences={patchPreferences}
          activeDocument={active && activeMarkdown ? { title: active.title, markdown: activeMarkdown } : undefined}
          openDocument={onOpenDocument}
          sourcedDocuments={sourcedDocuments}
          focusSourceId={focusSourceId}
          editSourcedDocument={onEditSourcedDocument}
          resetSourcedDocument={onResetSourcedDocument}
        />
      )}
    </div>
    </GithubConnectionProvider>
  )
}


/* ═══════════════════════════════════════════════════════════════════════
   COMMAND PALETTE (⌘K)
   ═══════════════════════════════════════════════════════════════════════ */

export interface CmdAction {
  id: string
  group: string
  label: string
  icon: React.ReactNode
  kbd?: string
  fn: () => void
}

export function CommandPalette({
  open, actions, creditState, onClose,
}: {
  open: boolean
  actions: CmdAction[]
  creditState: CreditBalanceState
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  useEffect(() => {
    if (!open) { setQ(''); setSel(0) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); return }
      if (e.key === 'Enter')     { e.preventDefault(); filtered[sel]?.fn(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel, q])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return actions
    return actions.filter((a) =>
      a.label.toLowerCase().includes(s) || a.group.toLowerCase().includes(s)
    )
  }, [q, actions])

  const grouped = useMemo(() => {
    const m = new Map<string, CmdAction[]>()
    for (const a of filtered) {
      if (!m.has(a.group)) m.set(a.group, [])
      m.get(a.group)!.push(a)
    }
    return Array.from(m.entries())
  }, [filtered])

  if (!open) return null
  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="pm-cmdk-search">
          {Ic.search(18)}
          <input
            autoFocus
            placeholder="Type an action, file, or command…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
          />
          <span className="pm-kbd">ESC</span>
        </div>
        <div className="pm-cmdk-list">
          {grouped.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--pm-text-muted)', fontSize: 13 }}>
              No matches
            </div>
          )}
          {grouped.map(([g, items]) => (
            <div key={g}>
              <div className="pm-cmdk-group-label">{g}</div>
              {items.map((a) => {
                const idx = filtered.indexOf(a)
                return (
                  <div key={a.id}>
                    <div
                      className={cx('pm-cmdk-item', idx === sel && 'pm-cmdk-selected')}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => { a.fn(); onClose() }}
                    >
                      {a.icon}
                      <span>{a.label}</span>
                      {a.kbd && <span className="pm-kbd">{a.kbd}</span>}
                    </div>
                    {a.id === 'run' || a.id === 'dl-docx' ? creditState.snapshot?.prices['pdf-to-markdown']?.enabled !== false ? <div className="pm-credit-cost pm-cmdk-credit-cost"><CreditCost toolId="pdf-to-markdown" creditState={creditState} showActionLabel={false} /></div> : null : ['ai-clean', 'ai-sum', 'ai-tr'].includes(a.id) ? creditState.snapshot?.prices['document-ai']?.enabled !== false ? <div className="pm-credit-cost pm-cmdk-credit-cost"><CreditCost toolId="document-ai" creditState={creditState} showActionLabel={false} /></div> : null : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="pm-cmdk-footer">
          <span><span className="pm-kbd">↑↓</span> Navigate</span>
          <span><span className="pm-kbd">↵</span> Run</span>
          <span><span className="pm-kbd">ESC</span> Close</span>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   TOAST STACK
   ═══════════════════════════════════════════════════════════════════════ */

export function ToastStack({
  toasts,
}: {
  toasts: { id: string; kind: 'success' | 'error' | 'info'; msg: string }[]
}) {
  return (
    <div className="pm-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pm-toast', `pm-toast-${t.kind}`)}>
          <div className="pm-toast-icon">
            {t.kind === 'success' ? Ic.check(12) : t.kind === 'error' ? Ic.alert(12) : Ic.info(12)}
          </div>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS HELP MODAL
   ═══════════════════════════════════════════════════════════════════════ */

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const items = [
    ['⌘K / Ctrl+K', 'Open command palette'],
    ['⌘↵ / Ctrl+Enter', 'Open blank editor'],
    ['⌘C / Ctrl+C', 'Copy markdown'],
    ['⌘S / Ctrl+S', 'Download .md'],
    ['⌘/ / Ctrl+/', 'Toggle focus mode'],
    ['?', 'Show shortcuts'],
    ['Esc', 'Close overlay / go back'],
  ]
  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-head">
          <div className="pm-modal-title">{Ic.kbd(14)} Keyboard shortcuts</div>
          <button className="pm-btn pm-btn-icon pm-btn-icon-sm" onClick={onClose}>{Ic.close(12)}</button>
        </div>
        <ul className="pm-shortcut-list">
          {items.map(([k, l]) => (
            <li key={k}>
              <span>{l}</span>
              <span className="pm-kbd">{k}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
