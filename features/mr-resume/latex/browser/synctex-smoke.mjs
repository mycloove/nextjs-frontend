import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { browserEngineAssetPins, BROWSER_LATEX_PROFILE_VERSION } from '../browserCompiler.ts'
import { createBrowserSyncSession } from '../browserSynctex.ts'
import { proofActionIdentity } from '../workspaceIdentity.ts'
import { readProjectZip } from '../projectArchive.ts'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../../../public/mr-resume/latex/busytex-v2')
const fixturesDirectory = path.resolve(directory, '../fixtures/synctex')
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const file = (path, content) => ({ path, content })
const selected = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7)
const record = process.argv.includes('--record')
assert.equal(manifest.profileVersion, BROWSER_LATEX_PROFILE_VERSION)
const parserBytes = await readFile(path.join(root, manifest.synctex.path))
assert.equal(hash(parserBytes), manifest.synctex.sha256)

function queryWorker() {
  const native = new Worker(new URL('./synctex-query-worker.mjs', import.meta.url), { execArgv: [] })
  const adapter = { onmessage: null, onerror: null, onmessageerror: null, postMessage: (value, transfer = []) => native.postMessage(value, transfer), terminate: () => { void native.terminate() } }
  native.on('message', (data) => adapter.onmessage?.({ data }))
  native.on('error', (error) => adapter.onerror?.({ message: error.message, preventDefault() {} }))
  native.on('messageerror', () => adapter.onmessageerror?.({}))
  return adapter
}

async function compile(engine, files, mainFile, approvedGroups) {
  const pins = browserEngineAssetPins(manifest, engine, approvedGroups)
  const assets = await Promise.all(pins.map(async (pin) => {
    const bytes = await readFile(path.join(root, pin.path))
    assert.equal(bytes.length, pin.bytes); assert.equal(hash(bytes), pin.sha256)
    return { path: pin.path, content: buffer(bytes) }
  }))
  const worker = new Worker(new URL('./smoke-worker.mjs', import.meta.url), { workerData: { staticDirectory: root, engine }, execArgv: ['--experimental-vm-modules'] })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Real engine fixture exceeded 180 seconds')) }, 180000)
      const finish = (error, value) => { clearTimeout(timer); if (error) reject(error); else resolve(value) }
      worker.on('error', (error) => finish(error))
      worker.on('message', (event) => {
        if (event.kind === 'harness-error') return finish(new Error(event.message))
        if (event.kind === 'boot') worker.postMessage({ type: 'init', engine, mainFile, manifest, assets, approvedGroups }, assets.map((asset) => asset.content))
        if (event.kind !== 'message') return
        assert.deepEqual(event.requests, [], 'The parent supplies pinned assets; no compiler/source request is permitted')
        assert.deepEqual(event.consoleLines, [], 'No source/log data may reach console')
        const result = event.value
        if (result.type === 'ready') worker.postMessage({ type: 'compile', operationKey: 'synctex-fixture-operation', mainFile, engine, files })
        if (result.type === 'error') finish(new Error(`${result.code}: ${result.message}\n${result.log || ''}`))
        if (result.type === 'result') finish(null, result)
      })
    })
  } finally { await worker.terminate() }
}

