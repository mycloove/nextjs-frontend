'use client'

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import theme from '../components/MrResumeTheme.module.css'
import styles from './LatexResumeStudio.module.css'
import CodeMirrorSource, { type SourceJump } from './CodeMirrorSource'
import LatexPdfPreview from './LatexPdfPreview'
import useLatexWorkspace from './useLatexWorkspace'
import { addProjectAsset, addTextFile, applyNativeFontChoices, deleteProjectFile, downloadName, projectSize, referencesToFile, renameProjectFile,
  requiredNativeFonts, restoreCheckpointProject, reviseProject, sameProjectSource, sourceOutline } from './project.ts'
import { createTemplateProject, latexSourceTemplates } from './templates.ts'
import { createRegularLatexProject, downloadBlob, exportProjectFile, importProjectFile, importSupportedFile } from './projectImport'
import { syncLatexProof } from './compileTransport'
import type { LatexCheckpoint, LatexDiagnostic, LatexImportRequest, LatexPdfLocation, LatexProject } from './types'

export type LatexResumeStudioProps = { active: boolean; importRequest?: LatexImportRequest | null; onImportHandled?: (id: string) => void; onCopyRegular?: () => void }
type Panel = 'files' | 'source' | 'proof' | 'problems'
type Drawer = 'closed' | 'problems' | 'log' | 'history'
type Modal = { kind: 'new' | 'rename'; fileId?: string; path?: string } | { kind: 'delete'; fileId: string; path: string }
  | { kind: 'restore'; checkpoint: LatexCheckpoint } | { kind: 'privacy'; auto: boolean } | { kind: 'fonts'; projectId: string; revision: number; fonts: string[] }
  | { kind: 'remove'; project: LatexProject }
