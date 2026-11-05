import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { LatexTransportError } from './compileTransport.ts'
import { newerProof, recoverableCompileFailure } from './compilePolicy.ts'
import { addTextFile, makeCheckpoint, reviseProject, sameProjectSource } from './project.ts'
import { applyReviewedProjectReplace, reviewProjectReplace } from './editorHelpers.ts'
import { createTemplateProject } from './templates.ts'
import type { CompileAttempt, LatexRetentionIssue } from './useLatexWorkspace.ts'
import type { LatexProject, LatexProof } from './types.ts'
import { matchesProofSnapshot, matchesSourceSnapshot, proofActionIdentity } from './workspaceIdentity.ts'

// Run the production action bodies with injected refs/transports. These tests
// exercise races and outcomes, not React rendering, focus or browser E2E.
function action(name: string, environment: Record<string, unknown>, studio = false) {
  const path = studio ? './LatexResumeStudio.tsx' : './useLatexWorkspace.ts'
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let source = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) source = node.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(source, `Production action ${name} exists`)
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return runInNewContext(`${javascript}\n${name}`, { AbortController, Error, Date, ...environment }) as (...args: unknown[]) => Promise<unknown>
}

class PreparationRequired extends Error {
  preparation = { profileVersion: 'browser-test', groups: [], downloadBytes: 100 }
}

function compileFixture(runtime: 'browser' | 'native' = 'native') {
  const source = createTemplateProject()
  const intent = { snapshot: source, operationKey: 'operation-one', mode: 'manual', runtime }
  const proof = { status: 'ready', projectId: source.id, revision: source.revision, operationKey: intent.operationKey, engine: source.engine,
    profileVersion: 'test', snapshotHash: 'a'.repeat(64), pdf: { id: 'proof-one', sha256: 'b'.repeat(64), bytes: 8, pages: 1 }, data: new ArrayBuffer(8),
    diagnostics: [], log: 'final log', createdAt: new Date().toISOString(), syncAvailable: false } satisfies LatexProof
  let attempt: CompileAttempt | null = null, retained: LatexRetentionIssue[] = []
  const cleared: string[] = [], requests: string[] = []
  const environment = {
    runtimeRef: { current: runtime as 'browser' | 'native' }, activeRef: { current: true }, onlineRef: { current: true }, mounted: { current: true },
    running: { current: null as unknown }, unresolved: { current: null as unknown }, queued: { current: null as unknown }, preparationRef: { current: null as unknown },
    retryAt: { current: 0 }, autoRef: { current: false }, capabilitiesRef: { current: { ready: true } }, store: { current: null as unknown }, selectionEpoch: { current: 0 },
    projectsRef: { current: [source] }, proofsRef: { current: {} as Record<string, LatexProof> }, proofSnapshots: { current: {} as Record<string, LatexProject> },
    setAttempt: (value: CompileAttempt | null | ((old: CompileAttempt | null) => CompileAttempt | null)) => { attempt = typeof value === 'function' ? value(attempt) : value },
    setRetentionIssues: (update: (old: LatexRetentionIssue[]) => LatexRetentionIssue[]) => { retained = update(retained) },
    setBrowserPreparation: () => {}, setQueuedRevision: () => {}, stopAutoSchedule: () => {}, refreshEngineCache: async () => {},
    setProofSources: () => {}, setProofs: () => {}, setProofAttempts: () => {}, setBrowserMaps: () => {}, retainCheckpoint: () => {}, queueSave: async () => false,
    clearPendingCompile: async (key: string) => { cleared.push(key) },
    compileLatexProject: async () => { requests.push('upload'); return proof },
    recoverLatexProject: async () => { requests.push('recover'); return proof },
    compileBrowserProject: async () => { requests.push('browser'); return { ...proof, runtime: 'browser' } },
    executeRef: { current: async () => { requests.push('queued') } },
    BrowserPackageGroupRequiredError: PreparationRequired, LatexTransportError, recoverableCompileFailure, newerProof, sameProjectSource, makeCheckpoint,
    isCurrentProof: () => false, messageOf: (error: Error) => error.message, proofActionIdentity,
  }
  return { source, intent, proof, environment, cleared, requests, attempt: () => attempt!, issues: () => retained,
    execute: (recovery = false) => action('execute', environment)(intent, recovery) }
}