async function qualify(name, engine, files, expectations, mainFile = 'main.tex', approvedGroups = []) {
  if (selected && selected !== name && !name.startsWith(selected + '-')) return
  const started = performance.now(), output = await compile(engine, files, mainFile, approvedGroups)
  assert.equal(output.exitCode, 0)
  assert.ok(output.synctex instanceof ArrayBuffer && output.synctex.byteLength > 0)
  assert.equal(output.synctexPdfSha256, hash(new Uint8Array(output.pdf)))
  assert.match(output.log, /SyncTeX written on output\.synctex\.gz/)
  const document = await pdfjs.getDocument({ data: new Uint8Array(output.pdf.slice(0)), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise
  const items = [], geometries = []
  try {
    for (let page = 1; page <= document.numPages; page++) {
      const pdfPage = await document.getPage(page)
      geometries.push({ page, view: pdfPage.view, rotate: pdfPage.rotate })
      for (const item of (await pdfPage.getTextContent()).items) if ('str' in item && item.str.trim()) items.push({ page, ...item })
    }
    const sourceFiles = files.filter((file) => typeof file.content === 'string')
    const proof = { status: 'ready', runtime: 'browser', operationKey: 'synctex-fixture-operation', projectId: 'synctex-fixture-project', revision: 1,
      snapshotHash: hash(JSON.stringify({ engine, mainFile, files: sourceFiles })), engine, profileVersion: manifest.profileVersion,
      pdf: { id: 'synctex-fixture-operation', sha256: output.synctexPdfSha256, bytes: output.pdf.byteLength, pages: document.numPages }, diagnostics: [], log: output.log, syncAvailable: false, createdAt: '2026-11-05T00:00:00.000Z', data: output.pdf }
    const artifact = { identity: proofActionIdentity(proof), engine, data: output.synctex, parser: buffer(parserBytes), parserSha256: manifest.synctex.sha256,
      sourceFiles: sourceFiles.map((file) => ({ path: file.path, lines: file.content.split(/\r\n|\r|\n/).length })) }
    const session = createBrowserSyncSession({ createWorker: queryWorker, timeoutMs: 3000 })
    const captured = [], timings = []
    let refusal
    const base = { operationKey: proof.operationKey, snapshotHash: proof.snapshotHash, pdfHash: proof.pdf.sha256 }
    try {
      try { assert.equal((await session.query(proof, artifact, null)).available, true) }
      catch (error) {
        if (engine !== 'lualatex' || !/zero-Y glyph boundaries/.test(error.message)) throw error
        refusal = error.message
      }
      for (const expected of expectations) {
        const item = items.find((item) => item.str.toLowerCase().includes(expected.text.toLowerCase()))
        assert.ok(item, `Missing real PDF text: ${expected.text}`)
        const source = sourceFiles.find((file) => file.path === expected.file)
        const line = expected.line ?? source.content.split(/\r\n|\r|\n/).findIndex((line) => line.includes(expected.source ?? expected.text)) + 1
        assert.ok(line > 0, `Missing fixture source line: ${expected.text}`)
        const query = { ...base, direction: 'inverse', page: item.page, x: item.transform[4] + Math.min(2, item.width / 2), y: item.transform[5] + item.height / 3 }
        if (refusal) { captured.push({ text: expected.text, query: { page: query.page, x: query.x, y: query.y }, file: expected.file, line, refused: true }); continue }
        const at = performance.now(), inverse = await session.query(proof, artifact, query)
        timings.push(performance.now() - at)
        const refused = expected.refused || (expected.allowRefusal && !inverse.available)
        if (refused) assert.equal(inverse.available, false, `${name} must refuse the upstream Lua boundary ambiguity rather than jump to another line`)
        else assert.ok(inverse.available && inverse.candidates.some((candidate) => candidate.file === expected.file && candidate.line === line), `${name} ${expected.text}: expected ${expected.file}:${line}; ${JSON.stringify(inverse)}`)
        const forward = await session.query(proof, artifact, { ...base, direction: 'forward', file: expected.file, line })
        assert.ok(forward.available && forward.candidates.some((candidate) => candidate.locations.some((location) => location.page === item.page)), `${name} forward ${expected.file}:${line}: ${JSON.stringify(forward)}`)
        captured.push({ text: expected.text, query: { page: query.page, x: query.x, y: query.y }, file: expected.file, line, ...(refused ? { refused: true } : {}) })
      }
      if (!refusal) {
        const blank = await session.query(proof, artifact, { ...base, direction: 'inverse', page: 1, x: 1, y: 1 })
        assert.equal(blank.available, false); assert.deepEqual(blank.candidates, [])
      }
    } finally { session.dispose() }
    const evidence = { name, engine, profileVersion: manifest.profileVersion, worker: manifest.assets.find((pin) => pin.path === 'compiler-worker.js'), wasm: manifest.assets.find((pin) => pin.path === 'busytex.wasm'), parser: manifest.synctex,
      sources: sourceFiles, pdfSha256: output.synctexPdfSha256, synctexSha256: hash(new Uint8Array(output.synctex)), pdfBase64: Buffer.from(output.pdf).toString('base64'), synctexBase64: Buffer.from(output.synctex).toString('base64'), geometries, expected: captured, ...(refusal ? { refusal } : {}) }
    if (record) { await mkdir(fixturesDirectory, { recursive: true }); await writeFile(path.join(fixturesDirectory, name + '.json'), JSON.stringify(evidence, null, 2) + '\n') }
    console.log(JSON.stringify({ name, engine, elapsedMs: Math.round(performance.now() - started), pdfBytes: output.pdf.byteLength, sidecarBytes: output.synctex.byteLength, pages: document.numPages, verifiedLocations: captured, refusal, warmInverseMs: timings.map((value) => Math.round(value * 100) / 100), recorded: record }))
  } finally { await document.destroy() }
}

console.log('REAL SYNCTEX NODE/WASM FIXTURE: exact pinned engines + production query worker; no browser, HTTP server, native engine, or E2E.')
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) {
  await qualify(`multi-file-${engine}`, engine, [file('main.tex', String.raw`\documentclass{article}
\usepackage[paperwidth=400pt,paperheight=500pt,margin=50pt]{geometry}
\pagestyle{empty}
\begin{document}
\noindent FIRSTMARKER one.\par
\input{sections/body.tex}
\noindent THIRDMARKER three.\par
\end{document}
`), file('sections/body.tex', '\\noindent SECONDMARKER two.\\par\n')], [
    { text: 'FIRSTMARKER', file: 'main.tex', line: 5 }, { text: 'SECONDMARKER', file: 'sections/body.tex', line: 1 }, { text: 'THIRDMARKER', file: 'main.tex', line: 7 },
  ])
  await qualify(`columns-macro-${engine}`, engine, [file('main.tex', String.raw`\documentclass{article}
\usepackage[margin=30pt,paperwidth=400pt,paperheight=500pt]{geometry}
\usepackage{hyperref}
\newcommand{\resumeitem}[1]{\noindent\textbf{#1}\par}
\pagestyle{empty}
\begin{document}
\noindent\begin{minipage}[t]{.45\linewidth}
\input{sections/left.tex}
\end{minipage}\hfill\begin{minipage}[t]{.45\linewidth}
\input{sections/right.tex}
\end{minipage}
\end{document}
`), file('sections/left.tex', String.raw`\resumeitem{LEFTMARKER}
\href{https://example.org}{LEFTLINK}\par
`), file('sections/right.tex', String.raw`\resumeitem{RIGHTMARKER}
\noindent SECONDROW\par
`)], [{ text: 'LEFTMARKER', file: 'sections/left.tex', line: 1 }, { text: 'LEFTLINK', file: 'sections/left.tex', line: 2 }, { text: 'RIGHTMARKER', file: 'sections/right.tex', line: 1, refused: engine === 'lualatex' }, { text: 'SECONDROW', file: 'sections/right.tex', line: 2 }])
}
if (process.argv.includes('--altacv') || selected?.startsWith('altacv')) {
  const zip = await readFile(new URL('../../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url))
  assert.equal(hash(zip), 'a4cfbd5be6521ee6a6854bc4dd702e70951bb2529f18ead4d24406454f02a1c3')
  const project = await readProjectZip(buffer(zip), 'Pinned public AltaCV fixture')
  const files = [...project.files.map(({ path, content }) => file(path, content)), ...await Promise.all(project.assets.map(async (asset) => file(asset.path, new Uint8Array(await asset.blob.arrayBuffer()))))]
  for (const engine of ['pdflatex', 'xelatex', 'lualatex']) await qualify(`altacv-${engine}`, engine, files,
    ['Job Title 1', 'Job Title 2', 'Project 1', 'Statistical Analysis', 'German'].map((text) => ({ text, file: 'sample.tex', allowRefusal: engine === 'lualatex' })), 'sample.tex', ['cv-layout', 'cv-fonts', 'bibliography'])
}
