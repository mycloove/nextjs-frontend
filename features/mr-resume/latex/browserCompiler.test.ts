import assert from 'node:assert/strict'
import { resolveObjectURL } from 'node:buffer'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { createBrowserLatexTransport, BROWSER_LATEX_ROOT, BROWSER_LATEX_PROFILE_VERSION, BrowserPackageGroupRequiredError, browserEngineAssetPins, browserLatexCompatibility, browserLatexDiagnostics, browserPackagePreparation, readBrowserCompilerManifest, type BrowserCompilerGroup, type BrowserCompilerManifest, type BrowserCompilerWorker, type BrowserPreparation, type LatexCompileProgress } from './browserCompiler.ts'
import type { BrowserSyncArtifact } from './browserSynctex.ts'
import { proofActionIdentity } from './workspaceIdentity.ts'
import type { EngineAssetPin, EngineAssetStore } from './engineAssetStore.ts'
import { verifyBrowserLatexPdf } from './browserPdfVerification.ts'
import { createTemplateProject } from './templates.ts'
import { projectSnapshotHash, reviseProject } from './project.ts'
import { readProjectZip } from './projectArchive.ts'
import { LatexTransportError } from './compileTransport.ts'
import { LATEX_LIMITS, type LatexProject } from './types.ts'

const hashBytes = (data: ArrayBuffer | Uint8Array) => createHash('sha256').update(data instanceof ArrayBuffer ? new Uint8Array(data) : data).digest('hex')
const fixtureBytes = new Map(['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz'].map((path) => [path, new TextEncoder().encode(path === 'texlive.snapshot.tar.gz' ? 'Unit-only archive fixture.'.repeat(80) : `/* Unit-only public asset: ${path} */`)]))
const assetPin = (path: string, bytes: Uint8Array): EngineAssetPin => ({ path, bytes: bytes.byteLength, sha256: hashBytes(bytes) })
const manifest: BrowserCompilerManifest = {
  version: 1, profileVersion: BROWSER_LATEX_PROFILE_VERSION,
  engines: ['lualatex', 'xelatex', 'pdflatex'].map((id) => ({ id: id as LatexProject['engine'], name: id, version: 'unit only', fonts: ['Latin Modern Roman'], packages: ['fontspec', 'geometry', 'enumitem', 'titlesec', 'hyperref'] })),
  assets: [...fixtureBytes].map(([path, bytes]) => assetPin(path, bytes)),
  limitations: ['Contract fixture; not a compiler smoke result.'],
}
const manifestPin = (bundle = manifest) => {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle))
  return { bytes: bytes.byteLength, sha256: hashBytes(bytes) }
}
function fixtureRequest(bundle = manifest, contents = fixtureBytes) {
  return async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.mode, 'same-origin')
    if (url === `${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`) return Response.json(bundle)
    assert.equal(init.cache, 'force-cache')
    const pin = [...bundle.assets, ...(bundle.groups ?? []).flatMap((group) => group.assets), ...(bundle.biber?.assets ?? []), ...(bundle.synctex ? [bundle.synctex] : [])].find((pin) => url === `${BROWSER_LATEX_ROOT}${pin.path}?sha256=${pin.sha256}`)
    assert.ok(pin, `Only a fixed public pin may be fetched: ${url}`)
    const bytes = contents.get(pin.path)
    assert.ok(bytes)
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': pin.path === 'compiler-worker.js' ? 'application/javascript' : 'application/octet-stream' } })
  }
}
class MemoryAssetStore implements EngineAssetStore {
  bytes = new Map<string, { version: string; data: ArrayBuffer }>()
  approvals = new Set<string>()
  loads: { version: string; pin: EngineAssetPin }[] = []
  saves: { version: string; pin: EngineAssetPin }[] = []
  consents: string[] = []
  async load(version: string, pin: EngineAssetPin, signal?: AbortSignal) {
    assert.equal(signal?.aborted, false)
    this.loads.push({ version, pin: { ...pin } })
    return this.bytes.get(`${version}:${pin.sha256}`)?.data.slice(0) ?? null
  }
  async save(version: string, pin: EngineAssetPin, data: ArrayBuffer, signal?: AbortSignal) {
    assert.equal(signal?.aborted, false); assert.equal(data.byteLength, pin.bytes); assert.equal(hashBytes(data), pin.sha256)
    this.saves.push({ version, pin: { ...pin } }); this.bytes.set(`${version}:${pin.sha256}`, { version, data: data.slice(0) })
    return true
  }
  async summary() { return { available: true, bytes: [...this.bytes.values()].reduce((sum, entry) => sum + entry.data.byteLength, 0), entries: this.bytes.size, versions: [...new Set([...this.bytes.values()].map((entry) => entry.version))] } }
  async clear() { this.bytes.clear(); this.approvals.clear() }
  async hasConsent(version: string, id: string, hash: string) { return this.approvals.has(`${version}:${id}:${hash}`) }
  async consent(version: string, id: string, hash: string) { const key = `${version}:${id}:${hash}`; this.consents.push(key); this.approvals.add(key) }
}
function groupedFixture(withBiber = false) {
  const contents = new Map(fixtureBytes)
  const group = (id: string, kind: BrowserCompilerGroup['kind'], profiles: LatexProject['engine'][], packages: string[] = []): BrowserCompilerGroup => {
    const archive = `groups/${id}/snapshot.tar.gz`, index = `groups/${id}/index.json`
    const assets = [archive, index].map((path) => { const bytes = new TextEncoder().encode(`Unit-only group data: ${path}`); contents.set(path, bytes); return assetPin(path, bytes) })
    return { id, kind, profiles, packages, archive, index, assets }
  }
  const engines = manifest.engines.map((profile) => profile.id)
  const groups = [group('base', 'core', engines), group('extra-core', 'core', engines), ...engines.map((engine) => group(engine, 'profile', [engine])), group('pdf-extra', 'profile', ['pdflatex']), group('boxes', 'package', engines, ['tcolorbox', 'mdframed']), group('layouts', 'package', ['pdflatex'], ['customclass', 'paracol']), group('lua-only', 'package', ['lualatex'], ['luapackage'])]
  if (!withBiber) return { bundle: { ...manifest, groups }, contents }
  groups.push(group('bibliography', 'package', engines, ['biblatex']))
  const assets = ['biber.js.bin', 'biber.wasm', 'biber.data', 'biber-index.json'].map((name) => {
    const path = `tools/biber/${name}`, bytes = new TextEncoder().encode(`Unit-only Biber asset: ${name}`)
    contents.set(path, bytes); return assetPin(path, bytes)
  })
  return { bundle: { ...manifest, engines: manifest.engines.map((engine) => ({ ...engine, packages: [...engine.packages, 'biblatex', 'biber'] })), groups, biber: { group: 'bibliography', version: '2.22', assets } }, contents }
}
function literalProject(content: string, files: LatexProject['files'] = [], engine: LatexProject['engine'] = 'pdflatex'): LatexProject {
  return { ...createTemplateProject(), engine, mainFile: 'wrapper/main.tex', files: [{ id: 'main', path: 'wrapper/main.tex', content }, ...files] }
}
class WorkerFixture implements BrowserCompilerWorker {
  onmessage: BrowserCompilerWorker['onmessage'] = null
  onerror: BrowserCompilerWorker['onerror'] = null
  onmessageerror: BrowserCompilerWorker['onmessageerror'] = null
  messages: unknown[] = []
  transfers: Transferable[][] = []
  terminations = 0
  handle: (message: unknown) => void = () => {}
  postMessage(message: unknown, transfer: Transferable[] = []) { this.messages.push(message); this.transfers.push(transfer); this.handle(message) }
  terminate() { this.terminations++ }
  emit(message: unknown) { this.onmessage?.({ data: message } as MessageEvent<unknown>) }
}
async function actualPdf() {
  const document = await PDFDocument.create()
  document.addPage([595, 842]).drawText('Actual PDF transport fixture, not actual TeX compilation.')
  return new Uint8Array(await document.save()).buffer
}
function transport(worker: WorkerFixture, overrides: Partial<Parameters<typeof createBrowserLatexTransport>[0]> = {}) {
  return createBrowserLatexTransport({ supported: () => true, request: fixtureRequest(), manifestPin: manifestPin(), createWorker: () => worker, verifyPdf: (data) => verifyBrowserLatexPdf(data), ...overrides })
}
function successful(worker: WorkerFixture, pdf: ArrayBuffer, change: Record<string, unknown> = {}) {
  worker.handle = (message) => {
    const input = message as Record<string, unknown>
    queueMicrotask(() => {
      if (input.type === 'init') worker.emit({ type: 'ready', engines: manifest.engines.map((profile) => profile.id), version: manifest.profileVersion })
      else worker.emit({ type: 'result', operationKey: input.operationKey, engine: input.engine, exitCode: 0, pdf, log: '', ...change })
    })
  }
}
function needsGroups(worker: WorkerFixture, groupIDs: string[], log = "! LaTeX Error: File `tcolorbox.sty' not found.") {
  worker.handle = (message) => {
    const input = message as Record<string, unknown>
    queueMicrotask(() => input.type === 'init'
      ? worker.emit({ type: 'ready', engines: manifest.engines.map((profile) => profile.id), version: manifest.profileVersion })
      : worker.emit({ type: 'error', operationKey: input.operationKey, code: 'package_group_required', groupIDs, log }))
  }
}
async function rejected(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof LatexTransportError && error.code === code)
}

test('browser maps are separately inspected, PDF-bound session artifacts; persisted/native proof DTOs stay unchanged', async () => {
  const path = 'tools/synctex/synctex-parser.wasm', contents = new Map(fixtureBytes), parser = new TextEncoder().encode('Unit-only parser bytes')
  contents.set(path, parser)
  const bundle = { ...manifest, synctex: assetPin(path, parser) }
  for (const accepted of [true, false]) {
    const worker = new WorkerFixture(), pdf = await actualPdf(), maps: BrowserSyncArtifact[] = []
    successful(worker, pdf, { synctex: new TextEncoder().encode('Unit-only map bytes').buffer, synctexPdfSha256: hashBytes(pdf) })
    const compiler = transport(worker, { request: fixtureRequest(bundle, contents), manifestPin: manifestPin(bundle), inspectSyncArtifact: async (proof, artifact) => {
      assert.equal(artifact.identity, proofActionIdentity(proof)); assert.equal(artifact.parserSha256, bundle.synctex.sha256)
      assert.equal(artifact.data.byteLength, 19); assert.ok(artifact.sourceFiles.every((file) => file.lines > 0)); return accepted
    } })
    const proof = await compiler.compileBrowserProject(createTemplateProject(), 'session-map-operation', undefined, undefined, { onSyncArtifact: (artifact) => maps.push(artifact) })
    assert.equal(proof.runtime, 'browser'); assert.equal(proof.syncAvailable, false); assert.equal(Object.hasOwn(proof, 'synctex'), false)
    assert.equal(Object.hasOwn(proof, 'artifact'), false); assert.equal(maps.length, accepted ? 1 : 0)
    assert.equal(proof.data.byteLength, pdf.byteLength)
  }
})

test('map/PDF mismatch, malformed/oversized maps and cancellation during map inspection never publish a sync artifact', async () => {
  const path = 'tools/synctex/synctex-parser.wasm', contents = new Map(fixtureBytes), parser = new TextEncoder().encode('Unit-only parser')
  contents.set(path, parser)
  const bundle = { ...manifest, synctex: assetPin(path, parser) }
  for (const sidecar of [new ArrayBuffer(LATEX_LIMITS.syncBytes + 1), 'not bytes', new ArrayBuffer(3)]) {
    const worker = new WorkerFixture(), pdf = await actualPdf()
    successful(worker, pdf, { synctex: sidecar, synctexPdfSha256: 'f'.repeat(64) })
    const compiler = transport(worker, { request: fixtureRequest(bundle, contents), manifestPin: manifestPin(bundle), inspectSyncArtifact: async () => assert.fail('Invalid maps never reach inspection') })
    await rejected(compiler.compileBrowserProject(createTemplateProject(), 'bad-map-operation', undefined, undefined, { onSyncArtifact: () => assert.fail('No bad artifact') }), 'browser_protocol_error')
  }
  const worker = new WorkerFixture(), pdf = await actualPdf(), controller = new AbortController()
  successful(worker, pdf, { synctex: new ArrayBuffer(3), synctexPdfSha256: hashBytes(pdf) })
  const compiler = transport(worker, { request: fixtureRequest(bundle, contents), manifestPin: manifestPin(bundle), inspectSyncArtifact: async (_proof, _map, signal) => { controller.abort(); assert.equal(signal?.aborted, true); return true } })
  await rejected(compiler.compileBrowserProject(createTemplateProject(), 'cancel-map-operation', controller.signal, undefined, { onSyncArtifact: () => assert.fail('Cancelled map cannot be published') }), 'browser_compile_cancelled')
})

test('package-assisted eligibility is checked after asset preparation and again immediately before source transfer', async () => {
  for (const denyAt of [1, 2]) {
    const worker = new WorkerFixture(), pdf = await actualPdf()
    successful(worker, pdf)
    let checks = 0, created = 0
    const compiler = transport(worker, { createWorker: () => { created++; return worker } })
    await rejected(compiler.compileBrowserProject(createTemplateProject(), 'stale-package-operation', undefined, undefined, { mayStartAfterPreparation: () => ++checks < denyAt }), 'browser_compile_cancelled')
    assert.equal(created, denyAt - 1)
    assert.equal(worker.messages.some((message) => (message as { type: string }).type === 'compile'), false)
  }
})

test('public package preparation validates exact compatible IDs and includes Biber bytes without granting consent', () => {
  const { bundle } = groupedFixture(true)
  for (const ids of [[], new Array(1), ['missing'], ['base'], ['boxes', 'boxes'], ['lua-only']]) assert.equal(browserPackagePreparation(bundle, 'pdflatex', ids), null)
  const prepared = browserPackagePreparation(bundle, 'pdflatex', ['bibliography'])!
  assert.equal(prepared.groups.length, 1)
  assert.equal(prepared.downloadBytes, bundle.groups.find((group) => group.id === 'bibliography')!.assets.reduce((sum, pin) => sum + pin.bytes, 0) + bundle.biber!.assets.reduce((sum, pin) => sum + pin.bytes, 0))
  prepared.groups[0].assets[0].sha256 = 'f'.repeat(64)
  assert.notEqual(browserPackagePreparation(bundle, 'pdflatex', ['bibliography'])!.groups[0].assets[0].sha256, 'f'.repeat(64))
})

test('biblatex informational file probes retain their severity before missing-file classification', () => {
  const project = literalProject('\\documentclass{article}\n\\begin{document}Resume\\end{document}')
  for (const path of ['output.bbl', 'ieee.dbx', 'biblatex-dm.cfg', 'optional.sty', 'optional.bib']) {
    for (const prefix of ['', 'wrapper/main.tex:2: ']) {
      const message = `Package biblatex Info: ... file '${path}' not found.`
      const diagnostics = browserLatexDiagnostics(prefix + message, project, false)
      assert.equal(diagnostics.length, 1)
      assert.equal(diagnostics[0].severity, 'info', `${prefix}${message}`)
      assert.equal(diagnostics[0].code, 'tex_info')
    }
    const fatal = browserLatexDiagnostics(`! Package biblatex Error: File '${path}' not found.`, project, false)
    assert.equal(fatal[0].severity, 'error', `Required ${path} must still fail`)
  }
  assert.ok(browserLatexDiagnostics("Package biblatex Info: ... file 'ieee.dbx' not found.", project, true).some((item) => item.severity === 'error'), 'A refused worker still fails even with only informational log entries')
})

