'use client'

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cancelLatexCompile, compileLatexProject, getLatexCapabilities, getLatexOperation, LatexTransportError } from './compileTransport.ts'
import { LATEX_MAIN_FILE_NOTICE, type LatexCapabilities, type LatexCheckpoint, type LatexDiagnostic, type LatexProject, type LatexProof, type LatexRuntime, unavailableLatexCapabilities } from './types.ts'
import { cloneAsNewProject, isCurrentProof, isRecord, makeCheckpoint, newLatexId, projectSnapshotHash, reviseProject, sameProjectSource, validateLatexProject } from './project.ts'
import { LatexProjectStore, LatexStorageError, LOCAL_LATEX_LIMITS, openLatexProjectStore } from './projectStore.ts'
import { createTemplateProject } from './templates.ts'
import { mayAutoCompile, newerProof, recoverableCompileFailure } from './compilePolicy.ts'
import { approveBrowserPackageGroups, BrowserPackageGroupRequiredError, browserLatexCompatibility, cancelBrowserCompile, clearBrowserEngineCache, compileBrowserProject, getBrowserCapabilities, getBrowserEngineCacheSummary, type BrowserPreparation, type LatexCompileProgress } from './browserCompiler.ts'
import { repairAltaCvBrowserProject } from './altacvBrowser.ts'
import type { EngineCacheSummary } from './engineAssetStore.ts'

export type LatexSaveState = { kind: 'unsaved' | 'saving' | 'saved' | 'session' | 'conflict'; revision?: number; savedAt?: string; reason?: string }
export type CompileAttempt = { projectId: string; revision: number; operationKey: string; stage: 'waiting' | 'ready' | 'failed' | 'cancelling' | 'cancelled' | 'recoverable' | 'recovering';
  message: string; diagnostics: LatexDiagnostic[]; log: string; snapshot: LatexProject; requestId?: string; runtime: LatexRuntime; progress?: LatexCompileProgress }
type CompileIntent = { snapshot: LatexProject; operationKey: string; mode: 'manual' | 'auto'; runtime: LatexRuntime }
type RunningCompile = CompileIntent & { controller: AbortController; cancelled: boolean; stopped: boolean }
const onlineSnapshot = () => typeof navigator !== 'undefined' && navigator.onLine
const subscribeOnline = (notify: () => void) => { window.addEventListener('online', notify); window.addEventListener('offline', notify); return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify) } }
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed. Your writing is unchanged.'
export function browserMemoryWarning(memory: unknown): number | null {
  return typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory < 4 ? memory : null
}
export type BrowserPreparationRequest = { projectId: string; revision: number; snapshot: LatexProject; memoryGB?: number; packages?: BrowserPreparation }

