'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import theme from '../components/MrResumeTheme.module.css'
import styles from './LatexResumeStudio.module.css'
import CodeMirrorSource, { type SourceJump } from './CodeMirrorSource'
import LatexPdfPreview from './LatexPdfPreview'
import LatexIcon from './LatexIcon'
import useLatexWorkspace from './useLatexWorkspace'
import { addProjectAsset, addTextFile, applyNativeFontChoices, deleteProjectFile, downloadName, projectSize, referencesToFile, renameProjectFile,
  requiredNativeFonts, restoreCheckpointProject, reviseProject, sameProjectSource, sourceOutline, utf8Bytes } from './project.ts'
import { createTemplateProject, latexSourceTemplates } from './templates.ts'
import { createRegularLatexProject, downloadBlob, exportProjectFile, importProjectFile, importSupportedFile } from './projectImport'
import { syncLatexProof } from './compileTransport'
import type { LatexAsset, LatexCheckpoint, LatexDiagnostic, LatexImportRequest, LatexPdfLocation, LatexProject } from './types'
import { LATEX_LIMITS } from './types'
import { LOCAL_LATEX_LIMITS } from './projectStore'

export type LatexResumeStudioProps = { active: boolean; importRequest?: LatexImportRequest | null; onImportHandled?: (id: string) => void; onCopyRegular?: () => void }
type Panel = 'files' | 'source' | 'proof' | 'problems'
type Drawer = 'closed' | 'build' | 'problems' | 'log' | 'history'
type Modal = { kind: 'new' | 'rename'; fileId?: string; path?: string } | { kind: 'delete'; fileId: string; path: string }
  | { kind: 'restore'; checkpoint: LatexCheckpoint } | { kind: 'privacy'; auto: boolean } | { kind: 'fonts'; projectId: string; revision: number; fonts: string[] }
  | { kind: 'remove'; project: LatexProject }