test('AltaCV first-pass bibliography notices do not reject a converged PDF in the full browser transport', async () => {
  const project = literalProject('\\documentclass{article}\n\\begin{document}Resume\\end{document}', [], 'xelatex')
  const log = [
    'TeX pass 1: XeLaTeX',
    "Package biblatex Info: ... file 'output.bbl' not found.",
    'No file output.bbl.',
    "Package biblatex Info: ... file 'ieee.dbx' not found.",
    "Package biblatex Info: ... file 'biblatex-dm.cfg' not found.",
    'Package biblatex Warning: Please (re)run Biber on the file:',
    '(biblatex)                output',
    'INFO - Writing output.bbl with encoding UTF-8',
    'TeX pass 2: XeLaTeX', '(./output.bbl)',
    'TeX pass 3: XeLaTeX',
    "Package biblatex Info: ... file 'ieee.dbx' not found.",
    "Package biblatex Info: ... file 'biblatex-dm.cfg' not found.",
    '(./output.bbl)', 'Output written on output.pdf (2 pages).',
  ].join('\n')
  const worker = new WorkerFixture(), pdf = await actualPdf()
  successful(worker, pdf, { log })
  const proof = await transport(worker).compileBrowserProject(project, 'altacv-biblatex-converged')
  assert.equal(proof.status, 'ready')
  assert.equal(proof.diagnostics.some((item) => item.severity === 'error'), false)
  assert.deepEqual(proof.diagnostics.map((item) => item.code), ['tex_info', 'tex_info'])
  assert.equal(proof.pdf.sha256, hashBytes(pdf))
  assert.equal(proof.log, log, 'The original compiler evidence must remain intact')
})

test('only an earlier generated output.bbl notice is transient; final missing bibliography and source failures remain errors', () => {
  const project = literalProject('\\documentclass{article}\n\\begin{document}Resume\\end{document}')
  for (const engine of ['pdfLaTeX', 'XeLaTeX', 'LuaHBTeX']) {
    const initial = `TeX pass 1: ${engine}\nNo file output.bbl.\nTeX pass 2: ${engine}\n(./output.bbl)`
    assert.equal(browserLatexDiagnostics(initial, project, false).some((item) => item.severity === 'error'), false)
    for (const message of ['No file output.bbl.', "Package biblatex Warning: Please (re)run Biber on the file:", "LaTeX Warning: Citation 'missing' on page 1 undefined on input line 2."]) {
      assert.ok(browserLatexDiagnostics(`${initial}\n${message}`, project, false).some((item) => item.severity === 'error'), message)
    }
    for (const message of ['No file missing.bib.', 'No file sections/body.tex.', 'No file supplied.bbl.', "! LaTeX Error: File 'missing.sty' not found.", "! Package biblatex Error: File 'output.bbl' not found."]) {
      assert.ok(browserLatexDiagnostics(`TeX pass 1: ${engine}\n${message}\nTeX pass 2: ${engine}\nOutput written on output.pdf.`, project, false).some((item) => item.severity === 'error'), message)
    }
  }
  assert.equal(browserLatexDiagnostics('No file output.bbl.', project, false)[0].severity, 'error', 'Without later-pass evidence a missing bibliography is not assumed resolved')
})

test('browser diagnostics keep nested source authority, vendor barriers and explicit invalid locations', () => {
  const project = literalProject('Main\nsource\n', [{ id: 'child', path: 'sections/body.tex', content: 'line\nline\nline\n' }])
  const log = '(./wrapper/main.tex\n(./sections/body.tex\n! Undefined control sequence.\nl.2 \\badcommand\n)\n! Main failure.\nl.1 Main\n(/texlive/vendor.sty\n! Vendor failure.\nl.2 wrong\n)\n/other/sections/body.tex:2: Unknown source.\nsections/body.tex:0: Bad zero location.\nsections/body.tex:2.5: Fraction location.\n'
  const diagnostics = browserLatexDiagnostics(log, project, true)
  assert.equal(diagnostics[0].file, 'sections/body.tex'); assert.equal(diagnostics[0].line, 2); assert.equal(diagnostics[0].help, 'The compiler stopped at \\badcommand.')
  assert.equal(diagnostics[1].file, 'wrapper/main.tex'); assert.equal(diagnostics[1].line, 1)
  assert.ok(diagnostics.slice(2).every((item) => !item.file && !item.line))
  const indirect = browserLatexDiagnostics('(./wrapper/main.tex\n! Undefined control sequence.\n\\outer ->\\badcommand\nl.2 \\outer\n', project, true)
  assert.equal(indirect[0].help, undefined)
})

test('browser diagnostics keep polyglossia missing hyphenation patterns a warning, not a refused missing file', () => {
  const project = literalProject('Source')
  const [hyphenation] = browserLatexDiagnostics('Module polyglossia Warning: Hyphenation file hyph-bn.pat.txt not found on input line 21\n', project, true)
  assert.equal(hyphenation.severity, 'warning'); assert.equal(hyphenation.code, 'tex_warning')
  const [authored] = browserLatexDiagnostics("! LaTeX Error: File `hyph-bn.tex' not found.\n", project, true)
  assert.equal(authored.code, 'missing_file', 'An authored or required file is still refused')
})

test('browser diagnostics classify actual missing extensions and reconstruct wrapped/package-prefixed messages', () => {
  const project = literalProject('Source')
  for (const [name, code] of [['part.tex', 'missing_file'], ['refs.bib', 'missing_file'], ['style.bst', 'missing_file'], ['custom.sty', 'missing_package'], ['resume.cls', 'missing_package'], ['photo.png', 'missing_asset'], ['font.otf', 'missing_font']]) {
    const result = browserLatexDiagnostics(`! LaTeX Error: File \`${name}' not found.\n`, project, true)
    assert.equal(result[0].code, code, name)
  }
  const path = 'sections/' + 'a'.repeat(75) + '.tex'
  const withLongPath = { ...project, files: [...project.files, { id: 'long', path, content: 'Source\n' }] }
  const line = `${path}:1: Undefined control sequence.`
  const found = browserLatexDiagnostics(line.slice(0, 79) + '\n' + line.slice(79) + '\nl.1 \\badcommand\n', withLongPath, true)
  assert.equal(found[0].file, path); assert.equal(found[0].line, 1)
  const wrapped = browserLatexDiagnostics("(./wrapper/main.tex\nPackage graphics Warning: File `photo.png'\n(graphics) not found on input line 1.\n", project, true)
  assert.equal(wrapped[0].code, 'missing_asset'); assert.equal(wrapped[0].file, 'wrapper/main.tex'); assert.equal(wrapped[0].line, 1)
})

test('actual TeX font metric failures stay separate from missing project files and informational probes', () => {
  const project = literalProject('Source'), message = 'Font TU/lmr/m/n/14.4=[lmroman12-regular]:+tlig; at 14.4pt not loadable: Metric (TFM) file or installed font not found.'
  for (const prefix of ['', '! ', 'wrapper/main.tex:1: ']) assert.equal(browserLatexDiagnostics(prefix + message, project, true)[0].code, 'missing_font')
  assert.equal(browserLatexDiagnostics('Package fontspec Info: ' + message, project, false)[0].severity, 'info')
  assert.equal(browserLatexDiagnostics("! LaTeX Error: File 'font.sty' not found.", project, true)[0].code, 'missing_package')
})

test('import/construction and capability checks never start compilation or transmit private source', async () => {
  const worker = new WorkerFixture(), compiler = transport(worker)
  assert.equal(worker.messages.length, 0)
  assert.equal((await compiler.getBrowserCapabilities()).profiles.length, 3)
  assert.equal(worker.messages.length, 0)
  const unsupported = transport(worker, { supported: () => false, request: async () => assert.fail('No fetch for unsupported browser') })
  assert.equal((await unsupported.getBrowserCapabilities()).ready, false)
})

test('online metadata revalidates stale workers while offline checks retain force-cached asset support', async () => {
  for (const online of [true, false]) {
    let calls = 0
    const compiler = createBrowserLatexTransport({ supported: () => true, manifestPin: manifestPin(), online: () => online, request: async (url, init) => {
      calls++
      assert.equal(url, `${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`)
      assert.equal(init.cache, online ? 'no-cache' : 'force-cache')
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.credentials, 'omit')
      return Response.json(manifest)
    } })
    assert.equal((await compiler.getBrowserCapabilities()).ready, true)
    assert.equal((await compiler.getBrowserCapabilities()).ready, true)
    assert.equal(calls, 1, 'Once verified, metadata remains available without another network request')
  }
})

test('an imported draft does not fetch or start a worker until its exact chosen main and complete sources can compile', async () => {
  const zip = new JSZip()
  zip.file('template/first.tex', '\\documentclass{article}\\begin{document}First document\\end{document}')
  zip.file('template/cv.tex', '\\documentclass{article}\\begin{document}\\input{sections/body.tex}\\end{document}')
  zip.file('template/sections/body.tex', 'My exact source\r\n')
  const draft = await readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }))
  assert.equal(draft.mainFile, null)
  const worker = new WorkerFixture()
  let requests = 0, workers = 0
  const compiler = transport(worker, { request: async (url, init) => { requests++; return fixtureRequest()(url, init) }, createWorker: () => { workers++; return worker } })
  await rejected(compiler.compileBrowserProject(draft, 'unselected-zip-operation'), 'missing_main')
  assert.equal(requests, 0)
  assert.equal(workers, 0)
  assert.equal(worker.messages.length, 0)
  const selected = reviseProject(draft, { mainFile: 'template/cv.tex' })
  successful(worker, await actualPdf())
  const proof = await compiler.compileBrowserProject(selected, 'selected-zip-operation')
  const initialized = worker.messages[0] as { type: string; mainFile: string; engine: string; manifest: BrowserCompilerManifest; assets: { path: string; content: ArrayBuffer }[]; approvedGroups: string[] }
  assert.equal(initialized.type, 'init'); assert.equal(initialized.mainFile, 'template/cv.tex'); assert.equal(initialized.engine, selected.engine)
  assert.deepEqual(initialized.manifest, manifest); assert.deepEqual(initialized.approvedGroups, [])
  assert.deepEqual(initialized.assets.map((asset) => asset.path), manifest.assets.map((pin) => pin.path))
  assert.deepEqual(worker.transfers[0], initialized.assets.map((asset) => asset.content))
  const sent = worker.messages[1] as { mainFile: string; files: { path: string; content: string }[] }
  assert.equal(sent.mainFile, 'template/cv.tex')
  assert.deepEqual(sent.files, selected.files.map(({ path, content }) => ({ path, content })))
  assert.equal(proof.snapshotHash, await projectSnapshotHash(selected))
  assert.equal(draft.mainFile, null)
  assert.equal(requests, 6)
  assert.equal(workers, 1)
})

test('a stalled availability request is bounded; immutable cached profiles need no network connection', async () => {
  const worker = new WorkerFixture()
  let aborted = false
  const stalled = transport(worker, { capabilitiesTimeoutMs: 15, request: async (_url, init) => {
    init.signal!.addEventListener('abort', () => { aborted = true }, { once: true })
    return new Promise(() => {})
  } })
  await assert.rejects(stalled.getBrowserCapabilities(), /manifest check timed out/)
  assert.equal(aborted, true)
  assert.equal(worker.messages.length, 0)
  let requests = 0
  const cached = transport(worker, { request: async () => { requests++; return Response.json(manifest) } })
  await cached.getBrowserCapabilities()
  await cached.getBrowserCapabilities()
  assert.equal(requests, 1)
})

