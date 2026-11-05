import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveBuildDetails, type BuildDetailsAttempt } from './buildDetails.ts'
import { createTemplateProject } from './templates.ts'
import { reviseProject } from './project.ts'
import type { LatexProof } from './types.ts'

function fixture() {
  const source = createTemplateProject()
  source.title = 'Captured title'
  const data = new TextEncoder().encode('%PDF-1.7\ncanonical proof').buffer
  const proof: LatexProof = { status: 'ready', projectId: source.id, revision: source.revision, operationKey: 'captured-operation', snapshotHash: 'a'.repeat(64),
    engine: source.engine, profileVersion: 'captured-profile', runtime: 'browser', syncAvailable: false, createdAt: '2026-11-04T19:00:00Z',
    pdf: { id: 'captured-operation', sha256: 'b'.repeat(64), bytes: data.byteLength, pages: 2 }, data, log: '', diagnostics: [{ severity: 'warning', message: 'Final authored box warning', file: 'main.tex', line: 8 }] }
  const attempt: BuildDetailsAttempt = { projectId: source.id, revision: source.revision, operationKey: proof.operationKey, stage: 'ready', runtime: 'browser', snapshot: source,
    progress: { assetAudit: [
      { path: 'compiler-worker.js', bytes: 1234, sha256: 'c'.repeat(64), source: 'fetch-response', groupId: 'runtime', groupKind: 'runtime', packages: [] },
      { path: 'groups/core/snapshot.tar.gz', bytes: 2345, sha256: 'd'.repeat(64), source: 'indexeddb-reuse', groupId: 'core', groupKind: 'core', packages: ['geometry', 'hyperref'] },
    ] } }
  return { source, proof, attempt }
}

test('build report uses captured source and canonical proof, never editing r+1 or a newer attempt', () => {
  const { source, proof, attempt } = fixture()
  const next = reviseProject(source, { title: 'Live r+1', engine: 'lualatex', files: [...source.files, { id: 'next-file', path: 'later.tex', content: 'Later source' }], mainFile: 'later.tex' })
  const report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: { ...attempt, revision: next.revision, snapshot: next, operationKey: 'next-operation' } })!
  assert.equal(report.project.title, 'Captured title')
  assert.equal(report.project.mainFile, 'main.tex')
  assert.equal(report.project.revision, source.revision)
  assert.equal(report.engine, proof.engine)
  assert.equal(report.profileVersion, 'captured-profile')
  assert.equal(report.assets.length, 0)
  assert.deepEqual(report.pdf, { sha256: proof.pdf.sha256, bytes: proof.pdf.bytes, pages: 2 })
  assert.deepEqual(report.diagnostics, proof.diagnostics)
  const unknown = deriveBuildDetails({ proof, proofSource: next, currentAttempt: attempt })!
  assert.equal(unknown.project.mainFile, null)
  assert.equal(unknown.project.title, null)
  assert.equal(unknown.assetEvidence, 'Not recorded')
})

test('matching captured engine assets are evidence of supplied groups, not fonts/packages used in the PDF', () => {
  const { source, proof, attempt } = fixture(), report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: attempt })!
  assert.equal(report.worker?.sha256, 'c'.repeat(64))
  assert.equal(report.manifest, null, 'Current app manifest pins are never substituted for missing historical evidence')
  assert.deepEqual(report.packages.available, ['geometry', 'hyperref'])
  assert.equal(report.packages.usedInPdf, 'Not checked')
  assert.equal(report.fonts.availability, 'Not recorded')
  assert.equal(report.fonts.usedInPdf, 'Not checked')
  assert.equal(report.renderer.override, 'Not recorded')
  assert.match(report.assetEvidence, /not current cache contents/u)
  attempt.progress!.assetAudit![0].sha256 = 'e'.repeat(64)
  attempt.progress!.assetAudit![1].packages.push('later-package')
  assert.equal(report.worker?.sha256, 'c'.repeat(64))
  assert.deepEqual(report.packages.available, ['geometry', 'hyperref'])
})

test('asset evidence refuses foreign, unfinished, wrong-runtime, wrong-engine and same-revision fork attempts', () => {
  const { source, proof, attempt } = fixture()
  for (const other of [
    { ...attempt, projectId: 'foreign' }, { ...attempt, stage: 'waiting' }, { ...attempt, operationKey: 'other-operation' },
    { ...attempt, runtime: 'native' as const }, { ...attempt, snapshot: { ...source, engine: 'pdflatex' as const } },
    { ...attempt, snapshot: { ...source, files: source.files.map((file) => ({ ...file, content: file.content + 'fork' })) } },
  ]) assert.equal(deriveBuildDetails({ proof, proofSource: source, currentAttempt: other })!.assets.length, 0)
  assert.equal(deriveBuildDetails({ proof, currentAttempt: attempt })!.assets.length, 0)
})