export default function useLatexWorkspace(active: boolean) {
  const [projects, setProjects] = useState<LatexProject[]>([]), [projectId, setProjectId] = useState<string | null>(null)
  const [ready, setReady] = useState(false), [saves, setSaves] = useState<Record<string, LatexSaveState>>({})
  const [checkpoints, setCheckpoints] = useState<LatexCheckpoint[]>([]), [proofs, setProofs] = useState<Record<string, LatexProof>>({})
  const [proofSources, setProofSources] = useState<Record<string, LatexProject>>({})
  const [protectedRecords, setProtectedRecords] = useState<string[]>([]), [storageWarning, setStorageWarning] = useState('')
  const [capabilities, setCapabilities] = useState<LatexCapabilities>({ ...unavailableLatexCapabilities, reason: 'Compiler availability has not been checked. Source editing remains local.' })
  const [runtime, setRuntime] = useState<LatexRuntime>('browser')
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false), [autoCompile, setAutoCompile] = useState(false)
  const [attempt, setAttempt] = useState<CompileAttempt | null>(null), [queuedRevision, setQueuedRevision] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [engineCache, setEngineCache] = useState<EngineCacheSummary | null>(null), [engineCacheBusy, setEngineCacheBusy] = useState(false)
  const [browserPreparation, setBrowserPreparation] = useState<BrowserPreparationRequest | null>(null)
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => false)
  const store = useRef<LatexProjectStore | null>(null), expected = useRef(new Map<string, number | null>())
  const proofSnapshots = useRef<Record<string, LatexProject>>({})
  const projectsRef = useRef(projects), idRef = useRef(projectId), savesRef = useRef(saves), proofsRef = useRef(proofs)
  // These refs are updated by the canonical actions below, never copied back from a possibly older React render.
  const mounted = useRef(true), activeRef = useRef(active), onlineRef = useRef(online), capabilitiesRef = useRef(capabilities), autoRef = useRef(autoCompile)
  const runtimeRef = useRef<LatexRuntime>('browser')
  const memoryAcknowledged = useRef(false), preparationRef = useRef<BrowserPreparationRequest | null>(null)
  const engineMutation = useRef(false), preparationOperation = useRef<AbortController | null>(null), cacheReadSequence = useRef(0)
  useLayoutEffect(() => { activeRef.current = active; onlineRef.current = online; capabilitiesRef.current = capabilities; autoRef.current = autoCompile }, [active, online, capabilities, autoCompile])
  const channel = useRef<BroadcastChannel | null>(null), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve()), running = useRef<RunningCompile | null>(null), queued = useRef<CompileIntent | null>(null)
  const unresolved = useRef<CompileIntent | null>(null), retryAt = useRef(0), capabilitiesRequest = useRef<AbortController | null>(null)
  const executeRef = useRef<(intent: CompileIntent) => Promise<void>>(async () => {})

  const currentProject = () => projectsRef.current.find((project) => project.id === idRef.current) ?? null
  function updateSave(id: string, state: LatexSaveState) {
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
        updateSave(project.id, { kind: conflict ? 'conflict' : 'session', reason: messageOf(error) })
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
      running.current?.controller.abort(); capabilitiesRequest.current?.abort(); preparationOperation.current?.abort()
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
    if (running.current || unresolved.current) { setNotice('Cancel or resolve the current compile before changing runtime. No source was uploaded or converted by this action.'); return false }
    // Auto/upload consent belongs to one runtime, never to a later selection.
    stopAutoSchedule(); autoRef.current = false; setAutoCompile(false); capabilitiesRequest.current?.abort()
    preparationOperation.current?.abort()
    runtimeRef.current = next; setRuntime(next)
    preparationRef.current = null; setBrowserPreparation(null)
    retryAt.current = 0
    const unavailable = { ...unavailableLatexCapabilities, reason: next === 'browser' ? 'Checking the fixed browser-local engine bundle. No source is uploaded.' : 'Checking the explicitly selected private native compiler.' }
    capabilitiesRef.current = unavailable; setCapabilities(unavailable); setCapabilitiesLoading(false); setAttempt(null)
    setNotice(next === 'browser' ? 'Browser-local runtime selected. Source, images, logs and PDFs stay on this device. First use downloads only the fixed engine assets.' : 'Private native runtime selected explicitly. Auto Compile is off; source upload still requires informed compile consent.')
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
    } catch (error) { setNotice(messageOf(error)) }
  }

  function applyProject(next: LatexProject, checkpointLabel?: string) {
    const current = currentProject()
    if (!current || current.id !== next.id || next.revision <= current.revision) throw new Error('A change must target the current project as a new revision.')
    validateLatexProject(next)
    stopAutoSchedule()
    const checkpoint = checkpointLabel ? makeCheckpoint(current, checkpointLabel) : undefined
    if (checkpoint) retainCheckpoint(checkpoint)
    replaceProject(next)
    if (!['conflict', 'session'].includes(savesRef.current[next.id]?.kind)) updateSave(next.id, { kind: 'unsaved', revision: expected.current.get(next.id) ?? undefined })
    if (checkpoint) void queueSave(next, checkpoint)
    else scheduleSave(next)
  }

  function addProject(project: LatexProject) {
    validateLatexProject(project)
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('This workspace already has eight projects. Export and explicitly remove one before creating another.')
    void flushSave(); stopAutoSchedule()
    expected.current.set(project.id, null)
    const state: LatexSaveState = { kind: store.current ? 'unsaved' : 'session', reason: store.current ? undefined : 'Device storage is unavailable.' }
    updateSave(project.id, state)
    projectsRef.current = [project, ...projectsRef.current]; idRef.current = project.id
    setProjects(projectsRef.current); setProjectId(project.id)
    void queueSave(project)
  }

  function selectProject(id: string) {
    if (!projectsRef.current.some((item) => item.id === id) || id === idRef.current) return
    void flushSave(); stopAutoSchedule(); idRef.current = id; setProjectId(id)
  }

  async function checkpointNow(label = 'Manual checkpoint', snapshot?: LatexProject) {
    const project = snapshot ?? currentProject()
    if (!project) return
    const checkpoint = makeCheckpoint(project, label)
    retainCheckpoint(checkpoint)
    const latest = projectsRef.current.find((item) => item.id === project.id)
    const committed = latest ? await queueSave(latest, checkpoint) : false
    setNotice(committed ? `Checkpoint committed for revision ${project.revision}. The six most recent checkpoints are kept.` : 'Checkpoint kept in this session only. Export a source ZIP for a portable backup.')
  }

  async function reloadStoredProject() {
    const current = currentProject(), database = store.current
    if (!current || !database) { setNotice('Device storage is unavailable. Export your current source ZIP.'); return }
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('Export the current writing before reloading; a recovery copy would exceed the eight-project limit.')
    const restored = await database.readWorkspace(), stored = restored.projects.find((item) => item.id === current.id)
    if (!stored) throw new Error('The stored project could not be restored. Its original record was kept.')
    const latest = currentProject()
    if (!latest || latest.id !== current.id) throw new Error('The selected project changed while storage was read. No writing was replaced; request recovery again.')
    if (projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('A new project was added during recovery. Export your writing before reloading; no source was replaced.')
    const copy = cloneAsNewProject(latest, `${latest.title || 'Project'} unsaved recovery`)
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
    void queueSave(copy)
    setStorageWarning(''); setNotice('Stored source restored. Your previous in-memory source remains a separate recovery project.')
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
    const revision = expected.current.get(id)
    if (store.current && revision !== undefined && revision !== null) await store.current.deleteProject(id, revision)
    const remaining = projectsRef.current.filter((item) => item.id !== id)
    if (!remaining.length) {
      const initial = createTemplateProject(); remaining.push(initial); expected.current.set(initial.id, null); updateSave(initial.id, { kind: store.current ? 'unsaved' : 'session' })
    }
    projectsRef.current = remaining; idRef.current = remaining[0].id
    setProjects(remaining); setProjectId(remaining[0].id); setCheckpoints((items) => items.filter((item) => item.project.id !== id))
    const nextProofs = { ...proofsRef.current }; delete nextProofs[id]; proofsRef.current = nextProofs; setProofs(nextProofs)
    const nextSources = { ...proofSnapshots.current }; delete nextSources[id]; proofSnapshots.current = nextSources; setProofSources(nextSources)
    channel.current?.postMessage({ id, removed: true })
    setNotice('The selected project was explicitly removed. Other projects and the Regular draft are unchanged.')
  }

  function enqueueCompile(project: LatexProject, mode: CompileIntent['mode'], operationKey = newLatexId()) {
    try { validateLatexProject(project) } catch (error) { setNotice(messageOf(error)); return }
    if (project.mainFile === null) { if (mode === 'manual') setNotice(LATEX_MAIN_FILE_NOTICE); return }
    if (engineMutation.current) { if (mode === 'manual') setNotice('Wait for the engine cache action or package consent to finish before compiling. No source was sent.'); return }
    if (preparationRef.current) { if (mode === 'auto') return; dismissBrowserPreparation() }
    const selectedRuntime = runtimeRef.current
    if (!activeRef.current || (selectedRuntime === 'native' && !onlineRef.current) || !capabilitiesRef.current.enabled || !capabilitiesRef.current.ready) { if (mode === 'manual') setNotice(selectedRuntime === 'native' && !onlineRef.current ? 'Offline. Private native compilation is paused; source editing and retained downloads still work.' : capabilitiesRef.current.reason); return }
    if (!capabilitiesRef.current.profiles.some((profile) => profile.id === project.engine)) { setNotice('The selected engine is not a ready compiler profile. Choose a reported supported engine.'); return }
    if (Date.now() < retryAt.current) { if (mode === 'manual') setNotice('The compiler fair-use limit is active. New source was kept; no automatic retry was started.'); return }
    const memoryGB = browserMemoryWarning(typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    if (selectedRuntime === 'browser' && memoryGB !== null && !memoryAcknowledged.current) {
      const request = { projectId: project.id, revision: project.revision, snapshot: { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, memoryGB }
      preparationRef.current = request; setBrowserPreparation(request); stopAutoSchedule()
      return
    }
    if (mode === 'manual' && selectedRuntime === 'browser') {
      try {
        const repaired = repairAltaCvBrowserProject(project)
        if (repaired !== project) {
          applyProject(repaired, `Before AltaCV font repair r${project.revision}`)
          project = repaired
          setNotice("Updated the older browser copy's generated font setup for this engine. A checkpoint preserves the previous source; your writing, images and original AltaCV files are unchanged.")
        }
      } catch (error) { setNotice(messageOf(error)); return }
    }
    const intent: CompileIntent = { snapshot: { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, operationKey, mode, runtime: selectedRuntime }
    preparationRef.current = null; setBrowserPreparation(null)
    if (running.current) {
      if (project.id === running.current.snapshot.id && project.revision === running.current.snapshot.revision && sameProjectSource(project, running.current.snapshot)) {
        queued.current = null; setQueuedRevision(null); if (mode === 'manual') setNotice('This exact source revision is already in flight. No duplicate compile was queued.'); return
      }
      queued.current = intent; setQueuedRevision(project.revision); return
    }
    if (unresolved.current) { queued.current = mode === 'manual' ? intent : null; setQueuedRevision(mode === 'manual' ? project.revision : null); setNotice('The previous operation is not terminal yet. Recover or cancel it explicitly before starting more work.'); return }
    void executeRef.current(intent)
  }

  async function execute(intent: CompileIntent) {
    if (intent.runtime !== runtimeRef.current || !activeRef.current || (intent.runtime === 'native' && !onlineRef.current)) return
    const slot: RunningCompile = { ...intent, controller: new AbortController(), cancelled: false, stopped: false }
    let terminal = false
    running.current = slot; unresolved.current = null
    let lastProgress: LatexCompileProgress | undefined
    if (mounted.current) setAttempt({ projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, stage: 'waiting',
      message: intent.runtime === 'browser' ? 'Preparing the captured revision for local browser compilation. No source is uploaded.' : 'Uploading this revision and waiting for the private compiler. You can keep editing.', diagnostics: [], log: '', snapshot: intent.snapshot, runtime: intent.runtime })
    if (store.current && intent.runtime === 'native') {
      // Save the captured revision before upload so a reload can recover the exact operation without re-uploading source.
      try { await store.current.retainPendingCompile({ operationKey: intent.operationKey, snapshot: intent.snapshot, snapshotHash: await projectSnapshotHash(intent.snapshot), createdAt: new Date().toISOString() }) }
      catch { /* Best-effort capture: losing it only removes reload recovery, never the compile itself. */ }
    }
    try {
      const proof = intent.runtime === 'browser' ? await compileBrowserProject(intent.snapshot, intent.operationKey, slot.controller.signal, (progress) => {
        if (mounted.current && running.current === slot && !slot.cancelled && !slot.controller.signal.aborted) {
          lastProgress = { ...progress }
          setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, message: progress.message, progress } : current)
        }
      }) : await compileLatexProject(intent.snapshot, intent.operationKey, slot.controller.signal)
      if (slot.cancelled || slot.stopped || !mounted.current) return
      if (proof.projectId !== intent.snapshot.id || proof.revision !== intent.snapshot.revision) throw new Error('Compiler result identity does not match its immutable source snapshot.')
      terminal = true
      const latestSource = projectsRef.current.find((item) => item.id === proof.projectId), previousProof = proofsRef.current[proof.projectId]
      const previousIsCurrent = Boolean(isCurrentProof(latestSource ?? null, previousProof) && sameProjectSource(latestSource, proofSnapshots.current[proof.projectId]))
      const differentSource = latestSource?.revision === proof.revision && !sameProjectSource(latestSource, intent.snapshot)
      setAttempt({ projectId: proof.projectId, revision: proof.revision, operationKey: proof.operationKey, stage: 'ready', snapshot: intent.snapshot,
        message: differentSource ? `PDF ready for the captured r${proof.revision}, but the stored source at that revision is different. Current writing is unchanged.` : intent.runtime === 'browser' ? `PDF ready. Revision ${proof.revision} was compiled and verified on this device.` : `Typeset PDF ready for revision ${proof.revision}.`, diagnostics: proof.diagnostics, log: proof.log, runtime: intent.runtime, progress: lastProgress })
      if (newerProof(previousProof, proof) && !(previousIsCurrent && differentSource)) {
        proofSnapshots.current = { ...proofSnapshots.current, [proof.projectId]: intent.snapshot }; setProofSources(proofSnapshots.current)
        proofsRef.current = { ...proofsRef.current, [proof.projectId]: proof }; setProofs(proofsRef.current)
        const checkpoint = makeCheckpoint(intent.snapshot, `Successful compile r${proof.revision}`)
        retainCheckpoint(checkpoint)
        const latest = projectsRef.current.find((project) => project.id === proof.projectId)
        if (latest) {
          const saved = await queueSave(latest)
          if (saved && store.current) {
            try { await store.current.retainProof(proof, checkpoint) }
            catch (error) { if (mounted.current) setStorageWarning(`${messageOf(error)} The PDF and compile checkpoint are available in this session only.`) }
          } else if (mounted.current) setStorageWarning('The compiled PDF and checkpoint are session-only because this source could not save locally. Download the PDF and source ZIP before closing.')
        }
      }
      if (differentSource) {
        const recovery = projectsRef.current.find((item) => item.id !== proof.projectId && sameProjectSource(item, intent.snapshot))
        if (recovery) { proofSnapshots.current = { ...proofSnapshots.current, [recovery.id]: intent.snapshot }; setProofSources(proofSnapshots.current); proofsRef.current = { ...proofsRef.current, [recovery.id]: proof }; setProofs(proofsRef.current) }
      }
    } catch (error) {
      if (!mounted.current || slot.cancelled) return
      if (intent.runtime === 'browser' && error instanceof BrowserPackageGroupRequiredError) {
        const request = { projectId: intent.snapshot.id, revision: intent.snapshot.revision, snapshot: intent.snapshot, packages: error.preparation }
        preparationRef.current = request; setBrowserPreparation(request); stopAutoSchedule()
      }
      const transport = error instanceof LatexTransportError ? error : null
      const recoverable = intent.runtime === 'native' && (slot.stopped || Boolean(transport && recoverableCompileFailure(transport.code, transport.status)))
      if (recoverable) unresolved.current = intent
      if (transport?.status === 429) { retryAt.current = Date.now() + (transport.retryAfterSeconds ?? 60) * 1000; stopAutoSchedule() }
      setAttempt({ projectId: intent.snapshot.id, revision: intent.snapshot.revision, operationKey: intent.operationKey, stage: transport?.code === 'browser_compile_cancelled' ? 'cancelled' : recoverable ? 'recoverable' : 'failed',
        message: slot.stopped ? 'Stopped waiting. Server cancellation has not been acknowledged; admitted work remains deadline-bounded.' : messageOf(error),
        diagnostics: transport?.diagnostics ?? [], log: transport?.log ?? '', snapshot: intent.snapshot, requestId: transport?.request_id, runtime: intent.runtime, progress: lastProgress })
    } finally {
      if (intent.runtime === 'native' && (terminal || slot.cancelled)) await clearPendingCompile(intent.operationKey)
      if (running.current === slot) running.current = null
      if (mounted.current && intent.runtime === 'browser') void refreshEngineCache()
      if (!mounted.current || unresolved.current || preparationRef.current) return
      const next = queued.current; queued.current = null; setQueuedRevision(null)
      if (next && next.runtime === runtimeRef.current && activeRef.current && (next.runtime === 'browser' || onlineRef.current) && (next.mode === 'manual' || mayAutoCompile({ enabled: autoRef.current, active: activeRef.current, online: onlineRef.current, runtime: next.runtime, ready: capabilitiesRef.current.ready, retryAt: retryAt.current }))) void executeRef.current(next)
    }
  }
  executeRef.current = execute

  async function clearPendingCompile(operationKey: string) {
    // Storage cleanup must never turn an acknowledged terminal compile into a thrown error.
    try { await store.current?.clearPendingCompile(operationKey) }
    catch { /* Reload recovery still resolves the saved record against the server status. */ }
  }

  async function refreshEngineCache() {
    const sequence = ++cacheReadSequence.current
    try { const summary = await getBrowserEngineCacheSummary(); if (mounted.current && sequence === cacheReadSequence.current) setEngineCache(summary) }
    catch (error) { if (mounted.current && sequence === cacheReadSequence.current) setEngineCache({ available: false, bytes: 0, entries: 0, versions: [], reason: messageOf(error) }) }
  }
  useEffect(() => { if (active && runtime === 'browser') void refreshEngineCache() }, [active, runtime])

  async function clearEngineCache() {
    if (running.current || engineMutation.current) { setNotice('Wait for engine preparation or cancel the current local compile before clearing assets. Project writing is unchanged.'); return false }
    engineMutation.current = true; cacheReadSequence.current++
    stopAutoSchedule()
    setEngineCacheBusy(true)
    try {
      await clearBrowserEngineCache(); await refreshEngineCache()
      if (mounted.current) setNotice('Engine asset cache and package permissions cleared. Project sources, checkpoints and PDF proofs are unchanged. The next compile may read its fixed assets from HTTP cache or download them again; offline availability is not promised.')
      return true
    } catch (error) { if (mounted.current) setNotice(messageOf(error)); return false }
    finally { engineMutation.current = false; if (mounted.current) setEngineCacheBusy(false) }
  }
  async function continueBrowserPreparation() {
    if (engineMutation.current) return
    const request = preparationRef.current
    const currentRequest = () => {
      const project = currentProject()
      return mounted.current && activeRef.current && request && preparationRef.current === request && project && runtimeRef.current === 'browser'
        && !running.current && !unresolved.current && request.projectId === project.id && request.revision === project.revision && sameProjectSource(request.snapshot, project) ? project : null
    }
    if (!request || !currentRequest()) {
      dismissBrowserPreparation(); setNotice('Source or runtime changed while engine preparation was waiting. Compile the latest revision explicitly.'); return
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
        if (mounted.current && preparationRef.current === request) { dismissBrowserPreparation(); setNotice('Source, runtime or workspace changed during package approval. No compile started; compile the latest revision explicitly.') }
        return
      }
      if (request.memoryGB !== undefined) memoryAcknowledged.current = true
      preparationRef.current = null; setBrowserPreparation(null)
      queued.current = null; setQueuedRevision(null)
    } catch (error) { if (mounted.current && !controller.signal.aborted) setNotice(messageOf(error)) }
    finally { preparationOperation.current = null; engineMutation.current = false; if (mounted.current) setEngineCacheBusy(false) }
    if (next) enqueueCompile(next, 'manual')
  }
  function dismissBrowserPreparation() { preparationOperation.current?.abort(); preparationRef.current = null; setBrowserPreparation(null); queued.current = null; setQueuedRevision(null); stopAutoSchedule() }

  async function cancelCompile() {
    const slot = running.current, intent = slot ?? unresolved.current
    if (!intent) return
    queued.current = null; setQueuedRevision(null); stopAutoSchedule()
    setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, stage: 'cancelling', message: intent.runtime === 'browser' ? 'Terminating the local compiler worker. Source and the last good PDF are unchanged.' : 'Requesting server cancellation. Waiting for the sandbox acknowledgment.' } : current)
    try {
      const result = intent.runtime === 'browser' ? await cancelBrowserCompile(intent.operationKey) : await cancelLatexCompile(intent.operationKey)
      if (result.cancelled) {
        if (slot) { slot.cancelled = true; slot.controller.abort() }
        unresolved.current = null
        setAttempt((current) => current?.operationKey === intent.operationKey ? { ...current, stage: 'cancelled', message: intent.runtime === 'browser' ? 'Local cancellation acknowledged: the compiler worker was terminated. No server work or source upload exists to recover.' : 'Server acknowledged cancellation of this operation.' } : current)
      } else {
        if (result.status === 'failed' && !running.current && unresolved.current?.operationKey === intent.operationKey) { unresolved.current = null; await clearPendingCompile(intent.operationKey) }
        setAttempt((current) => current?.operationKey === intent.operationKey && !['ready', 'failed', 'cancelled'].includes(current.stage)
          ? { ...current, stage: result.status === 'failed' || intent.runtime === 'browser' ? 'failed' : running.current?.operationKey === intent.operationKey ? 'waiting' : 'recoverable', message: intent.runtime === 'browser' ? 'The local attempt already settled; there is no server operation to cancel or recover.' : `Cancellation was not acknowledged. Server status: ${result.status}.` } : current)
      }
    } catch (error) { setAttempt((current) => current?.operationKey === intent.operationKey && !['ready', 'failed', 'cancelled'].includes(current.stage)
      ? { ...current, stage: intent.runtime === 'browser' ? 'failed' : running.current?.operationKey === intent.operationKey ? 'waiting' : 'recoverable', message: `Cancellation is unconfirmed. ${messageOf(error)}` } : current) }
  }

  function stopWaiting() {
    const slot = running.current
    if (!slot) return
    if (slot.runtime === 'browser') { void cancelCompile(); return }
    slot.stopped = true; queued.current = null; setQueuedRevision(null); stopAutoSchedule(); slot.controller.abort()
  }

  async function recoverCompile() {
    const intent = unresolved.current
    if (!intent || intent.runtime !== 'native' || running.current || !onlineRef.current) return
    setAttempt((current) => current ? { ...current, stage: 'recovering', message: 'Checking the captured operation. Current source is not re-uploaded.' } : current)
    try {
      const operation = await getLatexOperation(intent.operationKey)
      if (operation.status === 'ready') { await executeRef.current(intent); return }
      if (operation.status === 'running') { setAttempt((current) => current ? { ...current, stage: 'recoverable', message: 'The server still reports this operation as running. No automatic polling or duplicate build was started.' } : current); return }
      unresolved.current = null
      setAttempt((current) => current ? { ...current, stage: operation.status === 'cancelled' ? 'cancelled' : 'failed', message: operation.error ?? `Server operation is ${operation.status}.` } : current)
      const next = queued.current; queued.current = null; setQueuedRevision(null)
      if (next && next.mode === 'manual' && activeRef.current && onlineRef.current) void executeRef.current(next)
    } catch (error) {
      const expired = error instanceof LatexTransportError && [404, 410].includes(error.status ?? 0)
      if (expired) { unresolved.current = null; queued.current = null; setQueuedRevision(null) }
      setAttempt((current) => current ? { ...current, stage: expired ? 'failed' : 'recoverable', message: expired ? 'The server no longer has this private operation/result. Local source and retained PDFs are unchanged. Compile again explicitly if needed.' : `Operation recovery is unavailable. ${messageOf(error)}` } : current)
    }
  }

  const project = projects.find((item) => item.id === projectId) ?? null
  const selectedProof = project ? proofs[project.id] ?? null : null
  const proofCurrent = Boolean(isCurrentProof(project, selectedProof) && sameProjectSource(project, project ? proofSources[project.id] : null))
  return { ready, project, projects, saves, saveState: project ? saves[project.id] : undefined, storageWarning, protectedRecords, checkpoints, proofCurrent,
    proof: selectedProof, capabilities, capabilitiesLoading, runtime, selectRuntime, online, autoCompile, attempt, queuedRevision, notice,
    engineCache, engineCacheBusy, browserPreparation, refreshEngineCache, clearEngineCache, continueBrowserPreparation, dismissBrowserPreparation,
    setNotice, setAutoCompile, refreshCapabilities, flushSave, changeText, validateTextChange, applyProject, addProject, selectProject, checkpointNow,
    saveAsNewProject: () => { const current = currentProject(); if (current) addProject(cloneAsNewProject(current)) }, reloadStoredProject, removeProject,
    compile: () => { const current = currentProject(); if (current) { if (autoTimer.current) clearTimeout(autoTimer.current); enqueueCompile(current, 'manual') } }, cancelCompile, stopWaiting, recoverCompile }
}