test('worker response is independently parsed, hashed and bound to immutable source and original image bytes', async () => {
  const worker = new WorkerFixture(), pdf = await actualPdf(), original = pdf.slice(0)
  successful(worker, pdf)
  const compiler = transport(worker)
  const source = createTemplateProject()
  source.assets = [{ id: 'photo', path: 'photo.png', mediaType: 'image/png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99])], { type: 'image/png' }) }]
  const hash = await projectSnapshotHash(source), content = source.files[0].content
  const waiting = compiler.compileBrowserProject(source, 'browser-operation-one')
  source.files[0].content = 'Writing typed while the original snapshot compiles'
  source.revision++
  const proof = await waiting
  assert.equal(proof.runtime, 'browser')
  assert.equal(proof.syncAvailable, false)
  assert.equal(proof.revision, 1)
  assert.equal(proof.snapshotHash, hash)
  assert.deepEqual(proof.data, original)
  const compiled = worker.messages[1] as { files: { path: string; content: string | Uint8Array }[] }
  assert.equal(compiled.files[0].content, content)
  assert.deepEqual(compiled.files.find((file) => file.path === 'photo.png')!.content, new Uint8Array(await source.assets[0].blob.arrayBuffer()))
  assert.equal(worker.terminations, 1)
})

test('incompatible engine/fontspec and Biber sources refuse explicitly before any worker starts', async () => {
  const worker = new WorkerFixture(), compiler = transport(worker)
  const biber = literalProject('\\documentclass{article}\\usepackage[backend=biber]{biblatex}\\begin{document}Publications\\end{document}')
  for (const source of [biber, { ...createTemplateProject(), engine: 'pdflatex' as const }]) await rejected(compiler.compileBrowserProject(source, 'browser-incompatible'), 'browser_compile_incompatible')
  assert.equal(worker.messages.length, 0)
  assert.equal(worker.terminations, 0)
  assert.equal(browserLatexCompatibility(createTemplateProject(), manifest.engines.slice(2))[0].code, 'browser_engine_unsupported')
  assert.deepEqual(browserLatexCompatibility({ ...createTemplateProject(), files: [{ id: 'main', path: 'main.tex', content: '% \\usepackage{biblatex}\n\\documentclass{article}' }] }, manifest.engines), [])
  const explicitShaping = { ...createTemplateProject(), engine: 'xelatex' as const, files: [{ id: 'main', path: 'main.tex', content: '\\setmainfont{Noto Sans Bengali}[Script=Bengali,Renderer=HarfBuzz]' }] }
  assert.ok(browserLatexCompatibility(explicitShaping, manifest.engines).some((item) => item.code === 'browser_engine_incompatible' && item.message.includes('LuaHBTeX')))
  const backup = { ...createTemplateProject(), files: [...createTemplateProject().files, { id: 'unused', path: 'unused.tex', content: '\\usepackage{biblatex}\n\\write18{must not execute}' }] }
  assert.deepEqual(browserLatexCompatibility(backup, manifest.engines), [])
})

test('engine preflight honors provable iftex branches without rewriting source or guessing custom conditions', () => {
  const source = '\\iftutex\n\\usepackage{fontspec}\n\\ifLuaTeX\n\\setmainfont[Renderer=HarfBuzz]{Latin Modern Roman}\n\\else\n\\setmainfont{Latin Modern Roman}\n\\fi\n\\else\n\\usepackage[T1]{fontenc}\n\\fi\n'
  for (const engine of ['pdflatex', 'xelatex', 'lualatex'] as const) {
    const project = literalProject(source, [], engine)
    assert.deepEqual(browserLatexCompatibility(project, manifest.engines), [])
    assert.equal(project.files[0].content, source)
  }
  const custom = literalProject('\\ifcustom\n\\usepackage{fontspec}\n\\fi', [], 'pdflatex')
  const unknown = browserLatexCompatibility(custom, manifest.engines)
  assert.ok(unknown.some((issue) => issue.code === 'browser_compatibility_not_determined' && issue.severity === 'info'))
  assert.ok(!unknown.some((issue) => issue.severity === 'error'))
  for (const content of ['\\newcommand{\\unused}{\\usepackage{fontspec}}', '\\def\\unused{\n\\usepackage{fontspec}\n}', '\\begin{verbatim}\n\\usepackage{fontspec}\n\\end{verbatim}']) {
    const source = literalProject(content)
    assert.ok(!browserLatexCompatibility(source, manifest.engines).some((issue) => issue.severity === 'error'))
    assert.equal(source.files[0].content, content)
  }
})

test('located warnings and information remain nonfatal, including literal error words inside a warning', async () => {
  const project = createTemplateProject()
  const log = 'main.tex:4: Package demo Warning: The word Error: is illustrative.\nmain.tex:6: LaTeX Font Warning: Font shape substituted.\nmain.tex:8: Package demo Info: Inventory only.'
  const diagnostics = browserLatexDiagnostics(log, project, false)
  assert.deepEqual(diagnostics.map((item) => [item.severity, item.file, item.line]), [['warning', 'main.tex', 4], ['warning', 'main.tex', 6], ['info', 'main.tex', 8]])
  const worker = new WorkerFixture()
  successful(worker, await actualPdf(), { log })
  const proof = await transport(worker).compileBrowserProject(project, 'warning-only-ready')
  assert.equal(proof.status, 'ready')
  assert.equal(proof.diagnostics.filter((item) => item.severity === 'error').length, 0)
  assert.equal(browserLatexDiagnostics('main.tex:9: Undefined control sequence \\warningExample', project, false)[0].severity, 'error')
})

test('earlier unresolved references do not reject a converged final pass, but final unresolved output does', async () => {
  const project = createTemplateProject()
  const resolved = 'TeX pass 1: LuaHBTeX\nLaTeX Warning: Reference `known\' on page 1 undefined.\nLaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.\nTeX pass 2: LuaHBTeX\nLaTeX Font Warning: Size substitution used.'
  assert.deepEqual(browserLatexDiagnostics(resolved, project, false).map((item) => item.severity), ['warning'])
  const worker = new WorkerFixture()
  successful(worker, await actualPdf(), { log: resolved })
  assert.equal((await transport(worker).compileBrowserProject(project, 'converged-final-pass')).status, 'ready')
  for (const warning of [
    'LaTeX Warning: There were undefined references.',
    'main.tex:12: LaTeX Warning: Citation `missing\' on page 1 undefined.',
    'LaTeX Warning: Reference `very-long-literal-key\' on page 1\nundefined on input line 12.',
    'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
    'Package biblatex Warning: Please (re)run Biber on the file:',
    'Package pdftex.def Warning: File `missing.png\' not found: using draft setting.',
    '[125] Biber.pm:333> WARN - I didn\'t find a database entry for missing',
  ]) {
    const log = `${resolved}\nTeX pass 3: LuaHBTeX\n${warning}`
    assert.ok(browserLatexDiagnostics(log, project, false).some((item) => item.severity === 'error'), warning)
    const refused = new WorkerFixture()
    successful(refused, await actualPdf(), { log })
    await rejected(transport(refused).compileBrowserProject(project, 'unresolved-final-pass'), 'browser_compile_refused')
  }
})

test('late fatal diagnostics survive a full warning list without promoting ordinary warnings', () => {
  const project = createTemplateProject()
  const warnings = Array.from({ length: 300 }, (_, index) => `main.tex:${index + 1}: Package demo Warning: Warning ${index}.`).join('\n')
  const diagnostics = browserLatexDiagnostics(`${warnings}\nmain.tex:401: Undefined control sequence \\actualFailure`, project, false)
  assert.equal(diagnostics.length, 128)
  assert.equal(diagnostics.filter((item) => item.severity === 'error').length, 1)
  assert.equal(diagnostics.find((item) => item.severity === 'error')?.line, 401)
})

test('real-Biber metadata requires a pinned bibliography group, complete tool and compatible advertised profiles', () => {
  const { bundle } = groupedFixture(true)
  assert.equal(readBrowserCompilerManifest(bundle).biber!.version, '2.22')
  for (const change of [
    { biber: undefined }, { biber: { ...bundle.biber, version: '2.19' } },
    { biber: { ...bundle.biber, group: 'missing' } }, { biber: { ...bundle.biber, assets: bundle.biber!.assets.slice(1) } },
    { biber: { ...bundle.biber, executable: '/host/biber' } },
    { groups: bundle.groups.map((group) => group.id === 'bibliography' ? { ...group, profiles: ['lualatex'] } : group) },
  ]) assert.throws(() => readBrowserCompilerManifest({ ...bundle, ...change }))
})

test('only pinned SimpleIcons nonprinting space is a warning; visible glyph and body-space loss stay errors', () => {
  const project = createTemplateProject()
  const space = browserLatexDiagnostics('Missing character: There is no   (U+0020) in font [SimpleIcons.otf]/OT:language\n=dflt;!', project, false)
  assert.equal(space[0].severity, 'warning'); assert.equal(space[0].code, 'icon_font_space')
  for (const log of ['Missing character: There is no X (U+F59F) in font [SimpleIcons.otf]!', 'Missing character: There is no   (U+0020) in font [Lato-Regular.ttf]!']) {
    const issues = browserLatexDiagnostics(log, project, false)
    assert.equal(issues[0].severity, 'error'); assert.equal(issues[0].code, 'missing_glyph')
  }
})

test('Biber tool bytes require the same explicit immutable-group approval and never contain project data in requests', async () => {
  const { bundle, contents } = groupedFixture(true), assets = new MemoryAssetStore(), worker = new WorkerFixture()
  const project = literalProject('\\documentclass{article}\\usepackage[backend=biber]{biblatex}\\addbibresource{refs.bib}\\begin{document}Private CV\\printbibliography\\end{document}', [{ id: 'bib', path: 'refs.bib', content: '@book{private,title={Private bibliography},year={2026}}' }])
  const compiler = transport(worker, { request: fixtureRequest(bundle, contents), manifestPin: manifestPin(bundle), assetStore: assets })
  const preparation = await compiler.getBrowserPreparation(project)
  const group = bundle.groups.find((group) => group.id === 'bibliography')!
  const bytes = [...group.assets, ...bundle.biber!.assets].reduce((sum, asset) => sum + asset.bytes, 0)
  assert.deepEqual(preparation.groups.map((group) => group.id), ['bibliography'])
  assert.equal(preparation.downloadBytes, bytes)
  assert.ok(assets.saves.every((asset) => asset.pin.path === 'manifest.json')); assert.equal(worker.messages.length, 0)
  await rejected(compiler.compileBrowserProject(project, 'needs-biber-approval'), 'package_group_required')
  assert.equal(worker.messages.length, 0); assert.ok(assets.saves.every((asset) => asset.pin.path === 'manifest.json'))
  await compiler.approveBrowserPackageGroups(preparation)
  successful(worker, await actualPdf())
  await compiler.compileBrowserProject(project, 'approved-biber-operation')
  const initialized = worker.messages[0] as { approvedGroups: string[]; assets: { path: string }[] }
  assert.deepEqual(initialized.approvedGroups, ['bibliography'])
  for (const asset of bundle.biber!.assets) assert.ok(initialized.assets.some((item) => item.path === asset.path))
  assert.equal((await compiler.getBrowserPreparation(project)).groups.length, 0)
  const revisedContents = new Map(contents)
  const changed = new TextEncoder().encode('A different unit-only Biber runtime, not the approved bytes')
  revisedContents.set('tools/biber/biber.js.bin', changed)
  const revised = { ...bundle, biber: { ...bundle.biber!, assets: bundle.biber!.assets.map((asset) => asset.path === 'tools/biber/biber.js.bin' ? assetPin(asset.path, changed) : asset) } }
  const different = transport(new WorkerFixture(), { request: fixtureRequest(revised, revisedContents), manifestPin: manifestPin(revised), assetStore: assets })
  assert.equal((await different.getBrowserPreparation(project)).groups.length, 1, 'Consent must cover the tool bytes too, not just unchanged TeX style files')
})

test('mismatched identities, nonzero engine exits, malformed output and dishonest PDF verification cannot be accepted', async () => {
  for (const change of [{ operationKey: 'other-operation' }, { engine: 'pdflatex' }, { exitCode: 1 }, { pdf: new ArrayBuffer(LATEX_LIMITS.pdfBytes + 1) }, { log: 'x'.repeat(LATEX_LIMITS.logBytes + 1) }]) {
    const worker = new WorkerFixture()
    successful(worker, await actualPdf(), change)
    await rejected(transport(worker).compileBrowserProject(createTemplateProject(), 'browser-invalid-result'), 'browser_protocol_error')
    assert.equal(worker.terminations, 1)
  }
  const invalid = new WorkerFixture()
  successful(invalid, new TextEncoder().encode('%PDF-1.7\nnot a proof').buffer)
  await rejected(transport(invalid).compileBrowserProject(createTemplateProject(), 'browser-invalid-pdf'), 'browser_pdf_invalid')
  const dishonest = new WorkerFixture()
  successful(dishonest, await actualPdf())
  await rejected(transport(dishonest, { verifyPdf: async (data) => ({ bytes: data.byteLength, pages: 1, sha256: 'b'.repeat(64) }) }).compileBrowserProject(createTemplateProject(), 'browser-dishonest-pdf'), 'browser_pdf_invalid')
})

test('real cancellation terminates the worker before acknowledgment; late results are ignored and never recovered as server work', async () => {
  const worker = new WorkerFixture(), compiler = transport(worker)
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  worker.handle = () => { started() }
  const waiting = compiler.compileBrowserProject(createTemplateProject(), 'browser-cancel-operation')
  const rejection = rejected(waiting, 'browser_compile_cancelled')
  await entered
  assert.deepEqual(await compiler.cancelBrowserCompile('unrelated-operation'), { cancelled: false, status: 'not_found' })
  assert.equal(worker.terminations, 0)
  assert.deepEqual(await compiler.cancelBrowserCompile('browser-cancel-operation'), { cancelled: true, status: 'cancelled' })
  assert.equal(worker.terminations, 1)
  worker.emit({ type: 'ready', engines: manifest.engines.map((profile) => profile.id), version: manifest.profileVersion })
  await rejection
  assert.equal(worker.messages.length, 1)
})

test('loading and compile deadlines are terminal local failures, with no leaked worker or automatic retry', async () => {
  const loading = new WorkerFixture()
  await rejected(transport(loading, { loadingTimeoutMs: 15 }).compileBrowserProject(createTemplateProject(), 'browser-load-timeout'), 'browser_loading_timeout')
  // Under concurrent suites the load deadline can precede worker construction.
  // An unstarted worker must stay unstarted; a started worker must be terminated.
  assert.equal(loading.terminations, loading.messages.length ? 1 : 0)
  const compiling = new WorkerFixture()
  compiling.handle = (message) => { if ((message as { type: string }).type === 'init') queueMicrotask(() => compiling.emit({ type: 'ready', engines: manifest.engines.map((profile) => profile.id), version: manifest.profileVersion })) }
  await rejected(transport(compiling, { compileTimeoutMs: 15 }).compileBrowserProject(createTemplateProject(), 'browser-compile-timeout'), 'browser_compiling_timeout')
  assert.equal(compiling.terminations, 1)
})

test('progress comes from real worker phases/pass numbers, not fabricated percentages or private log excerpts', async () => {
  const worker = new WorkerFixture(), pdf = await actualPdf(), phases: LatexCompileProgress[] = []
  worker.handle = (message) => {
    const input = message as Record<string, unknown>
    queueMicrotask(() => {
      if (input.type === 'init') {
        worker.emit({ type: 'progress', stage: 'initializing', message: 'untrusted private excerpt', downloadedBytes: 999999, verifiedBytes: 999999, totalBytes: 1, cachedBytes: 999999, assetPath: 'private/main.tex' })
        worker.emit({ type: 'ready', engines: manifest.engines.map((profile) => profile.id), version: manifest.profileVersion })
      } else {
        worker.emit({ type: 'progress', stage: 'compiling', pass: 2, message: 'untrusted private excerpt', percent: 99 })
        worker.emit({ type: 'result', operationKey: input.operationKey, engine: input.engine, exitCode: 0, pdf, log: '' })
      }
    })
  }
  await transport(worker).compileBrowserProject(createTemplateProject(), 'browser-progress-operation', undefined, (value) => phases.push(value))
  assert.ok(phases.some((value) => value.phase === 'loading'))
  assert.deepEqual(phases.filter((value) => value.phase !== 'loading').map((value) => value.phase), ['initializing', 'compiling', 'compiling', 'verifying'])
  assert.equal(phases.find((value) => value.pass)?.pass, 2)
  assert.doesNotMatch(JSON.stringify(phases), /private excerpt|percent/)
  assert.doesNotMatch(JSON.stringify(phases), /private\/main\.tex|999999/)
})

test('real TeX diagnostics and missing glyphs refuse partial PDFs, while warnings remain visible', async () => {
  const source = createTemplateProject()
  assert.ok(browserLatexDiagnostics('main.tex:5: Undefined control sequence.\n', source, true).some((item) => item.file === 'main.tex' && item.line === 5))
  assert.ok(browserLatexDiagnostics('LaTeX Warning: Label(s) may have changed.\n', source, false).some((item) => item.severity === 'error' && item.code === 'unresolved_references'))
  const flooded = Array.from({ length: 150 }, (_, index) => `LaTeX Warning: Warning ${index}.`).join('\n') + '\nMissing character: There is no required glyph!'
  const reported = browserLatexDiagnostics(flooded, source, false)
  assert.equal(reported.length, 128)
  assert.ok(reported.some((item) => item.code === 'missing_glyph' && item.severity === 'error'))
  const nested = { ...source, files: [...source.files, { id: 'nested', path: 'sections/details.tex', content: 'bad source' }] }
  assert.ok(browserLatexDiagnostics('./sections/details.tex:3: Undefined control sequence.', nested, true).some((item) => item.file === 'sections/details.tex' && item.line === 3))
  const worker = new WorkerFixture()
  successful(worker, await actualPdf(), { log: 'Missing character: There is no Bengali glyph in font Latin Modern Roman!\n' })
  await rejected(transport(worker).compileBrowserProject(source, 'browser-missing-glyph'), 'browser_compile_refused')
})

test('manifest rejects unavailable profiles and unsafe, duplicate, unpinned or oversized asset paths', () => {
  assert.equal(readBrowserCompilerManifest(manifest).engines.length, 3)
  for (const input of [{ ...manifest, engines: [] }, { ...manifest, assets: [...manifest.assets, manifest.assets[0]] }, { ...manifest, assets: manifest.assets.map((asset) => ({ ...asset, path: '../escape.wasm' })) }, { ...manifest, assets: manifest.assets.map((asset) => ({ ...asset, sha256: 'unverified' })) }, { ...manifest, assets: manifest.assets.map((asset) => ({ ...asset, bytes: 512 * 1024 * 1024 })) }]) assert.throws(() => readBrowserCompilerManifest(input))
})

test('production bootstrap is a pinned force-cached fixed asset GET, with no private data or leaked Blob URL', async () => {
  const code = new TextEncoder().encode('/* unit bootstrap contract, not actual TeX */'), pdf = await actualPdf()
  const contents = new Map(fixtureBytes).set('compiler-worker.js', code)
  const pinned = { ...manifest, assets: manifest.assets.map((asset) => asset.path === 'compiler-worker.js' ? assetPin(asset.path, code) : asset) }
  const previous = globalThis.Worker
  const workers: (WorkerFixture & { url: string })[] = []
  class BootstrapFixture extends WorkerFixture {
    url: string
    constructor(url: string) { super(); this.url = url; successful(this, pdf); workers.push(this) }
  }
  globalThis.Worker = BootstrapFixture as unknown as typeof Worker
  try {
    const urls: string[] = []
    const compiler = createBrowserLatexTransport({ supported: () => true, manifestPin: manifestPin(pinned), verifyPdf: (data) => verifyBrowserLatexPdf(data), request: async (url, init) => {
      urls.push(url)
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.cache, url.includes('manifest.json?') ? 'no-cache' : 'force-cache'); assert.equal(init.credentials, 'omit')
      return fixtureRequest(pinned, contents)(url, init)
    } })
    const proof = await compiler.compileBrowserProject(createTemplateProject(), 'bootstrap-pinned-operation')
    assert.equal(proof.runtime, 'browser')
    assert.deepEqual(urls, [`${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`, ...pinned.assets.map((pin) => `${BROWSER_LATEX_ROOT}${pin.path}?sha256=${pin.sha256}`)])
    assert.match(workers[0].url, /^blob:/)
    assert.equal(workers[0].terminations, 1)
    assert.equal(resolveObjectURL(workers[0].url), undefined)
  } finally { globalThis.Worker = previous }
})

test('invalid worker script MIME or byte hashes stop bootstrap before execution or source transfer', async () => {
  for (const type of ['application/javascript', 'text/html']) {
    const urls: string[] = []
    const compiler = createBrowserLatexTransport({ supported: () => true, manifestPin: manifestPin(), request: async (url) => {
      urls.push(url)
      if (url.includes('manifest.json?profile=')) return Response.json(manifest)
      return new Response(new Uint8Array([1]), { headers: { 'Content-Type': type } })
    } })
    await assert.rejects(compiler.compileBrowserProject(createTemplateProject(), 'bootstrap-unpinned-operation'), (error: unknown) => error instanceof LatexTransportError && error.code === 'browser_runtime_unavailable' && /asset|integrity|MIME/i.test(error.message))
    assert.deepEqual(urls, [`${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`, `${BROWSER_LATEX_ROOT}compiler-worker.js?sha256=${manifest.assets[0].sha256}`])
  }
})

test('initialization failure is not mislabeled as a TeX source refusal and never sends a snapshot', async () => {
  const worker = new WorkerFixture()
  worker.handle = () => queueMicrotask(() => worker.emit({ type: 'error', code: 'runtime_unavailable', message: 'Insufficient device memory for this engine.' }))
  await assert.rejects(transport(worker).compileBrowserProject(createTemplateProject(), 'init-failed-operation'), (error: unknown) => error instanceof LatexTransportError && error.code === 'browser_runtime_unavailable' && error.diagnostics?.[0]?.message.includes('before receiving') === true && error.diagnostics?.[0]?.help?.includes('device memory') === true)
  assert.equal(worker.messages.length, 1)
  assert.equal(worker.terminations, 1)
})

test('cancellation during independent PDF verification aborts that stage without detaching canonical bytes', async () => {
  const worker = new WorkerFixture(), pdf = await actualPdf(), original = pdf.slice(0)
  successful(worker, pdf)
  let entered!: () => void, aborted = false
  const verifying = new Promise<void>((resolve) => { entered = resolve })
  const compiler = transport(worker, { verifyPdf: (copy, signal) => {
    assert.notEqual(copy, pdf)
    structuredClone(copy, { transfer: [copy] })
    assert.equal(copy.byteLength, 0)
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
    entered()
    return new Promise(() => {})
  } })
  const waiting = compiler.compileBrowserProject(createTemplateProject(), 'cancel-verifying-operation')
  const failure = rejected(waiting, 'browser_compile_cancelled')
  await verifying
  assert.equal((await compiler.cancelBrowserCompile('cancel-verifying-operation')).cancelled, true)
  assert.equal(aborted, true)
  await failure
  assert.equal(worker.terminations, 1)
  assert.deepEqual(pdf, original)
})

test('manifest asset ceilings match the worker 96 MiB ceiling before any download', () => {
  const bounded = structuredClone(manifest)
  bounded.assets.at(-1)!.bytes = 96 * 1024 * 1024
  assert.equal(readBrowserCompilerManifest(bounded).assets.at(-1)!.bytes, 96 * 1024 * 1024)
  bounded.assets.at(-1)!.bytes++
  assert.throws(() => readBrowserCompilerManifest(bounded), /asset entry/)
})

test('grouped manifests are additive, immutable metadata and retain all five legacy top-level pins', () => {
  const { bundle } = groupedFixture(), parsed = readBrowserCompilerManifest(bundle)
  assert.deepEqual(parsed, bundle)
  assert.equal(Object.hasOwn(readBrowserCompilerManifest(manifest), 'groups'), false)
  bundle.groups[0].assets[0].sha256 = 'f'.repeat(64)
  bundle.groups[0].profiles.length = 0
  assert.notEqual(parsed.groups![0].assets[0].sha256, 'f'.repeat(64))
  assert.equal(parsed.groups![0].profiles.length, 3)
  for (const missing of manifest.assets) assert.throws(() => readBrowserCompilerManifest({ ...parsed, assets: parsed.assets.filter((pin) => pin.path !== missing.path) }))
  assert.throws(() => readBrowserCompilerManifest({ ...parsed, groups: [] }))
  assert.throws(() => readBrowserCompilerManifest({ ...parsed, groups: parsed.groups!.filter((group) => group.kind !== 'core') }))
  assert.throws(() => readBrowserCompilerManifest({ ...parsed, groups: parsed.groups!.filter((group) => !group.profiles.includes('xelatex') || group.kind !== 'profile') }))
})

test('group schema rejects unsafe paths, aliases, unknown assets, forged kinds/profiles/packages and package-size overflow', () => {
  const { bundle } = groupedFixture(), box = bundle.groups.find((group) => group.id === 'boxes')!
  const changed = (group: Record<string, unknown>) => ({ ...bundle, groups: bundle.groups.map((item) => item.id === box.id ? { ...box, ...group } : item) })
  for (const group of [
    { id: '../boxes' }, { id: 'Boxes' }, { kind: 'remote' }, { kind: {} }, { extra: true }, { profiles: [] }, { profiles: ['pdflatex', 'pdflatex'] }, { profiles: ['tectonic'] },
    { packages: [] }, { packages: ['box', 'BOX'] }, { packages: ['bad/package'] }, { packages: ['bad package'] },
    { archive: 'https://invalid.test/box.tar.gz' }, { archive: 'groups/other/box.tar.gz' }, { index: 'groups/boxes/index.json?source=private' },
    { assets: [box.assets[0]] }, { assets: [box.assets[0], box.assets[0]] }, { assets: [...box.assets, manifest.assets[0]] },
    { assets: box.assets.map((pin) => ({ ...pin, bytes: 0 })) }, { assets: box.assets.map((pin) => ({ ...pin, sha256: 'bad' })) },
    { assets: box.assets.map((pin) => ({ ...pin, source: 'private source is not a pin' })) },
    { assets: box.assets.map((pin) => ({ ...pin, bytes: pin.path === box.archive ? 12 * 1024 * 1024 + 1 : pin.bytes })) },
  ]) assert.throws(() => readBrowserCompilerManifest(changed(group)), JSON.stringify(group))
  for (const path of ['groups/boxes/../index.json', 'groups//boxes/index.json', '/groups/boxes/index.json', 'groups/boxes/.hidden/index.json', 'groups/boxes/index.json/', 'groups/boxes/%2e%2e/index.json', 'groups\\boxes\\index.json']) {
    assert.throws(() => readBrowserCompilerManifest(changed({ index: path, assets: [box.assets[0], { ...box.assets[1], path }] })), path)
  }
  for (const [archive, index] of [['groups/boxes/a.tar.gz', 'groups/boxes/a.tar.gz/index.json'], ['groups/boxes/Dir/a.tar.gz', 'groups/boxes/dir/index.json']]) {
    assert.throws(() => readBrowserCompilerManifest(changed({ archive, index, assets: [{ ...box.assets[0], path: archive }, { ...box.assets[1], path: index }] })))
  }
  assert.throws(() => readBrowserCompilerManifest({ ...bundle, groups: [...bundle.groups, box] }))
  assert.throws(() => readBrowserCompilerManifest({ ...bundle, assets: [...bundle.assets, { ...bundle.assets[2], path: 'BUSYTEX.WASM' }] }))
  assert.equal(readBrowserCompilerManifest(changed({ assets: box.assets.map((pin) => ({ ...pin, bytes: pin.path === box.archive ? 12 * 1024 * 1024 : pin.bytes })) })).groups!.length, bundle.groups.length)
})

test('global grouped asset budget includes unused legacy pins and permits at most 64 unique assets', () => {
  const groups: BrowserCompilerGroup[] = Array.from({ length: 29 }, (_, index) => {
    const id = `g${index}`, archive = `groups/${id}/archive.tar.gz`, inventory = `groups/${id}/index.json`
    return { id, kind: index === 0 ? 'core' : index <= 3 ? 'profile' : 'package', profiles: index >= 1 && index <= 3 ? [manifest.engines[index - 1].id] : manifest.engines.map((profile) => profile.id), packages: index > 3 ? [`package${index}`] : [], archive, index: inventory, assets: [archive, inventory].map((path) => ({ path, bytes: 1, sha256: 'a'.repeat(64) })) }
  })
  const assets = [...manifest.assets, { path: 'extra.bin', bytes: 1, sha256: 'b'.repeat(64) }]
  assert.equal(readBrowserCompilerManifest({ ...manifest, groups, assets }).groups!.length, 29)
  assert.throws(() => readBrowserCompilerManifest({ ...manifest, groups, assets: [...assets, { path: 'overflow.bin', bytes: 1, sha256: 'c'.repeat(64) }] }))
  assert.throws(() => readBrowserCompilerManifest({ ...manifest, groups, assets: manifest.assets.map((pin, index) => ({ ...pin, bytes: index < 2 ? 128 * 1024 * 1024 : pin.bytes })) }))
})

test('each engine receives exactly runtime + every core/matching profile, never legacy snapshots or unapproved packages', async () => {
  const { bundle, contents } = groupedFixture(), pdf = await actualPdf()
  for (const engine of bundle.engines.map((profile) => profile.id)) {
    const worker = new WorkerFixture(), store = new MemoryAssetStore(), urls: string[] = []
    successful(worker, pdf)
    const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
    const source = literalProject(String.raw`\documentclass{article}\begin{document}Private marker\end{document}`, [], engine)
    await compiler.compileBrowserProject(source, `selected-${engine}-operation`)
    const expected = [...bundle.assets.slice(0, 3), ...bundle.groups.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(engine))).flatMap((group) => group.assets)]
    const initialized = worker.messages[0] as { assets: { path: string; content: ArrayBuffer }[]; engine: string; approvedGroups: string[] }
    assert.equal(initialized.engine, engine); assert.deepEqual(initialized.approvedGroups, [])
    assert.deepEqual(initialized.assets.map((asset) => asset.path), expected.map((pin) => pin.path))
    for (const asset of initialized.assets) assert.equal(hashBytes(asset.content), expected.find((pin) => pin.path === asset.path)!.sha256)
    assert.deepEqual(worker.transfers[0], initialized.assets.map((asset) => asset.content))
    assert.deepEqual(store.loads.map((entry) => entry.pin.path), expected.map((pin) => pin.path))
    assert.ok(expected.reduce((sum, pin) => sum + pin.bytes, 0) < bundle.assets.reduce((sum, pin) => sum + pin.bytes, 0))
    assert.equal(urls.length, expected.length + 1)
    assert.doesNotMatch(JSON.stringify(urls), /texlive\.snapshot|snapshot-index|groups\/(?:boxes|layouts|lua-only)|Private marker|wrapper/)
    assert.doesNotMatch(JSON.stringify(worker.messages[0]), /Private marker|"files"/)
  }
})