test('package consent is awaiting_action, not failure, and preserves the last good proof', async () => {
  const fixture = compileFixture('browser')
  fixture.environment.proofsRef.current[fixture.source.id] = fixture.proof
  fixture.environment.compileBrowserProject = async () => { throw new PreparationRequired() }
  await fixture.execute()
  assert.equal(fixture.attempt().stage, 'awaiting_action')
  assert.equal(fixture.attempt().diagnostics.length, 0)
  assert.equal(fixture.environment.proofsRef.current[fixture.source.id], fixture.proof)
  assert.equal(fixture.environment.unresolved.current, null)
  assert.equal(fixture.cleared.length, 0)
})

test('native reload recovery bypasses current browser selection and never uploads source', async () => {
  const fixture = compileFixture()
  fixture.environment.runtimeRef.current = 'browser'
  fixture.environment.unresolved.current = fixture.intent
  const execute = action('execute', fixture.environment)
  await action('recoverCompile', { ...fixture.environment, execute })( )
  assert.deepEqual(fixture.requests, ['recover'])
  assert.equal(fixture.attempt().stage, 'ready')
  assert.equal(fixture.attempt().origin, 'recovery')
  assert.equal(fixture.environment.proofsRef.current[fixture.source.id], fixture.proof)
  assert.deepEqual(fixture.cleared, ['operation-one'])
})

test('native terminal failures, cancellation and expired recovery clear only the captured marker', async () => {
  for (const [code, status, stage] of [['tex_error', 422, 'failed'], ['operation_failed', 422, 'failed'], ['operation_cancelled', 409, 'cancelled'], ['operation_not_found', 404, 'failed'], ['operation_not_found', 410, 'failed']] as const) {
    const fixture = compileFixture()
    fixture.environment.recoverLatexProject = async () => { throw new LatexTransportError({ error: code, code, status, request_id: 'request-one' }) }
    await fixture.execute(true)
    assert.equal(fixture.attempt().stage, stage, code)
    assert.equal(fixture.environment.unresolved.current, null, code)
    assert.deepEqual(fixture.cleared, ['operation-one'], code)
    assert.equal(Object.keys(fixture.environment.proofsRef.current).length, 0)
  }
})

test('running/disconnected recovery remains explicit, bounded and recoverable without clearing its marker', async () => {
  for (const [code, status] of [['operation_running', 409], ['transport_unavailable', undefined], ['upstream_timeout', 504]] as const) {
    const fixture = compileFixture()
    fixture.environment.recoverLatexProject = async () => { throw new LatexTransportError({ error: code, code, status, request_id: 'request-one' }) }
    await fixture.execute(true)
    assert.equal(fixture.attempt().stage, 'recoverable')
    assert.equal(fixture.environment.unresolved.current, fixture.intent)
    assert.equal(fixture.environment.running.current, null)
    assert.equal(fixture.cleared.length, 0)
  }
})

test('r1 completion cannot replace edited r2 writing or publish its proof under another project', async () => {
  const fixture = compileFixture()
  const edited = reviseProject(fixture.source, { title: 'Current writing' }), other = createTemplateProject()
  fixture.environment.projectsRef.current = [edited, other]
  await fixture.execute()
  assert.equal(fixture.environment.projectsRef.current[0], edited)
  assert.equal(fixture.environment.projectsRef.current[1], other)
  assert.equal(fixture.environment.proofsRef.current[other.id], undefined)
  assert.equal(fixture.attempt().projectId, fixture.source.id)
  assert.equal(fixture.attempt().revision, 1)
  assert.equal(fixture.environment.proofSnapshots.current[fixture.source.id], fixture.source)
})

test('acknowledged cancellation of a restored operation clears recovery even without a running slot', async () => {
  const fixture = compileFixture()
  fixture.environment.unresolved.current = fixture.intent
  await action('cancelCompile', { ...fixture.environment, cancelLatexCompile: async () => ({ cancelled: true, status: 'cancelled' }) })()
  assert.equal(fixture.environment.unresolved.current, null)
  assert.deepEqual(fixture.cleared, ['operation-one'])
})

