'use client'

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cancelLatexCompile, compileLatexProject, getLatexCapabilities, recoverLatexProject, LatexTransportError } from './compileTransport.ts'
import { LATEX_MAIN_FILE_NOTICE, type LatexCapabilities, type LatexCheckpoint, type LatexDiagnostic, type LatexProject, type LatexProof, type LatexRuntime, unavailableLatexCapabilities } from './types.ts'
import { cloneAsNewProject, isCurrentProof, isRecord, makeCheckpoint, newLatexId, projectSnapshotHash, reviseProject, sameProjectSource, validateLatexProject } from './project.ts'
import { LatexProjectStore, LatexStorageError, LOCAL_LATEX_LIMITS, openLatexProjectStore } from './projectStore.ts'
import { createTemplateProject } from './templates.ts'
import { mayAutoCompile, newerProof, recoverableCompileFailure } from './compilePolicy.ts'
import { approveBrowserPackageGroups, BrowserPackageGroupRequiredError, browserLatexCompatibility, cancelBrowserCompile, clearBrowserEngineCache, compileBrowserProject, getBrowserCapabilities, getBrowserEngineCacheSummary, getBrowserPreparation, type BrowserPreparation, type LatexCompileProgress } from './browserCompiler.ts'
import { repairAltaCvBrowserProject } from './altacvBrowser.ts'
import type { EngineCacheSummary } from './engineAssetStore.ts'
import { createFeedbackState, feedbackIdentity, feedbackReducer, type FeedbackFact } from './feedback.ts'
import { matchesProofSnapshot, matchesSourceSnapshot, proofActionIdentity } from './workspaceIdentity.ts'
import type { BrowserSyncArtifact } from './browserSynctex.ts'

export type LatexSaveState = { kind: 'unsaved' | 'saving' | 'saved' | 'session' | 'conflict'; revision?: number; savedAt?: string; reason?: string; riskId?: string; since?: number }
export type CompileAttempt = { projectId: string; revision: number; operationKey: string; stage: 'waiting' | 'awaiting_action' | 'ready' | 'failed' | 'cancelling' | 'cancelled' | 'recoverable' | 'recovering';
  message: string; diagnostics: LatexDiagnostic[]; log: string; snapshot: LatexProject; requestId?: string; runtime: LatexRuntime; progress?: LatexCompileProgress; origin?: 'manual' | 'auto' | 'recovery'; startedAt?: number; completedAt?: number; pdfPages?: number; code?: string; previousPdfKept?: boolean }
type CompileIntent = { snapshot: LatexProject; operationKey: string; mode: 'manual' | 'auto'; runtime: LatexRuntime; requireCurrentSource?: boolean; packageGroups?: readonly string[] }
type RunningCompile = CompileIntent & { controller: AbortController; cancelled: boolean; stopped: boolean }
const onlineSnapshot = () => typeof navigator !== 'undefined' && navigator.onLine
const subscribeOnline = (notify: () => void) => { window.addEventListener('online', notify); window.addEventListener('offline', notify); return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify) } }
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed. Your writing is unchanged.'
export function browserMemoryWarning(memory: unknown): number | null {
  return typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory < 4 ? memory : null
}
export type BrowserPreparationRequest = { projectId: string; revision: number; snapshot: LatexProject; operationKey: string; memoryGB?: number; packages?: BrowserPreparation; packageGroups?: readonly string[]; error?: string }
export type BrowserDependencyCheck = { snapshot: LatexProject; epoch: number; status: 'checking' | 'ready' | 'failed'; preparation?: BrowserPreparation; error?: string }
export type LatexRetentionIssue = { projectId: string; revision: number; operationKey: string; kind: 'proof' | 'recovery'; message: string; createdAt: number }
type FeedbackInput = Pick<FeedbackFact, 'category' | 'code' | 'priority' | 'severity' | 'lifecycle' | 'projectId' | 'summary'> & Partial<FeedbackFact>
export function workspaceFeedbackFact(input: FeedbackInput, now = Date.now()): FeedbackFact {
  return { id: input.id ?? `${input.projectId ?? 'workspace'}:${input.operationKey ?? input.actionRequestId ?? input.code}:${input.code}`, origin: 'manual',
    dedupeKey: input.code, actionIds: [], createdAt: now, updatedAt: now, ...input }
}
export function attemptFeedback(attempt: CompileAttempt): FeedbackFact {
  const waiting = ['waiting', 'recovering', 'cancelling'].includes(attempt.stage), ready = attempt.stage === 'ready', permission = attempt.stage === 'awaiting_action'
  const code = waiting ? attempt.progress?.phase ?? attempt.stage : attempt.code ?? attempt.stage
  return workspaceFeedbackFact({ category: 'build', code, projectId: attempt.projectId, projectTitle: attempt.snapshot.title, revision: attempt.revision,
    runtime: attempt.runtime, operationKey: attempt.operationKey, origin: attempt.origin ?? 'recovery', createdAt: (ready ? attempt.completedAt : attempt.startedAt) ?? 0,
    priority: waiting ? 2 : ready ? 3 : attempt.stage === 'cancelled' ? 4 : 1,
    severity: ready ? 'success' : attempt.stage === 'failed' ? 'error' : permission || attempt.stage === 'recoverable' ? 'warning' : 'info',
    lifecycle: waiting ? 'progress' : ready ? 'receipt' : attempt.stage === 'cancelled' ? 'info' : 'attention',
    summary: ready && attempt.pdfPages ? `PDF ready: ${attempt.pdfPages} ${attempt.pdfPages === 1 ? 'page' : 'pages'}, revision ${attempt.revision}.`
      : attempt.stage === 'failed' ? attempt.previousPdfKept ? 'Build failed. Previous PDF kept.' : 'Build failed. Review Problems for the compiler message.' : attempt.message,
    detailRef: `build:${attempt.operationKey}`, actionIds: permission ? ['review-download'] : attempt.stage === 'recoverable' ? ['recover', 'cancel'] : attempt.stage === 'failed' ? ['first-error'] : ready ? ['view-pdf'] : [] })
}