test('cached second compilation has no HTTP request, works offline, and reports real stream/cache bytes only once', async () => {
  const { bundle, contents } = groupedFixture(), pdf = await actualPdf(), store = new MemoryAssetStore(), workers: WorkerFixture[] = [], urls: string[] = []
  let online = true
  const compiler = transport(new WorkerFixture(), { manifestPin: manifestPin(bundle), online: () => online, assetStore: store, createWorker: () => {
    const worker = new WorkerFixture(); successful(worker, pdf); workers.push(worker); return worker
  }, request: async (url, init) => {
    urls.push(url)
    if (!online) assert.fail('Verified metadata/cache must make the second compile request-free')
    const response = await fixtureRequest(bundle, contents)(url, init)
    if (url.includes('manifest.json?')) return response
    const data = new Uint8Array(await response.arrayBuffer()), middle = Math.floor(data.length / 2)
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data.slice(0, middle)); controller.enqueue(data.slice(middle)); controller.close() } }), { headers: response.headers })
  } })
  const source = literalProject(String.raw`\documentclass{article}`), first: LatexCompileProgress[] = [], second: LatexCompileProgress[] = []
  await compiler.compileBrowserProject(source, 'first-cache-operation', undefined, (value) => first.push(value))
  const calls = urls.length
  online = false
  await compiler.compileBrowserProject(source, 'offline-cache-operation', undefined, (value) => second.push(value))
  assert.equal(urls.length, calls); assert.equal(workers.length, 2)
  const expected = [...bundle.assets.slice(0, 3), ...bundle.groups.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(source.engine))).flatMap((group) => group.assets)]
  const total = expected.reduce((sum, pin) => sum + pin.bytes, 0)
  assert.equal(first.at(-1)!.downloadedBytes, total); assert.equal(first.at(-1)!.verifiedBytes, total); assert.equal(first.at(-1)!.cachedBytes, 0)
  assert.equal(second.at(-1)!.downloadedBytes, 0); assert.equal(second.at(-1)!.verifiedBytes, total); assert.equal(second.at(-1)!.cachedBytes, total)
  const firstAudit = first.at(-1)!.assetAudit!, secondAudit = second.at(-1)!.assetAudit!
  assert.deepEqual(firstAudit.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), expected)
  assert.deepEqual(secondAudit.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), expected)
  assert.ok(firstAudit.every((entry) => entry.source === 'fetch-response'))
  assert.ok(secondAudit.every((entry) => entry.source === 'indexeddb-reuse'))
  assert.ok(firstAudit.every((entry) => entry.path !== 'manifest.json'))
  for (const entry of firstAudit) {
    const group = bundle.groups.find((group) => group.assets.some((asset) => asset.path === entry.path))
    assert.equal(entry.groupId, group?.id ?? 'runtime')
    assert.equal(entry.groupKind, group?.kind ?? 'runtime')
    assert.deepEqual(entry.packages, group?.packages ?? [])
  }
  const firstVerified = first.find((value) => (value.verifiedBytes ?? 0) > 0)!
  assert.equal(firstVerified.assetAudit!.length, 1, 'Earlier progress snapshots must not gain later audit entries')
  assert.notEqual(firstVerified.assetAudit, firstAudit)
  assert.ok(first.some((value) => (value.downloadedBytes ?? 0) > (value.verifiedBytes ?? 0) && (value.downloadedBytes ?? 0) < total))
  for (const values of [first, second]) {
    let downloaded = 0, verified = 0, cached = 0
    for (const value of values.filter((value) => value.totalBytes !== undefined)) {
      assert.equal(value.totalBytes, total)
      assert.ok(value.downloadedBytes! >= downloaded && value.verifiedBytes! >= verified && value.cachedBytes! >= cached)
      assert.ok(value.downloadedBytes! + value.cachedBytes! <= total && value.verifiedBytes! <= total)
      if (value.assetPath) assert.ok(contents.has(value.assetPath))
      downloaded = value.downloadedBytes!; verified = value.verifiedBytes!; cached = value.cachedBytes!
    }
  }
  assert.deepEqual(await compiler.getBrowserEngineCacheSummary(), { available: true, bytes: total + manifestPin(bundle).bytes, entries: calls, versions: [BROWSER_LATEX_PROFILE_VERSION] })
  assert.equal(Object.hasOwn(await compiler.getBrowserEngineCacheSummary(), 'ready'), false)
  await compiler.clearBrowserEngineCache()
  assert.deepEqual(await compiler.getBrowserEngineCacheSummary(), { available: true, bytes: 0, entries: 0, versions: [] })
})

test('the parent independently rejects injected corrupt cache bytes and reloads only their fixed pin online', async () => {
  const store = new MemoryAssetStore(), pdf = await actualPdf(), urls: string[] = []
  const compiler = transport(new WorkerFixture(), { assetStore: store, createWorker: () => { const worker = new WorkerFixture(); successful(worker, pdf); return worker }, request: async (url, init) => { urls.push(url); return fixtureRequest()(url, init) } })
  await compiler.compileBrowserProject(createTemplateProject(), 'cache-prime-operation')
  const pin = manifest.assets[0], calls = urls.length, progress: LatexCompileProgress[] = []
  store.bytes.get(`${manifest.profileVersion}:${pin.sha256}`)!.data = new Uint8Array(pin.bytes).buffer
  await compiler.compileBrowserProject(createTemplateProject(), 'cache-recover-operation', undefined, (value) => progress.push(value))
  assert.deepEqual(urls.slice(calls), [`${BROWSER_LATEX_ROOT}${pin.path}?sha256=${pin.sha256}`])
  assert.equal(hashBytes(store.bytes.get(`${manifest.profileVersion}:${pin.sha256}`)!.data), pin.sha256)
  const audit = progress.at(-1)!.assetAudit!
  assert.equal(audit.length, manifest.assets.length)
  assert.equal(audit.filter((entry) => entry.source === 'fetch-response').length, 1)
  assert.equal(audit.find((entry) => entry.path === pin.path)!.source, 'fetch-response')
  assert.ok(audit.filter((entry) => entry.path !== pin.path).every((entry) => entry.source === 'indexeddb-reuse'))
  assert.ok(audit.every((entry) => entry.groupId === 'engine-bundle' && entry.groupKind === 'bundle' && entry.packages.length === 0))
})