const emptyDiagnostics: LatexDiagnostic[] = []
const smallSnapshot = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const subscribeSmall = (notify: () => void) => { const query = window.matchMedia('(max-width: 900px)'); query.addEventListener('change', notify); return () => query.removeEventListener('change', notify) }
const engineNames = { lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX' } as const
const localDisclosureMotion = { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
function sizeLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB` }

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
  const [filesOpen, setFilesOpen] = useState(true), [fontSize, setFontSize] = useState<number | null>(null), [tabSize, setTabSize] = useState<2 | 4>(2)
  const [localExpanded, setLocalExpanded] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({}), [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [jump, setJump] = useState<SourceJump | null>(null), [sourceLine, setSourceLine] = useState(1)
  const [drawer, setDrawer] = useState<Drawer>('closed'), [dismissedProblems, setDismissedProblems] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal | null>(null), [pathDraft, setPathDraft] = useState(''), [fileText, setFileText] = useState(''), [fontChoices, setFontChoices] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false), [consentChecked, setConsentChecked] = useState(false), [busy, setBusy] = useState(false)
  const [copyFonts, setCopyFonts] = useState<{ projectId: string; fonts: string[] } | null>(null)
  const [availabilityToast, setAvailabilityToast] = useState<{ message: string; ready: boolean } | null>(null)
  const [sync, setSync] = useState<{ identity: string; location: LatexPdfLocation | null; message: string; busy: boolean } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), splitElement = useRef<HTMLDivElement>(null), drag = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const localPanel = useRef<HTMLDivElement>(null), localBody = useRef<HTMLDivElement>(null)
  const localIntent = useRef(false), localStart = useRef<number | null>(null), localAnimations = useRef<Animation[]>([])
  const importInput = useRef<HTMLInputElement>(null), assetInput = useRef<HTMLInputElement>(null), sourceTabs = useRef<(HTMLButtonElement | null)[]>([])
  const handledImports = useRef(new Set<string>()), jumpSequence = useRef(0), syncRequest = useRef<AbortController | null>(null)
  const latest = useRef(workspace), callbacks = useRef({ onImportHandled })
  useLayoutEffect(() => { latest.current = workspace; callbacks.current = { onImportHandled } }, [workspace, onImportHandled])
  const alive = useRef(true)
  const project = workspace.project
  const file = project?.files.find((item) => item.id === selectedFiles[project.id]) ?? project?.files.find((item) => item.path === project.mainFile) ?? project?.files[0]
  const asset = project?.assets.find((item) => item.id === selectedAsset)
  const projectEntries = project ? [...project.files, ...project.assets] : []
  const selectedEntry = asset ?? file
  const projectTextOnly = Boolean(file && (/\.(?:md|txt)$/iu.test(file.path) || file.path.split('/').pop()?.toLowerCase() === 'latexmkrc'))
  const filesToggleLabel = small ? mobilePanel === 'files' ? 'Return to source' : 'Show project files' : filesOpen ? 'Hide project files' : 'Show project files'
  const proof = workspace.proof, current = workspace.proofCurrent
  const foreignProof = Boolean(proof && project && proof.projectId !== project.id)
  const sameRevisionMismatch = Boolean(proof && project && proof.revision === project.revision && !current && !foreignProof)
  const identity = proof ? `${proof.operationKey}:${proof.snapshotHash}:${proof.pdf.sha256}` : ''
  const currentAttempt = workspace.attempt?.projectId === project?.id ? workspace.attempt : null
  const diagnostics = currentAttempt?.diagnostics ?? proof?.diagnostics ?? emptyDiagnostics
  const diagnosticRevision = currentAttempt?.revision ?? proof?.revision
  const diagnosticsCurrent = Boolean(project && diagnosticRevision === project.revision && (currentAttempt ? sameProjectSource(project, currentAttempt.snapshot) : current))
  const usefulProblems = Boolean(currentAttempt && ['failed', 'recoverable'].includes(currentAttempt.stage) || diagnostics.some((item) => item.severity !== 'info'))
  const problemKey = currentAttempt?.operationKey ?? proof?.operationKey ?? ''
  // A new failed build surfaces its diagnostics even when the dock was on Build.
  // Explicitly choosing Log/History acknowledges this attempt, without hiding later failures.
  const newProblems = usefulProblems && dismissedProblems !== problemKey
  const drawerOpen = drawer !== 'closed' || newProblems || (small && mobilePanel === 'problems')
  const drawerView = newProblems ? 'problems' : drawer === 'closed' ? 'build' : drawer
  const canSync = Boolean(current && proof?.syncAvailable && workspace.online && active)
  const capabilityReady = workspace.capabilities.enabled && workspace.capabilities.ready
  const engineProfile = workspace.capabilities.profiles.find((profile) => profile.id === project?.engine)
  const compiling = Boolean(workspace.attempt && ['waiting', 'cancelling', 'recovering'].includes(workspace.attempt.stage))
  const saveLabel = !workspace.ready ? 'Restoring local project' : workspace.saveState?.kind === 'saved' ? `Saved r${workspace.saveState.revision}`
    : workspace.saveState?.kind === 'saving' ? 'Saving transaction' : workspace.saveState?.kind === 'conflict' ? 'Another tab saved' : workspace.saveState?.kind === 'session' ? 'Session only' : 'Unsaved changes'
  const nativeFonts = workspace.capabilities.profiles.find((profile) => profile.id === project?.engine)?.fonts ?? []
  const copiedFontsUnverified = Boolean(copyFonts && project && copyFonts.projectId === project.id && (!capabilityReady || copyFonts.fonts.some((font) => !nativeFonts.includes(font))))
  const fileCount = project ? project.files.length + project.assets.length : 0
  const projectCheckpoints = workspace.checkpoints.filter((item) => item.project.id === project?.id)
  const contentSize = project ? projectSize(project) : { source: 0, assets: 0 }
  const outline = project ? sourceOutline(project.files) : []
  const compileDisabled = !project || !capabilityReady || !engineProfile || !workspace.online || !active
  const compileReason = !workspace.online ? 'Offline. Source editing and retained downloads still work.' : !capabilityReady ? workspace.capabilities.reason : project && !engineProfile ? `${engineNames[project.engine]} is not available. Select an available engine in Editor settings.` : ''
  const buildLog = currentAttempt?.log ?? proof?.log ?? ''

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
    if (!active) { closeMenus(); return }
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
    if (!availabilityToast) return
    const timeout = window.setTimeout(() => setAvailabilityToast(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [availabilityToast])

  useEffect(() => {
    if (!workspace.ready || !importRequest || handledImports.current.has(importRequest.id)) return
    const request = importRequest
    handledImports.current.add(request.id)
    if (handledImports.current.size > 64) handledImports.current.delete(handledImports.current.values().next().value!)
    // An explicit bridge request creates a NEW independent project, never replaces a draft.
    void createRegularLatexProject(request.snapshot).then((copy) => {
      if (!alive.current) return
      latest.current.addProject(copy)
      setCopyFonts({ projectId: copy.id, fonts: requiredNativeFonts(request.snapshot.source) })
      latest.current.setNotice('Current Regular source copied to a new LaTeX project with its displayed JPEG photo, if present. This is a source copy, not a pixel-identical Regular layout.')
      callbacks.current.onImportHandled?.(request.id)
    }).catch((error: unknown) => { if (!alive.current) return; latest.current.setNotice(error instanceof Error ? error.message : 'Source copy failed. The Regular draft and current project are unchanged.'); callbacks.current.onImportHandled?.(request.id) })
  }, [workspace.ready, importRequest])

  useEffect(() => { if (!active || !current) syncRequest.current?.abort() }, [active, current, identity])
  useEffect(() => { const element = dialog.current; alive.current = true; return () => { alive.current = false; syncRequest.current?.abort(); localAnimations.current.forEach((animation) => animation.cancel()); element?.close() } }, [])

  function act(action: () => void) { try { action() } catch (error) { workspace.setNotice(error instanceof Error ? error.message : 'The project action could not be applied.') } }
  function chooseFile(id: string) {
    if (!project) return
    setSelectedFiles((previous) => ({ ...previous, [project.id]: id })); setSelectedAsset(null); setMobilePanel('source')
  }
  function chooseAsset(id: string) { setSelectedAsset(id); setMobilePanel('source') }
  function jumpTo(id: string, line: number, registration = false) {
    chooseFile(id); setJump({ id: ++jumpSequence.current, fileId: id, line, registration })
  }
  function openModal(value: Modal, path = '') { setPathDraft(path); setFileText(''); setFontChoices({}); setConsentChecked(false); setModal(value) }
  function compile() {
    if (!capabilityReady || !workspace.online || !active) { workspace.compile(); return }
    if (!consent) openModal({ kind: 'privacy', auto: false })
    else workspace.compile()
  }
  async function checkAvailability() {
    if (!workspace.online) {
      setAvailabilityToast({ message: 'Offline: editing, local backups and retained PDF downloads remain available.', ready: false })
      return
    }
    setAvailabilityToast({ message: 'Checking private compiler availability. No source is uploaded.', ready: false })
    const result = await workspace.refreshCapabilities()
    if (!result) return
    const ready = result.enabled && result.ready
    setAvailabilityToast({ message: ready ? 'Private LaTeX compilation is available.' : result.reason, ready })
  }
  async function downloadSource(snapshot = project, checkpoint = true) {
    if (!snapshot) return
    setBusy(true)
    try {
      const zip = await exportProjectFile(snapshot)
      downloadBlob(zip, `${downloadName(snapshot.title)}-source.zip`)
      if (checkpoint) await workspace.checkpointNow(`Source ZIP backup r${snapshot.revision}`, snapshot)
      workspace.setNotice(`Source ZIP downloaded from revision ${snapshot.revision}. It includes sources, bibliography, image bytes and the build manifest; native fonts/packages are not bundled.`)
    } catch (error) { workspace.setNotice(error instanceof Error ? error.message : 'Source ZIP export failed. The project is unchanged.') }
    finally { setBusy(false) }
  }
  function downloadPdf() {
    if (!proof) return
    downloadBlob(new Blob([proof.data], { type: 'application/pdf' }), `${downloadName(project?.title ?? 'resume')}-r${proof.revision}.pdf`)
    workspace.setNotice(`Downloaded the exact proof bytes for revision ${proof.revision}${current ? '.' : foreignProof ? '. This is the retained original-project PDF, not a compiled proof of the independent copy.' : '. This PDF does not match the current source snapshot.'}`)
  }
  function downloadMainTex() {
    const main = project?.files.find((item) => item.path === project.mainFile)
    if (!main) return
    downloadBlob(new Blob([main.content], { type: 'application/x-tex;charset=utf-8' }), main.path.split('/').pop()!)
    workspace.setNotice('Main .tex downloaded as exact UTF-8 source. Style files, bibliography and photo assets are not included in a single file; use Source ZIP for the complete project.')
  }
  async function importFile(file: File, asProject: boolean) {
    setBusy(true)
    try {
      if (asProject) {
        const imported = await importProjectFile(file)
        latest.current.addProject(imported)
        const main = imported.files.find((item) => item.path === imported.mainFile)!
        setSelectedFiles((previous) => ({ ...previous, [imported.id]: main.id })); setSelectedAsset(null); setFilesOpen(true); setMobilePanel('source')
        workspace.setNotice(`Imported "${imported.title}": all ${imported.files.length + imported.assets.length} project files preserved, including ${imported.assets.length} images. Main file: ${imported.mainFile}; engine: ${engineNames[imported.engine]}. Build settings remain editable; documentation and latexmkrc are kept for editing/export only. Other projects and Regular are unchanged.`)
      }
      else {
        const id = project?.id, revision = project?.revision
        const imported = await importSupportedFile(file), latestProject = latest.current.project
        if (!latestProject || latestProject.id !== id || latestProject.revision !== revision) throw new Error('The project changed while the file was read. Nothing was added; choose the file again.')
        const next = 'content' in imported ? addTextFile(latestProject, imported.path, imported.content) : addProjectAsset(latestProject, imported)
        latest.current.applyProject(next)
        if ('content' in imported) { setSelectedFiles((previous) => ({ ...previous, [next.id]: next.files[next.files.length - 1].id })); setSelectedAsset(null); setMobilePanel('source') }
        else chooseAsset(imported.id)
        workspace.setNotice('Supported file added. Existing paths and source references were not rewritten.')
      }
    } catch (error) { workspace.setNotice(error instanceof Error ? error.message : 'Import failed. Nothing was imported.') }
    finally { setBusy(false) }
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!modal || !project) return
    setBusy(true)
    try {
      if (modal.kind === 'new') {
        const next = addTextFile(project, pathDraft, fileText); workspace.applyProject(next); chooseFile(next.files[next.files.length - 1].id)
      } else if (modal.kind === 'rename') workspace.applyProject(renameProjectFile(project, modal.fileId!, pathDraft), `Before renaming ${modal.path}`)
      else if (modal.kind === 'delete') { workspace.applyProject(deleteProjectFile(project, modal.fileId), `Before deleting ${modal.path}`); setSelectedAsset(null) }
      else if (modal.kind === 'restore') workspace.applyProject(restoreCheckpointProject(project, modal.checkpoint), `Before restoring ${modal.checkpoint.label}`)
      else if (modal.kind === 'privacy') { if (!consentChecked) return; setConsent(true); if (modal.auto) workspace.setAutoCompile(true); else workspace.compile() }
      else if (modal.kind === 'fonts') {
        if (modal.projectId !== project.id || modal.revision !== project.revision) throw new Error('Source changed while the compatibility dialog was open. Reopen it to review the latest source.')
        const files = project.files.map((item) => ({ ...item, content: applyNativeFontChoices(item.content, fontChoices) }))
        if (files.some((item, index) => item.content !== project.files[index].content)) workspace.applyProject(reviseProject(project, { files }), 'Before explicit native-font compatibility change')
        setCopyFonts({ projectId: project.id, fonts: requiredNativeFonts(files.map((item) => item.content).join('\n')) })
        workspace.setNotice('Native font choices applied only to this LaTeX source copy. Regular writing, styling and exports were not modified.')
      } else if (modal.kind === 'remove') await workspace.removeProject(modal.project.id)
      setModal(null)
    } catch (error) { workspace.setNotice(error instanceof Error ? error.message : 'The action failed. Source was kept.') }
    finally { setBusy(false) }
  }

  function resize(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current !== event.pointerId || !splitElement.current) return
    const bounds = splitElement.current.getBoundingClientRect()
    setSplit(Math.round(Math.max(30, Math.min(70, (event.clientX - bounds.left) / bounds.width * 100))))
  }
  async function locate(direction: 'forward' | 'inverse', position?: { page: number; x: number; y: number }) {
    if (!canSync || !proof || !project || !file) return
    syncRequest.current?.abort()
    const controller = new AbortController(); syncRequest.current = controller
    const revision = project.revision, projectId = project.id, proofIdentity = identity
    setSync({ identity: proofIdentity, location: null, message: 'Querying the current PDF/source map.', busy: true })
    try {
      const base = { operationKey: proof.operationKey, snapshotHash: proof.snapshotHash, pdfHash: proof.pdf.sha256 }
      const result = await syncLatexProof(direction === 'forward' ? { ...base, direction, file: file.path, line: sourceLine } : { ...base, direction, ...position! }, controller.signal)
      if (controller.signal.aborted || latest.current.project?.id !== projectId || latest.current.project.revision !== revision || latest.current.proof?.operationKey !== proof.operationKey) return
      if (!result.available || (!result.locations.length && direction === 'forward') || (direction === 'inverse' && (!result.file || !result.line))) {
        setSync({ identity: proofIdentity, location: null, message: 'A mapping is unavailable for this location, or the private sidecar expired. No position was guessed.', busy: false }); return
      }
      if (direction === 'inverse') {
        const target = project.files.find((item) => item.path === result.file)
        if (!target) throw new Error('The map references a file outside this project. Navigation was refused.')
        jumpTo(target.id, result.line!, true)
      }
      setSync({ identity: proofIdentity, location: result.locations[0] ?? null, message: 'Measured SyncTeX location. Line/box navigation is approximate, not character-level matching.', busy: false })
      if (direction === 'forward') { setJump({ id: ++jumpSequence.current, fileId: file.id, line: sourceLine, registration: true, registrationOnly: true }); setMobilePanel('proof') }
    } catch (error) {
      if (!controller.signal.aborted) setSync({ identity: proofIdentity, location: null, message: error instanceof Error ? error.message : 'Source-map navigation failed. No position was guessed.', busy: false })
    }
  }
  function toggleDrawer(view: Exclude<Drawer, 'closed'>) {
    setDismissedProblems(problemKey)
    if (small) { setDrawer(view); setMobilePanel('problems'); return }
    if (drawerOpen && drawerView === view) { setDrawer('closed'); setDismissedProblems(problemKey) } else setDrawer(view)
  }
  const refs = modal && (modal.kind === 'delete' || modal.kind === 'rename') && project && modal.path ? referencesToFile(project, modal.path) : []
  const modalTitle = !modal ? '' : modal.kind === 'new' ? 'Create a source file' : modal.kind === 'rename' ? 'Rename without rewriting source' : modal.kind === 'delete' ? 'Delete this file' : modal.kind === 'restore' ? 'Restore a checkpoint' : modal.kind === 'privacy' ? (modal.auto ? 'Enable Auto Compile' : 'Compile this source revision') : modal.kind === 'fonts' ? 'Native-font compatibility' : 'Remove a local project'

  return <div ref={root} className={`${theme.theme} ${styles.root}`} data-mobile-panel={mobilePanel} data-files-collapsed={!filesOpen} aria-busy={!workspace.ready} style={fontSize ? { '--latex-code-size': `${fontSize}px` } as CSSProperties : undefined} onClick={(event) => {
    if ((event.target as Element).closest('button[data-close-menu]')) closeMenus(true)
  }} onKeyDown={(event) => {
    if (!active || event.defaultPrevented || modal) return
    if (event.key === 'Escape' && root.current?.querySelector('details[data-latex-menu][open]')) { event.preventDefault(); closeMenus(true) }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compile() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void workspace.flushSave() }
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
        <span className={styles.saveState} data-state={workspace.saveState?.kind ?? 'restoring'} role="status" title={workspace.saveState?.kind === 'saved' ? 'Committed on this device. No cloud draft sync.' : workspace.saveState?.reason}>{saveLabel}<span className={styles.savedLocation}>{workspace.saveState?.kind === 'saved' ? 'on this device' : ''}</span></span>
      </div>
      <div className={styles.primaryActions}>
        <div className={styles.outputGroup} role="group" aria-label="Output">
          <button type="button" className={`${styles.button} ${styles.downloadAction}`} aria-label="Download PDF" title={`Download PDF${proof && !current ? ` r${proof.revision}` : ''}`} disabled={!proof} onClick={downloadPdf}><LatexIcon name="download" /></button>
          <details className={styles.exportMenu} data-latex-menu>
            <summary aria-label="Export and workspace actions"><span>Export</span><LatexIcon name="chevronDown" /></summary>
            <div className={styles.exportOptions}>
            <span className={styles.menuHeading}>Download</span>
            <button type="button" data-close-menu disabled={!proof} onClick={downloadPdf}><LatexIcon name="download" /><span>PDF proof{proof && !current ? ` r${proof.revision}` : ''}<small>{proof ? current ? 'Exact current PDF bytes' : 'Retained proof, not current source' : 'Compile a proof first'}</small></span></button>
            <button type="button" data-close-menu disabled={!project} onClick={downloadMainTex}><LatexIcon name="file" /><span>Main source (.tex)</span></button>
            <button type="button" data-close-menu disabled={!project || busy} onClick={() => void downloadSource()}><LatexIcon name="layers" /><span>Complete source ZIP<small>Sources, images and build manifest</small></span></button>
            <button type="button" data-close-menu disabled={!buildLog} onClick={() => downloadBlob(new Blob([buildLog], { type: 'text/plain;charset=utf-8' }), `${downloadName(project?.title ?? 'resume')}-r${diagnosticRevision ?? 1}.log`)}><LatexIcon name="terminal" /><span>Build log (.log)</span></button>
            <span className={styles.menuRule} />
            <button type="button" data-close-menu disabled={workspace.capabilitiesLoading} onClick={() => void checkAvailability()}><LatexIcon name="shield" /><span>Check availability</span></button>
            <button type="button" data-close-menu disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="history" /><span>Create checkpoint</span></button>
            </div>
          </details>
        </div>
        <button type="button" className={styles.primaryButton} disabled={compileDisabled} title={compileReason || 'Compile this source snapshot (Ctrl/Cmd Enter)'} onClick={compile}>{compiling ? <span className={styles.spinner} aria-hidden="true" /> : <LatexIcon name="play" />}<span>{compiling ? 'Queue latest' : 'Compile'}</span><kbd>Ctrl Enter</kbd></button>
        <button type="button" className={styles.availabilityButton} disabled={workspace.capabilitiesLoading} onClick={() => void checkAvailability()}><LatexIcon name="shield" />{workspace.capabilitiesLoading ? 'Checking...' : 'Check availability'}</button>
      </div>
    </header>
    <input ref={importInput} hidden type="file" tabIndex={-1} accept=".tex,.zip" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, true) }} />
    {availabilityToast && <div className={styles.availabilityToast} data-ready={availabilityToast.ready} role="status" aria-live="polite">
      <span className={styles.availabilityToastMark} aria-hidden="true">{availabilityToast.ready ? '✓' : '!'}</span>
      <span>{availabilityToast.message}</span>
      <button type="button" aria-label="Dismiss availability message" onClick={() => setAvailabilityToast(null)}>Close</button>
    </div>}
    <div className={styles.statusStack} aria-label="LaTeX workspace notices">
    {workspace.storageWarning && <div className={styles.warning} role="status"><p>{workspace.storageWarning}</p><div><button type="button" className={styles.textButton} disabled={busy} onClick={() => void downloadSource()}>Export latest source</button>{workspace.saveState?.kind === 'conflict' && <><button type="button" className={styles.textButton} onClick={() => act(workspace.saveAsNewProject)}>Save as new project</button><button type="button" className={styles.textButton} onClick={() => void workspace.reloadStoredProject().catch((error: unknown) => workspace.setNotice(error instanceof Error ? error.message : 'Stored source could not load.'))}>Reload with recovery copy</button></>}</div></div>}
    {copiedFontsUnverified && project && <div className={styles.compatibility}><span>Source copy: {capabilityReady ? 'one or more requested native fonts are absent from this profile.' : 'native fonts are not verified while the compiler is unavailable.'} Regular is unchanged.</span><button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'fonts', projectId: project.id, revision: project.revision, fonts: copyFonts!.fonts })}>Review source-only font choices</button></div>}
    {workspace.notice && <div className={styles.notice} role="status"><span>{workspace.notice}</span><button type="button" aria-label="Dismiss LaTeX notice" onClick={() => workspace.setNotice('')}>Close</button></div>}
    {importRequest && <div className={styles.capabilityNotice} role="status">Preparing an independent source copy and displayed JPEG sidecar. Existing projects are not replaced or uploaded.</div>}
    {workspace.attempt && <div className={styles.attempt} data-stage={workspace.attempt.stage} role="status"><span><b>{workspace.attempt.projectId === project?.id ? `r${workspace.attempt.revision}` : 'Other project'}:</b> {workspace.attempt.message}{workspace.queuedRevision !== null && ` Latest queued intent: r${workspace.queuedRevision}.`}</span>
      {['waiting', 'cancelling', 'recoverable'].includes(workspace.attempt.stage) && <button type="button" className={styles.textButton} disabled={workspace.attempt.stage === 'cancelling'} onClick={() => void workspace.cancelCompile()}>Cancel on server</button>}
      {workspace.attempt.stage === 'waiting' && <button type="button" className={styles.textButton} onClick={workspace.stopWaiting}>Stop waiting</button>}
      {workspace.attempt.stage === 'recoverable' && <button type="button" className={styles.textButton} disabled={!workspace.online} onClick={() => void workspace.recoverCompile()}>Recover operation</button>}
    </div>}
    </div>
    <div className={styles.workspace}>
      <aside id="resume-latex-file-rail" className={styles.rail} aria-label="LaTeX project files and source outline">
        <input ref={assetInput} hidden type="file" tabIndex={-1} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, false) }} />
        <section className={styles.filesWorkspace} aria-label="Project files">
          <div className={styles.railTop}>
            <div className={styles.railHeading}><h2>Project files</h2><span title={`${fileCount} of ${LATEX_LIMITS.files} files`}>{fileCount} / {LATEX_LIMITS.files}</span></div>
            <div className={styles.railActions}>
              <button type="button" className={styles.button} aria-label="New file" title="New file" disabled={!project || fileCount >= LATEX_LIMITS.files} onClick={() => openModal({ kind: 'new' }, 'section.tex')}><LatexIcon name="plus" /><span>New</span></button>
              <button type="button" className={styles.button} aria-label="Add file or image" title="Add file / image" disabled={busy || !project || fileCount >= LATEX_LIMITS.files} onClick={() => assetInput.current?.click()}><LatexIcon name="upload" /><span>Add</span></button>
            </div>
          </div>
          <div className={styles.fileEntries}>
            <ul className={styles.fileList}>{project?.files.map((item) => <li className={styles.fileRow} key={item.id}>
             <button type="button" className={styles.fileButton} aria-current={item.id === file?.id && !asset ? 'true' : undefined} title={item.path} onClick={() => chooseFile(item.id)}><LatexIcon name="file" /><code>{item.path}</code><span className={styles.fileTag} data-main={item.path === project.mainFile}>{item.path === project.mainFile ? 'Main' : item.path.split('.').pop()}</span><small>{sizeLabel(utf8Bytes(item.content))}</small></button>
            <FileActionMenu path={item.path}>
              {item.path !== project.mainFile && /\.tex$/iu.test(item.path) && <button type="button" onClick={() => { act(() => workspace.applyProject(reviseProject(project, { mainFile: item.path }))); chooseFile(item.id) }}><LatexIcon name="check" /><span>Set as main</span></button>}
              <button type="button" onClick={() => openModal({ kind: 'rename', fileId: item.id, path: item.path }, item.path)}><LatexIcon name="rename" /><span>Rename</span></button>
              <button type="button" data-destructive disabled={item.path === project.mainFile} title={item.path === project.mainFile ? 'Choose another main file before deleting this one.' : 'Delete with a recovery checkpoint'} onClick={() => openModal({ kind: 'delete', fileId: item.id, path: item.path })}><LatexIcon name="trash" /><span>Delete</span></button>
            </FileActionMenu>
          </li>)}</ul>
          {Boolean(project?.assets.length) && <><h3 className={styles.railLabel}>Local image assets</h3><ul className={styles.fileList}>{project?.assets.map((item) => <li className={styles.fileRow} key={item.id}>
             <button type="button" className={styles.fileButton} aria-current={asset?.id === item.id ? 'true' : undefined} title={item.path} onClick={() => chooseAsset(item.id)}><LatexIcon name="image" /><code>{item.path}</code><small>{sizeLabel(item.blob.size)}</small></button>
            <FileActionMenu path={item.path}>
              <button type="button" onClick={() => openModal({ kind: 'rename', fileId: item.id, path: item.path }, item.path)}><LatexIcon name="rename" /><span>Rename</span></button>
              <button type="button" data-destructive onClick={() => openModal({ kind: 'delete', fileId: item.id, path: item.path })}><LatexIcon name="trash" /><span>Delete</span></button>
            </FileActionMenu>
          </li>)}</ul></>}
          </div>
        </section>
        <div className={styles.railScroll}>
          <section className={styles.railTools} aria-label="Tools">
            <p className={styles.railToolsLabel}>Tools</p>
            <details className={styles.railSection}><summary><span>Source outline</span><small>{outline.length} {outline.length === 1 ? 'section' : 'sections'}</small></summary><p className={styles.helper}>Section commands only. Custom macros may not appear.</p><ol className={styles.outline}>{outline.map((item) => <li key={`${item.fileId}:${item.line}`} data-level={item.level}><button type="button" onClick={() => jumpTo(item.fileId, item.line)}><span>{item.title}</span><small>{item.file}:{item.line}</small></button></li>)}</ol>{!outline.length && <p className={styles.helper}>Add a section command to navigate your source here.</p>}</details>
            <details className={styles.railSection}><summary><span>Start from source</span></summary><p className={styles.helper}>Each template creates a separate project. Native output depends on a ready compiler profile.</p><div className={styles.templateShelf}>{latexSourceTemplates.map((item) => <button type="button" key={item.id} disabled={!workspace.ready || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} onClick={() => act(() => workspace.addProject(createTemplateProject(item.id)))}><b>{item.name}</b><span>{item.detail}</span><small>v{item.version} / {engineNames[item.engine]}</small></button>)}</div></details>
            <details className={styles.railSection}><summary><span>Projects and backups</span></summary><div className={styles.backupActions}><button type="button" className={styles.button} disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="plus" />Create checkpoint</button><button type="button" className={styles.textButton} onClick={() => toggleDrawer('history')}>View history</button>{onCopyRegular && <button type="button" className={styles.textButton} onClick={onCopyRegular}>Copy Regular source</button>}<button type="button" className={styles.button} disabled={busy || !workspace.ready} onClick={() => importInput.current?.click()}><LatexIcon name="upload" />Import .tex / source ZIP</button><p className={styles.helper}>Imports always create a new project. Unsupported archive entries are refused, never silently discarded. UTF-8 source is kept exactly.</p><button type="button" className={styles.textButton} disabled={!project || workspace.projects.length >= LOCAL_LATEX_LIMITS.projects} onClick={() => act(workspace.saveAsNewProject)}>Duplicate current project</button>{project && <button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'remove', project })}>Remove current project...</button>}</div></details>
          </section>
          {Boolean(workspace.protectedRecords.length) && <details className={styles.railSection}><summary>Preserved stored originals</summary><ul className={styles.protectedList}>{workspace.protectedRecords.map((record, index) => <li key={index}>{record}</li>)}</ul></details>}
        </div>
        <div ref={localPanel} className={styles.localWorkspace} data-expanded={localExpanded}>
          <h3 className={styles.localHeading}><button type="button" className={styles.localToggle} aria-expanded={localExpanded} aria-controls="resume-latex-local-details" aria-label={localExpanded ? 'Collapse local workspace' : 'Expand local workspace'} title="Local workspace" onClick={toggleLocalWorkspace}><LatexIcon name="lock" /><span id="resume-latex-local-label">Local workspace</span></button></h3>
          <div ref={localBody} id="resume-latex-local-details" className={styles.localWorkspaceBody} hidden={!localExpanded} role="region" aria-labelledby="resume-latex-local-label">
            <div className={styles.sourceBudget}><span>Project source</span><span>{sizeLabel(contentSize.source)} / 1 MiB</span></div>
            <meter className={styles.sourceMeter} min={0} max={LATEX_LIMITS.sourceBytes} value={contentSize.source} aria-label="Current project source byte budget" />
            <dl className={styles.localLimits}><div><dt>Projects</dt><dd>{workspace.projects.length}<span> / {LOCAL_LATEX_LIMITS.projects}</span></dd></div><div><dt>Checkpoints</dt><dd>{projectCheckpoints.length}<span> / {LOCAL_LATEX_LIMITS.checkpointsPerProject}</span></dd></div><div><dt>Files</dt><dd>{fileCount}<span> / {LATEX_LIMITS.files}</span></dd></div></dl>
            <p className={styles.railFoot}>Drafts stay on this device. No cloud draft sync.<br />32 MiB local storage budget, including checkpoints and proofs.{contentSize.assets > 0 && ` This project's images: ${sizeLabel(contentSize.assets)}.`}</p>
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
            {project && file ? <CodeMirrorSource projectId={project.id} file={file} active={active && !asset && (!small || mobilePanel === 'source')} wrap={wrap} tabSize={tabSize} revision={project.revision} toolbarActions={<div className={styles.sourcePaneActions}>
              <button type="button" className={styles.sourceLineChip} aria-label={`Show line ${sourceLine} in proof`} disabled={projectTextOnly || !canSync || Boolean(sync?.busy && sync.identity === identity)} title={projectTextOnly ? 'Documentation and configuration are not typeset.' : !canSync ? 'Compile a current proof with an available source map to navigate.' : `Locate line ${sourceLine} using the current SyncTeX map`} onClick={() => void locate('forward')}><LatexIcon name="target" /><span>Line {sourceLine}</span></button>
              <details className={styles.sourceSettings} data-latex-menu>
                <summary aria-label="Editor settings" title="Editor settings"><LatexIcon name="settings" /><span className={styles.srOnly}>Settings</span></summary>
                <div className={styles.sourceSettingsMenu}>
                  <span className={styles.menuHeading}>Source editor</span>
                  <label>Font size<select aria-label="Source font size" value={fontSize ?? 'auto'} onChange={(event) => setFontSize(event.target.value === 'auto' ? null : Number(event.target.value))}><option value="auto">Auto ({small ? 16 : 14} px)</option>{[12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size} px</option>)}</select></label>
                  <label>Tab size<select aria-label="Source tab size" value={tabSize} onChange={(event) => setTabSize(Number(event.target.value) as 2 | 4)}><option value={2}>2 spaces</option><option value={4}>4 spaces</option></select></label>
                  <label className={styles.checkControl}><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />Wrap source lines</label>
                  <span className={styles.menuHeading}>Compilation</span>
                  <label>Main file<select aria-label="Select main LaTeX file" value={project?.mainFile ?? ''} disabled={!project} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { mainFile: event.target.value }))) }}>{project?.files.filter((item) => /\.tex$/iu.test(item.path)).map((item) => <option key={item.id} value={item.path}>{item.path}</option>)}</select></label>
                  <label>Engine <select aria-label="LaTeX compiler engine" value={project?.engine ?? 'lualatex'} disabled={!project} onChange={(event) => { const engine = event.target.value as keyof typeof engineNames; if (project && Object.hasOwn(engineNames, engine)) act(() => workspace.applyProject(reviseProject(project, { engine }))) }}>
                    {Object.entries(engineNames).map(([id, name]) => <option key={id} value={id}>{name}{workspace.capabilities.profiles.some((profile) => profile.id === id) ? '' : ' (not available)'}</option>)}
                  </select></label>
                  <label className={styles.checkControl}><input type="checkbox" checked={workspace.autoCompile} disabled={!capabilityReady} onChange={(event) => event.target.checked ? (consent ? workspace.setAutoCompile(true) : openModal({ kind: 'privacy', auto: true })) : workspace.setAutoCompile(false)} />Auto Compile</label>
                  <p className={styles.helper}>Auto Compile is opt-in. Manual compilation never uploads while you type.</p>
                </div>
              </details>
            </div>} jump={jump} registrationActive={Boolean(canSync && sync?.identity === identity && !sync.busy && sync.location)} diagnostics={diagnosticsCurrent ? diagnostics : emptyDiagnostics} validateChange={workspace.validateTextChange} onChange={workspace.changeText} onCursor={(_id, line) => setSourceLine(line)} onCompile={compile} onNotice={workspace.setNotice} /> : <p className={styles.loading}>Restoring local source before any write-back.</p>}
            </div>
          </div>
        </section>
        <div className={styles.separator} role="separator" aria-orientation="vertical" aria-label="Resize source and proof panes" aria-valuemin={30} aria-valuemax={70} aria-valuenow={split} aria-valuetext={`${split}% source width`} aria-controls="resume-latex-source-pane resume-latex-proof-pane" tabIndex={0} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setSplit(event.key === 'Home' ? 30 : event.key === 'End' ? 70 : Math.max(30, Math.min(70, split + (event.key === 'ArrowRight' ? 2 : -2)))) }
        }} onPointerDown={(event) => { if (event.button === 0) { drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); resize(event) } }} onPointerMove={resize} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = null }}><span /></div>
        <section id="resume-latex-proof-pane" className={styles.proofPane} aria-label="Exact compiled PDF proof">
          {proof && !current && <p className={styles.staleNotice}>{foreignProof ? 'This is the original-project PDF retained with the independent recovery copy for this session.' : sameRevisionMismatch ? `Another tab supplied different source at r${project?.revision}. This PDF belongs to the captured compile snapshot, not that source.` : `Source is r${project?.revision}; this last good PDF was compiled from r${proof.revision}.`} Its source maps are disabled.</p>}
          <LatexPdfPreview proof={proof} current={current} active={active && (!small || mobilePanel === 'proof')} location={current && sync?.identity === identity ? sync.location : null} onPosition={canSync ? (position) => void locate('inverse', position) : undefined} onCompile={compile} compileDisabled={compileDisabled || compiling} compileReason={compileReason} />
          <div className={styles.syncStatus} data-available={canSync} role="status"><LatexIcon name={canSync ? 'target' : 'alert'} /><span>{current && sync?.identity === identity ? sync.message : canSync ? 'SyncTeX available for this current proof. Double-click a PDF point or use Show line in proof.' : proof?.syncAvailable && !current ? 'Source-map navigation is disabled for a non-current proof.' : !workspace.online ? 'Source-map queries are unavailable offline.' : 'No current PDF/source map is available. Positions are never guessed.'}</span></div>
        </section>
      </div>
    </div>
    <section className={styles.problemsDrawer} data-open={drawerOpen} aria-label="Build panel">
      <div className={styles.drawerBar}>
        <div className={styles.localDock}>
          <button type="button" className={styles.localDockToggle} aria-expanded={localExpanded} aria-controls="resume-latex-local-details" aria-label={localExpanded ? 'Collapse local workspace' : 'Expand local workspace'} aria-describedby="resume-latex-local-hint" onClick={toggleLocalWorkspace}><LatexIcon name="chevronUp" className={styles.localChevron} /></button>
          <span id="resume-latex-local-hint" className={styles.localDockHint} role="tooltip">Local workspace</span>
        </div>
        <div className={styles.buildTabs} role="group" aria-label="Build details">
          {(['build', 'problems', 'log', 'history'] as const).map((view) => <button key={view} id={`resume-latex-build-tab-${view}`} type="button" aria-pressed={drawerOpen && drawerView === view} aria-expanded={drawerOpen && drawerView === view} aria-controls="resume-latex-problems-content" onClick={() => toggleDrawer(view)}><LatexIcon name={view === 'build' ? 'layers' : view === 'problems' ? 'alert' : view === 'log' ? 'terminal' : 'history'} />{view === 'build' ? 'Build' : view === 'problems' ? <>Problems <span className={styles.problemCount} data-has-issues={usefulProblems}>{diagnostics.length}</span></> : view === 'log' ? 'Log' : <>History <span className={styles.problemCount}>{projectCheckpoints.length}</span></>}</button>)}
        </div>
        <span className={styles.drawerSummary}><span className={styles.connectionDot} data-online={workspace.online} />{workspace.autoCompile ? 'Auto Compile on' : 'Manual compile'} <i aria-hidden="true" /> {workspace.online ? 'Local drafts' : 'Offline editing'}</span>
        <button type="button" className={styles.iconButton} aria-label={drawerOpen ? 'Collapse build panel' : 'Expand build panel'} aria-expanded={drawerOpen} aria-controls="resume-latex-problems-content" onClick={() => { if (drawerOpen) { setDrawer('closed'); setDismissedProblems(problemKey); if (small) setMobilePanel('source') } else setDrawer('build') }}><LatexIcon name={drawerOpen ? 'chevronDown' : 'chevronUp'} /></button>
      </div>
      {drawerOpen && <div className={styles.drawerContent} id="resume-latex-problems-content" role="region" aria-label={`${drawerView === 'build' ? 'Build' : drawerView === 'problems' ? 'Problems' : drawerView === 'log' ? 'Compile log' : 'Project history'} details`} tabIndex={0}>
        {drawerView === 'build' && <>
          <div className={styles.buildOverview}>
            <div className={styles.buildFact}><LatexIcon name="file" /><div><span>Source snapshot</span><b>{project ? `${project.mainFile} / r${project.revision}` : 'Restoring source'}</b><small>{project ? `${fileCount} files / ${sizeLabel(contentSize.source + contentSize.assets)}` : 'No source has been uploaded.'}</small></div></div>
            <div className={styles.buildFact} data-state={currentAttempt?.stage ?? 'idle'}>{currentAttempt && ['waiting', 'recovering', 'cancelling'].includes(currentAttempt.stage) ? <span className={styles.spinner} aria-hidden="true" /> : <LatexIcon name={currentAttempt?.stage === 'failed' || currentAttempt?.stage === 'recoverable' ? 'alert' : 'shield'} />}<div><span>Private compiler</span><b>{currentAttempt ? `${engineNames[currentAttempt.snapshot.engine]} / ${currentAttempt.stage}` : !workspace.online ? 'Offline' : capabilityReady ? `${engineNames[project?.engine ?? 'lualatex']} / available` : 'Not available'}</b><small>{currentAttempt ? `Captured revision ${currentAttempt.revision}` : 'Only an explicit compile sends source.'}</small></div></div>
            <div className={styles.buildFact}><LatexIcon name={proof && current ? 'check' : 'file'} /><div><span>PDF proof</span><b>{proof ? `r${proof.revision} / ${current ? 'current' : 'not current'}` : 'Not compiled'}</b><small>{proof ? `${proof.pdf.pages} ${proof.pdf.pages === 1 ? 'page' : 'pages'} / ${sizeLabel(proof.pdf.bytes)} / exact bytes` : 'No preview or progress is fabricated.'}</small></div></div>
          </div>
          <div className={styles.buildStatus}><p>{currentAttempt?.message ?? (compileReason || 'Ready for a manual compile. Your source remains local until you choose Compile.')}{workspace.queuedRevision !== null && ` Latest queued intent: r${workspace.queuedRevision}.`}</p><button type="button" className={styles.button} disabled={workspace.capabilitiesLoading} onClick={() => void checkAvailability()}><LatexIcon name="shield" />Check availability</button></div>
          {workspace.capabilities.profiles.length > 0 && <details className={styles.compilerInventory}><summary>Reported native fonts and packages</summary><p className={styles.helper}>Availability reported by the private compiler, not inferred from your source. Custom project files are kept separately.</p>{workspace.capabilities.profiles.map((profile) => <div key={profile.id}><b>{profile.name}</b><small>{profile.version}</small><p><strong>Fonts:</strong> {profile.fonts.join(', ') || 'None reported'}</p><p><strong>Packages:</strong> {profile.packages.join(', ') || 'None reported'}</p></div>)}</details>}
        </>}
        {drawerView === 'problems' && <><p className={styles.helper}>{diagnosticRevision ? `Reported for r${diagnosticRevision}${!diagnosticsCurrent ? '. Current source is a different snapshot; lines may differ.' : '.'}` : 'Compile diagnostics appear here. No checks have been fabricated.'}</p>{diagnostics.length ? <ul className={styles.diagnostics}>{diagnostics.map((item, index) => <li key={index} data-severity={item.severity}><b>{item.severity}</b><div><p>{item.message}</p>{item.help && <p className={styles.helper}>{item.help}</p>}{item.file && <button type="button" className={styles.textButton} disabled={!project?.files.some((source) => source.path === item.file)} onClick={() => { const target = project?.files.find((source) => source.path === item.file); if (target) jumpTo(target.id, item.line ?? 1) }}>{item.file}{item.line ? `:${item.line}` : ''}</button>}{item.code && <code className={styles.diagnosticCode}>{item.code}</code>}</div></li>)}</ul> : <p>No diagnostics reported for this view.</p>}</>}
        {drawerView === 'log' && <><p className={styles.helper}>Private, bounded compile log. Source/log excerpts are not sent to analytics. Server results expire; an acknowledged local proof retains its log on this device.</p><pre className={styles.log}>{buildLog || 'No compile log is available.'}</pre>{currentAttempt?.requestId && <p className={styles.helper}>Request ID: <code>{currentAttempt.requestId}</code></p>}</>}
        {drawerView === 'history' && <><div className={styles.historyHeading}><div><h3>Checkpoints</h3><p className={styles.helper}>{projectCheckpoints.length} / {LOCAL_LATEX_LIMITS.checkpointsPerProject} for this project. The most recent six are kept.</p></div><button type="button" className={styles.button} disabled={!project} onClick={() => void workspace.checkpointNow()}><LatexIcon name="plus" />Create checkpoint</button></div><p className={styles.helper}>Restore creates a new revision and a recovery checkpoint first. Only committed transactions survive a reload.</p><ul className={styles.history}>{projectCheckpoints.map((item) => <li key={item.id}><LatexIcon name="history" /><div><b>{item.label}</b><small>r{item.project.revision} / {new Date(item.createdAt).toLocaleString()}</small></div><button type="button" className={styles.button} onClick={() => openModal({ kind: 'restore', checkpoint: item })}>Restore...</button><button type="button" className={styles.textButton} disabled={busy} onClick={() => void downloadSource(item.project, false)}><LatexIcon name="download" />ZIP</button></li>)}</ul>{!projectCheckpoints.length && <p>No local checkpoints yet. Create one before an important source change.</p>}</>}
      </div>}
    </section>
    <nav className={styles.mobileNav} aria-label="LaTeX workspace views">{(['files', 'source', 'proof', 'problems'] as const).map((panel) => <button type="button" key={panel} aria-current={mobilePanel === panel ? 'page' : undefined} onClick={() => { setMobilePanel(panel); if (panel === 'problems') setDrawer(usefulProblems ? 'problems' : 'build') }}><LatexIcon name={panel === 'files' ? 'files' : panel === 'source' ? 'file' : panel === 'proof' ? 'layers' : 'terminal'} />{panel === 'files' ? 'Files' : panel === 'source' ? 'Source' : panel === 'proof' ? 'Proof' : 'Build'}{panel === 'problems' && usefulProblems && <span className={styles.mobileIssueDot} aria-label="Build has issues" />}</button>)}</nav>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="resume-latex-dialog-title" onCancel={() => setModal(null)}><form onSubmit={(event) => void submitModal(event)}><div className={styles.dialogHeading}><h2 id="resume-latex-dialog-title">{modalTitle}</h2><button type="button" aria-label="Close LaTeX dialog" disabled={busy} onClick={() => setModal(null)}>Close</button></div>
      {modal && (modal.kind === 'new' || modal.kind === 'rename') && <><label className={styles.field}>Relative filename<input autoFocus value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} required maxLength={240} spellCheck={false} /></label><p className={styles.helper}>.tex, .sty, .cls, .bib, .bst, .md, .txt or latexmkrc. Documentation/configuration are editable and exportable, not executed. Image renames keep their PNG/JPEG format. Use NFC letters, numbers, hyphens, underscores and relative folders; no spaces or traversal paths.</p>{modal.kind === 'new' && <label className={styles.field}>Initial raw source<textarea value={fileText} onChange={(event) => setFileText(event.target.value)} rows={8} spellCheck={false} /></label>}</>}
      {modal && (modal.kind === 'rename' || modal.kind === 'delete') && <div className={styles.dialogWarning}><p>{modal.kind === 'delete' ? `Delete ${modal.path}?` : `Rename ${modal.path}?`} A recoverable checkpoint is recorded with the change. Source references will not be rewritten automatically.</p>{refs.length ? <ul>{refs.map((reference) => <li key={`${reference.file}:${reference.line}`}>{reference.file}:{reference.line} references this path.</li>)}</ul> : <p>No literal references were found. Macro-generated references may still exist.</p>}</div>}
      {modal?.kind === 'restore' && <p className={styles.dialogWarning}>Restore {modal.checkpoint.label} (r{modal.checkpoint.project.revision}) as a new source revision. Current source is checkpointed first; the last good PDF remains labeled with its own revision.</p>}
      {modal?.kind === 'privacy' && <><p>Compile sends this project&apos;s LaTeX source and image assets to our private compiler. It is not cloud draft storage. Uploaded source/assets and scratch are removed at terminal completion or forced cleanup; private server PDF/log/map results expire within 15 minutes.</p><p className={styles.helper}>Guest compilation is free but bounded by fair-use limits. No AI, account login or new credit charge is added. A compiled PDF is retained locally only when device storage commits it.</p>{modal.auto && <p>Auto Compile is explicit opt-in for this session. It waits 1.8 seconds after source edits, runs only while this workspace is active and online, and coalesces the latest intent. Opening projects, restoring and saving do not start compilation.</p>}<label className={styles.consent}><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} required />I understand that source and image assets are uploaded when I compile.</label></>}
      {modal?.kind === 'fonts' && <><p>These explicit choices change literal font declarations only in the LaTeX source copy. Regular writing and export bytes stay untouched. Engine/package compatibility and final shaping still require a real compile.</p>{!capabilityReady && <p className={styles.dialogWarning}>Compiler readiness is unavailable. Suggestions below are source-only compatibility choices, not a claim that a native font is installed.</p>}{modal.fonts.map((font) => {
        const bengali = /Bengali|Bangla|Hind Siliguri|Kalpurush|Solaiman|Nikosh/iu.test(font)
        const choices = [...new Set([font, ...(nativeFonts.length ? nativeFonts.filter((name) => !bengali || /Bengali|Bangla|Hind Siliguri|Kalpurush|Solaiman|Nikosh/iu.test(name)) : [bengali ? 'Noto Sans Bengali' : 'Latin Modern Roman'])])]
        return <label className={styles.field} key={font}>Requested: {font}<select value={fontChoices[font] ?? font} onChange={(event) => setFontChoices((previous) => ({ ...previous, [font]: event.target.value }))}>{choices.map((name) => <option key={name} value={name}>{name}{name === font ? ' (keep exact source)' : ''}</option>)}</select></label>
      })}{!modal.fonts.length && <p>No literal fontspec font names were detected. Custom macro-defined fonts must be reviewed in source.</p>}</>}
      {modal?.kind === 'remove' && <><p className={styles.dialogWarning}>Explicitly remove {modal.project.title || 'this project'} and its supported local checkpoints/assets/proof. This does not affect Regular or other projects. Invalid/future records are preserved. Export a Source ZIP first if you need a portable recovery copy.</p><button type="button" className={styles.button} disabled={busy} onClick={() => void downloadSource(modal.project, false)}>Download this project&apos;s ZIP</button></>}
      <div className={styles.dialogActions}><button type="button" className={styles.button} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy || (modal?.kind === 'privacy' && !consentChecked)}>{busy ? 'Working locally...' : modal?.kind === 'privacy' ? modal.auto ? 'Enable Auto Compile' : 'Compile this revision' : modal?.kind === 'delete' ? 'Delete with checkpoint' : modal?.kind === 'restore' ? 'Restore as new revision' : modal?.kind === 'remove' ? 'Remove project' : modal?.kind === 'fonts' ? 'Apply to LaTeX source only' : 'Apply'}</button></div>
    </form></dialog>
  </div>
}
