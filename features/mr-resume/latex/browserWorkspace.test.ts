import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { browserMemoryWarning } from './useLatexWorkspace.ts'
import { createTemplateProject } from './templates.ts'
import { reviseProject, sameProjectSource } from './project.ts'
import { unavailableLatexCapabilities, type LatexProject } from './types.ts'

const hookSource = readFileSync(new URL('./useLatexWorkspace.ts', import.meta.url), 'utf8')
const hook = ts.createSourceFile('useLatexWorkspace.ts', hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const ui = readFileSync(new URL('./LatexResumeStudio.tsx', import.meta.url), 'utf8')
const regular = readFileSync(new URL('../components/MrResumeStudio.tsx', import.meta.url), 'utf8')
function action(name: string) {
  let source = ''
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) source = node.getText(hook); ts.forEachChild(node, visit) }
  visit(hook)
  assert.ok(source, `Expected ${name} workflow action`)
  return source
}

test('runtime defaults local, remains feature-owned, and changing it cannot enable an automatic private upload', () => {
  assert.match(hookSource, /useState<LatexRuntime>\('browser'\)/u)
  const select = action('selectRuntime')
  assert.ok(select.indexOf('running.current || unresolved.current') < select.indexOf('setRuntime(next)'))
  assert.match(select, /autoRef.current = false; setAutoCompile\(false\)/u)
  assert.match(select, /capabilitiesRequest.current\?\.abort\(\)/u)
  assert.match(ui, /workspace.selectRuntime[\s\S]*?setConsent\(false\)/u)
  assert.doesNotMatch(regular, /browserCompiler|compileBrowserProject|cancelBrowserCompile|WebAssembly/u)
})

test('worker progress belongs only to the live captured intent and local errors cannot recover through native APIs', () => {
  const execute = action('execute')
  assert.match(execute, /intent.runtime === 'browser' \? await compileBrowserProject/u)
  assert.match(execute, /running.current === slot && !slot.cancelled && !slot.controller.signal.aborted/u)
  assert.match(execute, /const recoverable = intent.runtime === 'native'/u)
  assert.match(action('recoverCompile'), /intent.runtime !== 'native'/u)
  assert.match(action('cancelCompile'), /intent.runtime === 'browser' \? await cancelBrowserCompile/u)
  assert.match(action('stopWaiting'), /slot.runtime === 'browser'.*cancelCompile/u)
  const schedule = action('scheduleAuto')
  assert.match(schedule, /queued.current\?\.mode === 'auto' && queued.current.snapshot.id === project.id/u)
  const gate = schedule.indexOf('preparationRef.current || engineMutation.current || !compatible()')
  assert.ok(gate > 0 && schedule.indexOf('queued.current = null') < gate)
})