test('offline cache misses, corrupt bytes and unavailable downloads never start a worker or fabricate a PDF', async () => {
  for (const corrupted of [false, true]) {
    const store = new MemoryAssetStore(), worker = new WorkerFixture(), paths: string[] = []
    if (corrupted) for (const pin of manifest.assets) store.bytes.set(`${manifest.profileVersion}:${pin.sha256}`, { version: manifest.profileVersion, data: new Uint8Array(pin.bytes).buffer })
    const compiler = transport(worker, { online: () => false, assetStore: store, createWorker: () => assert.fail('No ready worker from missing offline pins'), request: async (url, init) => {
      paths.push(url); assert.equal(init.cache, 'force-cache')
      if (url.includes('manifest.json?')) return Response.json(manifest)
      throw new TypeError('Offline asset miss')
    } })
    await rejected(compiler.compileBrowserProject(createTemplateProject(), `offline-${corrupted}-operation`), 'browser_runtime_unavailable')
    assert.equal(paths.length, 2); assert.equal(worker.messages.length, 0); assert.equal(worker.terminations, 0)
  }
})

test('unavailable/quota cache paths use verified network assets without retaining a fake in-memory engine cache', async () => {
  const store = new MemoryAssetStore(), pdf = await actualPdf(), urls: string[] = []
  store.load = async () => { throw new DOMException('Cache unavailable', 'QuotaExceededError') }
  store.save = async () => false
  const compiler = transport(new WorkerFixture(), { assetStore: store, createWorker: () => { const worker = new WorkerFixture(); successful(worker, pdf); return worker }, request: async (url, init) => { urls.push(url); return fixtureRequest()(url, init) } })
  await compiler.compileBrowserProject(createTemplateProject(), 'no-storage-operation-one')
  await compiler.compileBrowserProject(createTemplateProject(), 'no-storage-operation-two')
  assert.equal(urls.filter((url) => url.includes('manifest.json?')).length, 1)
  assert.equal(urls.length, 11); assert.equal(store.bytes.size, 0)
})

test('untrusted cache implementations cannot mutate execution buffers, original sources, assets or compiler metadata', async () => {
  const store = new MemoryAssetStore(), worker = new WorkerFixture(), pdf = await actualPdf()
  successful(worker, pdf)
  store.save = async (_version, pin, data) => { pin.path = 'private/main.tex'; new Uint8Array(data).fill(0); return false }
  const compiler = transport(worker, { assetStore: store })
  const source = createTemplateProject(), original = '\uFEFFPrivate original\r\nJoiner\u200D stays\n', image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 88])
  source.files[0].content = original
  source.assets = [{ id: 'image', path: 'image.png', mediaType: 'image/png', blob: new Blob([image], { type: 'image/png' }) }]
  const fileCount = source.files.length, expectedHash = await projectSnapshotHash(source), waiting = compiler.compileBrowserProject(source, 'immutable-assets-operation')
  source.files[0].content = 'Later source'; source.files.push({ id: 'unused', path: 'unused.tex', content: 'Later backup' })
  source.assets[0].blob = new Blob([new Uint8Array([1])], { type: 'image/png' }); source.assets.length = 0; source.revision++
  const proof = await waiting, initialized = worker.messages[0] as { assets: { path: string; content: ArrayBuffer }[] }
  assert.equal(proof.snapshotHash, expectedHash)
  for (const asset of initialized.assets) assert.equal(hashBytes(asset.content), manifest.assets.find((pin) => pin.path === asset.path)!.sha256)
  const sent = worker.messages[1] as { files: { path: string; content: string | Uint8Array }[] }
  assert.equal(sent.files[0].content, original); assert.equal(sent.files.length, fileCount + 1)
  assert.deepEqual(sent.files.find((file) => file.path === 'image.png')!.content, image)
  assert.ok(!sent.files.some((file) => file.path === 'unused.tex'))
  const metadata = compiler.getManifest()!
  metadata.engines[0].packages.length = 0; metadata.assets[0].sha256 = 'f'.repeat(64)
  assert.deepEqual(compiler.getManifest(), manifest)
})

test('preparation discovers only reachable literal input/include/local-class/package dependencies and known matching groups', async () => {
  const { bundle, contents } = groupedFixture(), worker = new WorkerFixture(), store = new MemoryAssetStore(), urls: string[] = []
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const source = literalProject(String.raw`\documentclass{local}\input{sections/used}\include{also-used}\usepackage{provided}\input{\dynamic}`, [
    { id: 'class', path: 'wrapper/local.cls', content: String.raw`\LoadClass{article}\RequirePackage[option]{mdframed}` },
    { id: 'used', path: 'wrapper/sections/used.tex', content: String.raw`\\% commented \usepackage{paracol}
\RequirePackage % comment
 [options]
 {tcolorbox,unknown-package}
\input{../also-used}` },
    { id: 'included', path: 'wrapper/also-used.tex', content: String.raw`\input{sections/used}` },
    { id: 'provided', path: 'wrapper/provided.sty', content: 'Local package original' },
    { id: 'backup', path: 'unused-backup.tex', content: String.raw`\usepackage{paracol}\usepackage{biblatex}\write18{disabled}` },
  ])
  const preparation = await compiler.getBrowserPreparation(source)
  assert.deepEqual(preparation.groups.map((group) => group.id), ['boxes'])
  assert.equal(preparation.downloadBytes, bundle.groups.find((group) => group.id === 'boxes')!.assets.reduce((sum, pin) => sum + pin.bytes, 0))
  assert.equal(store.loads.length, 0); assert.equal(store.saves.length, 1); assert.equal(store.saves[0].pin.path, 'manifest.json'); assert.equal(worker.messages.length, 0); assert.equal(urls.length, 1)
  assert.deepEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\documentclass{customclass}`))).groups.map((group) => group.id), ['layouts'])
  assert.deepEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`, [{ id: 'local', path: 'wrapper/tcolorbox.sty', content: 'Local override' }]))).groups, [])
  assert.deepEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{luapackage}`))).groups, [])
  assert.deepEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\input{\unknown}`, [{ id: 'unused', path: 'backup.tex', content: String.raw`\usepackage{tcolorbox}` }]))).groups, [])
  assert.equal(urls.length, 1)
})

test('known required packages preflight a typed exact preparation before any engine download or worker, then compile only after explicit consent', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), urls: string[] = [], workers: WorkerFixture[] = [], pdf = await actualPdf()
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), createWorker: () => { const worker = new WorkerFixture(); successful(worker, pdf); workers.push(worker); return worker }, request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const source = literalProject(String.raw`\usepackage{tcolorbox}`), before = await projectSnapshotHash(source)
  let preparation!: BrowserPreparation
  await assert.rejects(compiler.compileBrowserProject(source, 'package-preflight-operation'), (error: unknown) => {
    assert.ok(error instanceof BrowserPackageGroupRequiredError); assert.equal(error.code, 'package_group_required'); preparation = error.preparation
    assert.equal(error.operationKey, 'package-preflight-operation'); return true
  })
  assert.deepEqual(preparation.groups.map((group) => group.id), ['boxes'])
  assert.equal(urls.length, 1); assert.equal(workers.length, 0); assert.equal(store.loads.length, 0)
  const box = bundle.groups.find((group) => group.id === 'boxes')!, expectedHash = hashBytes(new TextEncoder().encode(JSON.stringify([...box.assets].sort((a, b) => a.path < b.path ? -1 : 1).map((pin) => [pin.path, pin.bytes, pin.sha256]))))
  store.approvals.add(`old-version:boxes:${expectedHash}`); store.approvals.add(`${bundle.profileVersion}:boxes:${'f'.repeat(64)}`)
  assert.equal((await compiler.getBrowserPreparation(source)).groups.length, 1)
  await compiler.approveBrowserPackageGroups(preparation)
  assert.deepEqual(store.consents, [`${bundle.profileVersion}:boxes:${expectedHash}`])
  assert.equal(urls.length, 1); assert.equal(workers.length, 0)
  assert.deepEqual((await compiler.getBrowserPreparation(source)).groups, [])
  const progress: LatexCompileProgress[] = []
  const proof = await compiler.compileBrowserProject(source, 'package-approved-operation', undefined, (value) => progress.push(value))
  assert.equal(proof.snapshotHash, before); assert.equal(await projectSnapshotHash(source), before)
  const initialized = workers[0].messages[0] as { approvedGroups: string[]; assets: { path: string }[] }
  assert.deepEqual(initialized.approvedGroups, ['boxes'])
  assert.ok(initialized.assets.some((asset) => asset.path === box.archive)); assert.ok(initialized.assets.some((asset) => asset.path === box.index))
  const packageAudit = progress.at(-1)!.assetAudit!.filter((entry) => entry.groupId === 'boxes')
  assert.deepEqual(packageAudit.map((entry) => entry.path), [box.archive, box.index])
  assert.ok(packageAudit.every((entry) => entry.groupKind === 'package' && entry.source === 'fetch-response'))
  assert.ok(packageAudit.every((entry) => JSON.stringify(entry.packages) === JSON.stringify(['tcolorbox', 'mdframed'])))
  assert.doesNotMatch(JSON.stringify(urls), /tcolorbox|wrapper\/main|texlive\.snapshot|snapshot-index|groups\/layouts|usepackage/)
  await compiler.clearBrowserEngineCache()
  assert.equal((await compiler.getBrowserPreparation(source)).groups.length, 1)
})

test('approval rejects forged/current-version/group/size/hash metadata and cannot grant core or profile consent', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), worker = new WorkerFixture(), urls: string[] = []
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const preparation = await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`))
  const changed = (change: Partial<BrowserCompilerGroup>) => ({ ...preparation, groups: preparation.groups.map((group) => ({ ...group, ...change })) })
  for (const forged of [
    { ...preparation, profileVersion: 'browser-old-version' }, { ...preparation, downloadBytes: preparation.downloadBytes + 1 }, { ...preparation, groups: [] }, { ...preparation, groups: [...preparation.groups, ...preparation.groups] },
    changed({ id: 'unknown' }), changed({ kind: 'core' }), changed({ packages: ['different-package'] }), changed({ profiles: ['pdflatex'] }),
    changed({ assets: preparation.groups[0].assets.map((pin) => ({ ...pin, sha256: 'f'.repeat(64) })) }), changed({ assets: preparation.groups[0].assets.map((pin) => ({ ...pin, bytes: pin.bytes + 1 })) }),
    { ...preparation, groups: [bundle.groups[0]], downloadBytes: bundle.groups[0].assets.reduce((sum, pin) => sum + pin.bytes, 0) },
  ]) await rejected(compiler.approveBrowserPackageGroups(forged), 'browser_package_consent_invalid')
  assert.equal(store.consents.length, 0); assert.equal(store.loads.length, 0); assert.equal(urls.length, 1); assert.equal(worker.messages.length, 0)
  preparation.groups[0].assets[0].sha256 = 'e'.repeat(64)
  assert.notEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`))).groups[0].assets[0].sha256, 'e'.repeat(64))
})

test('unpersisted package consent is an honest refusal with no fetch or fabricated approval', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), urls: string[] = []
  store.consent = async () => {}
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const preparation = await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`))
  await rejected(compiler.approveBrowserPackageGroups(preparation), 'browser_package_consent_unavailable')
  assert.equal((await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`))).groups.length, 1)
  assert.equal(urls.length, 1); assert.equal(store.loads.length, 0)
})

test('dynamic worker package requests map known IDs to actual pins, never trust wire sizes or retry without new consent', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), worker = new WorkerFixture(), urls: string[] = [], pdf = await actualPdf()
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  worker.handle = (message) => { const input = message as Record<string, unknown>; queueMicrotask(() => input.type === 'init' ? worker.emit({ type: 'ready', version: bundle.profileVersion, engines: bundle.engines.map((profile) => profile.id) }) : worker.emit({ type: 'error', operationKey: input.operationKey, code: 'package_group_required', groupIDs: ['boxes'], downloadBytes: -999, packages: ['private fake name'], log: "! LaTeX Error: File `tcolorbox.sty' not found." })) }
  const source = literalProject(String.raw`\dynamicPackage`), before = await projectSnapshotHash(source)
  let preparation!: BrowserPreparation
  await assert.rejects(compiler.compileBrowserProject(source, 'dynamic-package-operation'), (error: unknown) => { assert.ok(error instanceof BrowserPackageGroupRequiredError); preparation = error.preparation; return true })
  const box = bundle.groups.find((group) => group.id === 'boxes')!
  assert.deepEqual(preparation.groups, [box]); assert.equal(preparation.downloadBytes, box.assets.reduce((sum, pin) => sum + pin.bytes, 0))
  assert.doesNotMatch(JSON.stringify(preparation), /private fake|-999/)
  assert.equal(worker.messages.length, 2); assert.equal(worker.terminations, 1); assert.doesNotMatch(JSON.stringify(urls), /groups\/boxes/)
  await compiler.approveBrowserPackageGroups(preparation)
  successful(worker, pdf)
  const proof = await compiler.compileBrowserProject(source, 'dynamic-approved-operation')
  assert.equal(proof.snapshotHash, before)
  assert.deepEqual((worker.messages[2] as { approvedGroups: string[] }).approvedGroups, ['boxes'])
})

test('worker package requests with unknown/duplicate/non-package/wrong-profile IDs are protocol errors', async () => {
  const { bundle, contents } = groupedFixture()
  for (const groupIDs of [[], ['unknown'], ['boxes', 'boxes'], ['base'], ['pdflatex'], ['lua-only'], [{ id: 'boxes' }]]) {
    const worker = new WorkerFixture()
    worker.handle = (message) => { const input = message as Record<string, unknown>; queueMicrotask(() => input.type === 'init' ? worker.emit({ type: 'ready', version: bundle.profileVersion, engines: bundle.engines.map((profile) => profile.id) }) : worker.emit({ type: 'error', operationKey: input.operationKey, code: 'package_group_required', groupIDs })) }
    await rejected(transport(worker, { assetStore: new MemoryAssetStore(), manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) }).compileBrowserProject(literalProject(String.raw`\dynamic`), 'invalid-package-operation'), 'browser_protocol_error')
    assert.equal(worker.terminations, 1)
  }
})

test('asset stream bounds, byte hashes, redirects, status and script MIME failures stop before worker execution', async () => {
  const pin = manifest.assets[0], bytes = fixtureBytes.get(pin.path)!
  for (const response of [
    () => new Response(new Uint8Array(bytes.length).buffer, { headers: { 'Content-Type': 'application/javascript' } }),
    () => new Response(bytes.slice(0, -1).buffer, { headers: { 'Content-Type': 'application/javascript' } }),
    () => new Response(new Uint8Array(bytes.length + 1).buffer, { headers: { 'Content-Type': 'application/javascript' } }),
    () => new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(new Uint8Array(bytes).buffer, { status: 404, headers: { 'Content-Type': 'application/javascript' } }),
    ...['invalid', '-1', String(bytes.length + 1), '1'].map((length) => () => new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'application/javascript', 'Content-Length': length } })),
    () => { const response = new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'application/javascript' } }); Object.defineProperty(response, 'redirected', { value: true }); return response },
  ]) {
    const worker = new WorkerFixture(), urls: string[] = [], progress: LatexCompileProgress[] = []
    const compiler = transport(worker, { createWorker: () => assert.fail('Invalid assets cannot execute'), request: async (url) => { urls.push(url); return url.includes('manifest.json?') ? Response.json(manifest) : response() } })
    await rejected(compiler.compileBrowserProject(createTemplateProject(), 'asset-security-operation', undefined, (value) => progress.push(value)), 'browser_runtime_unavailable')
    assert.equal(urls.length, 2); assert.equal(worker.messages.length, 0)
    assert.deepEqual(progress.at(-1)?.assetAudit, [], 'Failed assets must not enter the verified audit')
  }
})