test('expired cancellation clears its own marker, while a late acknowledgment cannot clear another operation', async () => {
  for (const status of [404, 410]) {
    const fixture = compileFixture()
    fixture.environment.unresolved.current = fixture.intent
    await action('cancelCompile', { ...fixture.environment, cancelLatexCompile: async () => { throw new LatexTransportError({ error: 'Expired', code: 'operation_not_found', status, request_id: 'cancel-one' }) } })()
    assert.equal(fixture.environment.unresolved.current, null)
    assert.deepEqual(fixture.cleared, ['operation-one'])
  }
  const fixture = compileFixture(), newer = { ...fixture.intent, operationKey: 'newer-operation' }
  fixture.environment.unresolved.current = fixture.intent
  await action('cancelCompile', { ...fixture.environment, cancelLatexCompile: async () => { fixture.environment.unresolved.current = newer; return { cancelled: true, status: 'cancelled' } } })()
  assert.equal(fixture.environment.unresolved.current, newer)
  assert.deepEqual(fixture.cleared, ['operation-one'])
})

test('marker cleanup failure remains a distinct actionable retention issue, not source-loss or success failure', async () => {
  const fixture = compileFixture()
  fixture.environment.store.current = { clearPendingCompile: async () => { throw new Error('Storage is blocked') } }
  await action('clearPendingCompile', fixture.environment)('operation-one', fixture.source)
  assert.equal(fixture.issues().length, 1)
  assert.equal(fixture.issues()[0].kind, 'recovery')
  assert.match(fixture.issues()[0].message, /terminal.*could not be cleared/u)
})

test('checkpoint transaction failure does not relabel already saved source as session-only', async () => {
  const project = createTemplateProject(), saved = { kind: 'saved', revision: project.revision }, states: unknown[] = []
  const environment = {
    saveChain: { current: Promise.resolve() }, projectsRef: { current: [project] }, savesRef: { current: { [project.id]: saved } },
    store: { current: { save: async () => { throw new Error('Checkpoint budget full') } } }, expected: { current: new Map([[project.id, project.revision]]) },
    updateSave: (_id: string, state: unknown) => states.push(state), sameProjectSource, mounted: { current: true }, setStorageWarning: () => {},
    LatexStorageError: class StorageError extends Error {}, messageOf: (error: Error) => error.message,
  }
  assert.equal(await action('queueSave', environment)(project, makeCheckpoint(project, 'Manual checkpoint')), false)
  assert.equal(states.at(-1), saved)
})

test('modal validation errors remain inside the same dialog without closing it or changing source', async () => {
  const project = createTemplateProject(), request = { kind: 'new', requestId: 'dialog-one', snapshot: project, runtime: 'browser' }
  const errors: string[] = [], closes: unknown[] = []
  await action('submitModal', {
    modalRef: { current: request }, latest: { current: { project, runtime: 'browser' } }, pendingModals: { current: new Set() },
    beginAction: () => 'work-one', finishAction: () => {}, setModalError: (message: string) => errors.push(message), closeModal: (id: string) => closes.push(id),
    alive: { current: true }, sameProjectSource, addTextFile, pathDraft: '../bad.tex', fileText: 'Original writing', workspace: { applyProject: () => assert.fail('Unsafe input cannot mutate source') },
  }, true)({ preventDefault() {} })
  assert.match(errors.at(-1)!, /relative NFC filename/u)
  assert.equal(closes.length, 0)
})

test('a late modal completion cannot close a newly opened request', async () => {
  const project = createTemplateProject(), old = { kind: 'remove', requestId: 'dialog-old', snapshot: project, runtime: 'browser', project }
  const current = { current: old }, closes: unknown[] = []
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const environment = {
    modalRef: current, latest: { current: { project, runtime: 'browser' } }, pendingModals: { current: new Set() }, alive: { current: true }, sameProjectSource,
    beginAction: () => 'work-one', finishAction: () => {}, setModalError: () => {}, setModal: (value: unknown) => closes.push(value),
    workspace: { removeProject: async () => waiting }, closeModal: (() => {}) as (...args: unknown[]) => unknown,
  }
  environment.closeModal = action('closeModal', environment, true)
  const pending = action('submitModal', environment, true)({ preventDefault() {} })
  current.current = { ...old, requestId: 'dialog-new' }
  release(); await pending
  assert.equal(current.current.requestId, 'dialog-new')
  assert.equal(closes.length, 0)
})

