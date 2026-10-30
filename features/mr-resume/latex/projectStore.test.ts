import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { assertExpectedRevision, LatexStorageError, LOCAL_LATEX_LIMITS, openLatexProjectStore, storedRecordBytes, validateStoredProof } from './projectStore.ts'
import { createTemplateProject } from './templates.ts'
import { sha256 } from './project.ts'
import type { LatexProof } from './types.ts'

const workflowSource = readFileSync(new URL('./useLatexWorkspace.ts', import.meta.url), 'utf8')
const workflow = ts.createSourceFile('useLatexWorkspace.ts', workflowSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function actionText(name: string) {
  let text = ''
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(workflow); ts.forEachChild(node, visit) }
  visit(workflow)
  assert.ok(text, `Expected the ${name} workflow action`)
  return text
}

test('expected-revision CAS rejects both stale tabs and missing/new-key conflicts', () => {
  const current = { id: 'project', revision: 3 }
  assert.doesNotThrow(() => assertExpectedRevision(current, 3, { id: 'project', revision: 4 }))
  assert.throws(() => assertExpectedRevision(current, 2, { id: 'project', revision: 4 }), (error: unknown) => error instanceof LatexStorageError && error.code === 'conflict')
  assert.throws(() => assertExpectedRevision(current, null, { id: 'project', revision: 1 }), /Another tab/u)
  assert.throws(() => assertExpectedRevision(null, 3, { id: 'project', revision: 4 }), /Another tab/u)
  assert.throws(() => assertExpectedRevision(current, 3, { id: 'project', revision: 2 }), /older/u)
  assert.throws(() => assertExpectedRevision(current, 3, { id: 'other', revision: 4 }), /Another tab/u)
  assert.doesNotThrow(() => assertExpectedRevision(null, null, { id: 'new-project', revision: 1 }))
  assert.deepEqual(current, { id: 'project', revision: 3 })
})

test('local budget includes real Unicode, binary image/PDF bytes and nested recovery snapshots', () => {
  assert.equal(storedRecordBytes('ক'), 3)
  assert.equal(storedRecordBytes(new Blob([new Uint8Array(1024)])), 1024)
  assert.equal(storedRecordBytes(new ArrayBuffer(2048)), 2048)
  const project = createTemplateProject()
  assert.ok(storedRecordBytes({ project, checkpoints: [{ project }] }) > storedRecordBytes(project) * 2)
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  assert.ok(storedRecordBytes(cycle) >= LOCAL_LATEX_LIMITS.bytes)
  assert.equal(LOCAL_LATEX_LIMITS.projects, 8); assert.equal(LOCAL_LATEX_LIMITS.checkpointsPerProject, 6)
})

test('unavailable IndexedDB is session-only without creating or migrating a Regular localStorage draft', async () => {
  await assert.rejects(openLatexProjectStore(undefined), /IndexedDB is unavailable/u)
})

test('proof metadata and future originals are rejected without detaching or modifying canonical PDF bytes', async () => {
  const data = new TextEncoder().encode('%PDF-1.7\nsynthetic contract fixture\n%%EOF').buffer
  const proof: LatexProof = { status: 'ready', operationKey: 'operation-fixture', projectId: 'project-fixture', revision: 1, snapshotHash: 'a'.repeat(64), engine: 'lualatex', profileVersion: 'test-only',
    pdf: { id: 'pdf-fixture', sha256: await sha256(data), bytes: data.byteLength, pages: 1 }, diagnostics: [], log: '', syncAvailable: false, createdAt: '2026-10-29T08:00:00Z', data }
  const record = { storageVersion: 1, projectId: proof.projectId, proof, snapshot: { ...createTemplateProject(), id: proof.projectId } }
  assert.equal(validateStoredProof(record).data, data)
  const before = new Uint8Array(data).slice()
  assert.throws(() => validateStoredProof({ ...record, storageVersion: 2 }), /unsupported/u)
  assert.throws(() => validateStoredProof({ ...record, proof: { ...proof, pdf: { ...proof.pdf, bytes: 2 } } }), /invalid/u)
  assert.throws(() => validateStoredProof({ ...record, proof: { ...proof, pdf: { ...proof.pdf, pages: 33 } } }), /invalid/u)
  assert.throws(() => validateStoredProof({ ...record, proof: { ...proof, snapshotHash: 'unverified' } }), /invalid/u)
  assert.deepEqual(new Uint8Array(data), before)
  assert.equal(data.byteLength, before.length)
})

test('pending writes cannot resurrect a removed project or overwrite newly restored source', () => {
  const save = actionText('queueSave')
  assert.match(save, /!canonical \|\| canonical\.revision !== project\.revision \|\| !sameProjectSource\(canonical, project\)/u)
  assert.ok(save.indexOf('canonical.revision') < save.indexOf('database.save'))
  const remove = actionText('removeProject')
  assert.ok(remove.indexOf('clearTimeout(saveTimer.current)') < remove.indexOf('await saveChain.current'))
  assert.ok(remove.indexOf('queued.current?.snapshot.id === id') < remove.indexOf('await saveChain.current'))
})

test('async stored-source reload preserves the latest writing, not its pre-read snapshot', () => {
  const reload = actionText('reloadStoredProject')
  const read = reload.indexOf('await database.readWorkspace()')
  const current = reload.indexOf('const latest = currentProject()')
  const copy = reload.indexOf('cloneAsNewProject(latest,')
  assert.ok(read >= 0 && current > read && copy > current)
  assert.match(reload, /latest\.id !== current\.id/u)
  assert.ok(reload.indexOf('projectsRef.current.length >= LOCAL_LATEX_LIMITS.projects', current) < copy)
})