test('readiness/protocol failures cannot accept PDFs, duplicate engines or private snapshots before real ready', async () => {
  const pdf = await actualPdf(), ids = manifest.engines.map((profile) => profile.id)
  for (const response of [null, { type: 'unknown' }, { type: 'ready', version: 'browser-old', engines: ids }, { type: 'ready', version: manifest.profileVersion, engines: ['lualatex', 'lualatex', 'pdflatex'] }, { type: 'ready', version: manifest.profileVersion, engines: ['pdflatex'] }, { type: 'result', operationKey: 'protocol-security-operation', engine: 'lualatex', exitCode: 0, pdf, log: '' }, { type: 'error', log: 'x'.repeat(LATEX_LIMITS.logBytes + 1) }]) {
    const worker = new WorkerFixture()
    worker.handle = () => queueMicrotask(() => worker.emit(response))
    await rejected(transport(worker).compileBrowserProject(createTemplateProject(), 'protocol-security-operation'), 'browser_protocol_error')
    assert.equal(worker.messages.length, 1); assert.equal(worker.terminations, 1)
    assert.equal(Object.hasOwn(worker.messages[0] as object, 'files'), false)
  }
  for (const event of ['error', 'messageerror']) {
    const worker = new WorkerFixture()
    worker.handle = () => queueMicrotask(() => event === 'error' ? worker.onerror?.({ preventDefault() {} } as ErrorEvent) : worker.onmessageerror?.({} as MessageEvent<unknown>))
    await rejected(transport(worker).compileBrowserProject(createTemplateProject(), 'worker-event-operation'), event === 'error' ? 'browser_worker_failed' : 'browser_protocol_error')
    assert.equal(worker.messages.length, 1); assert.equal(worker.terminations, 1)
  }
})

test('aborted preparation/approval and missing crypto perform no downloads; busy compilation remains explicitly cancellable', async () => {
  const controller = new AbortController(); controller.abort()
  const worker = new WorkerFixture(), compiler = transport(worker, { request: async () => assert.fail('No fetch after prior cancellation') })
  await rejected(compiler.compileBrowserProject(createTemplateProject(), 'pre-aborted-operation', controller.signal), 'browser_compile_cancelled')
  await assert.rejects(compiler.getBrowserPreparation(createTemplateProject(), controller.signal), { name: 'AbortError' })
  await assert.rejects(compiler.approveBrowserPackageGroups({ profileVersion: manifest.profileVersion, groups: [], downloadBytes: 0 }, controller.signal), { name: 'AbortError' })
  await rejected(transport(worker, { crypto: {} as Crypto, request: async () => assert.fail('No asset fetch without secure hashing') }).compileBrowserProject(createTemplateProject(), 'crypto-missing-operation'), 'browser_runtime_unavailable')
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const stalled = transport(worker)
  worker.handle = () => entered()
  const waiting = stalled.compileBrowserProject(createTemplateProject(), 'busy-first-operation'), failure = rejected(waiting, 'browser_compile_cancelled')
  await started
  await rejected(stalled.compileBrowserProject(createTemplateProject(), 'busy-second-operation'), 'browser_compiler_busy')
  await stalled.cancelBrowserCompile('busy-first-operation'); await failure
})

test('real structured-clone transfers detach only public init buffers, retaining independently cached and canonical PDF bytes', async () => {
  const store = new MemoryAssetStore(), pdf = await actualPdf(), original = pdf.slice(0), detached: ArrayBuffer[] = []
  class TransferWorkerFixture extends WorkerFixture {
    postMessage(message: unknown, transfer: Transferable[] = []) {
      const received = structuredClone(message, { transfer })
      if ((message as { type: string }).type === 'init') detached.push(...transfer as ArrayBuffer[])
      super.postMessage(received)
    }
  }
  const worker = new TransferWorkerFixture(); successful(worker, pdf)
  const proof = await transport(worker, { assetStore: store }).compileBrowserProject(createTemplateProject(), 'zero-copy-init-operation')
  assert.equal(detached.length, 5); assert.ok(detached.every((buffer) => buffer.byteLength === 0))
  const received = worker.messages[0] as { assets: { path: string; content: ArrayBuffer }[] }
  for (const asset of received.assets) assert.equal(hashBytes(asset.content), manifest.assets.find((pin) => pin.path === asset.path)!.sha256)
  assert.equal(store.bytes.size, 6); assert.ok([...store.bytes.values()].every((entry) => entry.data.byteLength > 0))
  assert.deepEqual(proof.data, original); assert.deepEqual(pdf, original)
})

test('cancelling stalled cache reads or asset streams aborts parent preparation before any worker or source transfer', async () => {
  for (const stage of ['cache', 'stream']) {
    let entered!: () => void, aborted = false
    const reached = new Promise<void>((resolve) => { entered = resolve }), store = new MemoryAssetStore(), worker = new WorkerFixture()
    if (stage === 'cache') store.load = async (_version, _pin, signal) => {
      signal!.addEventListener('abort', () => { aborted = true }, { once: true }); entered(); return new Promise(() => {})
    }
    const compiler = transport(worker, { assetStore: store, createWorker: () => assert.fail('Cancelled preparation cannot execute'), request: async (url, init) => {
      if (stage === 'cache' || url.includes('manifest.json?')) return fixtureRequest()(url, init)
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([47])); entered() }, cancel() { aborted = true } }), { headers: { 'Content-Type': 'application/javascript' } })
    } })
    const waiting = compiler.compileBrowserProject(createTemplateProject(), `cancel-${stage}-operation`), failure = rejected(waiting, 'browser_compile_cancelled')
    await reached
    assert.equal((await compiler.cancelBrowserCompile(`cancel-${stage}-operation`)).cancelled, true)
    await failure
    assert.equal(aborted, true); assert.equal(worker.messages.length, 0); assert.equal(worker.terminations, 0)
  }
})

test('concurrent metadata consumers share one verified request and cannot mutate trusted manifest profiles', async () => {
  let release!: (response: Response) => void, calls = 0
  const response = new Promise<Response>((resolve) => { release = resolve })
  const compiler = transport(new WorkerFixture(), { request: async (url, init) => { calls++; assert.equal(url, `${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`); assert.equal(init.cache, 'no-cache'); return response } })
  const first = compiler.getBrowserCapabilities(), second = compiler.getBrowserPreparation(literalProject(String.raw`\documentclass{article}`)), third = compiler.getBrowserCapabilities()
  assert.equal(calls, 1)
  release(Response.json(manifest))
  const [capabilities] = await Promise.all([first, second, third])
  capabilities.profiles[0].packages.length = 0; capabilities.profiles[0].id = 'pdflatex'
  assert.deepEqual(compiler.getManifest(), manifest); assert.equal(calls, 1)
})

test('literal package discovery does not turn inactive included engine branches into compatibility refusals', async () => {
  const source = literalProject(String.raw`\documentclass{article}\usepackage{local-fonts}`, [{ id: 'fonts', path: 'wrapper/local-fonts.sty', content: String.raw`\ifPDFTeX
\RequirePackage{lmodern}
\else
\RequirePackage{fontspec}
\setmainfont{Latin Modern Roman}
\fi` }])
  assert.deepEqual(browserLatexCompatibility(source, manifest.engines), [])
  const worker = new WorkerFixture(); successful(worker, await actualPdf())
  const compiler = transport(worker)
  assert.deepEqual((await compiler.getBrowserPreparation(source)).groups, [])
  await compiler.compileBrowserProject(source, 'conditional-local-package-operation')
  const sent = worker.messages[1] as { files: { path: string; content: string }[] }
  assert.deepEqual(sent.files, source.files.map(({ path, content }) => ({ path, content })))
})

test('a fresh offline transport restores independently pinned metadata, assets and consent without any HTTP request', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), pdf = await actualPdf()
  const source = literalProject(String.raw`\usepackage{tcolorbox}`), before = await projectSnapshotHash(source)
  const createWorker = () => { const worker = new WorkerFixture(); successful(worker, pdf); return worker }
  const first = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), createWorker, request: fixtureRequest(bundle, contents) })
  await first.approveBrowserPackageGroups(await first.getBrowserPreparation(source))
  await first.compileBrowserProject(source, 'prime-offline-reload')
  const worker = createWorker(), progress: LatexCompileProgress[] = []
  const restored = transport(worker, { online: () => false, assetStore: store, manifestPin: manifestPin(bundle), request: async () => assert.fail('An offline cached reload must not request HTTP') })
  assert.equal((await restored.getBrowserCapabilities()).ready, true)
  assert.equal((await restored.getBrowserPreparation(source)).groups.length, 0)
  const proof = await restored.compileBrowserProject(source, 'fresh-offline-reload', undefined, (value) => progress.push(value))
  assert.equal(proof.snapshotHash, before)
  assert.deepEqual((worker.messages[0] as { approvedGroups: string[] }).approvedGroups, ['boxes'])
  assert.equal(progress.at(-1)!.downloadedBytes, 0)
  assert.equal(progress.at(-1)!.cachedBytes, progress.at(-1)!.totalBytes)
  assert.equal(progress.at(-1)!.verifiedBytes, progress.at(-1)!.totalBytes)
})

test('cached metadata is not a trust root and invalid online manifests never silently fall back', async () => {
  const store = new MemoryAssetStore(), pin = manifestPin(), key = `${manifest.profileVersion}:${pin.sha256}`
  const forged = { ...manifest, limitations: ['Tampered metadata with the same profile version.'] }
  store.bytes.set(key, { version: manifest.profileVersion, data: new TextEncoder().encode(JSON.stringify(forged)).buffer })
  const offline = transport(new WorkerFixture(), { online: () => false, assetStore: store, request: async () => { throw new TypeError('Offline') } })
  await assert.rejects(offline.getBrowserCapabilities())
  assert.equal(offline.getManifest(), null)
  store.bytes.set(key, { version: manifest.profileVersion, data: new TextEncoder().encode(JSON.stringify(manifest)).buffer })
  const online = transport(new WorkerFixture(), { assetStore: store, request: async () => Response.json(forged) })
  await assert.rejects(online.getBrowserCapabilities(), /pinned|byte|limit/i)
  assert.equal(online.getManifest(), null)
  const failedNetwork = transport(new WorkerFixture(), { assetStore: store, request: async () => { throw new TypeError('Network unavailable') } })
  assert.equal((await failedNetwork.getBrowserCapabilities()).ready, true)
})

test('cancelling one metadata consumer does not cancel another consumer of the bounded shared request', async () => {
  const controller = new AbortController()
  let release!: (value: Response) => void, signal!: AbortSignal, calls = 0
  const response = new Promise<Response>((resolve) => { release = resolve })
  const compiler = transport(new WorkerFixture(), { request: async (_url, init) => { signal = init.signal as AbortSignal; calls++; return response } })
  const first = compiler.getBrowserCapabilities(controller.signal), second = compiler.getBrowserCapabilities()
  const cancelled = assert.rejects(first, { name: 'AbortError' })
  controller.abort()
  await cancelled
  assert.equal(signal.aborted, false)
  release(Response.json(manifest))
  assert.equal((await second).ready, true)
  assert.equal(calls, 1)
})

test('engine cache clearing is exclusive with compilation, metadata preparation and package approvals', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), worker = new WorkerFixture()
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  const preparation = await compiler.getBrowserPreparation(literalProject(String.raw`\usepackage{tcolorbox}`))
  let finish!: () => void
  const clearing = new Promise<void>((resolve) => { finish = resolve })
  store.clear = async () => clearing
  const first = compiler.clearBrowserEngineCache(), second = compiler.clearBrowserEngineCache()
  assert.equal(first, second)
  await rejected(compiler.compileBrowserProject(literalProject(String.raw`\documentclass{article}`), 'clear-busy-operation'), 'browser_cache_busy')
  await rejected(compiler.approveBrowserPackageGroups(preparation), 'browser_cache_busy')
  finish(); await first
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  worker.handle = () => entered()
  const compile = compiler.compileBrowserProject(literalProject(String.raw`\documentclass{article}`), 'active-clear-operation')
  const cancelled = rejected(compile, 'browser_compile_cancelled')
  await started
  await rejected(compiler.clearBrowserEngineCache(), 'browser_cache_busy')
  await compiler.cancelBrowserCompile('active-clear-operation'); await cancelled
})

test('non-streaming asset responses still receive exact bounded hashing and truthful observed-byte progress', async () => {
  const worker = new WorkerFixture(), progress: LatexCompileProgress[] = []
  successful(worker, await actualPdf())
  const compiler = transport(worker, { request: async (url, init) => {
    const response = await fixtureRequest()(url, init)
    if (url.includes('manifest.json?')) return response
    const data = await response.arrayBuffer()
    return { ok: true, redirected: false, headers: response.headers, body: null, arrayBuffer: async () => data } as Response
  } })
  await compiler.compileBrowserProject(createTemplateProject(), 'nonstreaming-progress-operation', undefined, (value) => progress.push(value))
  const total = manifest.assets.reduce((sum, pin) => sum + pin.bytes, 0)
  assert.equal(progress.at(-1)!.downloadedBytes, total)
  assert.equal(progress.at(-1)!.verifiedBytes, total)
  assert.equal(progress.at(-1)!.cachedBytes, 0)
  assert.equal(progress.at(-1)!.assetAudit!.length, manifest.assets.length)
  assert.ok(progress.at(-1)!.assetAudit!.every((entry) => entry.source === 'fetch-response'))
})

test('decoded HTTP asset bytes are pinned independently of compressed wire Content-Length', async () => {
  const worker = new WorkerFixture(), progress: LatexCompileProgress[] = []
  successful(worker, await actualPdf())
  const compiler = transport(worker, { request: async (url, init) => {
    const response = await fixtureRequest()(url, init)
    if (url.includes('manifest.json?')) return response
    const data = await response.arrayBuffer()
    // This represents the decoded body exposed by Fetch, not a raw HTTP socket.
    return new Response(data, { headers: { 'Content-Type': response.headers.get('content-type')!, 'Content-Encoding': 'gzip', 'Content-Length': String(data.byteLength + 20) } })
  } })
  await compiler.compileBrowserProject(createTemplateProject(), 'decoded-http-asset-operation', undefined, (value) => progress.push(value))
  const total = manifest.assets.reduce((sum, pin) => sum + pin.bytes, 0)
  assert.equal(progress.at(-1)!.downloadedBytes, total)
  assert.equal(progress.at(-1)!.verifiedBytes, total)
  assert.equal(progress.at(-1)!.cachedBytes, 0)
})

test('runtime filename catalogs are optional, exact-case, bounded safe basenames with strictly validated keys', () => {
  const { bundle } = groupedFixture(), box = bundle.groups.find((group) => group.id === 'boxes')!
  const changed = (metadata: Record<string, unknown>) => ({ ...bundle, groups: bundle.groups.map((group) => group.id === box.id ? { ...group, ...metadata } : group) })
  const names = ['tcolorbox.sty', 'Tcolorbox.sty', 'pgfkeys.code.tex', 'Mixed.TEX', 'font-Regular.ttf', 'ieee.bbx', 'ieee.cbx', 'format.def']
  assert.deepEqual(readBrowserCompilerManifest(changed({ files: names, requires: [] })).groups!.find((group) => group.id === box.id)!.files, names)
  assert.equal(Object.hasOwn(readBrowserCompilerManifest(bundle).groups![0], 'files'), false)
  for (const files of [undefined, null, 'a.sty', [null], new Array(1), ['a.sty', 'a.sty'], ...['../a.tex', 'path/a.tex', 'path\\a.tex', '/a.tex', 'https://host/a.sty', 'a.tex?token=x', 'a%20b.sty', '.hidden.tex', 'a\u0000.sty', 'a\n.sty', 'a b.sty', 'caf\u00e9.sty', 'refs.bib', 'photo.png', 'output.bbl', 'script.js', 'a.sty.', `${'a'.repeat(237)}.tex`].map((name) => [name])]) {
    assert.throws(() => readBrowserCompilerManifest(changed({ files })), `Unsafe catalog: ${JSON.stringify(files)}`)
  }
  assert.throws(() => readBrowserCompilerManifest(changed({ files: [], extraCatalog: [] })))
  const maximum = Array.from({ length: 8192 }, (_, index) => `f${index}.tex`)
  assert.equal(readBrowserCompilerManifest(changed({ files: maximum })).groups!.find((group) => group.id === box.id)!.files!.length, 8192)
  assert.throws(() => readBrowserCompilerManifest(changed({ files: [...maximum, 'overflow.tex'] })))
  const total = { ...bundle, groups: bundle.groups.map((group, index) => ({ ...group, files: index < 4 ? maximum : [] })) }
  assert.ok(readBrowserCompilerManifest(total))
  total.groups[4].files = ['overflow.tex']
  assert.throws(() => readBrowserCompilerManifest(total), /inventory exceeds/)
})