test('async source application rejects a same-revision fork in the canonical hook before mutation', () => {
  const original = createTemplateProject(), next = reviseProject(original, { title: 'A new title' })
  const fork = { ...original, files: original.files.map((file) => ({ ...file, content: file.content + '\n% Another tab source' })) }
  const apply = action('applyProject', { currentProject: () => fork, sameProjectSource })
  assert.throws(() => apply(next, undefined, original), /source changed while this action was pending/u)
})

test('reviewed replace applies only after an actual committed checkpoint and a still-current modal request', async () => {
  for (const scenario of ['failed-checkpoint', 'closed-request', 'success'] as const) {
    const project = createTemplateProject(), review = reviewProjectReplace(project, 'Ayesha Rahman', 'Updated author')
    const request = { kind: 'replace', requestId: 'replace-one', snapshot: project, runtime: 'browser', review }, modalRef = { current: request }
    const errors: string[] = [], mutations: unknown[] = [], notices: unknown[] = [], closes: unknown[] = []
    const checkpoint = makeCheckpoint(project, 'Before replacement')
    await action('submitModal', {
      modalRef, latest: { current: { project, runtime: 'browser' } }, pendingModals: { current: new Set() }, alive: { current: true }, sameProjectSource,
      beginAction: () => 'replace-action', finishAction: () => {}, setModalError: (message: string) => errors.push(message), closeModal: (id: string) => closes.push(id),
      applyReviewedProjectReplace,
      workspace: { checkpointNow: async () => { if (scenario === 'closed-request') modalRef.current = { ...request, requestId: 'new-dialog' }; return { committed: scenario !== 'failed-checkpoint', checkpoint } },
        applyProject: (next: LatexProject, _label: string | undefined, source: LatexProject) => { assert.equal(source, review.snapshot); mutations.push(next) }, notify: (...values: unknown[]) => notices.push(values) },
    }, true)({ preventDefault() {} })
    assert.equal(mutations.length, scenario === 'success' ? 1 : 0, scenario)
    assert.equal(notices.length, scenario === 'success' ? 1 : 0, scenario)
    assert.equal(closes.length, scenario === 'success' ? 1 : 0, scenario)
    if (scenario === 'failed-checkpoint') assert.match(errors.at(-1)!, /No text was replaced/u)
  }
})

test('late action receipts keep their captured project, revision and request rather than the current selection', async () => {
  const first = createTemplateProject(), second = createTemplateProject(), facts: Record<string, unknown>[] = []
  await action('notify', { currentProject: () => second, runtimeRef: { current: 'native' }, reportFeedback: (fact: Record<string, unknown>) => facts.push(fact) })(
    'success', 'export', 'source-download', 'Source ZIP download started.', first, 'captured-download', [],
  )
  assert.equal(facts[0].projectId, first.id)
  assert.equal(facts[0].revision, first.revision)
  assert.equal(facts[0].actionRequestId, 'captured-download')
  assert.equal(facts[0].runtime, undefined, 'An export does not borrow a newly selected compiler runtime')
})

test('project writing tools are wired without an automatic Problems popup or untyped banner state', () => {
  const studio = readFileSync(new URL('./LatexResumeStudio.tsx', import.meta.url), 'utf8')
  assert.match(studio, /<CodeMirrorSource project=\{project\}/u)
  assert.match(studio, /findProjectLiteral\(project, deferredQuery\)/u)
  assert.match(studio, /<LatexBuildDetails proof=\{proof\} proofSource=\{workspace.proofSource\} currentAttempt=\{workspace.proofAttempt\}/u)
  assert.match(studio, /<LatexPdfPreview proof=\{proof\} current=\{current\} editing=/u)
  assert.doesNotMatch(studio, /newProblems|statusStack|availabilityToast|setNotice/u)
  assert.match(studio, /if \(!active\) \{ closeMenus\(\); closeModal\(\); return \}/u)
  assert.equal(studio.match(/active && <FileActionMenu path=\{item.path\}>/gu)?.length, 2, 'Mode changes unmount transient portals and their document listeners')
})