test('local compile does not ask for upload consent and local source-map actions cannot call the native service', () => {
  assert.match(ui, /function compile\(\)[\s\S]*?if \(localRuntime\) \{ workspace.compile\(\); return \}/u)
  assert.match(ui, /const canSync = Boolean\(!localRuntime && proof\?\.runtime !== 'browser'/u)
  assert.match(ui, /Browser compilation does not provide SyncTeX navigation/u)
  assert.match(ui, /Project source, images, build logs and PDF bytes are not uploaded/u)
  assert.match(ui, /value=\{workspace.runtime\}/u)
  assert.match(ui, /Cancel local compile/u)
  assert.match(ui, /data-progress=\{workspace.attempt.progress\?\.phase\}/u)
})

test('browser support copy reports bounded packages, cache limits and original-byte proofs without universal compatibility claims', () => {
  assert.match(ui, /not universal TeX compatibility/u)
  assert.match(ui, /offline use needs cached assets/u)
  assert.match(ui, /academic Biber workflow needs the private native runtime/u)
  assert.match(ui, /External commands and arbitrary remote package resolution are disabled/u)
  assert.match(ui, /new Blob\(\[proof.data\], \{ type: 'application\/pdf' \}\)/u)
})

test('unselected drafts block manual, keyboard and automatic compilation without blocking source editing or ZIP export', () => {
  const enqueue = action('enqueueCompile')
  assert.match(enqueue, /project\.mainFile === null.*LATEX_MAIN_FILE_NOTICE.*return/u)
  assert.ok(enqueue.indexOf('project.mainFile === null') < enqueue.indexOf('const intent: CompileIntent'))
  assert.match(action('scheduleAuto'), /const compatible = \(\) => project\.mainFile !== null &&/u)
  assert.match(ui, /const compileDisabled = !project\?\.mainFile/u)
  assert.match(ui, /function compile\(\)[\s\S]*?if \(!project\?\.mainFile\) \{ workspace.compile\(\); return \}/u)
  assert.match(ui, /<FileActionMenu path=\{item.path\}>/u)
  assert.match(ui, /item.path !== project.mainFile && \/\\.tex\$\/iu.test\(item.path\)[\s\S]*?mainFile: item.path[\s\S]*?Set as main/u)
  assert.match(ui, /aria-label=\{`Actions for \$\{path\}`\}/u)
  assert.match(ui, /role="group" aria-label=\{`Actions for \$\{path\}`\}/u)
  assert.match(ui, /data-main=\{item.path === project.mainFile\}/u)
  assert.match(ui, /disabled=\{!project\?\.mainFile\} onClick=\{downloadMainTex\}/u)
  assert.match(ui, /disabled=\{!project \|\| busy\} onClick=\{\(\) => void downloadSource\(\)\}/u)
  assert.match(ui, /project.mainFile \?\? 'No main selected'/u)
  assert.match(ui, /disabled=\{!workspace.autoCompile && \(!project\?\.mainFile/u)
})

test('legacy generated fonts repair only on an explicit local compile, with a checkpoint before snapshot capture', () => {
  const enqueue = action('enqueueCompile')
  assert.match(enqueue, /mode === 'manual' && selectedRuntime === 'browser'/u)
  assert.match(enqueue, /repairAltaCvBrowserProject\(project\)/u)
  assert.match(enqueue, /applyProject\(repaired, `Before AltaCV font repair r/u)
  assert.ok(enqueue.indexOf('applyProject(repaired') < enqueue.indexOf('const intent: CompileIntent'))
  assert.doesNotMatch(action('addProject'), /repairAltaCvBrowserProject/u)
})

// Execute the real action bodies with injected hook refs and side effects. These
// are state-transition unit tests, not React/browser rendering or E2E checks.
function injectedAction(name: string, environment: Record<string, unknown>) {
  const source = ts.transpileModule(action(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return runInNewContext(`${source}\n${name}`, { AbortController, ...environment }) as (...args: unknown[]) => unknown
}
function preparationFixture() {
  const source = createTemplateProject()
  let project: LatexProject = source
  const request = { projectId: source.id, revision: source.revision, snapshot: source, memoryGB: 2, packages: { profileVersion: 'browser-unit', groups: [], downloadBytes: 0 } }
  const events = { busy: [] as boolean[], notices: [] as string[], compiled: [] as LatexProject[], queued: [] as (number | null)[] }
  const state = {
    preparationRef: { current: request as typeof request | null }, preparationOperation: { current: null as AbortController | null },
    engineMutation: { current: false }, mounted: { current: true }, activeRef: { current: true }, runtimeRef: { current: 'browser' },
    running: { current: null }, unresolved: { current: null }, memoryAcknowledged: { current: false }, queued: { current: { mode: 'manual' } as object | null },
  }
  let release!: () => void, entered!: () => void, approvals = 0
  const waiting = new Promise<void>((resolve) => { release = resolve }), started = new Promise<void>((resolve) => { entered = resolve })
  const environment = {
    ...state, currentProject: () => project, sameProjectSource,
    setBrowserPreparation: () => {}, setNotice: (notice: string) => events.notices.push(notice), setEngineCacheBusy: (busy: boolean) => events.busy.push(busy),
    setQueuedRevision: (revision: number | null) => events.queued.push(revision), stopAutoSchedule: () => {}, messageOf: (error: Error) => error.message, dismissBrowserPreparation: () => {},
    approveBrowserPackageGroups: async (_preparation: unknown, signal: AbortSignal) => { approvals++; assert.equal(signal.aborted, false); entered(); await waiting },
    enqueueCompile: (snapshot: LatexProject) => { assert.equal(state.engineMutation.current, false); events.compiled.push(snapshot) },
  }
  environment.dismissBrowserPreparation = injectedAction('dismissBrowserPreparation', environment) as () => void
  return { state, events, environment, started, release: () => release(), approvals: () => approvals, changeProject: (next: LatexProject) => { project = next }, source }
}

test('device-memory warnings are finite reported values only, never a fabricated estimate or a hard block', () => {
  for (const value of [undefined, null, '2', 0, -1, NaN, Infinity, 4, 8]) assert.equal(browserMemoryWarning(value), null)
  for (const value of [.25, .5, 1, 2]) assert.equal(browserMemoryWarning(value), value)
  assert.match(action('enqueueCompile'), /selectedRuntime === 'browser' && memoryGB !== null && !memoryAcknowledged.current/u)
  assert.match(ui, /roughly 512 MiB.*Continuing is your choice, not a guarantee/u)
})

test('changing local auto mode to native resets auto opt-in before the new runtime can schedule any upload', () => {
  const autoValues: boolean[] = [], runtimes: string[] = [], controller = new AbortController()
  const environment = {
    running: { current: null }, unresolved: { current: null }, runtimeRef: { current: 'browser' }, autoRef: { current: true },
    capabilitiesRequest: { current: controller }, preparationOperation: { current: null }, preparationRef: { current: null }, queued: { current: { mode: 'auto' } as object | null },
    capabilitiesRef: { current: unavailableLatexCapabilities }, retryAt: { current: 1 }, unavailableLatexCapabilities,
    setNotice: () => {}, stopAutoSchedule: () => { environment.queued.current = null }, setAutoCompile: (value: boolean) => autoValues.push(value), setBrowserPreparation: () => {},
    setRuntime: (value: string) => { assert.equal(environment.autoRef.current, false); runtimes.push(value) }, setAttempt: () => {}, setCapabilities: () => {}, setCapabilitiesLoading: () => {}, setQueuedRevision: () => {},
  }
  assert.equal(injectedAction('selectRuntime', environment)('native'), true)
  assert.equal(environment.autoRef.current, false)
  assert.deepEqual(autoValues, [false])
  assert.deepEqual(runtimes, ['native'])
  assert.equal(controller.signal.aborted, true)
  assert.equal(environment.queued.current, null)
})

test('package approval rechecks source, selected runtime, activity and dismissal after awaiting consent', async () => {
  for (const change of ['source', 'runtime', 'inactive', 'dismissed', 'unmounted']) {
    const fixture = preparationFixture(), continuePreparation = injectedAction('continueBrowserPreparation', fixture.environment)
    const pending = continuePreparation()
    await fixture.started
    if (change === 'source') fixture.changeProject(reviseProject(fixture.source, { files: fixture.source.files.map((file) => ({ ...file, content: file.content + '\nNew writing' })) }))
    if (change === 'runtime') fixture.state.runtimeRef.current = 'native'
    if (change === 'inactive') fixture.state.activeRef.current = false
    if (change === 'dismissed') fixture.state.preparationRef.current = null
    if (change === 'unmounted') fixture.state.mounted.current = false
    fixture.release(); await pending
    assert.equal(fixture.events.compiled.length, 0, change)
    assert.equal(fixture.state.memoryAcknowledged.current, false, change)
    assert.equal(fixture.state.engineMutation.current, false, change)
    assert.equal(fixture.state.preparationOperation.current, null, change)
  }
})

test('an unchanged consented revision compiles once, only after the engine mutation lock is released', async () => {
  const fixture = preparationFixture(), continuePreparation = injectedAction('continueBrowserPreparation', fixture.environment)
  const first = continuePreparation()
  await fixture.started
  await continuePreparation()
  assert.equal(fixture.approvals(), 1)
  fixture.release(); await first
  assert.deepEqual(fixture.events.compiled, [fixture.source])
  assert.equal(fixture.state.memoryAcknowledged.current, true)
  assert.equal(fixture.state.preparationRef.current, null)
  assert.equal(fixture.state.queued.current, null)
  assert.deepEqual(fixture.events.busy, [true, false])
})

test('dismissing consent aborts its operation and removes queued intents without compiling or switching runtime', async () => {
  const fixture = preparationFixture(), continuePreparation = injectedAction('continueBrowserPreparation', fixture.environment)
  const dismiss = injectedAction('dismissBrowserPreparation', fixture.environment)
  const pending = continuePreparation()
  await fixture.started
  const signal = fixture.state.preparationOperation.current!.signal
  dismiss()
  assert.equal(signal.aborted, true)
  assert.equal(fixture.state.preparationRef.current, null)
  assert.equal(fixture.state.queued.current, null)
  fixture.release(); await pending
  assert.equal(fixture.events.compiled.length, 0)
  assert.equal(fixture.state.runtimeRef.current, 'browser')
})

test('a failed cache clear cannot return success or announce cleared assets', async () => {
  const notices: string[] = [], busy: boolean[] = []
  const environment = {
    running: { current: null }, engineMutation: { current: false }, cacheReadSequence: { current: 0 }, mounted: { current: true }, stopAutoSchedule: () => {},
    setNotice: (notice: string) => notices.push(notice), setEngineCacheBusy: (value: boolean) => busy.push(value), messageOf: (error: Error) => error.message,
    clearBrowserEngineCache: async () => { throw new Error('Engine storage could not commit the clear.') }, refreshEngineCache: async () => assert.fail('No successful refresh after failed clear'),
  }
  assert.equal(await injectedAction('clearEngineCache', environment)(), false)
  assert.deepEqual(notices, ['Engine storage could not commit the clear.'])
  assert.deepEqual(busy, [true, false])
  assert.equal(environment.engineMutation.current, false)
  assert.ok(/modal.kind === 'engine-cache' && !await workspace.clearEngineCache\(\)\)\s*\{\s*setCacheClearError/u.test(ui))
  assert.ok(/cacheClearError && <p[^>]*role="alert"/u.test(ui))
})

test('late cache usage reads cannot replace a newer post-clear summary', async () => {
  const values: unknown[] = []
  let release!: (value: unknown) => void, calls = 0
  const old = new Promise<unknown>((resolve) => { release = resolve })
  const newer = { available: true, bytes: 0, entries: 0, versions: [] }
  const refresh = injectedAction('refreshEngineCache', {
    cacheReadSequence: { current: 0 }, mounted: { current: true }, setEngineCache: (value: unknown) => values.push(value), messageOf: (error: Error) => error.message,
    getBrowserEngineCacheSummary: async () => ++calls === 1 ? old : newer,
  })
  const first = refresh()
  await refresh()
  release({ available: true, bytes: 123, entries: 2, versions: ['browser-old'] }); await first
  assert.deepEqual(values, [newer])
})

test('cache/progress/consent controls preserve truthful labels, keyboard scroll access and bounded narrow layouts', () => {
  assert.ok(/HTTP cache reuse is not measured as network download/u.test(ui))
  assert.ok(/Verified engine asset bytes, not compile completion/u.test(ui))
  assert.ok(/Stored entries alone do not prove an offline profile is complete/u.test(ui))
  assert.ok(/source-offer.json`\}/u.test(ui))
  assert.ok(/role="region" aria-labelledby="resume-latex-local-label" tabIndex=\{0\}/u.test(ui))
  assert.ok(/!preparationCurrent/u.test(ui))
  const css = readFileSync(new URL('./LatexResumeStudio.module.css', import.meta.url), 'utf8')
  assert.ok(/\.localWorkspaceBody\s*\{[^}]*max-height: min\(44dvh, 400px\)[^}]*overflow-y: auto/u.test(css))
  assert.ok(/@media \(max-width: 900px\)/u.test(css))
  assert.ok(/\.preparationActions > button\s*\{\s*min-height: 44px/u.test(css))
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/u.test(css))
})