test('package dependencies reject unknown IDs, cycles and every incompatible source-engine edge', () => {
  const { bundle } = groupedFixture(), box = bundle.groups.find((group) => group.id === 'boxes')!
  for (const requires of [undefined, null, 'layouts', new Array(1), ['missing'], ['base'], ['pdflatex'], ['boxes'], ['layouts'], ['lua-only'], ['bad/id'], ['boxes', 'boxes']]) {
    assert.throws(() => readBrowserCompilerManifest({ ...bundle, groups: bundle.groups.map((group) => group.id === box.id ? { ...group, requires } : group) }), JSON.stringify(requires))
  }
  const cyclic = { ...bundle, groups: bundle.groups.map((group) => group.id === 'boxes' ? { ...group, profiles: ['pdflatex'] as LatexProject['engine'][], requires: ['layouts'] } : group.id === 'layouts' ? { ...group, requires: ['boxes'] } : group) }
  assert.throws(() => readBrowserCompilerManifest(cyclic), /cyclic/)
  assert.equal(browserPackagePreparation(cyclic, 'pdflatex', ['boxes']), null)
  const valid = { ...bundle, groups: bundle.groups.map((group) => group.id === 'layouts' || group.id === 'pdflatex' ? { ...group, requires: ['boxes'] } : group) }
  assert.ok(readBrowserCompilerManifest(valid))
  assert.deepEqual(browserPackagePreparation(valid, 'pdflatex', ['layouts'])!.groups.map((group) => group.id), ['boxes', 'layouts'])
  assert.equal(browserPackagePreparation(valid, 'lualatex', ['layouts']), null)
  assert.throws(() => readBrowserCompilerManifest({ ...valid, groups: valid.groups.map((group) => group.id === 'extra-core' ? { ...group, requires: ['layouts'] } : group) }), /incompatible/)
})

test('dependency preparation deduplicates shared pins and Biber bytes and deep-copies catalog/edge arrays', async () => {
  const { bundle, contents } = groupedFixture(true), store = new MemoryAssetStore()
  const boxes = bundle.groups.find((group) => group.id === 'boxes')!, layouts = bundle.groups.find((group) => group.id === 'layouts')!, bibliography = bundle.groups.find((group) => group.id === 'bibliography')!
  boxes.files = ['tcolorbox.sty']; boxes.requires = ['bibliography']; layouts.requires = ['boxes', 'bibliography']
  const parsed = readBrowserCompilerManifest(bundle), prepared = browserPackagePreparation(bundle, 'pdflatex', ['layouts', 'boxes'])!
  const bytes = [...boxes.assets, ...layouts.assets, ...bibliography.assets, ...bundle.biber!.assets].reduce((sum, pin) => sum + pin.bytes, 0)
  assert.deepEqual(prepared.groups.map((group) => group.id), ['bibliography', 'boxes', 'layouts'])
  assert.equal(prepared.downloadBytes, bytes)
  const pins = browserEngineAssetPins(bundle, 'pdflatex', ['layouts', 'boxes'])
  assert.equal(new Set(pins.map((pin) => pin.path)).size, pins.length)
  assert.equal(pins.reduce((sum, pin) => sum + pin.bytes, 0) - browserEngineAssetPins(bundle, 'pdflatex').reduce((sum, pin) => sum + pin.bytes, 0), bytes)
  const failure = new BrowserPackageGroupRequiredError(prepared, 'dependency-review-operation')
  prepared.groups.find((group) => group.id === 'boxes')!.files!.length = 0
  prepared.groups.find((group) => group.id === 'boxes')!.requires!.length = 0
  parsed.groups!.find((group) => group.id === 'boxes')!.files!.push('forged.tex')
  assert.deepEqual(boxes.files, ['tcolorbox.sty']); assert.deepEqual(boxes.requires, ['bibliography'])
  assert.deepEqual(failure.preparation.groups.find((group) => group.id === 'boxes')!.files, ['tcolorbox.sty'])
  assert.deepEqual(failure.preparation.groups.find((group) => group.id === 'boxes')!.requires, ['bibliography'])
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  await compiler.getBrowserCapabilities()
  for (const change of [{ files: ['forged.tex'] }, { requires: [] }]) {
    const forged = { ...failure.preparation, groups: failure.preparation.groups.map((group) => group.id === 'boxes' ? { ...group, ...change } : group) }
    await rejected(compiler.approveBrowserPackageGroups(forged), 'browser_package_consent_invalid')
  }
  assert.equal(store.consents.length, 0)
  const copy = compiler.getManifest()!
  copy.groups!.find((group) => group.id === 'boxes')!.files!.length = 0
  assert.deepEqual(compiler.getManifest()!.groups!.find((group) => group.id === 'boxes')!.files, ['tcolorbox.sty'])
})

test('reachable imported classes, shipped TeX libraries and literal bibliography styles use exact qualified inventory', async () => {
  const { bundle, contents } = groupedFixture(true), worker = new WorkerFixture(), urls: string[] = [], store = new MemoryAssetStore()
  bundle.groups.find((group) => group.id === 'boxes')!.files = ['tcolorbox.sty', 'mdframed.sty', 'tcbtheorems.code.tex', 'pgfkeys.code.tex', 'tikzlibraryarrows.meta.code.tex', 'pgflibraryshapes.geometric.code.tex', 'unqualified.sty']
  bundle.groups.find((group) => group.id === 'layouts')!.files = ['customclass.cls', 'paracol.sty']
  bundle.groups.find((group) => group.id === 'bibliography')!.files = ['biblatex.sty', 'ieee.bbx', 'ieee.cbx', 'apa6.bbx', 'ieee.bst', 'custom.dbx']
  bundle.groups.find((group) => group.id === 'base')!.files = ['core.code.tex', 'biblatex.sty']
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const project = literalProject(String.raw`\documentclass{local}\import{parts/}{body}`, [
    { id: 'class', path: 'wrapper/local.cls', content: String.raw`\LoadClass{article}\RequirePackage{provided}\input{pgfkeys.code.tex}` },
    { id: 'provided', path: 'wrapper/provided.sty', content: String.raw`\RequireCitationStyle{ieee}` },
    { id: 'body', path: 'wrapper/parts/body.tex', content: String.raw`\usepackage{paracol}` },
    { id: 'backup', path: 'backup.tex', content: String.raw`\usepackage{luapackage}` },
  ])
  assert.deepEqual((await compiler.getBrowserPreparation(project)).groups.map((group) => group.id), ['bibliography', 'boxes', 'layouts'])
  for (const source of [String.raw`\input{pgfkeys.code.tex}`, String.raw`\usetikzlibrary{arrows.meta}`, String.raw`\usepgflibrary{shapes.geometric}`, String.raw`\tcbuselibrary{theorems}`]) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(source))).groups.map((group) => group.id), ['boxes'], source)
  }
  for (const source of [String.raw`\RequireBibliographyStyle{apa6}`, String.raw`\bibliographystyle{ieee}`, String.raw`\ExecuteBibliographyOptions{style=ieee}`, String.raw`\PassOptionsToPackage{datamodel=custom}{biblatex}`, String.raw`\usepackage[style=ieee]{biblatex}`, String.raw`\RequirePackage[bibstyle=apa6]{biblatex}`]) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(source))).groups.map((group) => group.id), ['bibliography'], source)
  }
  for (const source of [String.raw`\input{private/pgfkeys.code.tex}`, String.raw`\input{Pgfkeys.code.tex}`, String.raw`\input{personal}\bibliography{refs}\includegraphics{photo}\setmainfont{Personal.ttf}`, String.raw`\usetikzlibrary{not-bundled,\macro}`, String.raw`\usepackage{unqualified}`, String.raw`\input{core.code.tex}`, String.raw`% \input{pgfkeys.code.tex}`, String.raw`\usepackage[style=\macro]{biblatex}`]) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(source))).groups, [], source)
  }
  const overrides = literalProject(String.raw`\input{pgfkeys.code.tex}\usetikzlibrary{arrows.meta}\bibliographystyle{ieee}\usepackage{tcolorbox}`, [
    { id: 'tex', path: 'wrapper/pgfkeys.code.tex', content: 'Private override' },
    { id: 'lib', path: 'wrapper/tikzlibraryarrows.meta.code.tex', content: 'Private library' },
    { id: 'bst', path: 'wrapper/ieee.bst', content: 'Private bibliography style' },
    { id: 'sty', path: 'wrapper/tcolorbox.sty', content: 'Private package' },
  ])
  assert.deepEqual((await compiler.getBrowserPreparation(overrides)).groups, [])
  assert.equal(urls.length, 1); assert.equal(worker.messages.length, 0); assert.equal(store.loads.length, 0)
  assert.ok(store.saves.every((entry) => entry.pin.path === 'manifest.json'), 'Proactive preparation reads only metadata and consent')
})

test('historical unrelated approvals never load or transfer their groups or Biber assets', async () => {
  const { bundle, contents } = groupedFixture(true), store = new MemoryAssetStore(), worker = new WorkerFixture(), urls: string[] = []
  bundle.groups.find((group) => group.id === 'extra-core')!.profiles = ['xelatex']
  successful(worker, await actualPdf())
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes', 'layouts', 'bibliography'])!)
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'lualatex', ['lua-only'])!)
  await compiler.compileBrowserProject(literalProject(String.raw`\usepackage{tcolorbox}`), 'isolated-template-packages')
  const expected = browserEngineAssetPins(bundle, 'pdflatex', ['boxes']), initialized = worker.messages[0] as { approvedGroups: string[]; assets: { path: string; content: ArrayBuffer }[] }
  assert.deepEqual(initialized.approvedGroups, ['boxes'])
  assert.deepEqual(initialized.assets.map((asset) => asset.path), expected.map((pin) => pin.path))
  for (const asset of initialized.assets) assert.equal(hashBytes(asset.content), expected.find((pin) => pin.path === asset.path)!.sha256)
  assert.deepEqual(store.loads.map((entry) => entry.pin.path), expected.map((pin) => pin.path))
  assert.doesNotMatch(JSON.stringify(urls), /groups\/(?:layouts|bibliography|lua-only|extra-core)|tools\/biber/)
  assert.ok(urls.some((url) => url.includes('groups/boxes/')), 'Consent alone does not claim package bytes were cached')
})

test('matching core/profile dependencies join preparation and exact installation; incompatible cores stay excluded', async () => {
  const { bundle, contents } = groupedFixture(), worker = new WorkerFixture(), store = new MemoryAssetStore()
  bundle.groups.find((group) => group.id === 'extra-core')!.profiles = ['xelatex']
  bundle.groups.find((group) => group.id === 'extra-core')!.requires = ['boxes']
  bundle.groups.find((group) => group.id === 'pdflatex')!.requires = ['layouts']
  bundle.groups.find((group) => group.id === 'layouts')!.requires = ['boxes']
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  const project = literalProject(String.raw`\documentclass{article}`), prepared = await compiler.getBrowserPreparation(project)
  assert.deepEqual(prepared.groups.map((group) => group.id), ['boxes', 'layouts'])
  assert.equal((await compiler.getBrowserPreparation({ ...project, engine: 'lualatex' })).groups.length, 0)
  await compiler.approveBrowserPackageGroups(prepared)
  successful(worker, await actualPdf())
  await compiler.compileBrowserProject(project, 'core-profile-dependencies')
  const initialized = worker.messages[0] as { approvedGroups: string[]; assets: { path: string }[] }
  assert.deepEqual(initialized.approvedGroups, ['boxes', 'layouts'])
  assert.ok(initialized.assets.every((asset) => !asset.path.includes('extra-core')))
})

test('explicit reviewed group selection is captured before awaiting and never bypasses consent or compatibility', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), worker = new WorkerFixture(), urls: string[] = []
  const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) } })
  const project = literalProject(String.raw`\dynamic`)
  for (const packageGroups of [['missing'], ['base'], ['lua-only'], ['boxes', 'boxes']]) await rejected(compiler.compileBrowserProject(project, 'bad-reviewed-selection', undefined, undefined, { packageGroups }), 'browser_package_consent_invalid')
  await rejected(compiler.compileBrowserProject(project, 'unconsented-explicit-selection', undefined, undefined, { packageGroups: ['boxes'] }), 'package_group_required')
  assert.equal(worker.messages.length, 0); assert.equal(urls.length, 1)
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes', 'layouts'])!)
  successful(worker, await actualPdf())
  const packageGroups = ['boxes'], pending = compiler.compileBrowserProject(project, 'captured-reviewed-selection', undefined, undefined, { packageGroups })
  packageGroups.push('layouts')
  await pending
  assert.deepEqual((worker.messages[0] as { approvedGroups: string[] }).approvedGroups, ['boxes'])
})

test('only advertised known optional font families or exact shipped font filenames select a group', async () => {
  const { bundle, contents } = groupedFixture()
  bundle.groups.find((group) => group.id === 'boxes')!.files = ['Lato-Regular.ttf', 'RobotoSlab-Regular.otf']
  bundle.engines = bundle.engines.map((profile) => ({ ...profile, fonts: [...profile.fonts, 'Lato', 'Roboto Slab'] }))
  const compiler = transport(new WorkerFixture(), { assetStore: new MemoryAssetStore(), manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  for (const source of [String.raw`\setmainfont{Lato}`, String.raw`\setsansfont{Roboto Slab}`, String.raw`\newfontfamily\heading{Lato}`, String.raw`\setmainfont{RobotoSlab-Regular.otf}`]) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(source, [], 'xelatex'))).groups.map((group) => group.id), ['boxes'], source)
  }
  for (const source of [String.raw`\setmainfont{Roboto}`, String.raw`\setmainfont{Roboto Condensed}`, String.raw`\setmainfont{Personal}`, String.raw`\setmainfont{lato}`, String.raw`\setmainfont[Path=personal/]{Lato}`, String.raw`\setmainfont{Lato-Regular.ttf}[Path=personal/]`, String.raw`\setmainfont{private/Lato-Regular.ttf}`, String.raw`\setmainfont{\fontfamily}`]) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(source, [], 'xelatex'))).groups, [], source)
  }
  assert.deepEqual((await compiler.getBrowserPreparation(literalProject(String.raw`\setmainfont{Lato}`))).groups, [])
  bundle.engines = bundle.engines.map((profile) => ({ ...profile, fonts: [] }))
  const unadvertised = transport(new WorkerFixture(), { assetStore: new MemoryAssetStore(), manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  assert.deepEqual((await unadvertised.getBrowserPreparation(literalProject(String.raw`\setmainfont{Lato}`, [], 'xelatex'))).groups, [])
})

test('literal examples and comments cannot recommend package, library, bibliography or font downloads', async () => {
  const { bundle, contents } = groupedFixture(true), store = new MemoryAssetStore()
  bundle.groups.find((group) => group.id === 'boxes')!.files = ['tcolorbox.sty', 'tcbtheorems.code.tex', 'Lato-Regular.ttf']
  bundle.engines = bundle.engines.map((profile) => ({ ...profile, fonts: [...profile.fonts, 'Lato'] }))
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents) })
  const examples = String.raw`\usepackage{tcolorbox}\tcbuselibrary{theorems}\usepackage[style=ieee]{biblatex}\setmainfont{Lato}`
  for (const content of [String.raw`\verb|` + examples + '|', String.raw`\verb*+` + examples + '+', String.raw`\verb|` + examples,
    ...['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'].flatMap((environment) => [`\\begin{${environment}}\n${examples}\n\\end{${environment}}`, `\\begin{${environment}}\n${examples}`]), `% ${examples}`]) {
    const project = literalProject(content, [], 'xelatex'), before = await projectSnapshotHash(project)
    assert.deepEqual((await compiler.getBrowserPreparation(project)).groups, [], content)
    assert.equal(await projectSnapshotHash(project), before)
  }
  for (const content of [String.raw`\verb|%|\usepackage{tcolorbox}`, '% \\begin{verbatim}\n\\usepackage{tcolorbox}', '\\verb|example|\n\\usepackage{tcolorbox}', '\\begin{verbatim}\nexample\n\\end{verbatim}\n\\usepackage{tcolorbox}']) {
    assert.deepEqual((await compiler.getBrowserPreparation(literalProject(content, [], 'xelatex'))).groups.map((group) => group.id), ['boxes'], content)
  }
  assert.equal(store.loads.length, 0); assert.equal(store.consents.length, 0)
})