test('canonical source and proof actions invalidate a project-switch round trip and profile changes', () => {
  const fixture = compileFixture('browser')
  const proof = { ...fixture.proof, runtime: 'browser' as const }
  fixture.environment.proofsRef.current[fixture.source.id] = proof
  const environment = { ...fixture.environment, currentProject: () => fixture.source, matchesSourceSnapshot, matchesProofSnapshot }
  const sourceCurrent = action('sourceIsCurrent', environment), proofCurrent = action('proofIsCurrent', environment)
  assert.equal(sourceCurrent(fixture.source, 0), true)
  assert.equal(proofCurrent(fixture.source, proof, 0), true)
  environment.selectionEpoch.current++
  assert.equal(sourceCurrent(fixture.source, 0), false)
  assert.equal(proofCurrent(fixture.source, proof, 0), false)
  assert.equal(proofCurrent(fixture.source, { ...proof, profileVersion: 'different' }, 1), false)
})

test('package retry rechecks source after asset preparation but ordinary explicit snapshot compilation stays intentional', async () => {
  for (const requireCurrentSource of [false, true]) {
    const fixture = compileFixture('browser')
    let preparationGuard: (() => boolean) | undefined
    Object.assign(fixture.intent, { requireCurrentSource })
    Object.assign(fixture.environment, { sourceIsCurrent: () => false,
      compileBrowserProject: async (_project: unknown, _key: unknown, _signal: unknown, _progress: unknown, options: { mayStartAfterPreparation?: () => boolean }) => {
        preparationGuard = options.mayStartAfterPreparation
        if (preparationGuard && !preparationGuard()) throw new Error('Source changed during package download; no worker started.')
        return { ...fixture.proof, runtime: 'browser' }
      } })
    await fixture.execute()
    assert.equal(Boolean(preparationGuard), requireCurrentSource)
    assert.equal(fixture.attempt().stage, requireCurrentSource ? 'failed' : 'ready')
    if (requireCurrentSource) assert.equal(Object.keys(fixture.environment.proofsRef.current).length, 0)
  }
})

test('reviewed fix UI refuses stale source, runtime and file-switch round trips before sending an editor transaction', () => {
  const source = createTemplateProject(), fix = { snapshot: source, fileId: source.files[0].id, runtime: 'browser' }
  for (const change of ['source', 'runtime', 'file', 'none']) {
    const requests: unknown[] = []
    const environment = { issueReview: { fix, epoch: 1, viewEpoch: 1 }, fileEpoch: { current: change === 'file' ? 3 : 1 },
      latest: { current: { sourceIsCurrent: () => change !== 'source', runtime: change === 'runtime' ? 'native' : 'browser' } },
      fixSequence: { current: 0 }, pendingFix: { current: null as unknown }, chooseFile: () => {}, setFixRequest: (value: unknown) => requests.push(value) }
    action('applyIssueFix', environment, true)()
    assert.equal(requests.length, change === 'none' ? 1 : 0, change)
  }
})

test('compact console and contextual AI disclosure never introduce a terminal or network assistant', () => {
  const ui = readFileSync(new URL('./LatexResumeStudio.tsx', import.meta.url), 'utf8')
  const output = readFileSync(new URL('./LatexBuildOutput.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(ui, /drawerView === 'terminal'|drawerView === 'activity'|drawerView === 'log'/u)
  assert.match(ui, /\['problems', 'output', 'history'\]/u)
  assert.match(ui, /AI assistance is disabled\. No source, log, PDF, or personal information is sent/u)
  assert.doesNotMatch(ui, /fetch\([^)]*(?:ai|suggest)|document-ai\/|ai-analyzer\//iu)
  assert.doesNotMatch(output, /scrollIntoView|contentEditable|onKeyDown.*execute|dangerouslySetInnerHTML/u)
  assert.match(output, /pausedAt === null\) element.scrollTop = element.scrollHeight/u)
  assert.match(output, /Read-only compiler output/u)
})