test('new browser captures expose their verified manifest and inventory without inventing PDF font use', () => {
  const { source, proof, attempt } = fixture()
  attempt.progress!.buildContext = { profileVersion: proof.profileVersion, manifest: { path: 'manifest.json', bytes: 9876, sha256: 'f'.repeat(64) },
    profile: { id: source.engine, name: 'Captured engine', version: 'Pinned TeX revision', fonts: ['Lato', 'Roboto Slab'], packages: ['biblatex', 'biber'] } }
  const report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: attempt })!
  assert.equal(report.manifest?.sha256, 'f'.repeat(64))
  assert.deepEqual(report.fonts.families, ['Lato', 'Roboto Slab'])
  assert.equal(report.fonts.usedInPdf, 'Not checked')
  assert.ok(report.packages.available.includes('biber'))
  attempt.progress!.buildContext!.profile.fonts.push('Later inventory')
  assert.deepEqual(report.fonts.families, ['Lato', 'Roboto Slab'])
  assert.equal(deriveBuildDetails({ proof, proofSource: source, currentAttempt: { ...attempt, operationKey: 'later-build' } })!.manifest, null)
  attempt.progress!.buildContext!.profileVersion = 'different-profile'
  assert.equal(deriveBuildDetails({ proof, proofSource: source, currentAttempt: attempt })!.fonts.availability, 'Not recorded')
})

test('the actual LuaHBTeX label and explicit wrapper renderer-policy record remain qualified log evidence', () => {
  const { proof } = fixture()
  const report = deriveBuildDetails({ proof: { ...proof, engine: 'lualatex', log: 'TeX pass 1: LuaHBTeX\nRenderer policy: LuaHBTeX HarfBuzz default; explicit source font features can override.\nTeX pass 2: LuaLaTeX\n' } })!
  assert.deepEqual(report.passes.observed, [1, 2])
  assert.match(report.renderer.override, /Retained log records/u)
  assert.equal(report.renderer.usedInPdf, 'Not checked')
})

test('native and legacy proofs retain honest unknown capability and provenance states', () => {
  const { source, proof, attempt } = fixture()
  delete proof.runtime
  const report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: { ...attempt, runtime: 'native' } })!
  assert.equal(report.runtime, 'native', 'Existing v1 proofs without runtime are native by contract')
  assert.equal(report.worker, null)
  assert.equal(report.manifest, null)
  assert.equal(report.fonts.availability, 'Not recorded')
  assert.equal(report.bibliography.outcome, 'Not recorded')
  assert.equal(report.passes.outcome, 'Not recorded')
  assert.equal(report.renderer.override, 'Not recorded')
  assert.equal(deriveBuildDetails({ proof: null }), null)
})

test('pass and bibliography records come from retained proof logs with explicit outcome qualifications', () => {
  const { source, proof, attempt } = fixture()
  proof.log = 'TeX pass 1: XeLaTeX\nBiber pass: real Perl Biber 2.22; biblatex 3.22; BCF 3.11 / BBL 3.3.\n[0] INFO - This is Biber 2.22\n[2] INFO - Output to output.bbl\nTeX pass 2: XeLaTeX\nTeX pass 3: XeLaTeX\n'
  const report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: attempt })!
  assert.deepEqual(report.passes.observed, [1, 2, 3])
  assert.equal(report.passes.final, null)
  assert.equal(report.passes.outcome, 'Not recorded')
  assert.deepEqual(report.bibliography.tools, ['Biber'])
  assert.match(report.bibliography.outputEvidence!, /output.bbl/u)
  assert.equal(report.bibliography.outcome, 'Not recorded', 'A log output line is not a separately recorded exit code')
  proof.log = 'Final TeX pass 3 (earlier pass diagnostics omitted after convergence):\nThis is BibTeX, Version 0.99d\n'
  const native = deriveBuildDetails({ proof: { ...proof, runtime: 'native' }, proofSource: source })!
  assert.deepEqual(native.passes.observed, [3])
  assert.equal(native.passes.final, 3)
  assert.deepEqual(native.bibliography.tools, ['BibTeX'])
})

test('source requests, absent log lines, and a clipped log never fabricate a renderer or a bibliography outcome', () => {
  const { source, proof } = fixture()
  source.files[0].content += '\n\\defaultfontfeatures{Renderer=HarfBuzz}\n\\usepackage{biblatex}\n'
  proof.log = '[Earlier compiler log truncated]\nTeX pass 3: pdfLaTeX\nRenderer=HarfBuzz is mentioned in source\n'
  const report = deriveBuildDetails({ proof, proofSource: source })!
  assert.equal(report.logLimited, true)
  assert.deepEqual(report.passes.observed, [], 'A different engine pass label cannot describe this proof')
  assert.deepEqual(report.bibliography.tools, [])
  assert.equal(report.bibliography.outcome, 'Not recorded')
  assert.equal(report.renderer.override, 'Not recorded')
  assert.equal(deriveBuildDetails({ proof: { ...proof, log: '[Raw context omitted at the log display limit; complete streams were checked.]' } })!.logLimited, true)
})

test('derived report cannot mutate proof/source and serialized download omits source, blobs and canonical PDF bytes', () => {
  const { source, proof, attempt } = fixture(), before = new Uint8Array(proof.data).slice(), text = source.files[0].content
  const report = deriveBuildDetails({ proof, proofSource: source, currentAttempt: attempt })!
  report.diagnostics[0].message = 'Report copy changed'
  assert.equal(proof.diagnostics[0].message, 'Final authored box warning')
  assert.equal(source.files[0].content, text)
  assert.deepEqual(new Uint8Array(proof.data), before)
  const json = JSON.stringify(report)
  assert.ok(!json.includes('Ayesha Rahman'))
  assert.ok(!json.includes('canonical proof'))
  assert.ok(!Object.hasOwn(report, 'data') && !Object.hasOwn(report, 'files') && !Object.hasOwn(report, 'log'))
  assert.match(report.qualification, /not an ATS score/u)
})