const emptyDiagnostics: LatexDiagnostic[] = []
const smallSnapshot = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const subscribeSmall = (notify: () => void) => { const query = window.matchMedia('(max-width: 900px)'); query.addEventListener('change', notify); return () => query.removeEventListener('change', notify) }
const engineNames = { lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX' } as const
function sizeLabel(bytes: number) { return `${Math.ceil(bytes / 1024)} KiB` }

export default function LatexResumeStudio({ active, importRequest = null, onImportHandled, onCopyRegular }: LatexResumeStudioProps) {
  const workspace = useLatexWorkspace(active)
  const small = useSyncExternalStore(subscribeSmall, smallSnapshot, () => false)
  const [mobilePanel, setMobilePanel] = useState<Panel>('source'), [wrap, setWrap] = useState(true), [split, setSplit] = useState(50)
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({}), [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [jump, setJump] = useState<SourceJump | null>(null), [sourceLine, setSourceLine] = useState(1)
  const [drawer, setDrawer] = useState<Drawer>('closed'), [dismissedProblems, setDismissedProblems] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal | null>(null), [pathDraft, setPathDraft] = useState(''), [fileText, setFileText] = useState(''), [fontChoices, setFontChoices] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false), [consentChecked, setConsentChecked] = useState(false), [busy, setBusy] = useState(false)
  const [copyFonts, setCopyFonts] = useState<{ projectId: string; fonts: string[] } | null>(null)
  const [availabilityToast, setAvailabilityToast] = useState<{ message: string; ready: boolean } | null>(null)
  const [sync, setSync] = useState<{ identity: string; location: LatexPdfLocation | null; message: string; busy: boolean } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), splitElement = useRef<HTMLDivElement>(null), drag = useRef<number | null>(null)
  const importInput = useRef<HTMLInputElement>(null), assetInput = useRef<HTMLInputElement>(null), sourceTabs = useRef<(HTMLButtonElement | null)[]>([])
  const handledImports = useRef(new Set<string>()), jumpSequence = useRef(0), syncRequest = useRef<AbortController | null>(null)
  const latest = useRef(workspace), callbacks = useRef({ onImportHandled })
  useLayoutEffect(() => { latest.current = workspace; callbacks.current = { onImportHandled } }, [workspace, onImportHandled])
  const alive = useRef(true)
  const project = workspace.project
  const file = project?.files.find((item) => item.id === selectedFiles[project.id]) ?? project?.files.find((item) => item.path === project.mainFile) ?? project?.files[0]
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
  const drawerOpen = drawer !== 'closed' || (usefulProblems && dismissedProblems !== problemKey) || (small && mobilePanel === 'problems')
  const drawerView = drawer === 'closed' ? 'problems' : drawer
  const canSync = Boolean(current && proof?.syncAvailable && workspace.online && active)
  const capabilityReady = workspace.capabilities.enabled && workspace.capabilities.ready
  const compiling = Boolean(workspace.attempt && ['waiting', 'cancelling', 'recovering'].includes(workspace.attempt.stage))
  const saveLabel = !workspace.ready ? 'Restoring local project' : workspace.saveState?.kind === 'saved' ? `Saved r${workspace.saveState.revision}`
    : workspace.saveState?.kind === 'saving' ? 'Saving transaction' : workspace.saveState?.kind === 'conflict' ? 'Another tab saved' : workspace.saveState?.kind === 'session' ? 'Session only' : 'Unsaved changes'
  const nativeFonts = workspace.capabilities.profiles.find((profile) => profile.id === project?.engine)?.fonts ?? []
  const copiedFontsUnverified = Boolean(copyFonts && project && copyFonts.projectId === project.id && (!capabilityReady || copyFonts.fonts.some((font) => !nativeFonts.includes(font))))

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
  useEffect(() => { const element = dialog.current; alive.current = true; return () => { alive.current = false; syncRequest.current?.abort(); element?.close() } }, [])

  function act(action: () => void) { try { action() } catch (error) { workspace.setNotice(error instanceof Error ? error.message : 'The project action could not be applied.') } }
  function chooseFile(id: string) {
    if (!project) return
    setSelectedFiles((previous) => ({ ...previous, [project.id]: id })); setSelectedAsset(null); setMobilePanel('source')
  }
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
      if (asProject) { const imported = await importProjectFile(file); latest.current.addProject(imported); workspace.setNotice('Imported as a new independent project. Other projects and the Regular draft are unchanged.') }
      else {
        const id = project?.id, revision = project?.revision
        const imported = await importSupportedFile(file), latestProject = latest.current.project
        if (!latestProject || latestProject.id !== id || latestProject.revision !== revision) throw new Error('The project changed while the file was read. Nothing was added; choose the file again.')
        const next = 'content' in imported ? addTextFile(latestProject, imported.path, imported.content) : addProjectAsset(latestProject, imported)
        latest.current.applyProject(next)
        if ('content' in imported) setSelectedFiles((previous) => ({ ...previous, [next.id]: next.files[next.files.length - 1].id }))
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
    if (drawerOpen && drawerView === view) { setDrawer('closed'); setDismissedProblems(problemKey) } else setDrawer(view)
    if (small) setMobilePanel('problems')
  }
  const activeFileItem = selectedAsset ? project?.assets.find((item) => item.id === selectedAsset) : file
  const refs = modal && (modal.kind === 'delete' || modal.kind === 'rename') && project && modal.path ? referencesToFile(project, modal.path) : []
  const modalTitle = !modal ? '' : modal.kind === 'new' ? 'Create a source file' : modal.kind === 'rename' ? 'Rename without rewriting source' : modal.kind === 'delete' ? 'Delete this file' : modal.kind === 'restore' ? 'Restore a checkpoint' : modal.kind === 'privacy' ? (modal.auto ? 'Enable Auto Compile' : 'Compile this source revision') : modal.kind === 'fonts' ? 'Native-font compatibility' : 'Remove a local project'

  return <div className={`${theme.theme} ${styles.root}`} data-mobile-panel={mobilePanel} aria-busy={!workspace.ready}>
    <header className={styles.identity}>
      <h1 className={styles.srOnly}>Resume typesetting editor</h1>
      <div className={styles.projectIdentity}>
        <label className={styles.srOnly} htmlFor="resume-latex-title">LaTeX project title</label>
        <input id="resume-latex-title" aria-label="LaTeX project title" value={project?.title ?? ''} placeholder="Restoring project..." disabled={!project} maxLength={200} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { title: event.target.value }))) }} />
        <span className={styles.saveState} data-state={workspace.saveState?.kind ?? 'restoring'} role="status">{saveLabel}</span>
      </div>
      <div className={styles.primaryActions}>
        <button type="button" className={styles.primaryButton} disabled={!project || !capabilityReady || !workspace.online || !active} onClick={compile}>{compiling ? 'Queue latest compile' : 'Compile'}<kbd>Ctrl Enter</kbd></button>
        {!capabilityReady && <button type="button" className={styles.availabilityButton} disabled={workspace.capabilitiesLoading} onClick={() => void checkAvailability()}>Check availability</button>}
        <button type="button" className={styles.button} disabled={!proof} onClick={downloadPdf}>Download PDF{proof && !current ? ` r${proof.revision}` : ''}</button>
        <details className={styles.exportMenu}>
          <summary aria-label="More export options">Export <span aria-hidden="true">⌄</span></summary>
          <div className={styles.exportOptions}>
            <button type="button" disabled={!project} onClick={downloadMainTex}>Main source (.tex)</button>
            <button type="button" disabled={!project || busy} onClick={() => void downloadSource()}>Complete source ZIP</button>
          </div>
        </details>
      </div>
    </header>
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
      <aside className={styles.rail} aria-label="LaTeX project files and source outline">
        <div className={styles.railHeading}><h2>Project files</h2><span>{project ? project.files.length + project.assets.length : 0} / 32</span></div>
        <div className={styles.projectControls}>
          <label><span>Project</span><select aria-label="Select LaTeX project" value={project?.id ?? ''} disabled={!workspace.ready} onChange={(event) => { workspace.selectProject(event.target.value); setSelectedAsset(null) }}>{workspace.projects.map((item) => <option key={item.id} value={item.id}>{item.title || 'Untitled project'}</option>)}</select></label>
          <label><span>Main file</span><select aria-label="Select main LaTeX file" value={project?.mainFile ?? ''} disabled={!project} onChange={(event) => { if (project) act(() => workspace.applyProject(reviseProject(project, { mainFile: event.target.value }))) }}>{project?.files.filter((item) => /\.tex$/iu.test(item.path)).map((item) => <option key={item.id} value={item.path}>{item.path}</option>)}</select></label>
        </div>
        <div className={styles.railActions}><button type="button" className={styles.button} disabled={!project} onClick={() => openModal({ kind: 'new' }, 'section.tex')}>New file</button><button type="button" className={styles.button} disabled={busy || !project} onClick={() => assetInput.current?.click()}>Add file / image</button></div>
        <input ref={assetInput} className={styles.srOnly} type="file" accept=".tex,.sty,.cls,.bib,.bst,.png,.jpg,.jpeg" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, false) }} />
        <div className={styles.railScroll}>
          <ul className={styles.fileList}>{project?.files.map((item) => <li key={item.id}><button type="button" className={styles.fileButton} aria-current={item.id === file?.id && !selectedAsset ? 'true' : undefined} onClick={() => chooseFile(item.id)}><code>{item.path}</code><small>{item.path === project.mainFile ? 'Main' : item.path.split('.').pop()}</small></button></li>)}</ul>
          {Boolean(project?.assets.length) && <><h3 className={styles.railLabel}>Local image assets</h3><ul className={styles.fileList}>{project?.assets.map((item) => <li key={item.id}><button type="button" className={styles.fileButton} aria-current={selectedAsset === item.id ? 'true' : undefined} onClick={() => setSelectedAsset(item.id)}><code>{item.path}</code><small>{sizeLabel(item.blob.size)}</small></button></li>)}</ul></>}
          {activeFileItem && <div className={styles.fileActions}><button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'rename', fileId: activeFileItem.id, path: activeFileItem.path }, activeFileItem.path)}>Rename</button><button type="button" className={styles.textButton} disabled={activeFileItem.path === project?.mainFile} onClick={() => openModal({ kind: 'delete', fileId: activeFileItem.id, path: activeFileItem.path })}>Delete</button></div>}
          <details className={styles.railSection} open><summary>Source outline <small>Best effort</small></summary><p className={styles.helper}>Section commands only. Custom macros may not appear.</p><ol className={styles.outline}>{project && sourceOutline(project.files).map((item) => <li key={`${item.fileId}:${item.line}`} data-level={item.level}><button type="button" onClick={() => jumpTo(item.fileId, item.line)}><span>{item.title}</span><small>{item.file}:{item.line}</small></button></li>)}</ol></details>
          <details className={styles.railSection}><summary>Start from source</summary><p className={styles.helper}>Each template creates a separate project. Native output depends on a ready compiler profile.</p><div className={styles.templateShelf}>{latexSourceTemplates.map((item) => <button type="button" key={item.id} onClick={() => act(() => workspace.addProject(createTemplateProject(item.id)))}><b>{item.name}</b><span>{item.detail}</span><small>v{item.version} / {engineNames[item.engine]}</small></button>)}</div></details>
          <details className={styles.railSection}><summary>Projects and backups</summary><button type="button" className={styles.button} disabled={!project} onClick={() => void workspace.checkpointNow()}>Create checkpoint</button><button type="button" className={styles.textButton} onClick={() => toggleDrawer('history')}>View history</button>{onCopyRegular && <button type="button" className={styles.textButton} onClick={onCopyRegular}>Copy Regular source</button>}<button type="button" className={styles.button} disabled={busy} onClick={() => importInput.current?.click()}>Import .tex / source ZIP</button><input ref={importInput} className={styles.srOnly} type="file" accept=".tex,.zip" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void importFile(selected, true) }} /><p className={styles.helper}>Imports always create a new project. Unsupported archive entries are refused, never silently discarded. UTF-8 source is kept exactly.</p><button type="button" className={styles.textButton} onClick={() => act(workspace.saveAsNewProject)}>Duplicate current project</button>{project && <button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'remove', project })}>Remove current project...</button>}</details>
          {Boolean(workspace.protectedRecords.length) && <details className={styles.railSection}><summary>Preserved stored originals</summary><ul className={styles.protectedList}>{workspace.protectedRecords.map((record, index) => <li key={index}>{record}</li>)}</ul></details>}
        </div>
        <p className={styles.railFoot}>{project ? `${sizeLabel(projectSize(project).source)} source; ${sizeLabel(projectSize(project).assets)} images.` : 'Restoring local source.'} Eight projects, six checkpoints per project, 32 MiB local content budget. No cloud draft sync.</p>
      </aside>
      <div ref={splitElement} className={styles.split} style={{ '--latex-source-width': `${split}%` } as CSSProperties}>
        <section id="resume-latex-source-pane" className={styles.sourcePane} aria-label="LaTeX source">
          <div className={styles.fileTabs} role="tablist" aria-label="Source files">{project?.files.map((item, index) => <button ref={(node) => { sourceTabs.current[index] = node }} type="button" role="tab" id={`resume-latex-file-${item.id}`} aria-selected={file?.id === item.id} aria-controls="resume-latex-editor-panel" tabIndex={file?.id === item.id ? 0 : -1} key={item.id} onClick={() => chooseFile(item.id)} onKeyDown={(event) => {
            const count = project.files.length
            const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
            if (next !== null) { event.preventDefault(); sourceTabs.current[next]?.focus() }
          }}><code>{item.path}</code>{item.path === project.mainFile && <small>Main</small>}</button>)}</div>
          <div className={styles.paneHeading}>
            <span>Editable source{project && <small>r{project.revision}</small>}</span>
            <div className={styles.sourcePaneActions}>
              <button type="button" className={styles.textButton} disabled={!canSync || Boolean(sync?.busy && sync.identity === identity)} onClick={() => void locate('forward')}>Show line {sourceLine} in proof</button>
              <details className={styles.sourceSettings}>
                <summary>Settings</summary>
                <div className={styles.sourceSettingsMenu}>
                  <label>Engine <select value={project?.engine ?? 'lualatex'} disabled={!project || !capabilityReady} onChange={(event) => { const selected = workspace.capabilities.profiles.find((profile) => profile.id === event.target.value); if (project && selected) act(() => workspace.applyProject(reviseProject(project, { engine: selected.id }))) }}>
                    {project && !workspace.capabilities.profiles.some((profile) => profile.id === project.engine) && <option value={project.engine}>{engineNames[project.engine]} (not ready)</option>}
                    {workspace.capabilities.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
                  <label className={styles.checkControl}><input type="checkbox" checked={workspace.autoCompile} disabled={!capabilityReady} onChange={(event) => event.target.checked ? (consent ? workspace.setAutoCompile(true) : openModal({ kind: 'privacy', auto: true })) : workspace.setAutoCompile(false)} />Auto Compile</label>
                  <label className={styles.checkControl}><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />Wrap source lines</label>
                </div>
              </details>
            </div>
          </div>
          <div className={styles.editorPanel} id="resume-latex-editor-panel" role="tabpanel" aria-labelledby={file ? `resume-latex-file-${file.id}` : undefined}>{project && file ? <CodeMirrorSource projectId={project.id} file={file} active={active && (!small || mobilePanel === 'source')} wrap={wrap} jump={jump} registrationActive={Boolean(canSync && sync?.identity === identity && !sync.busy && sync.location)} diagnostics={diagnosticsCurrent ? diagnostics : emptyDiagnostics} validateChange={workspace.validateTextChange} onChange={workspace.changeText} onCursor={(_id, line) => setSourceLine(line)} onCompile={compile} onNotice={workspace.setNotice} /> : <p className={styles.loading}>Restoring local source before any write-back.</p>}</div>
        </section>
        <div className={styles.separator} role="separator" aria-orientation="vertical" aria-label="Resize source and proof panes" aria-valuemin={30} aria-valuemax={70} aria-valuenow={split} aria-valuetext={`${split}% source width`} aria-controls="resume-latex-source-pane resume-latex-proof-pane" tabIndex={0} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setSplit(event.key === 'Home' ? 30 : event.key === 'End' ? 70 : Math.max(30, Math.min(70, split + (event.key === 'ArrowRight' ? 2 : -2)))) }
        }} onPointerDown={(event) => { if (event.button === 0) { drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); resize(event) } }} onPointerMove={resize} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = null }}><span /></div>
        <section id="resume-latex-proof-pane" className={styles.proofPane} aria-label="Exact compiled PDF proof">
          {proof && !current && <p className={styles.staleNotice}>{foreignProof ? 'This is the original-project PDF retained with the independent recovery copy for this session.' : sameRevisionMismatch ? `Another tab supplied different source at r${project?.revision}. This PDF belongs to the captured compile snapshot, not that source.` : `Source is r${project?.revision}; this last good PDF was compiled from r${proof.revision}.`} Its source maps are disabled.</p>}
          <LatexPdfPreview proof={proof} current={current} active={active && (!small || mobilePanel === 'proof')} location={current && sync?.identity === identity ? sync.location : null} onPosition={canSync ? (position) => void locate('inverse', position) : undefined} />
          <div className={styles.syncStatus} role="status">{current && sync?.identity === identity ? sync.message : canSync ? 'SyncTeX available for this current proof. Double-click a PDF point or use Show line in proof.' : proof?.syncAvailable && !current ? 'Source-map navigation is disabled for a non-current proof.' : !workspace.online ? 'Source-map queries are unavailable offline.' : 'No current PDF/source map is available. Positions are never guessed.'}</div>
        </section>
      </div>
    </div>
    <section className={styles.problemsDrawer} data-open={drawerOpen} aria-label="Build panel">
      <div className={styles.drawerBar}>
        <span className={styles.buildLabel}>Build</span>
        <div className={styles.buildTabs} role="group" aria-label="Build details">
          {(['problems', 'log', 'history'] as const).map((view) => <button key={view} id={`resume-latex-build-tab-${view}`} type="button" aria-pressed={drawerOpen && drawerView === view} aria-expanded={drawerOpen && drawerView === view} aria-controls="resume-latex-problems-content" onClick={() => toggleDrawer(view)}>{view === 'problems' ? <>Problems <span className={styles.problemCount} data-has-issues={usefulProblems}>{diagnostics.length}</span></> : view === 'log' ? 'Log' : 'History'}</button>)}
        </div>
        <span className={styles.drawerSummary}>{workspace.autoCompile ? 'Auto Compile on' : 'Manual compile'} <i aria-hidden="true" /> Local drafts</span>
      </div>
      {drawerOpen && <div className={styles.drawerContent} id="resume-latex-problems-content" role="region" aria-label={`${drawerView === 'problems' ? 'Problems' : drawerView === 'log' ? 'Compile log' : 'Project history'} details`} tabIndex={0}>
        {drawerView === 'problems' && <><p className={styles.helper}>{diagnosticRevision ? `Reported for r${diagnosticRevision}${!diagnosticsCurrent ? '. Current source is a different snapshot; lines may differ.' : '.'}` : 'Compile diagnostics appear here. No checks have been fabricated.'}</p>{diagnostics.length ? <ul className={styles.diagnostics}>{diagnostics.map((item, index) => <li key={index} data-severity={item.severity}><b>{item.severity}</b><div><p>{item.message}</p>{item.help && <p className={styles.helper}>{item.help}</p>}{item.file && <button type="button" className={styles.textButton} disabled={!project?.files.some((source) => source.path === item.file)} onClick={() => { const target = project?.files.find((source) => source.path === item.file); if (target) jumpTo(target.id, item.line ?? 1) }}>{item.file}{item.line ? `:${item.line}` : ''}</button>}{item.code && <code className={styles.diagnosticCode}>{item.code}</code>}</div></li>)}</ul> : <p>No diagnostics reported for this view.</p>}</>}
        {drawerView === 'log' && <><p className={styles.helper}>Private, bounded compile log. Source/log excerpts are not sent to analytics. Server results expire; an acknowledged local proof retains its log on this device.</p><pre className={styles.log}>{currentAttempt?.log ?? proof?.log ?? 'No compile log is available.'}</pre>{currentAttempt?.requestId && <p className={styles.helper}>Request ID: <code>{currentAttempt.requestId}</code></p>}</>}
        {drawerView === 'history' && <><p className={styles.helper}>Restore creates a new revision and a recovery checkpoint first. Only committed transactions survive a reload.</p><ul className={styles.history}>{workspace.checkpoints.filter((item) => item.project.id === project?.id).map((item) => <li key={item.id}><div><b>{item.label}</b><small>r{item.project.revision} / {new Date(item.createdAt).toLocaleString()}</small></div><button type="button" className={styles.textButton} onClick={() => openModal({ kind: 'restore', checkpoint: item })}>Restore...</button><button type="button" className={styles.textButton} disabled={busy} onClick={() => void downloadSource(item.project, false)}>ZIP</button></li>)}</ul>{!workspace.checkpoints.some((item) => item.project.id === project?.id) && <p>No local checkpoints yet. Create one before an important source change.</p>}</>}
      </div>}
    </section>
    <nav className={styles.mobileNav} aria-label="LaTeX workspace views">{(['files', 'source', 'proof', 'problems'] as const).map((panel) => <button type="button" key={panel} aria-current={mobilePanel === panel ? 'page' : undefined} onClick={() => { setMobilePanel(panel); if (panel === 'problems') setDrawer('problems') }}>{panel === 'files' ? 'Files' : panel === 'source' ? 'Source' : panel === 'proof' ? 'Proof' : 'Problems'}</button>)}</nav>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="resume-latex-dialog-title" onCancel={() => setModal(null)}><form onSubmit={(event) => void submitModal(event)}><div className={styles.dialogHeading}><h2 id="resume-latex-dialog-title">{modalTitle}</h2><button type="button" aria-label="Close LaTeX dialog" disabled={busy} onClick={() => setModal(null)}>Close</button></div>
      {modal && (modal.kind === 'new' || modal.kind === 'rename') && <><label className={styles.field}>Relative filename<input autoFocus value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} required maxLength={240} spellCheck={false} /></label><p className={styles.helper}>.tex, .sty, .cls, .bib or .bst. Image renames keep their PNG/JPEG format. Use NFC letters, numbers, hyphens, underscores and relative folders; no spaces or traversal paths.</p>{modal.kind === 'new' && <label className={styles.field}>Initial raw source<textarea value={fileText} onChange={(event) => setFileText(event.target.value)} rows={8} spellCheck={false} /></label>}</>}
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
