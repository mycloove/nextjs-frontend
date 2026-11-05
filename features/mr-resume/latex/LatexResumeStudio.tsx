'use client'

import { useDeferredValue, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import theme from '../components/MrResumeTheme.module.css'
import styles from './LatexResumeStudio.module.css'
import CodeMirrorSource, { type SourceJump } from './CodeMirrorSource'
import LatexPdfPreview from './LatexPdfPreview'
import LatexBuildDetails from './LatexBuildDetails'
import { applyReviewedProjectReplace, findProjectLiteral, reviewProjectReplace, type ProjectReplaceReview } from './editorHelpers'
import LatexIcon from './LatexIcon'
import useLatexWorkspace, { workspaceFeedbackFact } from './useLatexWorkspace'
import { LatexAnnouncements, LatexAttentionBar, LatexReceipt } from './LatexFeedback'
import LatexBuildOutput from './LatexBuildOutput'
import { selectAttention, selectReceipt, type FeedbackFact } from './feedback'
import { addProjectAsset, addTextFile, applyNativeFontChoices, cloneAsNewProject, deleteProjectFile, downloadName, projectSize, referencesToFile, renameProjectFile,
  newLatexId, requiredNativeFonts, restoreCheckpointProject, reviseProject, sameProjectSource, sourceOutline, utf8Bytes } from './project.ts'
import { createTemplateProject, latexSourceTemplates, latexTemplateQualifications } from './templates.ts'
import { createRegularLatexProject, downloadBlob, exportProjectFile, importProjectFileWithReport, importSupportedFile } from './projectImport'
import type { LatexImportReport } from './projectArchive'
import { assessLatexProject, type LatexInventoryStatus } from './projectAssessment'
import { createLatexProofNavigation, type ProofNavigationResult } from './proofNavigation'
import { BROWSER_LATEX_ROOT, browserEngineAssetPins, browserLatexCompatibility, getBrowserCompilerManifest, type LatexEngineAssetAudit } from './browserCompiler'
import type { LatexAsset, LatexCheckpoint, LatexDiagnostic, LatexImportRequest, LatexPdfLocation, LatexProject, LatexProof, LatexRuntime } from './types'
import { LATEX_LIMITS, LATEX_MAIN_FILE_NOTICE } from './types'
import { createAltaCvOriginalProject, findAltaCvEntry } from './altacvBrowser'
import { LOCAL_LATEX_LIMITS } from './projectStore'
import { diagnosticSourceTarget, matchesSourceSnapshot, proofActionIdentity } from './workspaceIdentity'
import { consoleHeight, readWorkspaceUi, writeWorkspaceUi, type WorkspaceDrawer } from './workspaceUi'
import { compilerEditorDiagnostics, type EditorDiagnostic, type LocalDiagnosticReport } from './editorDiagnostics'
import { reviewDiagnosticFix, reviewPackageDeclaration, type ReviewedSourceFix } from './editorFixes'
import { packageAssistance, type PackageAssistance } from './packageAssistance'

export type LatexResumeStudioProps = { active: boolean; importRequest?: LatexImportRequest | null; onImportHandled?: (id: string) => void; onCopyRegular?: () => void }
type Panel = 'files' | 'source' | 'proof' | 'problems'
type Drawer = WorkspaceDrawer
type Modal = { kind: 'new' | 'rename'; fileId?: string; path?: string } | { kind: 'delete'; fileId: string; path: string }
  | { kind: 'restore'; checkpoint: LatexCheckpoint } | { kind: 'privacy'; auto: boolean } | { kind: 'fonts'; projectId: string; revision: number; fonts: string[] }
  | { kind: 'remove'; project: LatexProject } | { kind: 'engine-cache' } | { kind: 'engine-assets'; operationKey: string } | { kind: 'preparation'; operationKey: string }
  | { kind: 'replace'; review: ProjectReplaceReview }
type ModalSession = Modal & { requestId: string; snapshot: LatexProject | null; runtime: LatexRuntime }
type IssueReview = { issue: EditorDiagnostic; fix: ReviewedSourceFix | null; assistance: PackageAssistance | null; epoch: number; viewEpoch: number; error?: string }
const emptyDiagnostics: LatexDiagnostic[] = []
const smallSnapshot = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const subscribeSmall = (notify: () => void) => { const query = window.matchMedia('(max-width: 900px)'); query.addEventListener('change', notify); return () => query.removeEventListener('change', notify) }
const engineNames = { lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX' } as const
const localDisclosureMotion = { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
function sizeLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB` }
function groupEngineAssets(assets: LatexEngineAssetAudit[]) {
  const groups = new Map<string, { id: string; kind: LatexEngineAssetAudit['groupKind']; packages: string[]; assets: LatexEngineAssetAudit[] }>()
  for (const asset of assets) {
    const group = groups.get(asset.groupId)
    if (group) group.assets.push(asset)
    else groups.set(asset.groupId, { id: asset.groupId, kind: asset.groupKind, packages: asset.packages, assets: [asset] })
  }
  return [...groups.values()]
}

function FileActionMenu({ path, children }: { path: string; children: ReactNode }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 })
  const [palette, setPalette] = useState({ panel: '', ink: '', muted: '', line: '', soft: '', danger: '', focus: '', shadow: '' })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(), panel = popup.current
      if (!anchor || !panel) return
      const margin = 8, gap = 6
      const left = Math.min(Math.max(margin, anchor.right - panel.offsetWidth), window.innerWidth - panel.offsetWidth - margin)
      const below = anchor.bottom + gap
      const top = below + panel.offsetHeight <= window.innerHeight - margin ? below : Math.max(margin, anchor.top - panel.offsetHeight - gap)
      setPosition({ left, top })
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false)
    }
    place()
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('focusin', focusOutside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('focusin', focusOutside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  return <>
    <button ref={trigger} type="button" className={styles.fileMenuTrigger} aria-label={`Actions for ${path}`} aria-expanded={open} aria-controls={open ? id : undefined} title={`Actions for ${path}`} onClick={(event) => {
      if (open) { setOpen(false); return }
      const rect = event.currentTarget.getBoundingClientRect()
      const computed = window.getComputedStyle(event.currentTarget)
      setPosition({ left: Math.max(8, rect.right - 184), top: rect.bottom + 6 })
      setPalette({ panel: computed.getPropertyValue('--rs-panel').trim(), ink: computed.getPropertyValue('--rs-ink').trim(), muted: computed.getPropertyValue('--rs-muted').trim(), line: computed.getPropertyValue('--rs-line').trim(), soft: computed.getPropertyValue('--rs-soft').trim(), danger: computed.getPropertyValue('--rs-danger').trim(), focus: computed.getPropertyValue('--rs-focus').trim(), shadow: computed.getPropertyValue('--rs-dropdown-shadow').trim() })
      setOpen(true)
    }}><LatexIcon name="more" /></button>
    {open && createPortal(<div ref={popup} id={id} className={styles.fileMenuPopover} role="group" aria-label={`Actions for ${path}`} style={{ left: position.left, top: position.top, '--rs-panel': palette.panel, '--rs-ink': palette.ink, '--rs-muted': palette.muted, '--rs-line': palette.line, '--rs-soft': palette.soft, '--rs-danger': palette.danger, '--rs-focus': palette.focus, '--rs-dropdown-shadow': palette.shadow } as CSSProperties} onClick={(event) => {
      if ((event.target as HTMLElement).closest('button')) { setOpen(false); trigger.current?.focus() }
    }} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
      if (next !== null && buttons.length) { event.preventDefault(); buttons[next]?.focus() }
    }}>{children}</div>, document.body)}
  </>
}

function ProjectImagePreview({ asset, onSource }: { asset: LatexAsset; onSource: () => void }) {
  const element = useRef<HTMLImageElement>(null)
  const [preview, setPreview] = useState<{ blob: Blob; failed: boolean; dimensions: string } | null>(null)
  useEffect(() => {
    const image = element.current
    if (!image) return
    const url = URL.createObjectURL(asset.blob)
    image.onload = () => setPreview({ blob: asset.blob, failed: false, dimensions: `${image.naturalWidth} x ${image.naturalHeight} px` })
    image.onerror = () => setPreview({ blob: asset.blob, failed: true, dimensions: '' })
    image.src = url
    return () => { image.onload = null; image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [asset.blob])
  const image = preview?.blob === asset.blob ? preview : null
  return <div className={styles.assetPreview} aria-label={`Local image preview: ${asset.path}`}>
    <div className={styles.assetControls}><LatexIcon name="image" /><code>{asset.path}</code><button type="button" className={styles.button} onClick={() => downloadBlob(asset.blob, asset.path.split('/').pop()!)}><LatexIcon name="download" />Download image</button><button type="button" className={styles.button} onClick={onSource}><LatexIcon name="file" />Return to source</button></div>
    <div className={styles.assetStage}>
      {!image ? <p role="status">Opening the local image...</p> : image.failed ? <p role="alert">This browser could not display the image. Its original bytes are still saved and available to download.</p> : null}
      {/* Original project bytes use a local object URL, not remote image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={element} alt={asset.path} hidden={!image || image.failed} />
    </div>
    <div className={styles.sourceStatus}><span>Original local image. Selecting it does not upload or modify it.</span><output>{image?.dimensions} <span>{sizeLabel(asset.blob.size)}</span></output></div>
  </div>
}

export default function LatexResumeStudio({ active, importRequest = null, onImportHandled, onCopyRegular }: LatexResumeStudioProps) {
  const workspace = useLatexWorkspace(active)
  const small = useSyncExternalStore(subscribeSmall, smallSnapshot, () => false)
  const [mobilePanel, setMobilePanel] = useState<Panel>('source'), [wrap, setWrap] = useState(true), [split, setSplit] = useState(50)
  const [sourceHeaderCollapsed, setSourceHeaderCollapsed] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(true), [fontSize, setFontSize] = useState<number | null>(null), [tabSize, setTabSize] = useState<2 | 4>(2)
  const [localExpanded, setLocalExpanded] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({}), [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [jump, setJump] = useState<SourceJump | null>(null), [sourceLine, setSourceLine] = useState(1)
  const [drawer, setDrawer] = useState<Drawer>('closed')
  const [detailsOpen, setDetailsOpen] = useState(false), [drawerHeight, setDrawerHeight] = useState(224)
  const [outputView, setOutputView] = useState<'log' | 'activity'>('log'), [preferencesReady, setPreferencesReady] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(800)
  const [localDiagnostics, setLocalDiagnostics] = useState<LocalDiagnosticReport | null>(null)
  const [issueReview, setIssueReview] = useState<IssueReview | null>(null)
  const [fixRequest, setFixRequest] = useState<{ id: number; review: ReviewedSourceFix } | null>(null)
  const fixSequence = useRef(0), fileEpoch = useRef(0), pendingFix = useRef<{ id: number; epoch: number; viewEpoch: number } | null>(null)
  const [actionProgress, setActionProgress] = useState<FeedbackFact | null>(null)
  const [importReports, setImportReports] = useState<Record<string, LatexImportReport>>({})
  const [searchQuery, setSearchQuery] = useState(''), [replacement, setReplacement] = useState(''), [searchOpen, setSearchOpen] = useState(false)
  const deferredQuery = useDeferredValue(searchQuery), searchInput = useRef<HTMLInputElement>(null)
  const [modal, setModal] = useState<ModalSession | null>(null), [pathDraft, setPathDraft] = useState(''), [fileText, setFileText] = useState(''), [fontChoices, setFontChoices] = useState<Record<string, string>>({})
  const [modalError, setModalError] = useState('')
  const [consent, setConsent] = useState(false), [consentChecked, setConsentChecked] = useState(false), [busy, setBusy] = useState(false)
  const [cacheClearError, setCacheClearError] = useState('')
  const [copyFonts, setCopyFonts] = useState<{ projectId: string; fonts: string[] } | null>(null)
  const [sync, setSync] = useState<{ identity: string; location: LatexPdfLocation | null; message: string; busy: boolean } | null>(null)
  const [navigationChoices, setNavigationChoices] = useState<{ snapshot: LatexProject; proof: LatexProof; epoch: number; candidates: ProofNavigationResult['candidates'] } | null>(null)
  const navigation = useRef<ReturnType<typeof createLatexProofNavigation> | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), splitElement = useRef<HTMLDivElement>(null), drag = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const consoleDrag = useRef<{ pointer: number; y: number; height: number } | null>(null)
  const consoleReturnFocus = useRef<HTMLElement | null>(null), drawerContent = useRef<HTMLDivElement>(null)
  const localPanel = useRef<HTMLDivElement>(null), localBody = useRef<HTMLDivElement>(null)
  const localIntent = useRef(false), localStart = useRef<number | null>(null), localAnimations = useRef<Animation[]>([])
  const importInput = useRef<HTMLInputElement>(null), assetInput = useRef<HTMLInputElement>(null), sourceTabs = useRef<(HTMLButtonElement | null)[]>([])
  const handledImports = useRef(new Set<string>()), jumpSequence = useRef(0), syncRequest = useRef<AbortController | null>(null)
  const latest = useRef(workspace), callbacks = useRef({ onImportHandled })
  useLayoutEffect(() => { latest.current = workspace; callbacks.current = { onImportHandled } }, [workspace, onImportHandled])
  const alive = useRef(true)
  const modalRef = useRef<ModalSession | null>(null), pendingActions = useRef(new Set<string>()), pendingModals = useRef(new Set<string>())
  const project = workspace.project
  const deferredProject = useDeferredValue(project)
  const file = project?.files.find((item) => item.id === selectedFiles[project.id]) ?? project?.files.find((item) => item.path === project.mainFile) ?? project?.files[0]
  const asset = project?.assets.find((item) => item.id === selectedAsset)
  const projectEntries = project ? [...project.files, ...project.assets] : []
  const selectedEntry = asset ?? file
  const projectTextOnly = Boolean(file && (/\.(?:md|txt)$/iu.test(file.path) || file.path.split('/').pop()?.toLowerCase() === 'latexmkrc'))
  const filesToggleLabel = small ? mobilePanel === 'files' ? 'Return to source' : 'Show project files' : filesOpen ? 'Hide project files' : 'Show project files'
  const proof = workspace.proof, current = workspace.proofCurrent
  const foreignProof = Boolean(proof && project && proof.projectId !== project.id)
  const sameRevisionMismatch = Boolean(proof && project && proof.revision === project.revision && !current && !foreignProof)
  const identity = proofActionIdentity(proof)
  const currentAttempt = workspace.attempt?.projectId === project?.id ? workspace.attempt : null
  const diagnostics = currentAttempt?.diagnostics ?? proof?.diagnostics ?? emptyDiagnostics
  const diagnosticRevision = currentAttempt?.revision ?? proof?.revision
  const diagnosticSnapshot = currentAttempt?.snapshot ?? workspace.proofSource
  const diagnosticRuntime = currentAttempt?.runtime ?? proof?.runtime ?? 'native'
  const diagnosticsCurrent = matchesSourceSnapshot(project, diagnosticSnapshot) && diagnosticRuntime === workspace.runtime
  const liveHints = localDiagnostics?.fileId === file?.id && localDiagnostics?.runtime === workspace.runtime && matchesSourceSnapshot(project, localDiagnostics?.snapshot) ? localDiagnostics!.hints : []
  const compilerIssues = diagnosticSnapshot ? compilerEditorDiagnostics(diagnosticSnapshot, diagnostics, diagnosticRuntime, diagnosticsCurrent) : []
  const editorIssues = [...compilerIssues, ...liveHints]
  const usefulProblems = Boolean(currentAttempt && ['failed', 'recoverable'].includes(currentAttempt.stage) || diagnostics.some((item) => item.severity === 'error') || liveHints.length)
  // Attention surfaces failures without stealing the user's chosen console tab.
  const drawerOpen = drawer !== 'closed' || (small && mobilePanel === 'problems')
  const drawerView = drawer === 'closed' ? 'build' : drawer
  const localRuntime = workspace.runtime === 'browser'
  const infoMessages = [
    ...(localRuntime ? [{ id: 'browser-compiler', title: 'Local browser compiler', message: 'Project source, images, build logs and PDF bytes are not uploaded. First use downloads only fixed engine assets; offline use needs cached assets.' }] : []),
    { id: 'workspace-limits', title: 'Bounded local workspace', message: 'Up to 32 files, 1 MiB source, 3 MiB project/PDF and 32 pages. Engine cache does not mean the application is offline-ready.' },
  ]
  const canSync = Boolean(active && current && proof && (proof.runtime ?? 'native') === workspace.runtime
    && (proof.runtime === 'browser' ? workspace.syncArtifact?.identity === identity : proof.syncAvailable && workspace.online))
  const navigationReason = !current ? 'Compile the current source before locating a source line.'
    : proof && (proof.runtime ?? 'native') !== workspace.runtime ? 'The proof belongs to a different runtime. Compile the selected runtime to navigate.'
      : proof?.runtime === 'browser' ? 'No safely qualified session source map is available. Recompiling may restore it; ambiguous or unsupported maps remain unavailable. The PDF is unchanged.'
        : !workspace.online ? 'Native source maps require a connection. The retained PDF is still available.' : 'No source map is available for this proof, or its private map has expired.'
  const capabilityReady = workspace.capabilities.enabled && workspace.capabilities.ready
  const browserCompiler = localRuntime
  const compiling = Boolean(workspace.attempt && ['waiting', 'cancelling', 'recovering'].includes(workspace.attempt.stage))
  const saveLabel = !workspace.ready ? 'Restoring' : workspace.saveState?.kind === 'saved' ? 'Saved locally'
    : workspace.saveState?.kind === 'saving' ? 'Saving' : workspace.saveState?.kind === 'conflict' ? 'Another tab saved' : workspace.saveState?.kind === 'session' ? 'Session only' : 'Unsaved changes'
  const nativeFonts = (workspace.capabilities.profiles.find((profile) => profile.id === project?.engine) ?? (browserCompiler ? workspace.capabilities.profiles[0] : undefined))?.fonts ?? []
  const copiedFontsUnverified = Boolean(copyFonts && project && copyFonts.projectId === project.id && (!capabilityReady || copyFonts.fonts.some((font) => !nativeFonts.includes(font))))
  const fileCount = project ? project.files.length + project.assets.length : 0
  const projectCheckpoints = workspace.checkpoints.filter((item) => item.project.id === project?.id)
  const contentSize = project ? projectSize(project) : { source: 0, assets: 0 }
  const outline = project && outlineOpen && deferredProject === project ? sourceOutline(project.files) : []
  const engineReady = Boolean(project && workspace.capabilities.profiles.some((profile) => profile.id === project.engine))
  const compileDisabled = !project?.mainFile || !capabilityReady || !engineReady || (!localRuntime && !workspace.online) || !active || workspace.engineCacheBusy
  const compileReason = project?.mainFile === null ? LATEX_MAIN_FILE_NOTICE : !localRuntime && !workspace.online ? 'Offline. Private native compilation is paused; source editing and retained downloads still work.' : !capabilityReady ? workspace.capabilities.reason : !engineReady ? 'This engine is not included in the selected runtime. Choose a reported engine explicitly; source is not converted silently.' : workspace.engineCacheBusy ? 'Wait for engine cache preparation or package approval to finish.' : ''
  const localCompatibility = localRuntime && capabilityReady && project && deferredProject === project ? browserLatexCompatibility(project, workspace.capabilities.profiles) : []
  const localManifest = localRuntime ? getBrowserCompilerManifest() : null
  const assessment = project && deferredProject === project && drawerOpen && drawerView === 'build' ? assessLatexProject(project, workspace.capabilities.profiles) : null
  const projectSearch = project && deferredProject === project && searchOpen ? findProjectLiteral(project, deferredQuery) : null
  const importReport = project ? importReports[project.id] : undefined
  const inventoryLabel = (value: LatexInventoryStatus) => value === 'listed' ? 'Listed in this profile' : value === 'not-listed' ? 'Not listed in this profile' : value === 'not-recorded' ? 'Not recorded' : 'Not determined'
  const localEngineBytes = localManifest && project ? browserEngineAssetPins(localManifest, project.engine).reduce((sum, pin) => sum + pin.bytes, 0) : null
  const preparationCurrent = Boolean(project && workspace.browserPreparation?.projectId === project.id && workspace.browserPreparation.revision === project.revision && sameProjectSource(workspace.browserPreparation.snapshot, project))
  const dependencyCheck = workspace.dependencyCheck
  const dependencyCheckCurrent = Boolean(localRuntime && dependencyCheck && workspace.sourceIsCurrent(dependencyCheck.snapshot, dependencyCheck.epoch))
  const pendingPackages = workspace.browserPreparation?.projectId === project?.id ? workspace.browserPreparation : null
  const inspectedPackages = dependencyCheck?.status === 'ready' && dependencyCheck.snapshot.id === project?.id ? dependencyCheck : null
  const packageReview = pendingPackages?.packages ?? inspectedPackages?.preparation
  const packageReviewSource = pendingPackages?.packages ? pendingPackages.snapshot : inspectedPackages?.snapshot
  const packageReviewCurrent = localRuntime && (pendingPackages?.packages ? preparationCurrent : dependencyCheckCurrent)
  const buildLog = currentAttempt?.log ?? proof?.log ?? ''
  const altaCvEntry = project ? findAltaCvEntry(project) : null
  const readyBrowserAttempt = workspace.proofAttempt?.stage === 'ready' && workspace.proofAttempt.runtime === 'browser' && workspace.proofAttempt.operationKey === proof?.operationKey ? workspace.proofAttempt : null
  const readyEngineAssets = readyBrowserAttempt?.progress?.assetAudit ?? []
  const engineAssetAttempt = modal?.kind === 'engine-assets' && readyBrowserAttempt?.operationKey === modal.operationKey && readyEngineAssets.length ? readyBrowserAttempt : null
  const engineAssets = engineAssetAttempt?.progress?.assetAudit ?? []
  const engineAssetGroups = groupEngineAssets(engineAssets)
  const engineAssetBytes = engineAssets.reduce((sum, asset) => sum + asset.bytes, 0)
  const engineAssetsReused = engineAssets.filter((asset) => asset.source === 'indexeddb-reuse').length
  const reviewCurrent = Boolean(issueReview && issueReview.viewEpoch === fileEpoch.current && workspace.sourceIsCurrent(issueReview.issue.snapshot, issueReview.epoch) && issueReview.issue.runtime === workspace.runtime)

  useEffect(() => {
    let saved
    try { saved = readWorkspaceUi(window.localStorage) } catch { /* Preferences are optional when browser storage is blocked. */ }
    if (saved) {
      setDrawer(saved.drawer); setDetailsOpen(saved.detailsOpen); setDrawerHeight(saved.consoleHeight)
      setOutputView(saved.outputView); setSourceHeaderCollapsed(saved.sourceHeaderCollapsed)
    }
    setPreferencesReady(true)
    const measure = () => setViewportHeight(window.innerHeight)
    measure(); window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => {
    if (!preferencesReady) return
    try { writeWorkspaceUi(window.localStorage, { version: 1, drawer, detailsOpen, consoleHeight: drawerHeight, outputView, sourceHeaderCollapsed }) } catch { /* Access to localStorage itself can be denied. */ }
  }, [preferencesReady, drawer, detailsOpen, drawerHeight, outputView, sourceHeaderCollapsed])

  function toggleLocalWorkspace() {
    const panel = localPanel.current, body = localBody.current
    if (!panel || !body) return
    const before = panel.getBoundingClientRect().top
    const frame = { opacity: getComputedStyle(body).opacity, transform: getComputedStyle(body).transform }
    const expand = !localIntent.current
    localIntent.current = expand
    localAnimations.current.forEach((animation) => animation.cancel())
    localAnimations.current = []
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const offset = before - panel.getBoundingClientRect().top
    if (localExpanded && !reduced && offset) localAnimations.current.push(panel.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], localDisclosureMotion))
    if (expand) {
      if (!filesOpen) setFilesOpen(true)
      if (!localExpanded) { localStart.current = filesOpen ? before : null; setLocalExpanded(true) }
      else if (!reduced) localAnimations.current.push(body.animate([frame, { opacity: 1, transform: 'none' }], localDisclosureMotion))
      return
    }
    if (!small && panel.contains(document.activeElement)) root.current?.querySelector<HTMLButtonElement>('[aria-describedby="resume-latex-local-hint"]')?.focus()
    if (reduced) { localStart.current = before; setLocalExpanded(false); return }
    const exit = body.animate([frame, { opacity: 0, transform: 'translateY(8px)' }], { ...localDisclosureMotion, duration: 120, fill: 'forwards' })
    localAnimations.current.push(exit)
    exit.onfinish = () => {
      if (localIntent.current || !alive.current) return
      localStart.current = panel.getBoundingClientRect().top
      setLocalExpanded(false)
    }
  }

  useLayoutEffect(() => {
    const before = localStart.current, panel = localPanel.current
    localStart.current = null
    if (before === null || !panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    localAnimations.current.forEach((animation) => animation.cancel())
    // FLIP moves the bottom-anchored footer without stretching text or animating height.
    const slide = panel.animate([{ transform: `translateY(${before - panel.getBoundingClientRect().top}px)` }, { transform: 'none' }], localDisclosureMotion)
    localAnimations.current = [slide]
    if (localExpanded && localBody.current) localAnimations.current.push(localBody.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], localDisclosureMotion))
  }, [localExpanded])

  function closeMenus(returnFocus = false) {
    root.current?.querySelectorAll<HTMLDetailsElement>('details[data-latex-menu][open]').forEach((menu) => {
      menu.open = false
      if (returnFocus) menu.querySelector('summary')?.focus()
    })
  }

  useEffect(() => {
    if (!active) { closeMenus(); closeModal(); return }
    const dismiss = (event: PointerEvent) => {
      root.current?.querySelectorAll<HTMLDetailsElement>('details[data-latex-menu][open]').forEach((menu) => { if (!menu.contains(event.target as Node)) menu.open = false })
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [active])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (modal && active && !element.open) element.showModal()
    if ((!modal || !active) && element.open) element.close()
    if (!active) drag.current = null
  }, [modal, active])

  useEffect(() => {
    if (modal?.kind === 'engine-assets' && !engineAssetAttempt) { modalRef.current = null; setModal(null) }
  }, [modal, engineAssetAttempt])

  useEffect(() => {
    if (!workspace.ready || !importRequest || handledImports.current.has(importRequest.id)) return
    const request = importRequest
    const initiatingProject = latest.current.project
    handledImports.current.add(request.id)
    if (handledImports.current.size > 64) handledImports.current.delete(handledImports.current.values().next().value!)
    // An explicit bridge request creates a NEW independent project, never replaces a draft.
    void createRegularLatexProject(request.snapshot).then((copy) => {
      if (!alive.current) return
      const selected = latest.current.project
      latest.current.addProject(copy, selected?.id === initiatingProject?.id && selected?.revision === initiatingProject?.revision && sameProjectSource(selected, initiatingProject))
      setCopyFonts({ projectId: copy.id, fonts: requiredNativeFonts(request.snapshot.source) })
      latest.current.notify('success', 'import', 'regular-source-copy', 'Regular source copied to a new LaTeX project with its displayed JPEG photo, if present. This is not a pixel-identical Regular layout.', copy, request.id, ['build-settings'])
      callbacks.current.onImportHandled?.(request.id)
    }).catch((error: unknown) => { if (!alive.current) return; latest.current.notify('error', 'import', 'regular-source-copy', error instanceof Error ? error.message : 'Source copy failed. The Regular draft and current project are unchanged.', initiatingProject, request.id); callbacks.current.onImportHandled?.(request.id) })
  }, [workspace.ready, importRequest])

  useEffect(() => { syncRequest.current?.abort(); navigation.current?.dispose(); navigation.current = null; setNavigationChoices(null) }, [active, project, identity, workspace.runtime, file?.id])
  useEffect(() => {
    if (!sync?.location) return
    const captured = sync.location, key = sync.identity
    const timer = setTimeout(() => setSync((value) => value?.identity === key && value.location === captured ? { ...value, location: null } : value), 1800)
    return () => clearTimeout(timer)
  }, [sync?.identity, sync?.location])
  useEffect(() => { const element = dialog.current; alive.current = true; return () => { alive.current = false; syncRequest.current?.abort(); navigation.current?.dispose(); localAnimations.current.forEach((animation) => animation.cancel()); element?.close() } }, [])

  function act(action: () => void) { try { action() } catch (error) { workspace.notify('error', 'project', 'project-action', error instanceof Error ? error.message : 'The project action could not be applied.', project) } }
  function chooseFile(id: string) {
    if (!project) return
    if (id !== file?.id || asset) { fileEpoch.current++; syncRequest.current?.abort(); navigation.current?.dispose(); navigation.current = null; setNavigationChoices(null); setSync(null) }
    setSelectedFiles((previous) => ({ ...previous, [project.id]: id })); setSelectedAsset(null); setMobilePanel('source')
  }
  function chooseAsset(id: string) { fileEpoch.current++; syncRequest.current?.abort(); navigation.current?.dispose(); navigation.current = null; setNavigationChoices(null); setSync(null); setSelectedAsset(id); setMobilePanel('source') }
  function jumpTo(id: string, line: number, registration = false, range?: Pick<SourceJump, 'column' | 'endLine' | 'endColumn'>) {
    chooseFile(id); setJump({ id: ++jumpSequence.current, fileId: id, line, registration, ...range })
  }
  function jumpToDiagnostic(diagnostic: LatexDiagnostic) {
    if (diagnosticRuntime !== latest.current.runtime || !latest.current.sourceIsCurrent(diagnosticSnapshot)) return
    const target = diagnosticSourceTarget(latest.current.project, diagnosticSnapshot, diagnostic)
    if (target) jumpTo(target.fileId, target.line, true)
  }
  function issueIsCurrent(issue: EditorDiagnostic) {
    return issue.runtime === latest.current.runtime && latest.current.sourceIsCurrent(issue.snapshot)
  }
  function jumpToIssue(issue: EditorDiagnostic) {
    if (!issueIsCurrent(issue) || !issue.range) return
    const target = diagnosticSourceTarget(latest.current.project, issue.snapshot, { file: issue.path ?? undefined, line: issue.range.line })
    if (target) jumpTo(target.fileId, target.line, true, issue.range.precision === 'token' ? issue.range : undefined)
  }
  function reviewIssue(issue: EditorDiagnostic) {
    if (!project) return
    const epoch = workspace.actionEpoch(), viewEpoch = fileEpoch.current
    if (!issueIsCurrent(issue)) { setIssueReview({ issue, fix: null, assistance: null, epoch, viewEpoch, error: 'This diagnostic belongs to another source snapshot or runtime. Recompile before reviewing a fix.' }); return }
    try {
      const assistance = packageAssistance(project, issue, { manifest: localManifest, profiles: workspace.capabilities.profiles, compilerLog: buildLog })
      const fix = reviewDiagnosticFix(project, issue, buildLog) ?? (assistance ? reviewPackageDeclaration(project, assistance) : null)
      setIssueReview({ issue, fix, assistance, epoch, viewEpoch })
    } catch (error) { setIssueReview({ issue, fix: null, assistance: null, epoch, viewEpoch, error: error instanceof Error ? error.message : 'No safe source fix could be prepared.' }) }
  }
  function applyIssueFix() {
    const review = issueReview
    if (!review?.fix || review.viewEpoch !== fileEpoch.current || !latest.current.sourceIsCurrent(review.fix.snapshot, review.epoch) || latest.current.runtime !== review.fix.runtime) return
    const id = ++fixSequence.current
    chooseFile(review.fix.fileId)
    pendingFix.current = { id, epoch: review.epoch, viewEpoch: fileEpoch.current }
    setFixRequest({ id, review: review.fix })
  }
  function completeIssueFix(id: number, error: string | null) {
    if (pendingFix.current?.id !== id) return
    pendingFix.current = null; setFixRequest(null)
    if (error) setIssueReview((review) => review ? { ...review, error } : review)
    else { setIssueReview(null); latest.current.notify('info', 'source', 'reviewed-fix', 'Reviewed fix applied to source. Undo restores the previous text; compile to verify the result.') }
  }
  async function downloadAssistance() {
    const captured = issueReview, assistance = captured?.assistance
    if (!captured || captured.viewEpoch !== fileEpoch.current || !assistance?.preparation || !latest.current.sourceIsCurrent(assistance.snapshot, captured.epoch)) return
    try {
      if (await workspace.downloadBrowserPackages(assistance.snapshot, assistance.preparation, captured.epoch)) setIssueReview((review) => review === captured ? null : review)
    } catch (error) { if (alive.current) setIssueReview((review) => review === captured ? { ...review, error: error instanceof Error ? error.message : 'Package preparation failed. Source and previous PDF were kept.' } : review) }
  }
  async function downloadReviewedPackages() {
    if (!packageReview || !packageReviewSource || !latest.current.sourceIsCurrent(packageReviewSource)) return
    try {
      if (pendingPackages?.packages) {
        if (latest.current.browserPreparation?.operationKey !== pendingPackages.operationKey) return
        if (pendingPackages.memoryGB !== undefined) openModal({ kind: 'preparation', operationKey: pendingPackages.operationKey })
        else await latest.current.continueBrowserPreparation()
      } else if (inspectedPackages && latest.current.sourceIsCurrent(inspectedPackages.snapshot, inspectedPackages.epoch)) {
        await latest.current.downloadBrowserPackages(inspectedPackages.snapshot, packageReview, inspectedPackages.epoch)
      }
    } catch (error) { latest.current.notify('action', 'runtime', 'package-preparation', error instanceof Error ? error.message : 'Package preparation stopped. Source and the previous PDF are unchanged.', packageReviewSource) }
  }
  function openModal(value: Modal, path = '') {
    const request = { ...value, requestId: newLatexId(), snapshot: latest.current.project, runtime: latest.current.runtime }
    modalRef.current = request
    setPathDraft(path); setFileText(''); setFontChoices({}); setConsentChecked(false); setCacheClearError(''); setModalError(''); setModal(request)
  }
  function closeModal(requestId?: string) {
    if (requestId && modalRef.current?.requestId !== requestId) return
    modalRef.current = null; setModal(null); setModalError('')
  }
  function beginAction() { const id = newLatexId(); pendingActions.current.add(id); setBusy(true); return id }
  function finishAction(id: string) { pendingActions.current.delete(id); if (alive.current) setBusy(pendingActions.current.size > 0) }
  function compile() {
    if (!project?.mainFile) { workspace.compile(); return }
    if (localRuntime) { workspace.compile(); return }
    if (!capabilityReady || !workspace.online || !active) { workspace.compile(); return }
    if (!consent) openModal({ kind: 'privacy', auto: false })
    else workspace.compile()
  }
  function selectRuntime(next: LatexRuntime) {
    if (workspace.selectRuntime(next)) { setConsent(false); setConsentChecked(false); syncRequest.current?.abort(); setSync(null) }
  }
  function openOriginalAltaCv() {
    if (!project || project.templateId !== 'altacv-browser' || !altaCvEntry) return
    act(() => {
      const copy = createAltaCvOriginalProject(project)
      workspace.setAutoCompile(false); workspace.addProject(copy)
      setSelectedAsset(null); setFilesOpen(true); setMobilePanel('source')
      workspace.notify('success', 'import', 'original-altacv', `Opened original AltaCV source ${copy.mainFile} in an independent project with XeLaTeX. Every file is retained; edits in the simplified main are kept separately, not merged. Nothing was compiled or uploaded.`, copy, undefined, ['build-settings'])
    })
  }
  async function checkAvailability() {
    const requestedRuntime = workspace.runtime, snapshot = project, actionId = newLatexId()
    if (!localRuntime && !workspace.online) {
      workspace.notify('action', 'runtime', 'availability', 'Compiler unavailable offline. Editing, backups and retained PDF downloads remain available.', snapshot, actionId, ['build-settings'])
      return
    }
    const result = await workspace.refreshCapabilities()
    if (!result || latest.current.runtime !== requestedRuntime) return
    const ready = result.enabled && result.ready
    workspace.notify(ready ? 'success' : 'action', 'runtime', 'availability', ready ? requestedRuntime === 'browser' ? 'Local compiler available.' : 'Private LaTeX compilation is available.' : `Compiler unavailable. Editing remains available. ${result.reason}`, snapshot, actionId, ['build-settings'])
  }
  async function downloadSource(snapshot = project, checkpoint = true) {
    if (!snapshot) return
    const actionId = beginAction()
    try {
      const zip = await exportProjectFile(snapshot)
      if (!alive.current) return
      downloadBlob(zip, `${downloadName(snapshot.title)}-source.zip`)
      workspace.notify('success', 'export', 'source-download', `Source ZIP download started for revision ${snapshot.revision}. A download does not acknowledge a local save.`, snapshot, actionId)
      if (checkpoint) await workspace.checkpointNow(`Source ZIP backup r${snapshot.revision}`, snapshot, false)
    } catch (error) { workspace.notify('error', 'export', 'source-download', error instanceof Error ? error.message : 'Source ZIP export failed. The project is unchanged.', snapshot, actionId, ['export-source']) }
    finally { finishAction(actionId) }
  }
  function downloadPdf() {
    if (!proof) return
    downloadBlob(new Blob([proof.data], { type: 'application/pdf' }), `${downloadName(project?.title ?? 'resume')}-r${proof.revision}.pdf`)
    workspace.notify('success', 'export', 'pdf-download', `PDF download started with the exact proof bytes for revision ${proof.revision}${current ? '.' : foreignProof ? '. This is the retained original-project PDF, not a compiled proof of the independent copy.' : '. This PDF does not match the current source snapshot.'}`, workspace.proofSource)
  }
  function downloadMainTex() {
    const main = project?.files.find((item) => item.path === project.mainFile)
    if (!main) return
    downloadBlob(new Blob([main.content], { type: 'application/x-tex;charset=utf-8' }), main.path.split('/').pop()!)
    workspace.notify('success', 'export', 'main-download', 'Main .tex download started with exact UTF-8 source. Use Source ZIP for the complete project.', project)
  }
  async function importFile(file: File, asProject: boolean) {
    const actionId = beginAction(), initiatingProject = project
    setActionProgress(workspaceFeedbackFact({ category: 'import', code: 'reading-import', actionRequestId: actionId, projectId: project?.id ?? null, projectTitle: project?.title, priority: 2, severity: 'info', lifecycle: 'progress', summary: 'Reading and validating the selected import. Current writing is unchanged.' }))
    try {
      if (asProject) {
        const { project: imported, report } = await importProjectFileWithReport(file)
        if (!alive.current) return
        const selected = latest.current.project
        const stillSelected = selected?.id === initiatingProject?.id && selected?.revision === initiatingProject?.revision && sameProjectSource(selected, initiatingProject)
        latest.current.addProject(imported, stillSelected)
        setImportReports((reports) => ({ ...Object.fromEntries(Object.entries(reports).filter(([id]) => latest.current.projects.some((item) => item.id === id))), [imported.id]: report }))
        if (stillSelected) { setSelectedAsset(null); setFilesOpen(true); setMobilePanel('source') }
        workspace.notify('success', 'import', 'project-import', `Imported ${imported.files.length + imported.assets.length} files.${imported.mainFile === null ? ' Choose the main .tex file to compile.' : ` Main: ${imported.mainFile}.`}`, imported, actionId, ['build-settings'])
      }
      else {
        const id = project?.id, revision = project?.revision
        const imported = await importSupportedFile(file), latestProject = latest.current.project
        if (!alive.current) return
        if (!latestProject || latestProject.id !== id || latestProject.revision !== revision || !sameProjectSource(latestProject, project)) throw new Error('The project changed while the file was read. Nothing was added; choose the file again.')
        const next = 'content' in imported ? addTextFile(latestProject, imported.path, imported.content) : addProjectAsset(latestProject, imported)
        latest.current.applyProject(next, undefined, project ?? undefined)
        if ('content' in imported) { setSelectedFiles((previous) => ({ ...previous, [next.id]: next.files[next.files.length - 1].id })); setSelectedAsset(null); setMobilePanel('source') }
        else chooseAsset(imported.id)
        workspace.notify('success', 'import', 'file-import', 'Supported file added. Existing paths and source references were not rewritten.', next, actionId)
        void latest.current.inspectBrowserDependencies()
      }
    } catch (error) { workspace.notify('error', 'import', 'import-stopped', `Import stopped. Your current project is unchanged. ${error instanceof Error ? error.message : 'Nothing was imported.'}`, initiatingProject, actionId, ['view-issues']) }
    finally { finishAction(actionId); if (alive.current) setActionProgress((progress) => progress?.actionRequestId === actionId ? null : progress) }
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const modal = modalRef.current, project = latest.current.project
    if (!modal || !project || pendingModals.current.has(modal.requestId)) return
    if (modal.kind === 'engine-assets') { closeModal(modal.requestId); return }
    const actionId = beginAction()
    pendingModals.current.add(modal.requestId)
    setModalError('')
    try {
      if (modal.kind !== 'engine-cache' && (project.id !== modal.snapshot?.id || project.revision !== modal.snapshot.revision || !sameProjectSource(project, modal.snapshot))) throw new Error('The selected project or source changed. Nothing was applied; reopen this action to review the current revision.')
      if (modal.kind === 'privacy' && modal.runtime !== latest.current.runtime) throw new Error('Runtime changed. No private upload was authorized; review the current runtime first.')
      if (modal.kind === 'new') {
        const next = addTextFile(project, pathDraft, fileText); workspace.applyProject(next); chooseFile(next.files[next.files.length - 1].id)
      } else if (modal.kind === 'rename') workspace.applyProject(renameProjectFile(project, modal.fileId!, pathDraft), `Before renaming ${modal.path}`)
      else if (modal.kind === 'delete') { workspace.applyProject(deleteProjectFile(project, modal.fileId), `Before deleting ${modal.path}`); setSelectedAsset(null) }
      else if (modal.kind === 'restore') workspace.applyProject(restoreCheckpointProject(project, modal.checkpoint), `Before restoring ${modal.checkpoint.label}`)
      else if (modal.kind === 'privacy') { if (workspace.runtime !== 'native') throw new Error('Runtime changed. No private upload was authorized; compile locally or review private consent again.'); if (!consentChecked) return; setConsent(true); if (modal.auto) workspace.setAutoCompile(true); else workspace.compile() }
      else if (modal.kind === 'fonts') {
        if (modal.projectId !== project.id || modal.revision !== project.revision) throw new Error('Source changed while the compatibility dialog was open. Reopen it to review the latest source.')
        const files = project.files.map((item) => ({ ...item, content: applyNativeFontChoices(item.content, fontChoices) }))
        if (files.some((item, index) => item.content !== project.files[index].content)) workspace.applyProject(reviseProject(project, { files }), 'Before explicit source-font compatibility change')
        setCopyFonts({ projectId: project.id, fonts: requiredNativeFonts(files.map((item) => item.content).join('\n')) })
        workspace.notify('success', 'source', 'font-choice', 'Explicit font choices applied only to this LaTeX source copy. Regular writing, styling and exports were not modified.', project, modal.requestId)
      } else if (modal.kind === 'remove') await workspace.removeProject(modal.project.id)
      else if (modal.kind === 'replace') {
        const saved = await workspace.checkpointNow(`Before reviewed replacement r${modal.review.snapshot.revision}`, modal.review.snapshot)
        if (!alive.current || modalRef.current?.requestId !== modal.requestId) return
        if (!saved?.committed) throw new Error('The recovery checkpoint could not be saved on this device. No text was replaced. Export source or resolve local storage before retrying this bulk action.')
        const next = applyReviewedProjectReplace(modal.review.snapshot, modal.review, saved.checkpoint)
        workspace.applyProject(next, undefined, modal.review.snapshot)
        workspace.notify('success', 'source', 'reviewed-replace', `Replaced ${modal.review.matches.length} literal occurrences in ${modal.review.changes.length} files. The previous source checkpoint is saved locally.`, next, modal.requestId, ['view-history'])
      }
      else if (modal.kind === 'preparation') {
        if (workspace.browserPreparation?.operationKey !== modal.operationKey) throw new Error('This compiler preparation request has already changed. Review the latest action before compiling.')
        if (!await workspace.continueBrowserPreparation()) return
      }
      else if (modal.kind === 'engine-cache' && !await workspace.clearEngineCache()) {
        setCacheClearError('Engine cache was not cleared. Storage may be blocked, full or unavailable. Retry explicitly when it is available; project sources, checkpoints and PDF proofs are unchanged.')
        return
      }
      closeModal(modal.requestId)
    } catch (error) {
      if (alive.current && modalRef.current?.requestId === modal.requestId) setModalError(error instanceof Error ? error.message : 'The action failed. Source was kept.')
    }
    finally { pendingModals.current.delete(modal.requestId); finishAction(actionId) }
  }

  function resize(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current !== event.pointerId || !splitElement.current) return
    const bounds = splitElement.current.getBoundingClientRect()
    setSplit(Math.round(Math.max(30, Math.min(70, (event.clientX - bounds.left) / bounds.width * 100))))
  }
  function resizeConsole(event: ReactPointerEvent<HTMLDivElement>) {
    const captured = consoleDrag.current
    if (captured?.pointer === event.pointerId) setDrawerHeight(consoleHeight(captured.height + captured.y - event.clientY, window.innerHeight))
  }
  async function locate(direction: 'forward' | 'inverse', position?: { page: number; x: number; y: number }) {
    if (!canSync || !proof || !project || !file) return
    syncRequest.current?.abort()
    const controller = new AbortController(); syncRequest.current = controller
    const proofIdentity = identity, epoch = workspace.actionEpoch()
    setNavigationChoices(null)
    setSync({ identity: proofIdentity, location: null, message: 'Querying the current PDF/source map.', busy: true })
    try {
      const base = { operationKey: proof.operationKey, snapshotHash: proof.snapshotHash, pdfHash: proof.pdf.sha256 }
      navigation.current ??= createLatexProofNavigation()
      const result = await navigation.current.query(proof, workspace.syncArtifact, direction === 'forward' ? { ...base, direction, file: file.path, line: sourceLine } : { ...base, direction, ...position! }, controller.signal)
      if (controller.signal.aborted || syncRequest.current !== controller || !latest.current.proofIsCurrent(project, proof, epoch)) return
      const candidates = result.candidates.filter((candidate) => diagnosticSourceTarget(latest.current.project, project, candidate)
        && (candidate.column === undefined || Number.isSafeInteger(candidate.column) && candidate.column > 0
          && candidate.column <= (project.files.find((source) => source.path === candidate.file)?.content.split(/\r\n|\r|\n/u)[candidate.line - 1]?.length ?? -1) + 1))
      if (!result.available || !candidates.length || (direction === 'forward' && !candidates.some((candidate) => candidate.locations.length))) {
        setSync({ identity: proofIdentity, location: null, message: result.reason || 'This point has no compiler-recorded source line. No position was guessed.', busy: false }); return
      }
      if (direction === 'inverse' && candidates.length > 1) {
        setNavigationChoices({ snapshot: project, proof, epoch, candidates })
        setSync({ identity: proofIdentity, location: null, message: 'This point maps to more than one source line. Choose a compiler-recorded location.', busy: false }); return
      }
      const candidate = candidates[0]
      if (direction === 'inverse') {
        const target = diagnosticSourceTarget(latest.current.project, project, candidate)
        if (!target) throw new Error('The map does not identify a valid source line in this snapshot. Navigation was refused.')
        jumpTo(target.fileId, target.line, true, candidate.column ? { column: candidate.column } : undefined)
      }
      setSync({ identity: proofIdentity, location: candidate.locations[0] ?? null, message: direction === 'inverse' ? 'Moved to the compiler-recorded source line.' : 'Showing the compiler-recorded PDF location.', busy: false })
      if (direction === 'forward') { setJump({ id: ++jumpSequence.current, fileId: file.id, line: sourceLine, registration: true, registrationOnly: true }); setMobilePanel('proof') }
    } catch (error) {
      if (!controller.signal.aborted && syncRequest.current === controller && latest.current.proofIsCurrent(project, proof, epoch)) setSync({ identity: proofIdentity, location: null, message: error instanceof Error ? error.message : 'Source-map navigation failed. No position was guessed.', busy: false })
    }
  }
  function chooseNavigationLocation(candidate: ProofNavigationResult['candidates'][number]) {
    if (!navigationChoices || !latest.current.proofIsCurrent(navigationChoices.snapshot, navigationChoices.proof, navigationChoices.epoch)) return
    const target = diagnosticSourceTarget(latest.current.project, navigationChoices.snapshot, candidate)
    if (!target) return
    jumpTo(target.fileId, target.line, true, candidate.column ? { column: candidate.column } : undefined)
    setNavigationChoices(null)
    setSync({ identity: proofActionIdentity(navigationChoices.proof), location: candidate.locations[0] ?? null, message: 'Moved to the compiler-recorded source line.', busy: false })
  }
  function toggleDrawer(view: Exclude<Drawer, 'closed'>) {
    if (drawerOpen && drawerView === view) closeDrawer()
    else showDrawer(view)
  }
  function closeDrawer() {
    const returnFocus = drawerContent.current?.contains(document.activeElement)
    setDrawer('closed'); if (small) setMobilePanel('source')
    if (returnFocus) {
      if (consoleReturnFocus.current?.isConnected) consoleReturnFocus.current.focus({ preventScroll: true })
      else root.current?.querySelector<HTMLButtonElement>('#resume-latex-console-toggle')?.focus({ preventScroll: true })
    }
  }
  const refs = modal && (modal.kind === 'delete' || modal.kind === 'rename') && project && modal.path ? referencesToFile(project, modal.path) : []
  const modalTitle = !modal ? '' : modal.kind === 'new' ? 'Create a source file' : modal.kind === 'rename' ? 'Rename without rewriting source' : modal.kind === 'delete' ? 'Delete this file' : modal.kind === 'restore' ? 'Restore a checkpoint' : modal.kind === 'privacy' ? (modal.auto ? 'Enable private Auto Compile' : 'Compile with the private runtime') : modal.kind === 'fonts' ? 'Source-font compatibility' : modal.kind === 'engine-cache' ? 'Clear downloaded engine assets' : modal.kind === 'engine-assets' ? 'Engine files' : modal.kind === 'preparation' ? 'Review local compiler preparation' : modal.kind === 'replace' ? 'Review project replacement' : 'Remove a local project'
  const feedbackFacts = [...workspace.feedbackFacts]
  if (project?.templateId === 'altacv-browser') feedbackFacts.push(workspaceFeedbackFact({ category: 'compatibility', code: 'simplified-altacv', projectId: project.id,
    projectTitle: project.title, priority: 1, severity: 'warning', lifecycle: 'attention', createdAt: 0, summary: 'This copy uses a different layout from the original.', actionIds: altaCvEntry ? ['original-altacv'] : ['build-settings'] }))
  if (copiedFontsUnverified && project) feedbackFacts.push(workspaceFeedbackFact({ category: 'compatibility', code: 'source-fonts', projectId: project.id, projectTitle: project.title,
    revision: project.revision, sourceIdentity: `r${project.revision}`, priority: 1, severity: 'warning', lifecycle: 'attention', createdAt: 0,
    summary: capabilityReady ? 'Some requested source-copy fonts are absent from this profile.' : 'Source-copy font availability has not been checked.', actionIds: ['review-fonts'] }))
  const incompatible = localCompatibility.find((item) => item.severity === 'error')
  if (project && incompatible) feedbackFacts.push(workspaceFeedbackFact({ category: 'compatibility', code: incompatible.code ?? 'engine-source', projectId: project.id,
    projectTitle: project.title, revision: project.revision, sourceIdentity: `r${project.revision}`, priority: 1, severity: 'warning', lifecycle: 'attention', createdAt: 0,
    summary: incompatible.message, actionIds: ['build-settings'] }))
  const attention = selectAttention(workspace.feedback, feedbackFacts, project?.id ?? null)
  const workspaceIssues = attention.issues.filter((fact) => !(fact.category === 'build' && fact.operationKey === currentAttempt?.operationKey && diagnostics.length > 0))
  const problemCount = editorIssues.length + workspaceIssues.length
  const receipt = selectReceipt(workspace.feedback, project?.id ?? null)
  const progress = actionProgress ?? feedbackFacts.find((fact) => fact.lifecycle === 'progress') ?? null
  const actionLabels = { 'export-source': 'Export source backup', 'save-copy': 'Save as new project', 'reload-source': 'Reload with recovery copy', 'view-protected': 'View preserved records',
    'retry-cleanup': 'Retry marker cleanup', 'download-pdf': 'Download PDF', 'review-download': 'Review download', 'review-dependencies': 'Review package downloads', 'first-error': 'First error', 'choose-main': 'Choose main',
    'build-settings': 'Build settings', 'view-pdf': 'View PDF', 'view-history': 'View history', 'view-issues': 'Problems', 'original-altacv': 'Open original with XeLaTeX', 'review-fonts': 'Review font choices', recover: 'Recover operation', cancel: 'Cancel operation' }
  function showDrawer(view: Exclude<Drawer, 'closed'>) {
    if (!drawerOpen) consoleReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDrawer(view); if (small) setMobilePanel('problems')
  }
  function feedbackAction(action: string, fact: FeedbackFact) {
    if (action === 'review-dependencies') { showDrawer('problems'); return }
    const target = workspace.projects.find((item) => item.id === fact.projectId) ?? null
    if (action === 'export-source' && target) { void downloadSource(target); return }
    if (action === 'save-copy' && target) { act(() => workspace.addProject(cloneAsNewProject(target))); return }
    if (target && target.id !== project?.id) workspace.selectProject(target.id)
    if (action === 'recover') { void workspace.recoverCompile(); return }
    if (action === 'cancel') { void workspace.cancelCompile(); return }
    if (action === 'reload-source') { void workspace.reloadStoredProject().catch((error: unknown) => workspace.notify('error', 'storage', 'reload-source', error instanceof Error ? error.message : 'Stored source could not load.', target)); return }
    if (action === 'retry-cleanup') { const issue = workspace.retentionIssues.find((item) => item.operationKey === fact.operationKey && item.kind === 'recovery'); if (issue) void workspace.retryRecoveryCleanup(issue); return }
    if (action === 'review-download' && workspace.browserPreparation && workspace.browserPreparation.operationKey === fact.operationKey) {
      if (workspace.browserPreparation.packages && workspace.browserPreparation.memoryGB === undefined) showDrawer('problems')
      else openModal({ kind: 'preparation', operationKey: fact.operationKey! })
      return
    }
    if (action === 'view-pdf' || action === 'download-pdf') {
      if (fact.operationKey && proof?.operationKey !== fact.operationKey) { showDrawer('build'); return }
      if (action === 'download-pdf') downloadPdf(); else setMobilePanel('proof')
      return
    }
    if (action === 'original-altacv') { openOriginalAltaCv(); return }
    if (action === 'review-fonts' && project) { openModal({ kind: 'fonts', projectId: project.id, revision: project.revision, fonts: copyFonts?.fonts ?? [] }); return }
    if (action === 'view-history') { showDrawer('history'); return }
    if (action === 'first-error') {
      showDrawer('problems')
      const issue = diagnostics.find((item) => item.severity === 'error' && diagnosticSourceTarget(project, diagnosticSnapshot, item))
      if (issue && (!fact.operationKey || fact.operationKey === currentAttempt?.operationKey)) jumpToDiagnostic(issue)
      return
    }
    if (action === 'view-issues') { showDrawer('problems'); return }
    if (action === 'view-protected') { setFilesOpen(true); setMobilePanel('files'); return }
    showDrawer('build')
  }

  return <div ref={root} className={`${theme.theme} ${styles.root}`} data-mobile-panel={mobilePanel} data-files-collapsed={!filesOpen} data-compiler-runtime={workspace.runtime} aria-busy={!workspace.ready} style={fontSize ? { '--latex-code-size': `${fontSize}px` } as CSSProperties : undefined} onClick={(event) => {
    if ((event.target as Element).closest('button[data-close-menu]')) closeMenus(true)
  }} onKeyDown={(event) => {
    if (!active || event.defaultPrevented || modal) return
    if (event.key === 'Escape' && root.current?.querySelector('details[data-latex-menu][open]')) { event.preventDefault(); closeMenus(true); return }
    if (event.key === 'Escape' && drawerOpen && drawerContent.current?.contains(event.target as Node)) { event.preventDefault(); closeDrawer(); return }
    if ((event.ctrlKey || event.metaKey) && event.code === 'Backquote') { event.preventDefault(); if (drawerOpen) closeDrawer(); else showDrawer('output'); return }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compile() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void workspace.flushSave() }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setFilesOpen(true); setMobilePanel('files'); setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()) }
  }}>
    <header className={styles.identity}>
      <h1 className={styles.srOnly}>Resume typesetting editor</h1>
      <button type="button" className={`${styles.iconButton} ${styles.filesToggle}`} aria-label={filesToggleLabel} aria-expanded={small ? mobilePanel === 'files' : filesOpen} aria-controls="resume-latex-file-rail" title={filesToggleLabel} onClick={() => small ? setMobilePanel(mobilePanel === 'files' ? 'source' : 'files') : setFilesOpen((open) => !open)}><LatexIcon name="files" /></button>
      <div className={styles.brand} role="img" aria-label="Mr Resume logo"><span className={styles.brandMark} aria-hidden="true" /></div>
      <span className={styles.breadcrumbSeparator} aria-hidden="true">/</span>
      <div className={styles.projectIdentity}>
        <div className={styles.projectTitle}>
          <label className={styles.srOnly} htmlFor="resume-latex-title">LaTeX project title</label>
          <input id="resume-latex-title" aria-label="LaTeX project title" title="Rename this project" value={project?.title ?? ''} placeholder="Restoring project..." disabled={!project} maxLength={200} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { title: event.target.value }))) }} />
          <details className={styles.projectMenu} data-latex-menu>
            <summary aria-label="Projects and source templates" title="Projects and source templates"><LatexIcon name="chevronDown" /></summary>
            <div className={styles.projectMenuOptions}>
              <span className={styles.menuHeading}>Projects <small>{workspace.projects.length} / {LOCAL_LATEX_LIMITS.projects}</small></span>
              <label className={styles.menuField}>Current project<select aria-label="Select LaTeX project" value={project?.id ?? ''} disabled={!workspace.ready} onChange={(event) => { workspace.selectProject(event.target.value); setSelectedAsset(null); closeMenus(true) }}>{workspace.projects.map((item) => <option key={item.id} value={item.id}>{item.title || 'Untitled project'}</option>)}</select></label>
              <span className={styles.menuHeading}>New from source</span>
              {latexSourceTemplates.map((item) => <button key={item.id} type="button" data-close-menu disabled={!workspace.ready || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} title={item.detail} onClick={() => act(() => workspace.addProject(createTemplateProject(item.id)))}><LatexIcon name="plus" /><span>{item.name}<small>v{item.version} / {engineNames[item.engine]}</small></span></button>)}
              <span className={styles.menuRule} />
              <button type="button" data-close-menu disabled={busy || !workspace.ready} onClick={() => importInput.current?.click()}><LatexIcon name="upload" /><span>Import .tex / source ZIP</span></button>
              <button type="button" data-close-menu disabled={!project || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} onClick={() => act(workspace.saveAsNewProject)}><LatexIcon name="copy" /><span>Duplicate current project</span></button>
              {onCopyRegular && <button type="button" data-close-menu onClick={onCopyRegular}><LatexIcon name="file" /><span>Copy Regular source</span></button>}
              <button type="button" data-close-menu disabled={!project} onClick={() => { if (project) openModal({ kind: 'remove', project }) }}><LatexIcon name="trash" /><span>Remove current project...</span></button>
              <p>New projects and imports never replace your existing writing.</p>
            </div>
          </details>
        </div>
        <span className={styles.saveState} data-state={workspace.saveState?.kind ?? 'restoring'} title={workspace.saveState?.kind === 'saved' ? `Revision ${workspace.saveState.revision} committed on this device. No cloud draft sync.` : workspace.saveState?.reason}>{saveLabel}</span>
        <div className={styles.buildIdentity}>
          <button type="button" disabled={!project} onClick={() => showDrawer('build')} aria-label={`Build settings. Main: ${project?.mainFile ?? 'Not selected'}. Engine: ${project ? engineNames[project.engine] : 'Restoring'}.${!localRuntime ? ' Private native mode uploads source with consent.' : ''}`} title={`Main: ${project?.mainFile ?? 'Not selected'} / ${project ? engineNames[project.engine] : 'Restoring'}. Open build settings.`}>
            <span className={styles.buildLabel}>Main:</span>
            <b className={styles.mainFile} title={project?.mainFile ?? undefined}>{project?.mainFile ?? 'Not selected'}</b>
            <span className={styles.buildSeparator} aria-hidden="true">/</span>
            <span className={styles.engineName}>{project ? engineNames[project.engine] : 'Restoring'}</span>
          </button>
          {!localRuntime && <span className={styles.runtimeMode}>Native / uploads source</span>}
        </div>
      </div>
      <div className={styles.primaryActions}>
        <details className={styles.infoMenu} data-latex-menu>
          <summary aria-label="Information and session notices" title="Information and session notices"><LatexIcon name="info" />{infoMessages.length > 0 && <span className={styles.infoCount}>{infoMessages.length}</span>}</summary>
          <div className={styles.infoPopover}>
            <h2>Workspace information</h2>
            {infoMessages.length ? infoMessages.map((item) => <section className={styles.infoItem} key={item.id}><h3>{item.title}</h3><p>{item.message}</p>{item.id === 'session-storage' && <button type="button" className={styles.textButton} data-close-menu disabled={busy} onClick={() => void downloadSource()}>Export latest source ZIP</button>}</section>) : <p className={styles.infoEmpty}>No active workspace notices.</p>}
          </div>
        </details>
        <div className={styles.outputGroup} role="group" aria-label="Output">
          <button type="button" className={`${styles.button} ${styles.downloadAction}`} aria-label="Download PDF" title={`Download PDF${proof && !current ? ` r${proof.revision}` : ''}`} disabled={!proof} onClick={downloadPdf}><LatexIcon name="download" /></button>
          <details className={styles.exportMenu} data-latex-menu>
            <summary aria-label="Export and workspace actions"><span>Export</span><LatexIcon name="chevronDown" /></summary>
            <div className={styles.exportOptions}>
            <span className={styles.menuHeading}>Download</span>
            <button type="button" data-close-menu disabled={!proof} onClick={downloadPdf}><LatexIcon name="download" /><span>PDF proof{proof && !current ? ` r${proof.revision}` : ''}<small>{proof ? current ? 'Exact current PDF bytes' : 'Retained proof, not current source' : 'Compile a proof first'}</small></span></button>
            <button type="button" data-close-menu disabled={!project?.mainFile} onClick={downloadMainTex}><LatexIcon name="file" /><span>Main source (.tex)</span></button>
            <button type="button" data-close-menu disabled={!project || busy} onClick={() => void downloadSource()}><LatexIcon name="layers" /><span>Complete source ZIP<small>Sources, images and build manifest</small></span></button>
            <button type="button" data-close-menu disabled={!buildLog} onClick={() => downloadBlob(new Blob([buildLog], { type: 'text/plain;charset=utf-8' }), `${downloadName(project?.title ?? 'resume')}-r${diagnosticRevision ?? 1}.log`)}><LatexIcon name="terminal" /><span>Build log (.log)</span></button>
            <span className={styles.menuRule} />
            <button type="button" data-close-menu disabled={workspace.capabilitiesLoading || workspace.engineCacheBusy} onClick={() => void checkAvailability()}><LatexIcon name="shield" /><span>Check availability</span></button>
            <button type="button" data-close-menu disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="history" /><span>Create checkpoint</span></button>
            </div>
          </details>
        </div>
        <button type="button" className={styles.primaryButton} disabled={compileDisabled} title={compileReason || 'Compile this source snapshot (Ctrl/Cmd Enter)'} onClick={compile}>{compiling ? <span className={styles.spinner} aria-hidden="true" /> : <LatexIcon name="play" />}<span>{compiling ? 'Queue latest' : 'Compile'}</span><kbd>Ctrl Enter</kbd></button>
      </div>
    </header>
    <input ref={importInput} hidden type="file" tabIndex={-1} accept=".tex,.zip" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, true) }} />
    <div className={styles.attentionAnchor}>
      <LatexAttentionBar selection={attention} projectId={project?.id ?? null} active={active} floating actionLabels={actionLabels} onAction={feedbackAction} onDismiss={workspace.dismissFeedback} onViewIssues={() => showDrawer('problems')} />
    </div>
    <LatexAnnouncements attention={attention.primary} progress={progress} receipt={receipt} active={active} projectId={project?.id ?? null} modalOpen={Boolean(modal)} />
    <div className={styles.workspace}>
      <aside id="resume-latex-file-rail" className={styles.rail} aria-label="LaTeX project files and source outline">
        <input ref={assetInput} hidden type="file" tabIndex={-1} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, false) }} />
        <section className={styles.filesWorkspace} aria-label="Project files">
          <div className={styles.railTop}>
            <div className={styles.railHeading}><h2>Project files</h2><span title={`${fileCount} of ${LATEX_LIMITS.files} files`}>{fileCount} / {LATEX_LIMITS.files}</span></div>
            <div className={styles.railActions}>
              <button type="button" className={`${styles.button} ${styles.newFileButton}`} aria-label="New file" title="New file" disabled={!project || fileCount >= LATEX_LIMITS.files} onClick={() => openModal({ kind: 'new' }, 'section.tex')}><LatexIcon name="plus" /></button>
              <button type="button" className={styles.button} aria-label="Add file or image" title="Add file / image" disabled={busy || !project || fileCount >= LATEX_LIMITS.files} onClick={() => assetInput.current?.click()}><LatexIcon name="upload" /><span>Add</span></button>
            </div>
          </div>
          <div className={styles.fileEntries}>
            <ul className={styles.fileList}>{project?.files.map((item) => <li className={styles.fileRow} key={item.id}>
             <button type="button" className={styles.fileButton} aria-current={item.id === file?.id && !asset ? 'true' : undefined} title={item.path} onClick={() => chooseFile(item.id)}><LatexIcon name="file" /><code>{item.path}</code><span className={styles.fileTag} data-main={item.path === project.mainFile}>{item.path === project.mainFile ? 'Main' : item.path.split('.').pop()}</span><small>{sizeLabel(utf8Bytes(item.content))}</small></button>
            {active && <FileActionMenu path={item.path}>
              {item.path !== project.mainFile && /\.tex$/iu.test(item.path) && <button type="button" onClick={() => { act(() => workspace.applyProject(reviseProject(project, { mainFile: item.path }))); chooseFile(item.id) }}><LatexIcon name="check" /><span>Set as main</span></button>}
              <button type="button" onClick={() => openModal({ kind: 'rename', fileId: item.id, path: item.path }, item.path)}><LatexIcon name="rename" /><span>Rename</span></button>
              <button type="button" data-destructive disabled={item.path === project.mainFile} title={item.path === project.mainFile ? 'Choose another main file before deleting this one.' : 'Delete with a recovery checkpoint'} onClick={() => openModal({ kind: 'delete', fileId: item.id, path: item.path })}><LatexIcon name="trash" /><span>Delete</span></button>
            </FileActionMenu>}
          </li>)}</ul>
          {Boolean(project?.assets.length) && <><h3 className={styles.railLabel}>Local image assets</h3><ul className={styles.fileList}>{project?.assets.map((item) => <li className={styles.fileRow} key={item.id}>
             <button type="button" className={styles.fileButton} aria-current={asset?.id === item.id ? 'true' : undefined} title={item.path} onClick={() => chooseAsset(item.id)}><LatexIcon name="image" /><code>{item.path}</code><small>{sizeLabel(item.blob.size)}</small></button>
            {active && <FileActionMenu path={item.path}>
              <button type="button" onClick={() => openModal({ kind: 'rename', fileId: item.id, path: item.path }, item.path)}><LatexIcon name="rename" /><span>Rename</span></button>
              <button type="button" data-destructive onClick={() => openModal({ kind: 'delete', fileId: item.id, path: item.path })}><LatexIcon name="trash" /><span>Delete</span></button>
            </FileActionMenu>}
          </li>)}</ul></>}
          </div>
        </section>
        <div className={styles.railScroll}>
          <section className={styles.railTools} aria-label="Tools">
            <p className={styles.railToolsLabel}>Tools</p>
            <details className={styles.railSection} open={searchOpen} onToggle={(event) => setSearchOpen(event.currentTarget.open)}><summary><span>Find in project</span><small>Ctrl Shift F</small></summary>
              <div className={styles.projectSearch}><label>Literal text<input ref={searchInput} value={searchQuery} maxLength={256} onChange={(event) => setSearchQuery(event.target.value)} spellCheck={false} placeholder="Search source files" /></label>
                <p className={styles.helper}>{deferredQuery !== searchQuery ? 'Updating results...' : projectSearch?.reason ?? (searchQuery ? `${projectSearch?.matches.length ?? 0}${projectSearch?.truncated ? '+' : ''} matches in r${project?.revision}. Case-sensitive; first 200 shown.` : 'Case-sensitive, local source only. Comments and bibliography text are included.')}</p>
                {Boolean(projectSearch?.matches.length) && <ol className={styles.searchResults}>{projectSearch!.matches.map((match) => <li key={`${match.fileId}:${match.from}`}><button type="button" onClick={() => {
                  const selected = latest.current.project
                  if (projectSearch && selected && projectSearch.projectId === selected.id && projectSearch.revision === selected.revision && sameProjectSource(project, selected)) jumpTo(match.fileId, match.line, false, match)
                }}><b>{match.file}:{match.line}:{match.column}</b><code>{match.preview}</code></button></li>)}</ol>}
                <details><summary>Replace with review</summary><label>Replacement<textarea value={replacement} onChange={(event) => setReplacement(event.target.value)} rows={2} spellCheck={false} /></label><button type="button" className={styles.button} disabled={!project || !searchQuery || searchQuery === replacement || !projectSearch?.matches.length || deferredQuery !== searchQuery} onClick={() => { if (project) act(() => openModal({ kind: 'replace', review: reviewProjectReplace(project, searchQuery, replacement) })) }}>Review replacements</button><p className={styles.helper}>Requires an unchanged reviewed snapshot and a locally saved checkpoint. No automatic macro or reference rewriting.</p></details>
              </div>
            </details>
            <details className={styles.railSection} onToggle={(event) => setOutlineOpen(event.currentTarget.open)}><summary><span>Source outline</span>{outlineOpen && <small>{outline.length} {outline.length === 1 ? 'section' : 'sections'}</small>}</summary><p className={styles.helper}>Section commands only. Custom macros may not appear.</p><ol className={styles.outline}>{outline.map((item) => <li key={`${item.fileId}:${item.line}`} data-level={item.level}><button type="button" onClick={() => jumpTo(item.fileId, item.line)}><span>{item.title}</span><small>{item.file}:{item.line}</small></button></li>)}</ol>{!outline.length && <p className={styles.helper}>Add a section command to navigate your source here.</p>}</details>
            <details className={styles.railSection}><summary><span>Start from source</span></summary><p className={styles.helper}>Each template creates a separate project. Build details report the selected profile and available bibliography backends; cached engine assets do not imply full offline application support.</p><div className={styles.templateShelf}>{latexSourceTemplates.map((item) => {
              const qualification = latexTemplateQualifications.find((entry) => entry.id === item.id)
              return <button type="button" key={item.id} disabled={!workspace.ready || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} onClick={() => act(() => workspace.addProject(createTemplateProject(item.id)))}><b>{item.name}</b><span>{item.detail}</span><small>v{item.version} / {engineNames[item.engine]}</small>{qualification && <><span>{qualification.checks}</span><small>Fixture: {qualification.fixture} / {qualification.profileVersion}</small><span>{qualification.limitation}</span></>}</button>
            })}</div></details>
            <details className={styles.railSection}><summary><span>Projects and backups</span></summary><div className={styles.backupActions}><button type="button" className={styles.button} disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="plus" />Create checkpoint</button><button type="button" className={styles.textButton} onClick={() => toggleDrawer('history')}>View history</button>{onCopyRegular && <button type="button" className={styles.textButton} onClick={onCopyRegular}>Copy Regular source</button>}<button type="button" className={styles.button} disabled={busy || !workspace.ready} onClick={() => importInput.current?.click()}><LatexIcon name="upload" />Import .tex / source ZIP</button><p className={styles.helper}>Imports always create a new project. Unsupported archive entries are refused, never silently discarded. UTF-8 source is kept exactly.</p><button type="button" className={styles.textButton} disabled={!project || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} onClick={() => act(workspace.saveAsNewProject)}>Duplicate current project</button>{project && <button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'remove', project })}>Remove current project...</button>}</div></details>
          </section>
          {Boolean(workspace.protectedRecords.length) && <details className={styles.railSection}><summary>Preserved stored originals</summary><ul className={styles.protectedList}>{workspace.protectedRecords.map((record, index) => <li key={index}>{record}</li>)}</ul></details>}
        </div>
        <div ref={localPanel} className={styles.localWorkspace} data-expanded={localExpanded}>
          <h3 className={styles.localHeading}><button type="button" className={styles.localToggle} aria-expanded={localExpanded} aria-controls="resume-latex-local-details" aria-label={localExpanded ? 'Collapse local workspace' : 'Expand local workspace'} title="Local workspace" onClick={toggleLocalWorkspace}><LatexIcon name="lock" /><span id="resume-latex-local-label">Local workspace</span></button></h3>
          <div ref={localBody} id="resume-latex-local-details" className={styles.localWorkspaceBody} hidden={!localExpanded} role="region" aria-labelledby="resume-latex-local-label" tabIndex={0}>
            <div className={styles.sourceBudget}><span>Project source</span><span>{sizeLabel(contentSize.source)} / 1 MiB</span></div>
            <meter className={styles.sourceMeter} min={0} max={LATEX_LIMITS.sourceBytes} value={contentSize.source} aria-label="Current project source byte budget" />
            <dl className={styles.localLimits}><div><dt>Projects</dt><dd>{workspace.projects.length}<span> / {LOCAL_LATEX_LIMITS.projects}</span></dd></div><div><dt>Checkpoints</dt><dd>{projectCheckpoints.length}<span> / {LOCAL_LATEX_LIMITS.checkpointsPerProject}</span></dd></div><div><dt>Files</dt><dd>{fileCount}<span> / {LATEX_LIMITS.files}</span></dd></div></dl>
            <p className={styles.railFoot}>Drafts stay on this device. No cloud draft sync.<br />32 MiB local storage budget, including checkpoints and proofs.{contentSize.assets > 0 && ` This project's images: ${sizeLabel(contentSize.assets)}.`}</p>
            <section className={styles.engineCache} aria-label="Engine asset cache">
              <div className={styles.sourceBudget}><span>Engine cache only</span><span>{workspace.engineCache?.available ? `${sizeLabel(workspace.engineCache.bytes)} / 256 MiB` : workspace.engineCache ? 'Not available' : 'Checking...'}</span></div>
              <p className={styles.helper}>{workspace.engineCache?.available ? `${workspace.engineCache.entries} assets / ${workspace.engineCache.versions.length} stored bundle profile version${workspace.engineCache.versions.length === 1 ? '' : 's'}. The newest two version working sets are retained when they fit the bounded cache. Stored entries alone do not prove an offline profile is complete.` : workspace.engineCache?.reason || 'Checking isolated engine storage; project data is separate.'}</p>
              {Boolean(workspace.engineCache?.versions.length) && <ul aria-label="Stored bundle profile versions" tabIndex={0}>{workspace.engineCache!.versions.map((version) => <li key={version}>{version}</li>)}</ul>}
              {Boolean(workspace.engineCache?.incompleteVersions?.length) && <p className={styles.helper} role="status">Assets were removed or evicted from {workspace.engineCache!.incompleteVersions!.join(', ')}. Required pins must be loaded and verified again; a retained label is not an offline-ready compiler.</p>}
              <div className={styles.preparationActions}>
                <button type="button" className={styles.textButton} disabled={workspace.engineCacheBusy} onClick={() => void workspace.refreshEngineCache()}>Refresh cache usage</button>
                <button type="button" className={styles.textButton} disabled={workspace.engineCacheBusy || compiling || !workspace.engineCache} onClick={() => openModal({ kind: 'engine-cache' })}>Clear engine cache...</button>
              </div>
            </section>
          </div>
        </div>
      </aside>
      <div ref={splitElement} className={styles.split} style={{ '--latex-source-width': `${split}%` } as CSSProperties}>
        <section id="resume-latex-source-pane" className={styles.sourcePane} data-header-collapsed={sourceHeaderCollapsed} aria-label="Project file editor">
          <button type="button" className={styles.sourceHeaderToggle} aria-expanded={!sourceHeaderCollapsed} aria-controls="resume-latex-file-tabs resume-latex-editor-tools" aria-label={sourceHeaderCollapsed ? 'Expand source tabs and toolbar' : 'Collapse source tabs and toolbar'} title={sourceHeaderCollapsed ? 'Expand source tabs and toolbar' : 'Collapse source tabs and toolbar'} onClick={(event) => {
            if (!sourceHeaderCollapsed) event.currentTarget.parentElement?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => { menu.open = false })
            setSourceHeaderCollapsed((collapsed) => !collapsed)
          }}><LatexIcon name="chevronUp" /></button>
          <div id="resume-latex-file-tabs" className={styles.fileTabs} role="tablist" aria-label="Project files">{projectEntries.map((item, index) => <button ref={(node) => { sourceTabs.current[index] = node }} type="button" role="tab" id={`resume-latex-file-${item.id}`} aria-selected={selectedEntry?.id === item.id} aria-controls="resume-latex-editor-panel" tabIndex={selectedEntry?.id === item.id ? 0 : -1} key={item.id} title={item.path} onClick={() => 'blob' in item ? chooseAsset(item.id) : chooseFile(item.id)} onKeyDown={(event) => {
            const count = projectEntries.length
            const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
            if (next !== null) { event.preventDefault(); sourceTabs.current[next]?.focus() }
          }}><LatexIcon name={'blob' in item ? 'image' : 'file'} /><code>{item.path}</code>{item.path === project?.mainFile && <small>Main</small>}</button>)}</div>
          <div className={styles.editorPanel} id="resume-latex-editor-panel" role="tabpanel" aria-labelledby={selectedEntry ? `resume-latex-file-${selectedEntry.id}` : undefined}>
            {asset && <ProjectImagePreview asset={asset} onSource={() => { if (file) chooseFile(file.id) }} />}
            {/* Keep CodeMirror mounted so image inspection preserves every file's undo history. */}
            <div className={styles.sourceDocument} hidden={Boolean(asset)}>
            {projectTextOnly && <p className={styles.projectTextNotice}>{file?.path.split('/').pop()?.toLowerCase() === 'latexmkrc' ? 'Project configuration is editable and included in source ZIP exports. It is never executed; the private compiler uses your selected engine and fixed safe settings.' : 'Project documentation is saved and exported exactly. It is not passed to TeX.'}</p>}
            {project && file ? <CodeMirrorSource project={project} projectId={project.id} file={file} active={active && !asset && (!small || mobilePanel === 'source')} wrap={wrap} tabSize={tabSize} revision={project.revision} toolbarActions={<div className={styles.sourcePaneActions}>
              <button type="button" className={styles.sourceLineChip} aria-label={`Show line ${sourceLine} in proof`} disabled={projectTextOnly || !canSync || Boolean(sync?.busy && sync.identity === identity)} title={projectTextOnly ? 'Documentation and configuration are not typeset.' : !canSync ? 'Compile a current proof with an available source map to navigate.' : `Locate line ${sourceLine} using the current SyncTeX map`} onClick={() => void locate('forward')}><LatexIcon name="target" /><span>Line {sourceLine}</span></button>
              <details className={styles.sourceSettings} data-latex-menu>
                <summary aria-label="Editor settings" title="Editor settings"><LatexIcon name="settings" /><span className={styles.srOnly}>Settings</span></summary>
                <div className={styles.sourceSettingsMenu}>
                  <span className={styles.menuHeading}>Source editor</span>
                  <label>Font size<select aria-label="Source font size" value={fontSize ?? 'auto'} onChange={(event) => setFontSize(event.target.value === 'auto' ? null : Number(event.target.value))}><option value="auto">Auto ({small ? 16 : 14} px)</option>{[12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size} px</option>)}</select></label>
                  <label>Tab size<select aria-label="Source tab size" value={tabSize} onChange={(event) => setTabSize(Number(event.target.value) as 2 | 4)}><option value={2}>2 spaces</option><option value={4}>4 spaces</option></select></label>
                  <label className={styles.checkControl}><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />Wrap source lines</label>
                  <span className={styles.menuHeading}>Compilation</span>
                  <label>Runtime<select aria-label="LaTeX compiler runtime" value={workspace.runtime} disabled={compiling || workspace.attempt?.stage === 'recoverable' || workspace.capabilitiesLoading} onChange={(event) => selectRuntime(event.target.value as LatexRuntime)}><option value="browser">Local browser (no upload)</option><option value="native">Private native (uploads source)</option></select></label>
                  <label>Engine <select value={project?.engine ?? 'lualatex'} disabled={!project || !capabilityReady} onChange={(event) => { const selected = workspace.capabilities.profiles.find((profile) => profile.id === event.target.value); if (project && selected) act(() => workspace.applyProject(reviseProject(project, { engine: selected.id }))) }}>
                    {project && !workspace.capabilities.profiles.some((profile) => profile.id === project.engine) && <option value={project.engine}>{engineNames[project.engine]} (not ready)</option>}
                    {workspace.capabilities.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
                   <label className={styles.checkControl}><input type="checkbox" checked={workspace.autoCompile} disabled={!workspace.autoCompile && (!project?.mainFile || !capabilityReady || !engineReady || localCompatibility.some((issue) => issue.severity === 'error'))} onChange={(event) => event.target.checked ? (localRuntime || consent ? workspace.setAutoCompile(true) : openModal({ kind: 'privacy', auto: true })) : workspace.setAutoCompile(false)} />Auto Compile</label>
                   <p className={styles.helper}>{localRuntime ? 'Compile and opt-in Auto Compile run on this device. Engine bytes are verified and cached separately. Optional fixed package groups require consent. External commands and arbitrary remote package resolution are disabled.' : 'Private Auto Compile is opt-in with upload consent. Manual compilation never uploads while you type.'}</p>
                  {localCompatibility.some((issue) => issue.severity === 'error') && <p className={styles.helper} role="note">{localCompatibility.find((issue) => issue.severity === 'error')!.message} Compile reports the source issue in Problems without rewriting your project.</p>}
                </div>
              </details>
            </div>} jump={jump} registrationActive={Boolean(canSync && sync?.identity === identity && !sync.busy && sync.location)} diagnostics={diagnosticsCurrent ? diagnostics : emptyDiagnostics} diagnosticSnapshot={diagnosticSnapshot} diagnosticRuntime={diagnosticRuntime} runtime={workspace.runtime} onLocalDiagnostics={setLocalDiagnostics} sourceIsCurrent={(snapshot) => (!pendingFix.current || pendingFix.current.viewEpoch === fileEpoch.current) && workspace.sourceIsCurrent(snapshot, pendingFix.current?.epoch ?? workspace.actionEpoch())} fixRequest={fixRequest} onFixResult={completeIssueFix} validateChange={workspace.validateTextChange} onChange={workspace.changeText} onCursor={(_id, line) => setSourceLine(line)} onCompile={compile} onNotice={(message) => workspace.notify('action', 'source', 'editor-action', message, project, `editor:${project.id}:${project.revision}:${message}`)} /> : <p className={styles.loading}>Restoring local source before any write-back.</p>}
            </div>
          </div>
        </section>
        <div className={styles.separator} role="separator" aria-orientation="vertical" aria-label="Resize source and proof panes" aria-valuemin={30} aria-valuemax={70} aria-valuenow={split} aria-valuetext={`${split}% source width`} aria-controls="resume-latex-source-pane resume-latex-proof-pane" tabIndex={0} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setSplit(event.key === 'Home' ? 30 : event.key === 'End' ? 70 : Math.max(30, Math.min(70, split + (event.key === 'ArrowRight' ? 2 : -2)))) }
        }} onPointerDown={(event) => { if (event.button === 0) { drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); resize(event) } }} onPointerMove={resize} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = null }}><span /></div>
        <section id="resume-latex-proof-pane" className={styles.proofPane} aria-label="Exact compiled PDF proof">
          {proof && !current && <p className={styles.staleNotice}>{foreignProof ? 'This is the original-project PDF retained with the independent recovery copy for this session.' : sameRevisionMismatch ? `Another tab supplied different source at r${project?.revision}. This PDF belongs to the captured compile snapshot, not that source.` : `Source is r${project?.revision}; this last good PDF was compiled from r${proof.revision}.`} Its source maps are disabled.</p>}
          <LatexPdfPreview proof={proof} current={current} editing={project ? { projectId: project.id, revision: project.revision } : undefined} proofSource={workspace.proofSource} currentAttempt={workspace.proofAttempt} detailsOpen={detailsOpen} onDetailsOpenChange={setDetailsOpen} navigationReason={navigationReason} active={active && (!small || mobilePanel === 'proof')} location={canSync && sync?.identity === identity ? sync.location : null} onPosition={canSync ? (position) => void locate('inverse', position) : undefined} onCompile={compile} compileDisabled={compileDisabled || compiling} compileReason={compileReason} />
          {current && sync?.identity === identity && <div className={styles.syncStatus} role="status"><LatexIcon name="target" /><span>{sync.message}</span><button type="button" className={styles.iconButton} aria-label="Dismiss source navigation message" onClick={() => { syncRequest.current?.abort(); setSync(null); setNavigationChoices(null) }}><LatexIcon name="close" /></button></div>}
          {navigationChoices && canSync && workspace.proofIsCurrent(navigationChoices.snapshot, navigationChoices.proof, navigationChoices.epoch) && <div className={styles.navigationChoices} role="group" aria-label="Choose a source location">{navigationChoices.candidates.map((candidate, index) => <button type="button" className={styles.textButton} key={`${candidate.file}:${candidate.line}:${index}`} onClick={() => chooseNavigationLocation(candidate)}>{candidate.file}:{candidate.line}</button>)}<button type="button" className={styles.textButton} onClick={() => setNavigationChoices(null)}>Dismiss</button></div>}
        </section>
      </div>
    </div>
    {progress && <div className={styles.liveBuild} data-progress={workspace.attempt?.progress?.phase}>
      <span className={styles.spinner} aria-hidden="true" /><p>{progress.projectId !== project?.id && progress.projectTitle ? `${progress.projectTitle}: ` : ''}{progress.summary}{workspace.queuedRevision !== null && ` Queued r${workspace.queuedRevision}.`}</p>
      {compiling && <button type="button" className={styles.textButton} disabled={workspace.attempt?.stage === 'cancelling'} onClick={() => void workspace.cancelCompile()}>{workspace.attempt?.runtime === 'browser' ? 'Cancel local compile' : 'Cancel on server'}</button>}
      {workspace.attempt?.runtime === 'native' && workspace.attempt.stage === 'waiting' && <button type="button" className={styles.textButton} onClick={workspace.stopWaiting}>Stop waiting</button>}
      {workspace.attempt?.progress?.totalBytes !== undefined && compiling && <details className={styles.byteDetails}><summary>{sizeLabel(workspace.attempt.progress.verifiedBytes ?? 0)} / {sizeLabel(workspace.attempt.progress.totalBytes)} verified</summary><div className={styles.engineBytes}><label htmlFor="resume-latex-engine-bytes">SHA-256 verified asset bytes; {sizeLabel(workspace.attempt.progress.cachedBytes ?? 0)} reused from verified engine cache</label><progress id="resume-latex-engine-bytes" max={workspace.attempt.progress.totalBytes || 1} value={workspace.attempt.progress.verifiedBytes ?? 0} aria-label="Verified engine asset bytes, not compile completion" /><span>{sizeLabel(workspace.attempt.progress.downloadedBytes ?? 0)} decoded asset response bytes received. HTTP cache reuse is not measured as network download.</span></div></details>}
    </div>}
    <div className={styles.receiptAnchor}><LatexReceipt fact={receipt} active={active} projectId={project?.id ?? null} modalOpen={Boolean(modal)} actionLabels={actionLabels} onAction={feedbackAction} onDismiss={workspace.dismissFeedback} onExpire={workspace.expireReceipt} /></div>
    <section className={styles.problemsDrawer} data-open={drawerOpen} aria-label="Build console" style={{ '--latex-console-height': `${consoleHeight(drawerHeight, viewportHeight)}px` } as CSSProperties}>
      {drawerOpen && <div className={styles.consoleSeparator} role="separator" aria-orientation="horizontal" aria-label="Resize build console" aria-controls="resume-latex-problems-content" aria-valuemin={Math.min(120, consoleHeight(480, viewportHeight))} aria-valuemax={consoleHeight(480, viewportHeight)} aria-valuenow={consoleHeight(drawerHeight, viewportHeight)} aria-valuetext={`${consoleHeight(drawerHeight, viewportHeight)} pixels`} tabIndex={small ? -1 : 0} onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); setDrawerHeight(consoleHeight(event.key === 'Home' ? 120 : event.key === 'End' ? viewportHeight : drawerHeight + (event.key === 'ArrowUp' ? 16 : -16), viewportHeight))
      }} onPointerDown={(event) => { if (event.button !== 0) return; consoleDrag.current = { pointer: event.pointerId, y: event.clientY, height: consoleHeight(drawerHeight, viewportHeight) }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={resizeConsole} onPointerUp={(event) => { consoleDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { consoleDrag.current = null }}><span /></div>}
      <div className={styles.drawerBar}>
        <div className={styles.localDock}>
          <button type="button" className={styles.localDockToggle} aria-expanded={localExpanded} aria-controls="resume-latex-local-details" aria-label={localExpanded ? 'Collapse local workspace' : 'Expand local workspace'} aria-describedby="resume-latex-local-hint" onClick={toggleLocalWorkspace}><LatexIcon name="chevronUp" className={styles.localChevron} /></button>
          <span id="resume-latex-local-hint" className={styles.localDockHint} role="tooltip">Local workspace</span>
        </div>
        <div className={styles.buildTabs} role="group" aria-label="Build console views">
          {(['problems', 'output', 'history'] as const).map((view) => <button key={view} id={`resume-latex-build-tab-${view}`} type="button" aria-pressed={drawerOpen && drawerView === view} aria-expanded={drawerOpen && drawerView === view} aria-controls="resume-latex-problems-content" onClick={() => toggleDrawer(view)}><LatexIcon name={view === 'problems' ? 'alert' : view === 'output' ? 'terminal' : 'history'} />{view === 'problems' ? <>Problems <span className={styles.problemCount} data-has-issues={problemCount > 0}>{problemCount}</span></> : view === 'output' ? 'Output' : <>History <span className={styles.problemCount}>{projectCheckpoints.length}</span></>}</button>)}
        </div>
        <span className={styles.drawerSummary}>{currentAttempt?.stage === 'failed' ? 'Build failed' : currentAttempt?.stage === 'awaiting_action' ? 'Permission needed' : compiling ? 'Building' : workspace.autoCompile ? 'Auto Compile on' : 'Manual compile'}</span>
        <button type="button" className={styles.iconButton} aria-label="Build settings" title="Build settings" aria-pressed={drawerOpen && drawerView === 'build'} onClick={() => toggleDrawer('build')}><LatexIcon name="settings" /></button>
        <button id="resume-latex-console-toggle" type="button" className={styles.iconButton} aria-label={drawerOpen ? 'Collapse build console' : 'Expand build console'} title="Toggle build console (Ctrl+`)" aria-expanded={drawerOpen} aria-controls="resume-latex-problems-content" onClick={() => drawerOpen ? closeDrawer() : showDrawer('output')}><LatexIcon name={drawerOpen ? 'chevronDown' : 'chevronUp'} /></button>
      </div>
      {drawerOpen && <div ref={drawerContent} className={styles.drawerContent} data-view={drawerView} id="resume-latex-problems-content" role="region" aria-label={`${drawerView === 'build' ? 'Build settings' : drawerView === 'problems' ? 'Problems' : drawerView === 'history' ? 'Project history' : 'Build output'}`} tabIndex={0}>
        {drawerView === 'build' && <>
          <LatexBuildDetails proof={proof} proofSource={workspace.proofSource} currentAttempt={workspace.proofAttempt} />
          <div className={styles.buildSettings}>
            <label>Main source<select aria-label="Main .tex file" value={project?.mainFile ?? ''} disabled={!project} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { mainFile: event.target.value || null }))) }}><option value="">Choose main</option>{project?.files.filter((item) => /\.tex$/iu.test(item.path)).map((item) => <option key={item.id} value={item.path}>{item.path}</option>)}</select></label>
            <label>Engine<select aria-label="Build engine" value={project?.engine ?? 'xelatex'} disabled={!project} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { engine: event.target.value as LatexProject['engine'] }))) }}>{Object.entries(engineNames).map(([id, name]) => <option key={id} value={id}>{name}{workspace.capabilities.profiles.some((profile) => profile.id === id) ? '' : ' (not ready)'}</option>)}</select></label>
            <label>Runtime<select aria-label="Build runtime" value={workspace.runtime} disabled={compiling || workspace.attempt?.stage === 'recoverable'} onChange={(event) => selectRuntime(event.target.value as LatexRuntime)}><option value="browser">Local browser (no upload)</option><option value="native">Private native (uploads source)</option></select></label>
          </div>
          <div className={styles.buildOverview}>
            <div className={styles.buildFact}><LatexIcon name="file" /><div><span>Source snapshot</span><b>{project ? `${project.mainFile ?? 'No main selected'} / r${project.revision}` : 'Restoring source'}</b><small>{project ? `${fileCount} files / ${sizeLabel(contentSize.source + contentSize.assets)}` : 'No source has been uploaded.'}</small></div></div>
            <div className={styles.buildFact} data-state={currentAttempt?.stage ?? 'idle'}>{currentAttempt && ['waiting', 'recovering', 'cancelling'].includes(currentAttempt.stage) ? <span className={styles.spinner} aria-hidden="true" /> : <LatexIcon name={currentAttempt?.stage === 'failed' || currentAttempt?.stage === 'recoverable' ? 'alert' : 'shield'} />}<div><span>{localRuntime ? 'Local browser compiler' : 'Private native compiler'}</span><b>{currentAttempt ? `${engineNames[currentAttempt.snapshot.engine]} / ${currentAttempt.progress?.phase ?? currentAttempt.stage}` : !localRuntime && !workspace.online ? 'Offline' : capabilityReady ? `${engineNames[project?.engine ?? 'lualatex']} / available to load` : 'Not available'}</b><small>{currentAttempt ? `Captured revision ${currentAttempt.revision}` : localRuntime ? 'Project source never leaves this device.' : 'Only a consented compile sends source.'}</small></div></div>
            <div className={styles.buildFact}><LatexIcon name={proof && current ? 'check' : 'file'} /><div><span>PDF proof</span><b>{proof ? `r${proof.revision} / ${current ? 'current' : 'not current'}` : 'Not compiled'}</b><small>{proof ? `${proof.pdf.pages} ${proof.pdf.pages === 1 ? 'page' : 'pages'} / ${sizeLabel(proof.pdf.bytes)} / exact bytes` : 'No preview or progress is fabricated.'}</small></div></div>
          </div>
          <div className={styles.buildStatus}><p>{currentAttempt?.message ?? (compileReason || (localRuntime ? 'Ready to load the local engine on Compile. Source and generated PDF bytes stay on this device.' : 'Ready for a consented private compile. Source remains local until Compile.'))}{workspace.queuedRevision !== null && ` Latest queued intent: r${workspace.queuedRevision}.`}</p><div className={styles.buildActions}><button type="button" className={styles.button} disabled={workspace.capabilitiesLoading || workspace.engineCacheBusy} onClick={() => void checkAvailability()}><LatexIcon name="shield" />Check availability</button>{readyBrowserAttempt && readyEngineAssets.length > 0 && <button type="button" className={styles.button} onClick={() => openModal({ kind: 'engine-assets', operationKey: readyBrowserAttempt.operationKey })}><LatexIcon name="layers" />View engine files</button>}</div></div>
          {localRuntime && <section className={styles.packageReview} aria-label="Template package check"><h3>Template packages</h3>
            <p>{!project?.mainFile ? 'Choose the main .tex file to inspect this template.' : !dependencyCheckCurrent ? 'Check the current source and its reachable classes, packages and libraries before compiling.' : dependencyCheck?.status === 'checking' ? 'Checking the pinned package catalogue and existing permissions. No package files are downloading.' : dependencyCheck?.status === 'failed' ? dependencyCheck.error : dependencyCheck?.preparation?.groups.length ? `${dependencyCheck.preparation.groups.length} package groups need download permission. Review their packages, dependencies and total size.` : 'No additional package permissions are currently needed for known literal dependencies. The compiler may discover further requirements.'}</p>
            <div className={styles.buildActions}><button type="button" className={styles.button} disabled={!project?.mainFile || workspace.engineCacheBusy || compiling || dependencyCheckCurrent && dependencyCheck?.status === 'checking'} onClick={() => void workspace.inspectBrowserDependencies()}>{dependencyCheckCurrent && dependencyCheck?.status === 'checking' ? 'Checking packages...' : 'Check template packages'}</button>{Boolean(packageReview?.groups.length) && <button type="button" className={styles.button} onClick={() => showDrawer('problems')}>Review package downloads</button>}</div>
            <p className={styles.helper}>Checking does not upload source, change files, download the engine, or start compilation. Permission is not proof that package bytes are cached: each required asset is verified during compilation. Unsupported packages and missing personal files cannot be fixed by downloading an unrelated package.</p>
          </section>}
          {altaCvEntry && <p className={styles.helper}>Overleaf parity requires the same main file, engine, TeX Live release, packages and font files. Installing Windows fonts or TeX Live does not change the pinned browser runtime. Imported <code>latexmkrc</code> is preserved as source data, not executed by either editor runtime.</p>}
          <p className={styles.helper}>Maximum three TeX passes, with at most one actual Biber or BibTeX run. Final unresolved references remain an error. Requested backend: {assessment?.bibliography.backend ?? 'not-determined'}. Biber: {inventoryLabel(assessment?.bibliography.capabilities.biber ?? 'not-recorded')}. BibTeX: {inventoryLabel(assessment?.bibliography.capabilities.bibtex ?? 'not-recorded')}.</p>
          <details className={styles.evidenceDetails}><summary>Import summary{importReport ? `: ${importReport.sourceCount} sources + ${importReport.imageCount} images` : ': not recorded in this session'}</summary>
            {importReport ? <><p>Imported revision {importReport.revision}; all {importReport.sourceCount} source/config files and {importReport.imageCount} image assets were retained unchanged. Current selection above may differ after editing.</p><dl className={styles.importEvidence}>
              <div><dt>Selected main at import</dt><dd>{importReport.main.selected ?? 'Not selected'} ({importReport.main.origin})</dd></div>
              <div><dt>Engine at import</dt><dd>{engineNames[importReport.engine.selected]} ({importReport.engine.origin === 'manifest' ? 'explicit portable manifest' : importReport.engine.origin === 'tex-program' ? 'supported TeX program directive' : importReport.engine.origin === 'altacv-recommendation' ? 'product recommendation for original AltaCV, not an Overleaf setting' : 'product default, not detected'}){importReport.engine.file ? ` / ${importReport.engine.file}${importReport.engine.line ? `:${importReport.engine.line}` : ''}` : ''}</dd></div>
              <div><dt>Document candidates</dt><dd>{importReport.main.candidates.join(', ') || 'Not determined; no complete literal document root identified.'}</dd></div>
            </dl><details><summary>Preserved file paths</summary><ul>{[...importReport.sourcePaths, ...importReport.imagePaths].map((path) => <li key={path}><code>{path}</code></li>)}</ul></details></> : <p>Import-time main/engine evidence is not recorded for this restored, copied or newly created project. The displayed main and engine are current settings, not detected original settings.</p>}
            {(importReport?.inertConfigPaths ?? assessment?.inertConfigPaths ?? []).length > 0 && <p><code>{(importReport?.inertConfigPaths ?? assessment?.inertConfigPaths)?.join(', ')}</code> is retained as inert data. It is not executed or used to choose a shell command.</p>}
          </details>
          {assessment && <details className={styles.evidenceDetails}><summary>Current source dependencies and fonts</summary><p>This read-only assessment follows literal reachable files. It does not execute macros, resolve unknown branches or verify fonts actually used in the PDF. The real compiler is authoritative.</p>
            <p>Potentially reachable source: {assessment.reachablePaths.join(', ') || 'Not determined'}. Profile: {assessment.profile?.version ?? 'Not recorded'}.</p>
            {assessment.fonts.length > 0 ? <div className={styles.evidenceTableWrap}><table className={styles.evidenceTable}><thead><tr><th>Requested font</th><th>Source evidence</th><th>Profile availability</th><th>PDF usage</th></tr></thead><tbody>{assessment.fonts.map((font, index) => <tr key={`${font.file}:${font.line}:${index}`}><td>{font.requested ?? 'Not determined'}{font.feature ? ` (${font.feature})` : ''}</td><td>{font.file}:{font.line} / {font.context === 'direct' ? 'literal declaration' : 'execution not determined'}</td><td>{inventoryLabel(font.profileAvailability)}{font.matchedFamily ? `: ${font.matchedFamily}` : ''}</td><td>Not verified</td></tr>)}</tbody></table></div> : <p>No literal font-family declarations found. Effective defaults and embedded font usage are not determined here.</p>}
            <details><summary>Files, classes and packages ({assessment.references.length})</summary><ul>{assessment.references.map((item, index) => <li key={`${item.file}:${item.line}:${index}`}><code>{item.requested ?? 'Macro-dependent'}</code> ({item.kind}): {item.projectPaths.length ? `project candidates ${item.projectPaths.join(', ')}` : inventoryLabel(item.profileAvailability)} / {item.file}:{item.line}{item.context !== 'direct' ? ' / execution not determined' : ''}</li>)}</ul></details>
            {assessment.notDetermined.length > 0 && <details><summary>Not determined ({assessment.notDetermined.length}){assessment.truncated ? '; assessment truncated' : ''}</summary><ul>{assessment.notDetermined.map((item, index) => <li key={index}>{item.file ? `${item.file}${item.line ? `:${item.line}` : ''}: ` : ''}{item.reason}</li>)}</ul></details>}
          </details>}
          <p className={styles.helper}>Advanced layouts compile as actual LaTeX, not a visual emulation. Engine, TeX/package/font versions, renderer and metadata can differ from Overleaf. Matching source alone is not a pixel-equality promise. Engine assets cached does not mean the app is fully offline-ready.</p>
          {workspace.capabilities.profiles.length > 0 && <details className={styles.compilerInventory}><summary>{localRuntime ? 'Bundled browser engines, fonts and packages' : 'Reported native fonts and packages'}</summary><p className={styles.helper}>{localRuntime ? 'Pinned local profiles and package subset, not universal TeX compatibility or the complete bundle inventory. The engine loads when compiling; custom project source is kept separately.' : 'Availability reported by the private compiler, not inferred from your source. Custom project files are kept separately.'}</p>{workspace.capabilities.profiles.map((profile) => <div key={profile.id}><b>{profile.name}</b><small>{profile.version}</small><p><strong>Fonts:</strong> {profile.fonts.join(', ') || 'None reported'}</p><p><strong>Packages:</strong> {profile.packages.join(', ') || 'None reported'}</p></div>)}{localManifest && <><p className={styles.helper}>{localManifest.groups ? `Selected core + ${project ? engineNames[project.engine] : 'engine'} assets: ${sizeLabel(localEngineBytes ?? 0)}. Optional package groups add their pinned bytes only after consent; the ${sizeLabel(localManifest.assets.reduce((total, asset) => total + asset.bytes, 0))} legacy full bundle is not fetched for grouped profiles.` : `Fixed runtime assets: ${sizeLabel(localManifest.assets.reduce((total, asset) => total + asset.bytes, 0))}.`} Device memory and cache availability vary.</p>{Boolean(localManifest.groups?.some((group) => group.kind === 'package')) && <ul>{localManifest.groups!.filter((group) => group.kind === 'package').map((group) => <li key={group.id}>{group.id}: {group.packages.join(', ')} / {sizeLabel(group.assets.reduce((sum, pin) => sum + pin.bytes, 0))} / explicit download consent</li>)}</ul>}<ul>{localManifest.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><a href={`${BROWSER_LATEX_ROOT}source-offer.json`} target="_blank" rel="noreferrer">Compiler source and license provenance</a></>}</details>}
        </>}
        {drawerView === 'problems' && <>
          {workspaceIssues.length > 0 && <><h3>Workspace actions</h3><ul className={styles.diagnostics}>{workspaceIssues.map((fact) => <li key={fact.id} data-severity={fact.severity}><b>{fact.priority === 0 ? 'Source risk' : 'Action'}</b><div><p>{fact.projectId !== project?.id && fact.projectTitle ? `${fact.projectTitle}: ` : ''}{fact.summary}</p><div className={styles.buildActions}>{fact.actionIds.map((action) => <button key={action} type="button" className={styles.textButton} onClick={() => feedbackAction(action, fact)}>{actionLabels[action as keyof typeof actionLabels] ?? action}</button>)}<button type="button" className={styles.textButton} onClick={() => workspace.dismissFeedback(fact)}>{fact.priority === 0 ? 'Acknowledge risk' : 'Defer'}</button></div></div></li>)}</ul></>}
          {Boolean(packageReview?.groups.length) && packageReviewSource && packageReview && <section className={styles.packageReview} aria-label="Review package download">
            <h3>Download supported package groups</h3>
            <p>For {engineNames[packageReviewSource.engine]} / source r{packageReviewSource.revision}: up to {sizeLabel(packageReview.downloadBytes)} of pinned package files and dependencies. Verified cache bytes may be reused.</p>
            <ul>{packageReview.groups.map((group) => <li key={group.id}><b>{group.id}</b>: {group.packages.join(', ')}{Boolean(group.requires?.length) && <span> / Requires: {group.requires!.join(', ')}</span>}</li>)}</ul>
            <p className={styles.helper}>Trusted origin: this site&apos;s <code>{BROWSER_LATEX_ROOT}</code> assets. Sizes and SHA-256 hashes are verified before use; first-use engine assets are separate. No OS install, arbitrary package URL, or source upload.</p>
            {!packageReviewCurrent && <p>Source or runtime changed. Recheck the current template; this review cannot start an old build.</p>}
            {pendingPackages?.error && <p role="status">{pendingPackages.error}</p>}
            <div className={styles.buildActions}><button type="button" className={styles.button} disabled={!packageReviewCurrent || workspace.engineCacheBusy || compiling || !workspace.online} onClick={() => void downloadReviewedPackages()}>{workspace.engineCacheBusy ? 'Preparing...' : workspace.online ? 'Download and compile' : 'Reconnect to download'}</button><button type="button" className={styles.textButton} disabled={compiling} onClick={() => { if (pendingPackages?.packages) workspace.dismissBrowserPreparation(); workspace.dismissDependencyCheck() }}>Not now</button></div>
            <p className={styles.helper}>After approval, the same captured source is compiled. More runtime-discovered dependencies may require another explicit approval. A download is not a guarantee of a valid PDF; source errors, unsupported resources and final verification still apply.</p>
          </section>}
          <p className={styles.helper}>{diagnosticRevision ? `Compiler report for r${diagnosticRevision}${!diagnosticsCurrent ? '. Source or runtime differs; old locations are disabled.' : '.'}` : 'Compile to obtain authoritative compiler diagnostics.'} Local checks are conservative hints, never compile blockers. Use F8 / Shift+F8 in the editor to navigate.</p>
          {localDiagnostics && matchesSourceSnapshot(project, localDiagnostics.snapshot) && localDiagnostics.status !== 'checked' && <p className={styles.helper}>Local check: {localDiagnostics.reason ?? 'This syntax is not determined locally.'}</p>}
          {(['error', 'warning', 'info'] as const).map((severity) => editorIssues.some((item) => item.diagnostic.severity === severity) && <section key={severity}><h3>{severity === 'error' ? 'Errors' : severity === 'warning' ? 'Warnings' : 'Information'}</h3><ul className={styles.diagnostics}>{editorIssues.filter((item) => item.diagnostic.severity === severity).map((item) => <li key={item.id} data-severity={item.diagnostic.severity}><b>{item.origin === 'local' ? 'Local check' : 'Compiler'}</b><div><p>{item.diagnostic.message}</p>{item.diagnostic.help && <p className={styles.helper}>{item.diagnostic.help}</p>}<div className={styles.buildActions}>{item.path && <button type="button" className={styles.textButton} disabled={!item.range || !issueIsCurrent(item)} title={!issueIsCurrent(item) ? 'Source or runtime changed. Recompile before navigating this diagnostic.' : !item.range ? 'No validated source range was reported.' : undefined} onClick={() => jumpToIssue(item)}>{item.path}{item.range ? `:${item.range.line}` : ''}</button>}<button type="button" className={styles.textButton} aria-expanded={issueReview?.issue.id === item.id} onClick={() => issueReview?.issue.id === item.id ? setIssueReview(null) : reviewIssue(item)}>Details and fixes</button></div></div></li>)}</ul></section>)}
          {!editorIssues.length && <p>{currentAttempt && ['failed', 'recoverable'].includes(currentAttempt.stage) ? currentAttempt.message : 'No diagnostics reported for this view.'}</p>}
          {issueReview && <section className={styles.issueReview} aria-label="Diagnostic detail and reviewed fix">
            <div className={styles.historyHeading}><h3>{issueReview.fix ? 'Suggested source fix' : 'Diagnostic details'}</h3><button type="button" className={styles.textButton} onClick={() => setIssueReview(null)}>Dismiss</button></div>
            <p>{issueReview.issue.diagnostic.message}</p>
            {issueReview.issue.diagnostic.help && <p className={styles.helper}>{issueReview.issue.diagnostic.help}</p>}
            {!reviewCurrent && <p className={styles.dialogWarning}>This review is out of date. Source, project, or runtime changed. Nothing can be applied; review the current diagnostic again.</p>}
            {issueReview.error && <p className={styles.dialogWarning} role="status">{issueReview.error}</p>}
            {issueReview.fix ? <><h4>{issueReview.fix.title}</h4><p className={styles.helper}>{issueReview.fix.explanation}</p><code>{issueReview.fix.path}</code><div className={styles.replacementReview}><section><h3>Before</h3><pre>{issueReview.fix.before || '(empty)'}</pre></section><section><h3>After</h3><pre>{issueReview.fix.after || '(empty)'}</pre></section></div><button type="button" className={styles.button} disabled={!reviewCurrent || Boolean(fixRequest)} onClick={applyIssueFix}>Apply reviewed fix</button><p className={styles.helper}>One Undo restores the original text. Applying a fix does not mean compilation succeeded.</p></> : <p className={styles.helper}>No deterministic source correction is established for this diagnostic. The original compiler message remains above.</p>}
            {issueReview.assistance && <div className={styles.packageReview}><h4>{issueReview.assistance.title}</h4><p>{issueReview.assistance.message}</p>
              {issueReview.assistance.preparation && <><p className={styles.helper}>{engineNames[issueReview.assistance.snapshot.engine]}: up to {sizeLabel(issueReview.assistance.preparation.downloadBytes)} for the package groups below, including their bundled dependencies. Cached bytes may be reused. Trusted same-origin source: <code>{BROWSER_LATEX_ROOT}</code>; every size and SHA-256 pin is verified.</p><ul>{issueReview.assistance.preparation.groups.map((group) => <li key={group.id}><b>{group.id}</b>: {group.packages.join(', ')}</li>)}</ul><button type="button" className={styles.button} disabled={!reviewCurrent || workspace.engineCacheBusy || compiling || !workspace.online} onClick={() => void downloadAssistance()}>{workspace.online ? 'Download package and retry' : 'Reconnect to download'}</button></>}
              {issueReview.assistance.canImport && <button type="button" className={styles.button} disabled={!reviewCurrent || busy} onClick={() => assetInput.current?.click()}>{issueReview.assistance.kind === 'unsupported' ? 'Add template source file' : 'Add local project file'}</button>}
              {issueReview.assistance.kind === 'unsupported' && <div className={styles.buildActions}><button type="button" className={styles.textButton} disabled={!project || busy} onClick={() => void downloadSource()}>Export source</button><button type="button" className={styles.textButton} onClick={() => showDrawer('build')}>Review runtime settings</button></div>}
            </div>}
            <details className={styles.aiState}><summary>Suggest fix with AI</summary><p>AI assistance is disabled. No source, log, PDF, or personal information is sent to an AI provider. Local fixes and compilation remain available.</p></details>
          </section>}
        </>}
        {drawerView === 'output' && <LatexBuildOutput log={buildLog} identity={currentAttempt?.operationKey ?? proof?.operationKey ?? ''} projectId={project?.id ?? null} activity={workspace.feedback.activity} view={outputView} onView={setOutputView} filename={`${downloadName(project?.title ?? 'resume')}-r${diagnosticRevision ?? 1}.log`} diagnostics={diagnostics} onDiagnostic={jumpToDiagnostic} canNavigate={(diagnostic) => diagnosticsCurrent && Boolean(diagnosticSourceTarget(project, diagnosticSnapshot, diagnostic))} />}
        {drawerView === 'history' && <><div className={styles.historyHeading}><div><h3>Checkpoints</h3><p className={styles.helper}>{projectCheckpoints.length} / {LOCAL_LATEX_LIMITS.checkpointsPerProject} for this project. The most recent six are kept.</p></div><button type="button" className={styles.button} disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="plus" />Create checkpoint</button></div><p className={styles.helper}>Restore creates a new revision and a recovery checkpoint first. Only committed transactions survive a reload.</p><ul className={styles.history}>{projectCheckpoints.map((item) => <li key={item.id}><LatexIcon name="history" /><div><b>{item.label}</b><small>r{item.project.revision} / {new Date(item.createdAt).toLocaleString()}</small></div><button type="button" className={styles.button} onClick={() => openModal({ kind: 'restore', checkpoint: item })}>Restore...</button><button type="button" className={styles.textButton} disabled={busy} onClick={() => void downloadSource(item.project, false)}><LatexIcon name="download" />ZIP</button></li>)}</ul>{!projectCheckpoints.length && <p>No local checkpoints yet. Create one before an important source change.</p>}</>}
      </div>}
    </section>
    <nav className={styles.mobileNav} aria-label="LaTeX workspace views">{(['files', 'source', 'proof', 'problems'] as const).map((panel) => <button type="button" key={panel} aria-current={mobilePanel === panel ? 'page' : undefined} onClick={() => { setMobilePanel(panel); if (panel === 'problems') setDrawer(usefulProblems ? 'problems' : 'build') }}><LatexIcon name={panel === 'files' ? 'files' : panel === 'source' ? 'file' : panel === 'proof' ? 'layers' : 'terminal'} />{panel === 'files' ? 'Files' : panel === 'source' ? 'Source' : panel === 'proof' ? 'Proof' : 'Build'}{panel === 'problems' && usefulProblems && <span className={styles.mobileIssueDot} aria-label="Build has issues" />}</button>)}</nav>
    <dialog ref={dialog} className={styles.dialog} data-kind={modal?.kind} aria-labelledby="resume-latex-dialog-title" aria-describedby={modalError ? 'resume-latex-dialog-error' : undefined} onCancel={() => closeModal()}><form onSubmit={(event) => void submitModal(event)}><div className={styles.dialogHeading}><h2 id="resume-latex-dialog-title">{modalTitle}</h2><button type="button" aria-label="Close LaTeX dialog" onClick={() => closeModal()}>Close</button></div>
      {modalError && <p id="resume-latex-dialog-error" className={styles.dialogWarning} role="alert">{modalError}</p>}
      {modal?.kind === 'preparation' && workspace.browserPreparation?.operationKey === modal.operationKey && <div className={styles.enginePreparation}>
        {workspace.browserPreparation.memoryGB !== undefined && <p>This device reports about {workspace.browserPreparation.memoryGB} GB of memory. The WASM engine reserves roughly 512 MiB and needs additional space for files and verification; a small device may fail. Continuing is your choice, not a guarantee.</p>}
        {workspace.browserPreparation.packages && <><p>Allow up to {sizeLabel(workspace.browserPreparation.packages.downloadBytes)} of fixed, SHA-256-verified compiler files for source r{workspace.browserPreparation.revision}. This is the required total, not measured new network bytes. Already verified cache bytes may be reused. Source and PDF bytes stay local.</p><ul>{workspace.browserPreparation.packages.groups.map((group) => <li key={group.id}><b>{group.id}</b><span>{group.packages.join(', ')} / {sizeLabel(group.assets.reduce((sum, asset) => sum + asset.bytes, 0))} TeX snapshot{localManifest?.biber?.group === group.id ? ` + ${sizeLabel(localManifest.biber.assets.reduce((sum, asset) => sum + asset.bytes, 0))} local Biber runtime` : ''}</span></li>)}</ul>{!workspace.online && <p>Offline: reconnect before approving a package download. Editing remains available.</p>}</>}
        {!preparationCurrent && <p className={styles.dialogWarning}>The source changed while permission was pending. Compile the latest revision explicitly; this old request cannot start a compile.</p>}
        {workspace.browserPreparation.error && <p className={styles.dialogWarning} role="alert">{workspace.browserPreparation.error}</p>}
        <button type="button" className={styles.textButton} onClick={() => { workspace.dismissBrowserPreparation(); closeModal() }}>Not now</button>
      </div>}
      {modal && (modal.kind === 'new' || modal.kind === 'rename') && <><label className={styles.field}>Relative filename<input autoFocus value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} required maxLength={240} spellCheck={false} /></label><p className={styles.helper}>.tex, .sty, .cls, .bib, .bst, .md, .txt or latexmkrc. Documentation/configuration are editable and exportable, not executed. Image renames keep their PNG/JPEG format. Use NFC letters, numbers, hyphens, underscores and relative folders; no spaces or traversal paths.</p>{modal.kind === 'new' && <label className={styles.field}>Initial raw source<textarea value={fileText} onChange={(event) => setFileText(event.target.value)} rows={8} spellCheck={false} /></label>}</>}
      {modal && (modal.kind === 'rename' || modal.kind === 'delete') && <div className={styles.dialogWarning}><p>{modal.kind === 'delete' ? `Delete ${modal.path}?` : `Rename ${modal.path}?`} A recoverable checkpoint is recorded with the change. Source references will not be rewritten automatically.</p>{refs.length ? <ul>{refs.map((reference) => <li key={`${reference.file}:${reference.line}`}>{reference.file}:{reference.line} references this path.</li>)}</ul> : <p>No literal references were found. Macro-generated references may still exist.</p>}</div>}
      {modal?.kind === 'restore' && <p className={styles.dialogWarning}>Restore {modal.checkpoint.label} (r{modal.checkpoint.project.revision}) as a new source revision. Current source is checkpointed first; the last good PDF remains labeled with its own revision.</p>}
      {modal?.kind === 'privacy' && <><p>Compile sends this project&apos;s LaTeX source and image assets to our private compiler. It is not cloud draft storage. Uploaded source/assets and scratch are removed at terminal completion or forced cleanup; private server PDF/log/map results expire within 15 minutes.</p><p className={styles.helper}>Guest compilation is free but bounded by fair-use limits. No AI, account login or new credit charge is added. A compiled PDF is retained locally only when device storage commits it.</p>{modal.auto && <p>Auto Compile is explicit opt-in for this session. It waits 1.8 seconds after source edits, runs only while this workspace is active and online, and coalesces the latest intent. Opening projects, restoring and saving do not start compilation.</p>}<label className={styles.consent}><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} required />I understand that source and image assets are uploaded when I compile.</label></>}
      {modal?.kind === 'fonts' && <><p>These explicit choices change literal font declarations only in the LaTeX source copy. Regular writing and export bytes stay untouched. Engine/package compatibility and final shaping still require a real compile.</p>{!capabilityReady && <p className={styles.dialogWarning}>Compiler readiness is unavailable. Suggestions below are source-only compatibility choices, not a claim that the selected runtime includes a font.</p>}{modal.fonts.map((font) => {
        const bengali = /Bengali|Bangla|Hind Siliguri|Kalpurush|Solaiman|Nikosh/iu.test(font)
        const choices = [...new Set([font, ...(nativeFonts.length ? nativeFonts.filter((name) => !bengali || /Bengali|Bangla|Hind Siliguri|Kalpurush|Solaiman|Nikosh/iu.test(name)) : [bengali ? 'Noto Sans Bengali' : 'Latin Modern Roman'])])]
        return <label className={styles.field} key={font}>Requested: {font}<select value={fontChoices[font] ?? font} onChange={(event) => setFontChoices((previous) => ({ ...previous, [font]: event.target.value }))}>{choices.map((name) => <option key={name} value={name}>{name}{name === font ? ' (keep exact source)' : ''}</option>)}</select></label>
      })}{!modal.fonts.length && <p>No literal fontspec font names were detected. Custom macro-defined fonts must be reviewed in source.</p>}</>}
      {modal?.kind === 'remove' && <><p className={styles.dialogWarning}>Explicitly remove {modal.project.title || 'this project'} and its supported local checkpoints/assets/proof. This does not affect Regular or other projects. Invalid/future records are preserved. Export a Source ZIP first if you need a portable recovery copy.</p><button type="button" className={styles.button} disabled={busy} onClick={() => void downloadSource(modal.project, false)}>Download this project&apos;s ZIP</button></>}
      {modal?.kind === 'engine-cache' && <><p className={styles.dialogWarning}>Clear only the verified engine assets and package-download permissions stored on this device. Project source, original ZIP contents, checkpoints and PDF proofs stay untouched. HTTP caches are separate and are not erased. The next local compile may need to download the selected profile again; offline compilation is not promised after clearing.</p>{cacheClearError && <p className={styles.dialogWarning} role="alert">{cacheClearError}</p>}</>}
      {modal?.kind === 'replace' && <><p>Review {modal.review.matches.length} literal replacements across {modal.review.changes.length} files in revision {modal.review.snapshot.revision}. A checkpoint must commit on this device before any source changes. Switching or editing the project invalidates this review.</p>
        <div className={styles.replacementReview}><section><h3>Find exactly</h3><pre>{modal.review.query}</pre></section><section><h3>Replace with</h3><pre>{modal.review.replacement || '(empty text)'}</pre></section></div>
        {modal.review.changes.map((change) => <details key={change.fileId}><summary>{change.file}: {change.occurrences} replacements</summary><ul>{modal.review.matches.filter((match) => match.fileId === change.fileId).map((match) => <li key={match.from}><code>{match.line}:{match.column} {match.preview}</code></li>)}</ul></details>)}
      </>}
      {modal?.kind === 'engine-assets' && engineAssetAttempt && <>
        <p><strong>Captured revision r{engineAssetAttempt.revision}</strong> / {engineNames[engineAssetAttempt.snapshot.engine]}</p>
        <p className={styles.helper}>Latest successful local compile for this project, retained in this editor session. This is not a view of current cache contents or a network-traffic report. Package names apply to each group, not to individual files.</p>
        <dl className={styles.engineAuditSummary}>
          <div><dt>Verified assets</dt><dd>{engineAssets.length}</dd></div>
          <div><dt>Total verified bytes</dt><dd title={`${engineAssetBytes.toLocaleString('en-US')} bytes`}>{sizeLabel(engineAssetBytes)}</dd></div>
          <div><dt>IndexedDB reuse</dt><dd>{engineAssetsReused}</dd></div>
          <div><dt>Fetch responses</dt><dd>{engineAssets.length - engineAssetsReused}</dd></div>
        </dl>
        <div className={styles.engineAuditGroups}>{engineAssetGroups.map((group) => <section key={group.id}>
          <div className={styles.engineAuditGroupHeading}><h3>{group.kind === 'runtime' ? 'Engine runtime' : group.kind === 'bundle' ? 'Complete engine bundle' : `${group.id} / ${group.kind === 'package' ? 'Approved package group' : group.kind === 'core' ? 'Core files' : 'Engine profile'}`}</h3><span>{group.assets.length} assets</span></div>
          {group.packages.length > 0 && <p><strong>Packages in this group:</strong> {group.packages.join(', ')}</p>}
          <ul>{group.assets.map((asset) => <li key={asset.path}>
            <code className={styles.engineAssetPath}>{asset.path}</code>
            <p className={styles.engineAssetSource} data-source={asset.source}>{asset.source === 'indexeddb-reuse' ? 'IndexedDB reuse — verified local engine cache' : 'Fetch response received — HTTP cache may have been used'}</p>
            <dl className={styles.engineAssetMetadata}><div><dt>Exact size</dt><dd>{asset.bytes.toLocaleString('en-US')} bytes / {sizeLabel(asset.bytes)}</dd></div><div><dt>SHA-256</dt><dd><code>{asset.sha256}</code></dd></div></dl>
          </li>)}</ul>
        </section>)}</div>
      </>}
      <div className={styles.dialogActions}>{modal?.kind === 'engine-assets' ? <button type="button" className={styles.primaryButton} onClick={() => closeModal()}>Done</button> : <><button type="button" className={styles.button} onClick={() => closeModal()}>Close</button><button type="submit" className={styles.primaryButton} disabled={busy || (modal?.kind === 'privacy' && !consentChecked) || (modal?.kind === 'preparation' && (!preparationCurrent || workspace.engineCacheBusy || Boolean(workspace.browserPreparation?.packages && !workspace.online)))}>{busy ? 'Working...' : modal?.kind === 'privacy' ? modal.auto ? 'Enable Auto Compile' : 'Compile this revision' : modal?.kind === 'preparation' ? 'Approve and compile this revision' : modal?.kind === 'replace' ? 'Save checkpoint and replace' : modal?.kind === 'delete' ? 'Delete with checkpoint' : modal?.kind === 'restore' ? 'Restore as new revision' : modal?.kind === 'remove' ? 'Remove project' : modal?.kind === 'engine-cache' ? 'Clear engine cache only' : modal?.kind === 'fonts' ? 'Apply to LaTeX source only' : 'Apply'}</button></>}</div>
    </form></dialog>
  </div>
}