export default function useLatexWorkspace(active: boolean) {
  const [projects, setProjects] = useState<LatexProject[]>([]), [projectId, setProjectId] = useState<string | null>(null)
  const [ready, setReady] = useState(false), [saves, setSaves] = useState<Record<string, LatexSaveState>>({})
  const [checkpoints, setCheckpoints] = useState<LatexCheckpoint[]>([]), [proofs, setProofs] = useState<Record<string, LatexProof>>({})
  const [proofSources, setProofSources] = useState<Record<string, LatexProject>>({})
  const [proofAttempts, setProofAttempts] = useState<Record<string, CompileAttempt>>({})
  const [browserMaps, setBrowserMaps] = useState<Record<string, BrowserSyncArtifact>>({})
  const [protectedRecords, setProtectedRecords] = useState<string[]>([]), [storageWarning, setStorageWarning] = useState('')
  const [capabilities, setCapabilities] = useState<LatexCapabilities>({ ...unavailableLatexCapabilities, reason: 'Compiler availability has not been checked. Source editing remains local.' })
  const [runtime, setRuntime] = useState<LatexRuntime>('browser')
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false), [autoCompile, setAutoCompile] = useState(false)
  const [attempt, setAttempt] = useState<CompileAttempt | null>(null), [queuedRevision, setQueuedRevision] = useState<number | null>(null)
  const [feedback, setFeedback] = useState(createFeedbackState)
  const [engineCache, setEngineCache] = useState<EngineCacheSummary | null>(null), [engineCacheBusy, setEngineCacheBusy] = useState(false)
  const [browserPreparation, setBrowserPreparation] = useState<BrowserPreparationRequest | null>(null)
  const [dependencyCheck, setDependencyCheck] = useState<BrowserDependencyCheck | null>(null)
  const [retentionIssues, setRetentionIssues] = useState<LatexRetentionIssue[]>([])
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => false)
  const store = useRef<LatexProjectStore | null>(null), expected = useRef(new Map<string, number | null>())
  const proofSnapshots = useRef<Record<string, LatexProject>>({})
  const projectsRef = useRef(projects), idRef = useRef(projectId), savesRef = useRef(saves), proofsRef = useRef(proofs)
  // These refs are updated by the canonical actions below, never copied back from a possibly older React render.
  const mounted = useRef(true), activeRef = useRef(active), onlineRef = useRef(online), capabilitiesRef = useRef(capabilities), autoRef = useRef(autoCompile)
  const runtimeRef = useRef<LatexRuntime>('browser')
  const selectionEpoch = useRef(0)
  const memoryAcknowledged = useRef(false), preparationRef = useRef<BrowserPreparationRequest | null>(null)
  const engineMutation = useRef(false), preparationOperation = useRef<AbortController | null>(null), cacheReadSequence = useRef(0)
  const dependencyOperation = useRef<AbortController | null>(null)
  const inspectDependenciesRef = useRef<() => Promise<BrowserDependencyCheck | null>>(() => Promise.resolve(null))
  useLayoutEffect(() => { if (activeRef.current !== active) selectionEpoch.current++; activeRef.current = active; onlineRef.current = online; capabilitiesRef.current = capabilities; autoRef.current = autoCompile }, [active, online, capabilities, autoCompile])
  const channel = useRef<BroadcastChannel | null>(null), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve()), running = useRef<RunningCompile | null>(null), queued = useRef<CompileIntent | null>(null)
  const unresolved = useRef<CompileIntent | null>(null), retryAt = useRef(0), capabilitiesRequest = useRef<AbortController | null>(null)
  const executeRef = useRef<(intent: CompileIntent) => Promise<void>>(async () => {})

  const currentProject = () => projectsRef.current.find((project) => project.id === idRef.current) ?? null
  function sourceIsCurrent(snapshot: LatexProject | null | undefined, epoch = selectionEpoch.current) {
    return activeRef.current && epoch === selectionEpoch.current && matchesSourceSnapshot(currentProject(), snapshot)
  }
  function proofIsCurrent(snapshot: LatexProject, proof: LatexProof, epoch = selectionEpoch.current) {
    return activeRef.current && epoch === selectionEpoch.current && runtimeRef.current === (proof.runtime ?? 'native')
      && matchesProofSnapshot(currentProject(), snapshot, proof)
      && proofActionIdentity(proofsRef.current[snapshot.id]) === proofActionIdentity(proof)
  }
  function reportFeedback(input: FeedbackInput, source: 'action' | 'derived' = 'action') {
    const fact = workspaceFeedbackFact(input)
    if (mounted.current) setFeedback((state) => feedbackReducer(state, { type: 'publish', fact, source }))
  }
  function notify(kind: 'success' | 'error' | 'action' | 'info', category: string, code: string, summary: string, snapshot = currentProject(), actionRequestId = newLatexId(), actionIds: string[] = []) {
    reportFeedback({ category, code, summary, actionRequestId, projectId: snapshot?.id ?? null, projectTitle: snapshot?.title, revision: snapshot?.revision,
      runtime: category === 'build' || category === 'runtime' ? runtimeRef.current : undefined, priority: kind === 'success' ? 3 : kind === 'info' ? 4 : 1, severity: kind === 'action' ? 'warning' : kind,
      lifecycle: kind === 'success' ? 'receipt' : kind === 'info' ? 'info' : 'attention', actionIds })
  }
  useEffect(() => {
    if (attempt) setFeedback((state) => feedbackReducer(state, { type: 'publish', fact: attemptFeedback(attempt), source: 'derived' }))
  }, [attempt])
  function updateSave(id: string, state: LatexSaveState) {
    const previous = savesRef.current[id]
    if (state.kind === 'session' || state.kind === 'conflict') {
      const continuing = previous?.kind === state.kind && previous.reason === state.reason
      state = { ...state, riskId: continuing ? previous.riskId : newLatexId(), since: continuing ? previous.since : Date.now() }
    }
    savesRef.current = { ...savesRef.current, [id]: state }
    if (mounted.current) setSaves(savesRef.current)
  }
  function replaceProject(next: LatexProject) {
    projectsRef.current = projectsRef.current.map((item) => item.id === next.id ? next : item)
    setProjects(projectsRef.current)
  }
  function retainCheckpoint(checkpoint: LatexCheckpoint) {
    setCheckpoints((previous) => [checkpoint, ...previous].filter((item, index, all) => all.filter((other, position) => position <= index && other.project.id === item.project.id).length <= LOCAL_LATEX_LIMITS.checkpointsPerProject))
  }

  function queueSave(project: LatexProject, checkpoint?: LatexCheckpoint) {
    const work = saveChain.current.catch(() => {}).then(async () => {
      const database = store.current, state = savesRef.current[project.id]
      const canonical = projectsRef.current.find((item) => item.id === project.id)
      // Debounced snapshots must not resurrect deleted projects or overwrite a
      // stored-source reload with older in-memory writing from the same ID.
      if (!database || !canonical || canonical.revision !== project.revision || !sameProjectSource(canonical, project)
        || state?.kind === 'session' || state?.kind === 'conflict') return false
      const revision = expected.current.get(project.id) ?? null
      if (!checkpoint && revision !== null && revision >= project.revision) return true
      updateSave(project.id, { kind: 'saving', revision: revision ?? undefined })
      try {
        const acknowledgment = await database.save(project, revision, checkpoint)
        expected.current.set(project.id, acknowledgment.revision)
        const latest = projectsRef.current.find((item) => item.id === project.id)
        updateSave(project.id, { kind: latest?.revision === acknowledgment.revision ? 'saved' : 'unsaved', revision: acknowledgment.revision, savedAt: acknowledgment.savedAt })
        channel.current?.postMessage({ id: project.id, revision: acknowledgment.revision })
        return true
      } catch (error) {
        const conflict = error instanceof LatexStorageError && error.code === 'conflict'
        // A failed checkpoint transaction cannot make already committed source
        // session-only. A CAS conflict, however, must remain visible as a risk.
        if (checkpoint && !conflict && state?.kind === 'saved' && revision === project.revision) updateSave(project.id, state)
        else updateSave(project.id, { kind: conflict ? 'conflict' : 'session', reason: messageOf(error) })
        if (mounted.current) setStorageWarning(conflict ? 'Another tab saved this project. Your in-memory writing has not been replaced. Export it or save it as a new project.'
          : `${messageOf(error)} Current writing and any uncommitted checkpoint are session-only. Export a source ZIP before reloading.`)
        return false
      }
    })
    saveChain.current = work.then(() => {})
    return work
  }

  function flushSave() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const project = currentProject()
    return project ? queueSave(project) : Promise.resolve(false)
  }
  function scheduleSave(project: LatexProject) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void queueSave(project) }, 700)
  }
  function stopAutoSchedule() {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    if (queued.current?.mode === 'auto') { queued.current = null; setQueuedRevision(null) }
  }
  const flushOnSuspend = useRef(flushSave)
  useLayoutEffect(() => { flushOnSuspend.current = flushSave })
  function scheduleAuto(project: LatexProject) {
    if (autoTimer.current) clearTimeout(autoTimer.current)
    // A newest incompatible edit still supersedes an older automatic intent.
    // Explicit manual snapshots remain intentional, even while writing changes.
    if (queued.current?.mode === 'auto' && queued.current.snapshot.id === project.id) { queued.current = null; setQueuedRevision(null) }
    const compatible = () => project.mainFile !== null && capabilitiesRef.current.profiles.some((profile) => profile.id === project.engine)
      && (runtimeRef.current !== 'browser' || !browserLatexCompatibility(project, capabilitiesRef.current.profiles).some((item) => item.severity === 'error'))
    if (preparationRef.current || engineMutation.current || !compatible() || !mayAutoCompile({ enabled: autoRef.current, active: activeRef.current, online: onlineRef.current, runtime: runtimeRef.current, ready: capabilitiesRef.current.ready, retryAt: retryAt.current })) return
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null
      if (preparationRef.current || engineMutation.current || idRef.current !== project.id || !compatible() || !mayAutoCompile({ enabled: autoRef.current, active: activeRef.current, online: onlineRef.current, runtime: runtimeRef.current, ready: capabilitiesRef.current.ready, retryAt: retryAt.current })) return
      enqueueCompile(project, 'auto')
    }, 1800)
  }

  useEffect(() => {
    let disposed = false
    mounted.current = true
    void (async () => {
      let database: LatexProjectStore | null = null
      try {
        database = await openLatexProjectStore()
        const restored = await database.readWorkspace()
        if (disposed) { database.close(); return }
        store.current = database
        const documents = [...restored.projects], captured = restored.pendingCompile
        if (captured && !documents.some((project) => project.id === captured.snapshot.id) && documents.length < LOCAL_LATEX_LIMITS.projects) documents.push(captured.snapshot)
        if (!documents.length) documents.push(createTemplateProject())
        const statuses: Record<string, LatexSaveState> = {}
        for (const project of documents) {
          const persisted = restored.projects.some((item) => item.id === project.id)
          expected.current.set(project.id, persisted ? project.revision : null)
          const recoveredSource = !persisted && captured?.snapshot.id === project.id
          statuses[project.id] = { kind: persisted ? 'saved' : recoveredSource ? 'session' : 'unsaved', revision: persisted ? project.revision : undefined,
            reason: recoveredSource ? 'Captured compile source was recovered without overwriting an unavailable original project. Save it as a new project.' : undefined }
        }
        projectsRef.current = documents; idRef.current = documents[0].id; savesRef.current = statuses
        setProjects(documents); setProjectId(documents[0].id); setSaves(statuses); setCheckpoints(restored.checkpoints)
        const retained = Object.fromEntries(restored.proofs.map((proof) => [proof.projectId, proof]))
        proofSnapshots.current = restored.proofSnapshots
        setProofSources(restored.proofSnapshots)
        proofsRef.current = retained; setProofs(retained); setProtectedRecords(restored.protectedRecords)
        if (restored.protectedRecords.length) setStorageWarning('Some stored records use an invalid or newer format. Their originals were preserved and will not be overwritten. New independent projects can still be created within local limits.')
        if (captured) {
          unresolved.current = { snapshot: captured.snapshot, operationKey: captured.operationKey, mode: 'manual', runtime: 'native' }
          setAttempt({ projectId: captured.snapshot.id, revision: captured.snapshot.revision, operationKey: captured.operationKey, stage: 'recoverable', runtime: 'native',
            message: 'A saved compile operation was restored. Recover checks its private status and PDF without uploading source or starting another build.', diagnostics: [], log: '', snapshot: captured.snapshot })
        }
      } catch (error) {
        database?.close()
        if (disposed) return
        const project = createTemplateProject()
        projectsRef.current = [project]; idRef.current = project.id
        const status: LatexSaveState = { kind: 'session', reason: messageOf(error) }
        savesRef.current = { [project.id]: status }
        setProjects([project]); setProjectId(project.id); setSaves(savesRef.current)
        setStorageWarning(`${messageOf(error)} This session is not autosaved. Export the latest source ZIP before closing.`)
      } finally { if (!disposed) setReady(true) }
    })()
    return () => {
      disposed = true; mounted.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (autoTimer.current) clearTimeout(autoTimer.current)
      running.current?.controller.abort(); capabilitiesRequest.current?.abort(); preparationOperation.current?.abort(); dependencyOperation.current?.abort()
      void saveChain.current.finally(() => store.current?.close())
    }
  }, [])

  useEffect(() => {
    if (!ready || typeof BroadcastChannel === 'undefined') return
    try {
      const broadcast = new BroadcastChannel('mr-resume:latex:v1'), target = channel
      target.current = broadcast
      broadcast.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!isRecord(data) || typeof data.id !== 'string' || !Number.isSafeInteger(data.revision)) return
        const current = projectsRef.current.find((item) => item.id === data.id), revision = expected.current.get(data.id)
        if (current && revision !== undefined && (data.revision as number) > (revision ?? 0)) {
          updateSave(current.id, { kind: 'conflict', reason: 'A newer revision was saved in another tab.' })
          setStorageWarning('Another tab saved this project. This tab kept its own source. Export or save a new project before reloading the stored copy.')
        }
      }
      return () => { broadcast.close(); target.current = null }
    } catch { /* Transactional CAS remains effective without BroadcastChannel. */ }
  }, [ready])

  useEffect(() => {
    if (!active || (runtime === 'native' && !online) || !autoCompile) stopAutoSchedule()
    if (!active) preparationOperation.current?.abort()
    if (!active && ready) void flushOnSuspend.current()
  }, [active, online, autoCompile, ready, runtime])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (projectsRef.current.some((project) => savesRef.current[project.id]?.kind !== 'saved')) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  async function refreshCapabilities(): Promise<LatexCapabilities | null> {
    const selectedRuntime = runtimeRef.current
    if (!activeRef.current || (selectedRuntime === 'native' && !onlineRef.current)) return null
    capabilitiesRequest.current?.abort()
    const controller = new AbortController(); capabilitiesRequest.current = controller
    setCapabilitiesLoading(true)
    try {
      const value = selectedRuntime === 'browser' ? await getBrowserCapabilities(controller.signal) : await getLatexCapabilities(controller.signal)
      if (!controller.signal.aborted && mounted.current && runtimeRef.current === selectedRuntime) { capabilitiesRef.current = value; setCapabilities(value); return value }
      return null
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && runtimeRef.current === selectedRuntime) {
        const unavailable = { ...unavailableLatexCapabilities, reason: messageOf(error) }
        capabilitiesRef.current = unavailable; setCapabilities(unavailable)
        return unavailable
      }
      return null
    } finally { if (capabilitiesRequest.current === controller && mounted.current) setCapabilitiesLoading(false) }
  }

  useEffect(() => {
    if (active && (runtime === 'browser' || online)) void refreshCapabilities()
    else capabilitiesRequest.current?.abort()
    // Capability checks never upload source or initiate a compile.
  }, [active, online, runtime])

  function selectRuntime(next: LatexRuntime) {
    if (next === runtimeRef.current || (next !== 'browser' && next !== 'native')) return false
    if (running.current || unresolved.current) { notify('action', 'runtime', 'runtime-busy', 'Cancel or resolve the current compile before changing runtime. No source was uploaded or converted by this action.'); return false }
    // Auto/upload consent belongs to one runtime, never to a later selection.
    stopAutoSchedule(); autoRef.current = false; setAutoCompile(false); capabilitiesRequest.current?.abort()
    preparationOperation.current?.abort()
    selectionEpoch.current++; runtimeRef.current = next; setRuntime(next)
    preparationRef.current = null; setBrowserPreparation(null)
    retryAt.current = 0
    const unavailable = { ...unavailableLatexCapabilities, reason: next === 'browser' ? 'Checking the fixed browser-local engine bundle. No source is uploaded.' : 'Checking the explicitly selected private native compiler.' }
    capabilitiesRef.current = unavailable; setCapabilities(unavailable); setCapabilitiesLoading(false); setAttempt(null)
    notify('info', 'runtime', 'runtime-selected', next === 'browser' ? 'Browser-local runtime selected. Source, images, logs and PDFs stay on this device. First use downloads only the fixed engine assets.' : 'Private native runtime selected explicitly. Auto Compile is off; source upload still requires informed compile consent.')
    return true
  }

  function validateTextChange(fileId: string, text: string) {
    const project = currentProject()
    if (!project) return 'The project has not restored yet.'
    try { validateLatexProject({ ...project, files: project.files.map((file) => file.id === fileId ? { ...file, content: text } : file) }); return null }
    catch (error) { return messageOf(error) }
  }

  function changeText(fileId: string, text: string) {
    const project = currentProject(), file = project?.files.find((item) => item.id === fileId)
    if (!project || !file || file.content === text) return
    try {
      const next = reviseProject(project, { files: project.files.map((item) => item.id === fileId ? { ...item, content: text } : item) })
      replaceProject(next)
      if (!['conflict', 'session'].includes(savesRef.current[project.id]?.kind)) updateSave(project.id, { kind: 'unsaved', revision: expected.current.get(project.id) ?? undefined })
      scheduleSave(next); scheduleAuto(next)
    } catch (error) { notify('error', 'source', 'source-change-refused', messageOf(error), project) }
  }

  function applyProject(next: LatexProject, checkpointLabel?: string, expectedSource?: LatexProject) {
    const current = currentProject()
    if (!current || current.id !== next.id || next.revision <= current.revision) throw new Error('A change must target the current project as a new revision.')
    if (expectedSource && (current.id !== expectedSource.id || current.revision !== expectedSource.revision || current.title !== expectedSource.title || !sameProjectSource(current, expectedSource))) throw new Error('The source changed while this action was pending. Nothing was applied; review the latest revision first.')
    validateLatexProject(next)
    stopAutoSchedule()
    const checkpoint = checkpointLabel ? makeCheckpoint(current, checkpointLabel) : undefined
    if (checkpoint) retainCheckpoint(checkpoint)
    replaceProject(next)
    if (!['conflict', 'session'].includes(savesRef.current[next.id]?.kind)) updateSave(next.id, { kind: 'unsaved', revision: expected.current.get(next.id) ?? undefined })
    if (checkpoint) void queueSave(next, checkpoint)
    else scheduleSave(next)
  }

  function addProject(project: LatexProject, select = true) {
    validateLatexProject(project)
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('This workspace already has eight projects. Export and explicitly remove one before creating another.')
    void flushSave(); stopAutoSchedule()
    expected.current.set(project.id, null)
    const state: LatexSaveState = { kind: store.current ? 'unsaved' : 'session', reason: store.current ? undefined : 'Device storage is unavailable.' }
    updateSave(project.id, state)
    projectsRef.current = [project, ...projectsRef.current]
    setProjects(projectsRef.current)
    if (select) { selectionEpoch.current++; idRef.current = project.id; setProjectId(project.id) }
    void queueSave(project)
  }

  function selectProject(id: string) {
    if (!projectsRef.current.some((item) => item.id === id) || id === idRef.current) return
    void flushSave(); stopAutoSchedule(); selectionEpoch.current++; idRef.current = id; setProjectId(id)
  }

  async function checkpointNow(label = 'Manual checkpoint', snapshot?: LatexProject, explicit = true) {
    const project = snapshot ?? currentProject()
    if (!project) return null
    const checkpoint = makeCheckpoint(project, label)
    retainCheckpoint(checkpoint)
    const latest = projectsRef.current.find((item) => item.id === project.id)
    const committed = latest ? await queueSave(latest, checkpoint) : false
    notify(committed ? explicit ? 'success' : 'info' : 'action', 'checkpoint', 'checkpoint-save', committed ? `Checkpoint saved locally for revision ${project.revision}.` : 'Checkpoint kept in this session only. Export a source ZIP for a portable backup.', project, checkpoint.id, committed ? ['view-history'] : ['export-source'])
    return { checkpoint, committed, projectId: project.id, revision: project.revision }
  }

  async function reloadStoredProject() {
    const current = currentProject(), database = store.current
    if (!current || !database) { notify('action', 'storage', 'storage-unavailable', 'Device storage is unavailable. Export your current source ZIP.', current); return }
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('Export the current writing before reloading; a recovery copy would exceed the eight-project limit.')
    const restored = await database.readWorkspace(), stored = restored.projects.find((item) => item.id === current.id)
    if (!stored) throw new Error('The stored project could not be restored. Its original record was kept.')
    const latest = currentProject()
    if (!latest || latest.id !== current.id) throw new Error('The selected project changed while storage was read. No writing was replaced; request recovery again.')
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('A new project was added during recovery. Export your writing before reloading; no source was replaced.')
    const copy = cloneAsNewProject(latest, `${latest.title || 'Project'} unsaved recovery`)
    selectionEpoch.current++
    expected.current.set(copy.id, null)
    projectsRef.current = [copy, ...projectsRef.current.map((item) => item.id === stored.id ? stored : item)]
    setProjects(projectsRef.current); expected.current.set(stored.id, stored.revision)
    updateSave(copy.id, { kind: 'unsaved' }); updateSave(stored.id, { kind: 'saved', revision: stored.revision })
    const oldProof = proofsRef.current[current.id], nextProofs = { ...proofsRef.current }, nextSources = { ...proofSnapshots.current }
    if (oldProof) { nextProofs[copy.id] = oldProof; nextSources[copy.id] = proofSnapshots.current[current.id] }
    delete nextProofs[stored.id]; delete nextSources[stored.id]
    const storedProof = restored.proofs.find((item) => item.projectId === stored.id)
    if (storedProof) { nextProofs[stored.id] = storedProof; nextSources[stored.id] = restored.proofSnapshots[stored.id] }
    proofSnapshots.current = nextSources; setProofSources(nextSources)
    proofsRef.current = nextProofs; setProofs(nextProofs)
    setBrowserMaps((maps) => { const next = { ...maps }; delete next[stored.id]; return next })
    void queueSave(copy)
    setStorageWarning(''); notify('success', 'storage', 'stored-source-restored', 'Stored source restored. Your previous in-memory source remains a separate recovery project.', stored)
  }

  async function removeProject(id: string) {
    if (running.current?.snapshot.id === id || unresolved.current?.snapshot.id === id) throw new Error('Resolve or cancel this project\'s compile before removing it.')
    const project = projectsRef.current.find((item) => item.id === id)
    if (!project) return
    if (idRef.current === id) {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      stopAutoSchedule()
    }
    if (queued.current?.snapshot.id === id) { queued.current = null; setQueuedRevision(null) }
    await saveChain.current
    const beforeDelete = projectsRef.current.find((item) => item.id === id)
    if (!beforeDelete || beforeDelete.revision !== project.revision || !sameProjectSource(beforeDelete, project)) throw new Error('Source changed while removal was waiting. Nothing was removed; review the latest project first.')
    const revision = expected.current.get(id)
    if (store.current && revision !== undefined && revision !== null) await store.current.deleteProject(id, revision)
    const afterDelete = projectsRef.current.find((item) => item.id === id)
    if (afterDelete && (afterDelete.revision !== project.revision || !sameProjectSource(afterDelete, project))) {
      expected.current.set(id, null)
      updateSave(id, { kind: 'session', reason: 'New writing arrived during removal of the old stored revision. The new writing is retained in this session; export it or save it as a new project.' })
      throw new Error('The old stored revision was removed, but newer in-memory writing was kept. Export or save the new writing before closing.')
    }
    const remaining = projectsRef.current.filter((item) => item.id !== id)
    if (!remaining.length) {
      const initial = createTemplateProject(); remaining.push(initial); expected.current.set(initial.id, null); updateSave(initial.id, { kind: store.current ? 'unsaved' : 'session' })
    }
    projectsRef.current = remaining
    if (idRef.current === id) { selectionEpoch.current++; idRef.current = remaining[0].id }
    setProjects(remaining); setProjectId(idRef.current); setCheckpoints((items) => items.filter((item) => item.project.id !== id))
    const nextProofs = { ...proofsRef.current }; delete nextProofs[id]; proofsRef.current = nextProofs; setProofs(nextProofs)
    const nextSources = { ...proofSnapshots.current }; delete nextSources[id]; proofSnapshots.current = nextSources; setProofSources(nextSources)
    setProofAttempts((captures) => { const next = { ...captures }; delete next[id]; return next })
    setBrowserMaps((maps) => { const next = { ...maps }; delete next[id]; return next })
    channel.current?.postMessage({ id, removed: true })
    notify('info', 'project', 'project-removed', 'The selected project was explicitly removed. Other projects and the Regular draft are unchanged.', project)
  }

  function enqueueCompile(project: LatexProject, mode: CompileIntent['mode'], operationKey = newLatexId(), requireCurrentSource = false, packageGroups: readonly string[] = []) {
    try { validateLatexProject(project) } catch (error) { notify('error', 'build', 'invalid-project', messageOf(error), project); return }
    if (project.mainFile === null) { if (mode === 'manual') notify('action', 'build', 'missing-main', LATEX_MAIN_FILE_NOTICE, project, operationKey, ['choose-main']); return }
    if (engineMutation.current) { if (mode === 'manual') notify('info', 'build', 'engine-busy', 'Wait for the engine cache action or package consent to finish before compiling. No source was sent.', project); return }
    if (preparationRef.current) { if (mode === 'auto') return; dismissBrowserPreparation() }
    const selectedRuntime = runtimeRef.current
    if (!activeRef.current || (selectedRuntime === 'native' && !onlineRef.current) || !capabilitiesRef.current.enabled || !capabilitiesRef.current.ready) { if (mode === 'manual') notify('action', 'build', 'compiler-unavailable', selectedRuntime === 'native' && !onlineRef.current ? 'Offline. Private native compilation is paused; source editing and retained downloads still work.' : capabilitiesRef.current.reason, project, operationKey, ['build-settings']); return }
    if (!capabilitiesRef.current.profiles.some((profile) => profile.id === project.engine)) { notify('action', 'build', 'engine-unavailable', 'The selected engine is not a ready compiler profile. Choose a reported supported engine.', project, operationKey, ['build-settings']); return }
    if (Date.now() < retryAt.current) { if (mode === 'manual') notify('action', 'build', 'fair-use-limit', 'The compiler fair-use limit is active. New source was kept; no automatic retry was started.', project); return }
    const memoryGB = browserMemoryWarning(typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    if (selectedRuntime === 'browser' && memoryGB !== null && !memoryAcknowledged.current) {
      const request = { projectId: project.id, revision: project.revision, snapshot: { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, operationKey, memoryGB, packageGroups: [...packageGroups] }
      preparationRef.current = request; setBrowserPreparation(request); stopAutoSchedule()
      setAttempt({ projectId: project.id, revision: project.revision, operationKey, snapshot: request.snapshot, runtime: 'browser', origin: mode, startedAt: Date.now(), stage: 'awaiting_action', message: 'Review this device\'s memory before loading the local compiler.', diagnostics: [], log: '' })
      return
    }
    if (mode === 'manual' && selectedRuntime === 'browser') {
      try {
        const repaired = repairAltaCvBrowserProject(project)
        if (repaired !== project) {
          applyProject(repaired, `Before AltaCV font repair r${project.revision}`)
          project = repaired
          notify('info', 'source', 'legacy-font-repair', "Updated the older browser copy's generated font setup for this engine. A checkpoint preserves the previous source; your writing, images and original AltaCV files are unchanged.", project)
        }
      } catch (error) { notify('error', 'source', 'legacy-repair-refused', messageOf(error), project); return }
    }
    const intent: CompileIntent = { snapshot: { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, operationKey, mode, runtime: selectedRuntime, requireCurrentSource, packageGroups: [...packageGroups] }
    preparationRef.current = null; setBrowserPreparation(null)
    if (running.current) {
      if (project.id === running.current.snapshot.id && project.revision === running.current.snapshot.revision && sameProjectSource(project, running.current.snapshot)) {
        queued.current = null; setQueuedRevision(null); if (mode === 'manual') notify('info', 'build', 'already-compiling', 'This exact source revision is already in flight. No duplicate compile was queued.', project); return
      }
      queued.current = intent; setQueuedRevision(project.revision); return
    }
    if (unresolved.current) { queued.current = mode === 'manual' ? intent : null; setQueuedRevision(mode === 'manual' ? project.revision : null); notify('info', 'build', 'recovery-pending', 'The previous operation is not terminal yet. Recover or cancel it explicitly before starting more work.', project); return }
    void executeRef.current(intent)
  }

  async function execute(intent: CompileIntent, recovery = false) {
    // Recovery retrieves a captured native result; it is not a new compile and
    // must work after reload even when the selected runtime defaults to browser.
    if ((!recovery && intent.runtime !== runtimeRef.current) || !activeRef.current || (intent.runtime === 'native' && !onlineRef.current)) return
    const slot: RunningCompile = { ...intent, controller: new AbortController(), cancelled: false, stopped: false }
    let terminal = false
    running.current = slot; unresolved.current = null
    let lastProgress: LatexCompileProgress | undefined
    const capturedMap: { value: BrowserSyncArtifact | null } = { value: null }
    const capturedEpoch = selectionEpoch.current
    const startedAt = Date.now(), origin = recovery ? 'recovery' : intent.mode
    if (mounted.current) setAttempt({ projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, stage: recovery ? 'recovering' : 'waiting',
      message: recovery ? 'Retrieving the captured native operation and verified PDF. Source is not uploaded again.' : intent.runtime === 'browser' ? 'Preparing the captured revision for local browser compilation. No source is uploaded.' : 'Uploading this revision and waiting for the private compiler. You can keep editing.', diagnostics: [], log: '', snapshot: intent.snapshot, runtime: intent.runtime, origin, startedAt })
    try {
    if (store.current && intent.runtime === 'native' && !recovery) {
      // Save the captured revision before upload so a reload can recover the exact operation without re-uploading source.
      try { await store.current.retainPendingCompile({ operationKey: intent.operationKey, snapshot: intent.snapshot, snapshotHash: await projectSnapshotHash(intent.snapshot), createdAt: new Date().toISOString() }) }
      catch (error) {
        if (error instanceof LatexStorageError && ['conflict', 'protected'].includes(error.code)) throw error
        if (mounted.current) setRetentionIssues((issues) => [...issues.filter((issue) => issue.operationKey !== intent.operationKey || issue.kind !== 'recovery'), { projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, kind: 'recovery', message: `Reload recovery could not be saved. ${messageOf(error)}`, createdAt: Date.now() }])
      }
    }
      const proof = intent.runtime === 'browser' ? await compileBrowserProject(intent.snapshot, intent.operationKey, slot.controller.signal, (progress) => {
        if (mounted.current && running.current === slot && !slot.cancelled && !slot.controller.signal.aborted) {
          lastProgress = { ...progress }
          setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, message: progress.message, progress } : current)
        }
      }, { onSyncArtifact: (artifact) => { capturedMap.value = artifact }, packageGroups: intent.packageGroups,
        mayStartAfterPreparation: intent.requireCurrentSource ? () => running.current === slot && !slot.cancelled && !slot.stopped
          && runtimeRef.current === intent.runtime && sourceIsCurrent(intent.snapshot, capturedEpoch) : undefined,
      }) : recovery ? await recoverLatexProject(intent.snapshot, intent.operationKey, slot.controller.signal) : await compileLatexProject(intent.snapshot, intent.operationKey, slot.controller.signal)
      if (slot.cancelled || slot.stopped || !mounted.current) return
      if (proof.projectId !== intent.snapshot.id || proof.revision !== intent.snapshot.revision) throw new Error('Compiler result identity does not match its immutable source snapshot.')
      terminal = true
      const latestSource = projectsRef.current.find((item) => item.id === proof.projectId), previousProof = proofsRef.current[proof.projectId]
      const previousIsCurrent = Boolean(isCurrentProof(latestSource ?? null, previousProof) && sameProjectSource(latestSource, proofSnapshots.current[proof.projectId]))
      const differentSource = latestSource?.revision === proof.revision && !sameProjectSource(latestSource, intent.snapshot)
      const completedAttempt: CompileAttempt = { projectId: proof.projectId, revision: proof.revision, operationKey: proof.operationKey, stage: 'ready', snapshot: intent.snapshot,
        message: differentSource ? `PDF ready for the captured r${proof.revision}, but the stored source at that revision is different. Current writing is unchanged.` : intent.runtime === 'browser' ? `PDF ready. Revision ${proof.revision} was compiled and verified on this device.` : `Typeset PDF ready for revision ${proof.revision}.`, diagnostics: proof.diagnostics, log: proof.log, runtime: intent.runtime, progress: lastProgress, origin, startedAt, completedAt: Date.now(), pdfPages: proof.pdf.pages }
      setAttempt(completedAttempt)
      if (newerProof(previousProof, proof) && !(previousIsCurrent && differentSource)) {
        proofSnapshots.current = { ...proofSnapshots.current, [proof.projectId]: intent.snapshot }; setProofSources(proofSnapshots.current)
        proofsRef.current = { ...proofsRef.current, [proof.projectId]: proof }; setProofs(proofsRef.current)
        // Session-only build evidence belongs to this retained proof, not to
        // later attempts or present-day capability/cache lookups.
        setProofAttempts((captures) => ({ ...captures, [proof.projectId]: completedAttempt }))
        // SyncTeX is an optional session artifact. Reloaded/retained v1 proofs never inherit a different build's map.
        setBrowserMaps((maps) => {
          const next = { ...maps }
          if (capturedMap.value?.identity === proofActionIdentity(proof)) next[proof.projectId] = capturedMap.value
          else delete next[proof.projectId]
          return next
        })
        const checkpoint = makeCheckpoint(intent.snapshot, `Successful compile r${proof.revision}`)
        retainCheckpoint(checkpoint)
        const latest = projectsRef.current.find((project) => project.id === proof.projectId)
        if (latest) {
          const saved = await queueSave(latest)
          if (saved && store.current) {
            try { await store.current.retainProof(proof, checkpoint); if (mounted.current) setRetentionIssues((issues) => issues.filter((issue) => issue.projectId !== proof.projectId || issue.kind !== 'proof')) }
            catch (error) { if (mounted.current) setRetentionIssues((issues) => [...issues.filter((issue) => issue.projectId !== proof.projectId || issue.kind !== 'proof'), { projectId: proof.projectId, revision: proof.revision, operationKey: proof.operationKey, kind: 'proof', message: `PDF generated, retention failed. ${messageOf(error)} Download the PDF before closing.`, createdAt: Date.now() }]) }
          } else if (mounted.current) setRetentionIssues((issues) => [...issues.filter((issue) => issue.projectId !== proof.projectId || issue.kind !== 'proof'), { projectId: proof.projectId, revision: proof.revision, operationKey: proof.operationKey, kind: 'proof', message: 'The verified PDF and compile checkpoint are session-only. Download the PDF and export source before closing.', createdAt: Date.now() }])
        }
      }
      if (differentSource) {
        const recovery = projectsRef.current.find((item) => item.id !== proof.projectId && sameProjectSource(item, intent.snapshot))
        if (recovery) { proofSnapshots.current = { ...proofSnapshots.current, [recovery.id]: intent.snapshot }; setProofSources(proofSnapshots.current); proofsRef.current = { ...proofsRef.current, [recovery.id]: proof }; setProofs(proofsRef.current) }
      }
    } catch (error) {
      if (!mounted.current || slot.cancelled) return
      if (intent.runtime === 'browser' && error instanceof BrowserPackageGroupRequiredError) {
        const request = { projectId: intent.snapshot.id, revision: intent.snapshot.revision, snapshot: intent.snapshot, operationKey: intent.operationKey, packages: error.preparation, packageGroups: intent.packageGroups }
        preparationRef.current = request; setBrowserPreparation(request); stopAutoSchedule()
        setAttempt({ projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, stage: 'awaiting_action', message: 'Additional compiler files need your permission before this build can continue.', diagnostics: [], log: '', snapshot: intent.snapshot, runtime: intent.runtime, origin, startedAt })
        return
      }
      const transport = error instanceof LatexTransportError ? error : null
      const recoverable = intent.runtime === 'native' && (slot.stopped || Boolean(transport && recoverableCompileFailure(transport.code, transport.status)))
      if (recoverable) unresolved.current = intent
      terminal = !recoverable
      if (transport?.status === 429) { retryAt.current = Date.now() + (transport.retryAfterSeconds ?? 60) * 1000; stopAutoSchedule() }
      setAttempt({ projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, stage: ['browser_compile_cancelled', 'operation_cancelled'].includes(transport?.code ?? '') ? 'cancelled' : recoverable ? 'recoverable' : 'failed',
        message: slot.stopped ? 'Stopped waiting. Server cancellation has not been acknowledged; admitted work remains deadline-bounded.' : messageOf(error),
        diagnostics: transport?.diagnostics ?? [], log: transport?.log ?? '', snapshot: intent.snapshot, requestId: transport?.request_id, runtime: intent.runtime, progress: lastProgress, origin, startedAt, code: transport?.code,
        previousPdfKept: Boolean(proofsRef.current[intent.snapshot.id]) })
    } finally {
      if (intent.runtime === 'native' && (terminal || slot.cancelled)) await clearPendingCompile(intent.operationKey, intent.snapshot)
      if (running.current === slot) running.current = null
      if (mounted.current && intent.runtime === 'browser') void refreshEngineCache()
      if (!mounted.current || unresolved.current || preparationRef.current) return
      const next = queued.current; queued.current = null; setQueuedRevision(null)
      if (next && next.runtime === runtimeRef.current && activeRef.current && (next.runtime === 'browser' || onlineRef.current) && (next.mode === 'manual' || mayAutoCompile({ enabled: autoRef.current, active: activeRef.current, online: onlineRef.current, runtime: next.runtime, ready: capabilitiesRef.current.ready, retryAt: retryAt.current }))) void executeRef.current(next)
    }
  }
  executeRef.current = execute

  async function clearPendingCompile(operationKey: string, snapshot?: LatexProject) {
    // Storage cleanup must never turn an acknowledged terminal compile into a thrown error.
    try {
      await store.current?.clearPendingCompile(operationKey)
      if (mounted.current) setRetentionIssues((issues) => issues.filter((issue) => issue.operationKey !== operationKey || issue.kind !== 'recovery'))
    } catch (error) {
      if (mounted.current && snapshot) setRetentionIssues((issues) => [...issues.filter((issue) => issue.operationKey !== operationKey || issue.kind !== 'recovery'), { projectId: snapshot.id, revision: snapshot.revision, operationKey, kind: 'recovery', message: `The operation is terminal, but its local recovery marker could not be cleared. ${messageOf(error)}`, createdAt: Date.now() }])
    }
  }

  async function refreshEngineCache() {
    const sequence = ++cacheReadSequence.current
    try { const summary = await getBrowserEngineCacheSummary(); if (mounted.current && sequence === cacheReadSequence.current) setEngineCache(summary) }
    catch (error) { if (mounted.current && sequence === cacheReadSequence.current) setEngineCache({ available: false, bytes: 0, entries: 0, versions: [], reason: messageOf(error) }) }
  }
  useEffect(() => { if (active && runtime === 'browser') void refreshEngineCache() }, [active, runtime])

  async function inspectBrowserDependencies(): Promise<BrowserDependencyCheck | null> {
    const project = currentProject()
    if (!mounted.current || !activeRef.current || runtimeRef.current !== 'browser' || !project?.mainFile || engineMutation.current) return null
    dependencyOperation.current?.abort()
    const controller = new AbortController(); dependencyOperation.current = controller
    const snapshot = { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, epoch = selectionEpoch.current
    setDependencyCheck({ snapshot, epoch, status: 'checking' })
    const eligible = () => mounted.current && !controller.signal.aborted && dependencyOperation.current === controller
      && runtimeRef.current === 'browser' && sourceIsCurrent(snapshot, epoch)
    try {
      // Reads pinned metadata and consent only; no engine payload, upload or compile.
      const preparation = await getBrowserPreparation(snapshot, controller.signal)
      if (!eligible()) return null
      const result: BrowserDependencyCheck = { snapshot, epoch, status: 'ready', preparation }
      setDependencyCheck(result)
      return result
    } catch (error) {
      if (!eligible()) return null
      const result: BrowserDependencyCheck = { snapshot, epoch, status: 'failed', error: messageOf(error) }
      setDependencyCheck(result)
      return result
    } finally { if (dependencyOperation.current === controller) dependencyOperation.current = null }
  }
  inspectDependenciesRef.current = inspectBrowserDependencies

  async function clearEngineCache() {
    if (running.current || engineMutation.current) { notify('info', 'cache', 'cache-busy', 'Wait for engine preparation or cancel the current local compile before clearing assets. Project writing is unchanged.'); return false }
    engineMutation.current = true; cacheReadSequence.current++
    dependencyOperation.current?.abort(); setDependencyCheck(null)
    stopAutoSchedule()
    setEngineCacheBusy(true)
    try {
      await clearBrowserEngineCache(); await refreshEngineCache()
      if (mounted.current) notify('success', 'cache', 'cache-cleared', 'Engine asset cache and package permissions cleared. Project sources, checkpoints and PDF proofs are unchanged. Offline availability is not promised.', null)
      return true
    } finally { engineMutation.current = false; if (mounted.current) { setEngineCacheBusy(false); void inspectDependenciesRef.current() } }
  }
  async function continueBrowserPreparation() {
    if (engineMutation.current) return false
    const request = preparationRef.current
    const capturedEpoch = selectionEpoch.current
    const currentRequest = () => {
      const project = currentProject()
      return mounted.current && activeRef.current && request && preparationRef.current === request && project && runtimeRef.current === 'browser'
        && capturedEpoch === selectionEpoch.current && !running.current && !unresolved.current && request.projectId === project.id && request.revision === project.revision && sameProjectSource(request.snapshot, project) ? project : null
    }
    if (!request || !currentRequest()) {
      dismissBrowserPreparation(); notify('info', 'build', 'preparation-stale', 'Source or runtime changed while engine preparation was waiting. Compile the latest revision explicitly.', request?.snapshot ?? null); return false
    }
    const controller = new AbortController()
    preparationOperation.current = controller; engineMutation.current = true
    let next: LatexProject | null = null
    setEngineCacheBusy(true)
    try {
      if (request.packages) await approveBrowserPackageGroups(request.packages, controller.signal)
      next = controller.signal.aborted ? null : currentRequest()
      // Consent authorizes only public group pins, never an old source intent.
      // Recheck after storage/digest awaits before starting any compiler worker.
      if (!next) {
        if (mounted.current && preparationRef.current === request) { dismissBrowserPreparation(); notify('info', 'build', 'approval-stale', 'Source, runtime or workspace changed during package approval. No compile started; compile the latest revision explicitly.', request.snapshot) }
        return false
      }
      if (request.memoryGB !== undefined) memoryAcknowledged.current = true
      preparationRef.current = null; setBrowserPreparation(null)
      dependencyOperation.current?.abort(); setDependencyCheck(null)
      queued.current = null; setQueuedRevision(null)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && preparationRef.current === request) {
        const failedApproval = { ...request, error: messageOf(error) }
        preparationRef.current = failedApproval; setBrowserPreparation(failedApproval)
      }
    }
    finally { preparationOperation.current = null; engineMutation.current = false; if (mounted.current) setEngineCacheBusy(false) }
    if (next) enqueueCompile(next, 'manual', request.operationKey, true, [...new Set([...(request.packageGroups ?? []), ...(request.packages?.groups.map((group) => group.id) ?? [])])])
    return Boolean(next)
  }
  async function downloadBrowserPackages(snapshot: LatexProject, packages: BrowserPreparation, epoch: number) {
    if (runtimeRef.current !== 'browser' || !sourceIsCurrent(snapshot, epoch) || running.current || unresolved.current || engineMutation.current
      || !packages.groups.length || packages.groups.some((group) => group.kind !== 'package' || !group.profiles.includes(snapshot.engine))) return false
    const request: BrowserPreparationRequest = { projectId: snapshot.id, revision: snapshot.revision, snapshot,
      operationKey: newLatexId(), packages }
    preparationRef.current = request; setBrowserPreparation(request); stopAutoSchedule()
    // The caller has displayed exact pinned groups/bytes. This click is consent, not a second confirmation dialog.
    return continueBrowserPreparation()
  }
  function dismissBrowserPreparation() {
    const request = preparationRef.current
    preparationOperation.current?.abort(); preparationRef.current = null; setBrowserPreparation(null); queued.current = null; setQueuedRevision(null); stopAutoSchedule()
    if (request) setAttempt((current) => current?.operationKey === request.operationKey && current.stage === 'awaiting_action' ? null : current)
  }

  async function cancelCompile() {
    const slot = running.current, intent = slot ?? unresolved.current
    if (!intent) return
    queued.current = null; setQueuedRevision(null); stopAutoSchedule()
    setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, stage: 'cancelling', message: intent.runtime === 'browser' ? 'Terminating the local compiler worker. Source and the last good PDF are unchanged.' : 'Requesting server cancellation. Waiting for the sandbox acknowledgment.' } : current)
    try {
      const result = intent.runtime === 'browser' ? await cancelBrowserCompile(intent.operationKey) : await cancelLatexCompile(intent.operationKey)
      if (result.cancelled) {
        if (slot) { slot.cancelled = true; slot.controller.abort() }
        if (unresolved.current?.operationKey === intent.operationKey) unresolved.current = null
        if (intent.runtime === 'native') await clearPendingCompile(intent.operationKey, intent.snapshot)
        setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, stage: 'cancelled', message: intent.runtime === 'browser' ? 'Local cancellation acknowledged: the compiler worker was terminated. No server work or source upload exists to recover.' : 'Server acknowledged cancellation of this operation.' } : current)
      } else {
        if (result.status === 'failed') {
          if (slot) { slot.cancelled = true; slot.controller.abort() }
          if (unresolved.current?.operationKey === intent.operationKey) unresolved.current = null
          if (intent.runtime === 'native') await clearPendingCompile(intent.operationKey, intent.snapshot)
        }
        setAttempt((current) => current?.operationKey === intent.operationKey && !['ready', 'failed', 'cancelled'].includes(current.stage)
          ? { ...current, stage: result.status === 'failed' || intent.runtime === 'browser' ? 'failed' : running.current?.operationKey === intent.operationKey ? 'waiting' : 'recoverable', message: intent.runtime === 'browser' ? 'The local attempt already settled; there is no server operation to cancel or recover.' : `Cancellation was not acknowledged. Server status: ${result.status}.` } : current)
      }
    } catch (error) {
      const expired = intent.runtime === 'native' && error instanceof LatexTransportError && [404, 410].includes(error.status ?? 0)
      if (expired) {
        if (slot) { slot.cancelled = true; slot.controller.abort() }
        if (unresolved.current?.operationKey === intent.operationKey) unresolved.current = null
        await clearPendingCompile(intent.operationKey, intent.snapshot)
      }
      setAttempt((current) => current?.operationKey === intent.operationKey && !['ready', 'failed', 'cancelled'].includes(current.stage)
        ? { ...current, stage: expired || intent.runtime === 'browser' ? 'failed' : running.current?.operationKey === intent.operationKey ? 'waiting' : 'recoverable', message: expired ? 'The server no longer retains this operation. Local source and retained PDFs are unchanged; compile again explicitly if needed.' : `Cancellation is unconfirmed. ${messageOf(error)}` } : current)
    }
  }

  function stopWaiting() {
    const slot = running.current
    if (!slot) return
    if (slot.runtime === 'browser') { void cancelCompile(); return }
    slot.stopped = true; queued.current = null; setQueuedRevision(null); stopAutoSchedule(); slot.controller.abort()
  }

  async function recoverCompile() {
    const intent = unresolved.current
    if (!intent || intent.runtime !== 'native' || running.current || !onlineRef.current || !activeRef.current) return
    // Deliberately bypass runtime selection and the new-upload dispatcher.
    await execute(intent, true)
  }

  const project = projects.find((item) => item.id === projectId) ?? null
  useEffect(() => {
    if (!ready || !active || runtime !== 'browser' || !project?.mainFile) return
    const timer = setTimeout(() => { void inspectDependenciesRef.current() }, 250)
    return () => { clearTimeout(timer); dependencyOperation.current?.abort() }
    // Check import/project/main/engine changes, not every source keystroke.
  }, [ready, active, runtime, project?.id, project?.mainFile, project?.engine])
  const selectedProof = project ? proofs[project.id] ?? null : null
  const proofCurrent = matchesProofSnapshot(project, project ? proofSources[project.id] : null, selectedProof)
  const feedbackFacts: FeedbackFact[] = []
  for (const source of projects) {
    const saved = saves[source.id]
    if (saved?.kind === 'session' || saved?.kind === 'conflict') feedbackFacts.push(workspaceFeedbackFact({ id: `source-risk:${source.id}`, category: 'source', code: saved.kind,
      projectId: source.id, projectTitle: source.title, priority: 0, severity: 'error', lifecycle: 'attention', dedupeKey: saved.riskId ?? saved.reason ?? saved.kind,
      createdAt: saved.since ?? 0, summary: saved.kind === 'conflict' ? 'Another tab saved this project. This tab kept its own writing.' : 'Changes are only in this session.',
      detailRef: `save:${source.id}`, actionIds: ['export-source', 'save-copy', ...(saved.kind === 'conflict' ? ['reload-source'] : [])] }))
  }
  if (protectedRecords.length) feedbackFacts.push(workspaceFeedbackFact({ id: 'protected-records', category: 'storage', code: 'protected-records', projectId: null, priority: 0, severity: 'warning', lifecycle: 'attention',
    dedupeKey: protectedRecords.join('\n'), createdAt: 0, summary: 'Some stored originals could not be opened. They were preserved, not overwritten.', actionIds: ['view-protected'] }))
  for (const issue of retentionIssues) feedbackFacts.push(workspaceFeedbackFact({ id: `${issue.kind}:${issue.operationKey}`, category: 'retention', code: issue.kind, projectId: issue.projectId,
    projectTitle: projects.find((item) => item.id === issue.projectId)?.title, revision: issue.revision, operationKey: issue.operationKey, priority: 1, severity: 'warning', lifecycle: 'attention',
    createdAt: issue.createdAt, summary: issue.message, actionIds: issue.kind === 'recovery' ? ['retry-cleanup'] : ['download-pdf', 'export-source'] }))
  if (attempt) feedbackFacts.push(attemptFeedback(attempt))
  if (dependencyCheck?.status === 'ready' && dependencyCheck.preparation?.groups.length && project && sourceIsCurrent(dependencyCheck.snapshot, dependencyCheck.epoch)
    && runtime === 'browser' && !running.current && browserPreparation?.projectId !== project.id) {
    const packages = dependencyCheck.preparation
    feedbackFacts.push(workspaceFeedbackFact({ category: 'runtime', code: 'template-packages', actionRequestId: `dependencies:${project.id}:${project.revision}:${packages.profileVersion}:${packages.groups.map((group) => group.id).join(',')}`,
      projectId: project.id, projectTitle: project.title, revision: project.revision, priority: 1, severity: 'warning', lifecycle: 'attention', createdAt: 0,
      summary: `This template references ${packages.groups.length} package ${packages.groups.length === 1 ? 'group' : 'groups'} requiring download permission. Review the packages before compiling.`, actionIds: ['review-dependencies'] }))
  }
  if (project?.mainFile === null) feedbackFacts.push(workspaceFeedbackFact({ category: 'setup', code: 'missing-main', projectId: project.id, projectTitle: project.title, revision: project.revision,
    priority: 1, severity: 'warning', lifecycle: 'attention', createdAt: 0, summary: 'Choose the main .tex file to compile.', actionIds: ['choose-main'] }))
  return { ready, project, projects, saves, saveState: project ? saves[project.id] : undefined, storageWarning, protectedRecords, checkpoints, proofCurrent,
    proof: selectedProof, proofSource: project ? proofSources[project.id] ?? null : null, proofAttempt: selectedProof ? proofAttempts[selectedProof.projectId] ?? null : null, capabilities, capabilitiesLoading, runtime, selectRuntime, online, autoCompile, attempt, queuedRevision,
    syncArtifact: project && selectedProof && browserMaps[project.id]?.identity === proofActionIdentity(selectedProof) ? browserMaps[project.id] : null,
    actionEpoch: () => selectionEpoch.current,
    feedback, feedbackFacts, notify, reportFeedback,
    dismissFeedback: (fact: FeedbackFact) => setFeedback((state) => feedbackReducer(state, { type: 'dismiss', fact })),
    expireReceipt: (fact: FeedbackFact) => setFeedback((state) => feedbackReducer(state, { type: 'expire-receipt', identity: feedbackIdentity(fact) })),
    engineCache, engineCacheBusy, browserPreparation, dependencyCheck, retentionIssues, refreshEngineCache, inspectBrowserDependencies, clearEngineCache, continueBrowserPreparation, downloadBrowserPackages, dismissBrowserPreparation,
    dismissDependencyCheck: () => { dependencyOperation.current?.abort(); setDependencyCheck(null) },
    retryRecoveryCleanup: (issue: LatexRetentionIssue) => clearPendingCompile(issue.operationKey, projectsRef.current.find((item) => item.id === issue.projectId)),
    setAutoCompile, refreshCapabilities, flushSave, changeText, validateTextChange, applyProject, addProject, selectProject, checkpointNow, sourceIsCurrent, proofIsCurrent,
    saveAsNewProject: () => { const current = currentProject(); if (current) addProject(cloneAsNewProject(current)) }, reloadStoredProject, removeProject,
    compile: () => { const current = currentProject(); if (current) { if (autoTimer.current) clearTimeout(autoTimer.current); enqueueCompile(current, 'manual') } }, cancelCompile, stopWaiting, recoverCompile }
}
