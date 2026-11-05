import assert from 'node:assert/strict'
import test from 'node:test'
import { createTemplateProject } from './templates.ts'
import { diagnosticSourceTarget, matchesProofSnapshot, matchesSourceSnapshot, proofActionIdentity } from './workspaceIdentity.ts'
import type { LatexProof } from './types.ts'

test('source actions require project, revision and exact captured source rather than a revision label', () => {
  const snapshot = createTemplateProject()
  assert.equal(matchesSourceSnapshot(snapshot, { ...snapshot }), true)
  assert.equal(matchesSourceSnapshot({ ...snapshot, id: 'other-project' }, snapshot), false)
  assert.equal(matchesSourceSnapshot({ ...snapshot, revision: snapshot.revision + 1 }, snapshot), false)
  assert.equal(matchesSourceSnapshot({ ...snapshot, files: snapshot.files.map((file) => ({ ...file, content: `${file.content}\n% fork` })) }, snapshot), false)
  assert.equal(matchesSourceSnapshot(null, snapshot), false)
})

test('proof action identity includes operation, source, PDF, runtime and profile', () => {
  const source = createTemplateProject()
  const proof = { status: 'ready', projectId: source.id, revision: source.revision, operationKey: 'op', snapshotHash: 'a'.repeat(64),
    engine: source.engine, profileVersion: 'profile-1', runtime: 'browser', pdf: { id: 'pdf', sha256: 'b'.repeat(64), pages: 1, bytes: 8 },
    data: new ArrayBuffer(8), diagnostics: [], log: '', syncAvailable: false, createdAt: new Date().toISOString() } satisfies LatexProof
  assert.equal(matchesProofSnapshot(source, source, proof), true)
  for (const changed of [{ ...proof, operationKey: 'new' }, { ...proof, snapshotHash: 'c'.repeat(64) }, { ...proof, pdf: { ...proof.pdf, sha256: 'd'.repeat(64) } },
    { ...proof, runtime: 'native' as const }, { ...proof, profileVersion: 'profile-2' }, { ...proof, engine: 'pdflatex' as const }]) {
    assert.notEqual(proofActionIdentity(changed), proofActionIdentity(proof))
  }
  assert.equal(matchesProofSnapshot({ ...source, id: 'copy' }, source, proof), false)
})

test('diagnostic jumps refuse stale, missing, invalid and out-of-range positions, preserving CRLF line counts', () => {
  const template = createTemplateProject(), file = { ...template.files[0], content: 'one\r\ntwo\nthree\rfour' }
  const source = { ...template, files: [file] }
  assert.deepEqual(diagnosticSourceTarget(source, source, { file: file.path, line: 4 }), { fileId: file.id, path: file.path, line: 4 })
  for (const line of [undefined, 0, -1, 1.5, 5, NaN]) assert.equal(diagnosticSourceTarget(source, source, { file: file.path, line }), null)
  assert.equal(diagnosticSourceTarget(source, source, { file: '/job/vendor.tex', line: 1 }), null)
  assert.equal(diagnosticSourceTarget({ ...source, files: [{ ...file, content: 'changed' }] }, source, { file: file.path, line: 1 }), null)
})