test('already-authorized dynamic dependency chains retry with exact transferred pins, one snapshot and cumulative real bytes', async () => {
  const { bundle, contents } = groupedFixture(true), store = new MemoryAssetStore(), workers: WorkerFixture[] = [], pdf = await actualPdf(), progress: LatexCompileProgress[] = [], detached: ArrayBuffer[] = []
  bundle.groups.find((group) => group.id === 'boxes')!.requires = ['bibliography']
  bundle.groups.find((group) => group.id === 'layouts')!.requires = ['boxes']
  class TransferringWorker extends WorkerFixture {
    postMessage(message: unknown, transfer: Transferable[] = []) {
      const received = structuredClone(message, { transfer })
      detached.push(...transfer as ArrayBuffer[])
      super.postMessage(received)
    }
  }
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
    const worker = new TransferringWorker(), index = workers.length
    if (index < 2) needsGroups(worker, [index ? 'layouts' : 'boxes'])
    else successful(worker, pdf)
    workers.push(worker); return worker
  } })
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['layouts'])!)
  const consents = [...store.consents], project = literalProject(String.raw`\dynamicPackage`), original = project.files[0].content, before = await projectSnapshotHash(project)
  const pending = compiler.compileBrowserProject(project, 'authorized-dynamic-chain', undefined, (value) => progress.push(value))
  project.files[0].content = 'A later edit must not replace the captured source'; project.revision++
  const proof = await pending
  assert.equal(proof.snapshotHash, before); assert.equal(proof.pdf.sha256, hashBytes(pdf)); assert.equal(workers.length, 3)
  assert.deepEqual(store.consents, consents, 'Automatic retry may not grant new consent')
  const expectedIds = [[], ['boxes', 'bibliography'], ['boxes', 'layouts', 'bibliography']]
  let total = 0
  for (const [index, worker] of workers.entries()) {
    const initialized = worker.messages[0] as { approvedGroups: string[]; assets: { path: string; content: ArrayBuffer }[] }, pins = browserEngineAssetPins(bundle, project.engine, expectedIds[index])
    assert.deepEqual(initialized.approvedGroups, expectedIds[index])
    assert.deepEqual(initialized.assets.map((asset) => asset.path), pins.map((pin) => pin.path))
    for (const asset of initialized.assets) assert.equal(hashBytes(asset.content), pins.find((pin) => pin.path === asset.path)!.sha256)
    const sent = worker.messages[1] as { operationKey: string; files: { content: string }[] }
    assert.equal(sent.operationKey, 'authorized-dynamic-chain'); assert.equal(sent.files[0].content, original); assert.equal(worker.terminations, 1)
    total += pins.reduce((sum, pin) => sum + pin.bytes, 0)
  }
  assert.ok(detached.length > 0 && detached.every((data) => data.byteLength === 0))
  const final = progress.at(-1)!, uniqueBytes = browserEngineAssetPins(bundle, 'pdflatex', expectedIds[2]).reduce((sum, pin) => sum + pin.bytes, 0)
  assert.equal(final.downloadedBytes, uniqueBytes); assert.equal(final.cachedBytes, total - uniqueBytes)
  assert.equal(final.verifiedBytes, total); assert.equal(final.totalBytes, total)
  assert.equal(final.assetAudit!.length, workers.reduce((sum, worker) => sum + (worker.messages[0] as { assets: unknown[] }).assets.length, 0))
  let verified = 0, downloaded = 0
  for (const value of progress.filter((value) => value.totalBytes !== undefined)) {
    assert.ok(value.verifiedBytes! >= verified && value.downloadedBytes! >= downloaded && value.verifiedBytes! <= value.totalBytes!)
    verified = value.verifiedBytes!; downloaded = value.downloadedBytes!
  }
})

test('dynamic new dependency reviews exclude existing consent, include Biber, and retain A while approving B then C', async () => {
  const { bundle, contents } = groupedFixture(true), store = new MemoryAssetStore(), workers: WorkerFixture[] = [], urls: string[] = [], pdf = await actualPdf()
  const boxes = bundle.groups.find((group) => group.id === 'boxes')!, bibliography = bundle.groups.find((group) => group.id === 'bibliography')!, layouts = bundle.groups.find((group) => group.id === 'layouts')!
  boxes.requires = ['bibliography']; layouts.requires = ['boxes']
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) }, createWorker: () => {
    const worker = new WorkerFixture(), index = workers.length
    if (index < 2) needsGroups(worker, [index ? 'layouts' : 'boxes'], `! LaTeX Error: File '${index ? 'paracol' : 'tcolorbox'}.sty' not found.`)
    else successful(worker, pdf)
    workers.push(worker); return worker
  } })
  // Only this group's exact pins were previously authorized, not its new dependency.
  await compiler.approveBrowserPackageGroups({ profileVersion: bundle.profileVersion, groups: [boxes], downloadBytes: boxes.assets.reduce((sum, pin) => sum + pin.bytes, 0) })
  const project = literalProject(String.raw`\dynamicPackage`), before = await projectSnapshotHash(project)
  let first!: BrowserPreparation, second!: BrowserPreparation
  await assert.rejects(compiler.compileBrowserProject(project, 'dynamic-first-review'), (error: unknown) => {
    assert.ok(error instanceof BrowserPackageGroupRequiredError)
    assert.equal(error.operationKey, 'dynamic-first-review'); assert.equal(error.request_id, 'browser-dynamic-first-review')
    assert.match(error.log!, /tcolorbox/); first = error.preparation; return true
  })
  assert.deepEqual(first.groups.map((group) => group.id), ['bibliography'])
  assert.equal(first.downloadBytes, [...bibliography.assets, ...bundle.biber!.assets].reduce((sum, pin) => sum + pin.bytes, 0))
  assert.equal(workers.length, 1); assert.doesNotMatch(JSON.stringify(urls), /groups\/(?:boxes|bibliography)|tools\/biber/)
  await compiler.approveBrowserPackageGroups(first)
  await assert.rejects(compiler.compileBrowserProject(project, 'dynamic-second-review', undefined, undefined, { packageGroups: first.groups.map((group) => group.id) }), (error: unknown) => {
    assert.ok(error instanceof BrowserPackageGroupRequiredError); second = error.preparation
    assert.equal(error.operationKey, 'dynamic-second-review'); assert.match(error.log!, /paracol/); return true
  })
  assert.deepEqual((workers[1].messages[0] as { approvedGroups: string[] }).approvedGroups, ['boxes', 'bibliography'])
  assert.deepEqual(second.groups.map((group) => group.id), ['layouts'])
  assert.equal(second.downloadBytes, layouts.assets.reduce((sum, pin) => sum + pin.bytes, 0))
  await compiler.approveBrowserPackageGroups(second)
  const proof = await compiler.compileBrowserProject(project, 'dynamic-final-reviewed-retry', undefined, undefined, { packageGroups: second.groups.map((group) => group.id) })
  assert.equal(proof.snapshotHash, before)
  assert.deepEqual((workers[2].messages[0] as { approvedGroups: string[] }).approvedGroups, ['boxes', 'layouts', 'bibliography'])
  assert.equal(store.consents.length, 3); assert.ok(workers.every((worker) => worker.terminations === 1))
})

test('dynamic selections stay with their exact project/source, not same-revision forks, other mains or engines', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), workers: WorkerFixture[] = [], pdf = await actualPdf()
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
    const worker = new WorkerFixture()
    if (!workers.length) needsGroups(worker, ['boxes'])
    else successful(worker, pdf)
    workers.push(worker); return worker
  } })
  const project = literalProject(String.raw`\dynamicPackage`)
  await rejected(compiler.compileBrowserProject(project, 'source-owned-dynamic-selection'), 'package_group_required')
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
  const changed = { ...project, files: project.files.map((file) => ({ ...file, content: 'A same-revision source fork' })) }
  const alternatives: LatexProject[] = [{ ...project, id: 'another-project' }, changed, reviseProject(project, {}), { ...project, engine: 'lualatex' },
    { ...project, mainFile: 'other.tex', files: [...project.files, { id: 'other', path: 'other.tex', content: 'Another main' }] }]
  for (const [index, source] of alternatives.entries()) {
    await compiler.compileBrowserProject(source, `different-source-selection-${index}`)
    assert.deepEqual((workers.at(-1)!.messages[0] as { approvedGroups: string[] }).approvedGroups, [])
  }
  await compiler.compileBrowserProject(project, 'matching-dynamic-selection')
  assert.deepEqual((workers.at(-1)!.messages[0] as { approvedGroups: string[] }).approvedGroups, ['boxes'])
})

test('dynamic source-selection memo is bounded and remains metadata-only, not asset or consent state', async () => {
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), projects: LatexProject[] = [], urls: string[] = []
  const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: async (url, init) => { urls.push(url); return fixtureRequest(bundle, contents)(url, init) }, createWorker: () => {
    const worker = new WorkerFixture(); needsGroups(worker, ['boxes']); return worker
  } })
  for (let index = 0; index < 9; index++) {
    const project = literalProject(String.raw`\dynamicPackage`); projects.push(project)
    await rejected(compiler.compileBrowserProject(project, `bounded-source-selection-${index}`), 'package_group_required')
  }
  const calls = urls.length
  assert.deepEqual((await compiler.getBrowserPreparation(projects[0])).groups, [])
  assert.deepEqual((await compiler.getBrowserPreparation(projects.at(-1)!)).groups.map((group) => group.id), ['boxes'])
  assert.equal(urls.length, calls); assert.equal(store.consents.length, 0)
  assert.doesNotMatch(JSON.stringify(urls), /groups\/boxes/)
})

test('already-installed dynamic group requests are inconsistent terminal refusals, never another download loop', async () => {
  const { bundle, contents } = groupedFixture()
  for (const explicit of [false, true]) {
    const store = new MemoryAssetStore(), workers: WorkerFixture[] = []
    const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
      const worker = new WorkerFixture(); needsGroups(worker, ['boxes']); workers.push(worker); return worker
    } })
    await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
    await rejected(compiler.compileBrowserProject(literalProject(String.raw`\dynamic`), 'inconsistent-installed-group', undefined, undefined, { packageGroups: explicit ? ['boxes'] : [] }), 'browser_protocol_error')
    assert.equal(workers.length, explicit ? 1 : 2); assert.ok(workers.every((worker) => worker.terminations === 1))
    assert.equal(store.consents.length, 1)
  }
})

test('cancellation bounds authorized dynamic consent checks, asset loading and replacement worker initialization', async () => {
  const { bundle, contents } = groupedFixture()
  for (const stage of ['consent', 'asset', 'initializing']) {
    const store = new MemoryAssetStore(), workers: WorkerFixture[] = []
    let entered!: () => void
    const reached = new Promise<void>((resolve) => { entered = resolve })
    const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
      const worker = new WorkerFixture()
      if (!workers.length) needsGroups(worker, ['boxes'])
      else worker.handle = () => entered()
      workers.push(worker); return worker
    } })
    await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
    const hasConsent = store.hasConsent.bind(store), load = store.load.bind(store)
    if (stage === 'consent') store.hasConsent = async (version, id, hash) => {
      if (id === 'boxes') { entered(); return new Promise(() => {}) }
      return hasConsent(version, id, hash)
    }
    if (stage === 'asset') store.load = async (version, pin, signal) => {
      if (pin.path.startsWith('groups/boxes/')) { entered(); return new Promise(() => {}) }
      return load(version, pin, signal)
    }
    const pending = compiler.compileBrowserProject(literalProject(String.raw`\dynamic`), `cancel-dynamic-${stage}`), failure = rejected(pending, 'browser_compile_cancelled')
    await reached
    assert.equal((await compiler.cancelBrowserCompile(`cancel-dynamic-${stage}`)).cancelled, true)
    await failure
    assert.equal(workers.length, stage === 'initializing' ? 2 : 1)
    assert.ok(workers.every((worker) => worker.terminations === 1))
    assert.equal(workers.flatMap((worker) => worker.messages).filter((message) => (message as { type: string }).type === 'compile').length, 1)
  }
})

test('reviewed retries still reject source edits or runtime switches made during the approved package download', async () => {
  const { bundle, contents } = groupedFixture()
  for (const change of ['source', 'runtime']) {
    const store = new MemoryAssetStore(), worker = new WorkerFixture(), project = literalProject(String.raw`\dynamic`), original = project.files[0].content
    let runtime = 'browser'
    const compiler = transport(worker, { assetStore: store, manifestPin: manifestPin(bundle), createWorker: () => assert.fail('Stale reviewed source must not start a worker'), request: async (url, init) => {
      if (url.includes('groups/boxes/')) { if (change === 'source') project.files[0].content = 'Changed source'; else runtime = 'native' }
      return fixtureRequest(bundle, contents)(url, init)
    } })
    await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
    await rejected(compiler.compileBrowserProject(project, `stale-reviewed-${change}`, undefined, undefined, { packageGroups: ['boxes'], mayStartAfterPreparation: () => project.files[0].content === original && runtime === 'browser' }), 'browser_compile_cancelled')
    assert.equal(worker.messages.length, 0)
  }
})

test('every automatic replacement worker repeats package-assisted source eligibility before transfer', async () => {
  const { bundle, contents } = groupedFixture()
  for (const denyAt of [3, 4, 5]) {
    const store = new MemoryAssetStore(), workers: WorkerFixture[] = []
    let checks = 0
    const compiler = transport(new WorkerFixture(), { assetStore: store, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
      const worker = new WorkerFixture(); needsGroups(worker, ['boxes']); workers.push(worker); return worker
    } })
    await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
    await rejected(compiler.compileBrowserProject(literalProject(String.raw`\dynamic`), 'stale-automatic-retry', undefined, undefined, { mayStartAfterPreparation: () => ++checks < denyAt }), 'browser_compile_cancelled')
    assert.equal(workers.length, denyAt === 5 ? 2 : 1)
    assert.equal(workers.flatMap((worker) => worker.messages).filter((message) => (message as { type: string }).type === 'compile').length, 1)
    assert.ok(workers.every((worker) => worker.terminations === 1))
  }
})

test('authorized dynamic reloads and replacement compiles share the original compile deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { bundle, contents } = groupedFixture(), store = new MemoryAssetStore(), workers: WorkerFixture[] = []
  let first!: () => void, second!: () => void
  const firstStarted = new Promise<void>((resolve) => { first = resolve }), secondStarted = new Promise<void>((resolve) => { second = resolve })
  const compiler = transport(new WorkerFixture(), { assetStore: store, compileTimeoutMs: 100, manifestPin: manifestPin(bundle), request: fixtureRequest(bundle, contents), createWorker: () => {
    const worker = new WorkerFixture(), index = workers.length
    worker.handle = (message) => {
      const input = message as { type: string }
      if (input.type === 'init') queueMicrotask(() => worker.emit({ type: 'ready', engines: bundle.engines.map((profile) => profile.id), version: bundle.profileVersion }))
      else (index ? second : first)()
    }
    workers.push(worker); return worker
  } })
  await compiler.approveBrowserPackageGroups(browserPackagePreparation(bundle, 'pdflatex', ['boxes'])!)
  const pending = compiler.compileBrowserProject(literalProject(String.raw`\dynamic`), 'shared-dynamic-deadline'), failure = rejected(pending, 'browser_compiling_timeout')
  await firstStarted
  context.mock.timers.tick(70)
  workers[0].emit({ type: 'error', operationKey: 'shared-dynamic-deadline', code: 'package_group_required', groupIDs: ['boxes'], log: "! LaTeX Error: File 'tcolorbox.sty' not found." })
  await secondStarted
  context.mock.timers.tick(30)
  assert.equal(workers[1].terminations, 1, 'Starting the replacement worker must not reset the original deadline')
  await failure
  assert.equal(workers.length, 2); assert.equal(workers[0].terminations, 1)
})
