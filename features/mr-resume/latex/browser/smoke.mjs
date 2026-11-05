import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { gunzipSync } from 'node:zlib'
import { PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import JSZip from 'jszip'
import { downloads, sha256, tarEntries } from './provision.mjs'
import { profileVersion, staticDirectory } from './provision-resume.mjs'

// Run with Node >=22.12 and --experimental-strip-types. No browser, HTTP server,
// native TeX executable, fake runner, screenshot, or remote package service.
const { latexSourceTemplates, createTemplateProject } = await import('../templates.ts')
const { browserLatexDiagnostics } = await import('../browserCompiler.ts')
const { readProjectZip, createProjectZip } = await import('../projectArchive.ts')
const { reviseProject } = await import('../project.ts')
const { createAltaCvBrowserProject, repairAltaCvBrowserProject } = await import('../altacvBrowser.ts')
const { verifyBrowserLatexPdf } = await import('../browserPdfVerification.ts')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const manifest = JSON.parse(await readFile(path.join(staticDirectory, 'manifest.json'), 'utf8'))
const provenance = JSON.parse(await readFile(path.join(staticDirectory, 'provenance.json'), 'utf8'))
const results = []
const selectedCases = new Set()
const only = process.argv.find((argument) => argument.startsWith('--case='))?.slice(7)
const outputDirectory = process.argv.find((argument) => argument.startsWith('--output-dir='))?.slice(13)
if (outputDirectory && !path.isAbsolute(outputDirectory)) throw new Error('Compiler proof output needs an absolute local directory')
let plainStyle = ''

function selectedAssets(engine, approvedGroups = [], bundle = manifest) {
  if (!bundle.groups) return [...bundle.assets, ...(bundle.synctex ? [bundle.synctex] : [])]
  const groups = bundle.groups.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(engine)) || (group.kind === 'package' && approvedGroups.includes(group.id)))
  for (const id of approvedGroups) assert.ok(groups.some((group) => group.id === id && group.kind === 'package' && group.profiles.includes(engine)), 'Only selected-engine package groups may be approved')
  return [...bundle.assets.filter((asset) => ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm'].includes(asset.path)), ...groups.flatMap((group) => group.assets), ...(bundle.biber && groups.some((group) => group.id === bundle.biber.group) ? bundle.biber.assets : []), ...(bundle.synctex ? [bundle.synctex] : [])]
}

function packageClosure(engine, ids, bundle) {
  const selected = new Set()
  const include = (id) => {
    if (selected.has(id)) return
    const group = bundle.groups?.find((group) => group.id === id && group.kind === 'package' && group.profiles.includes(engine))
    assert.ok(group, 'Fixture may select only real compatible package groups')
    selected.add(id); for (const dependency of group.requires || []) include(dependency)
  }
  ids.forEach(include)
  return [...selected].sort()
}

async function assetBuffers(pins) {
  return Promise.all(pins.map(async (pin, index) => {
    const content = await readFile(path.join(staticDirectory, pin.path))
    assert.equal(content.length, pin.bytes, `${pin.path}: supplied size`)
    assert.equal(sha256(content), pin.sha256, `${pin.path}: supplied SHA-256`)
    const bytes = new Uint8Array(content)
    return { path: pin.path, content: index % 2 ? bytes : bytes.buffer }
  }))
}

async function checkAssets() {
  assert.equal(manifest.version, 1)
  assert.equal(manifest.profileVersion, profileVersion)
  assert.deepEqual(manifest.engines.map((item) => item.id), ['pdflatex', 'xelatex', 'lualatex'])
  const allPins = new Map()
  for (const asset of [...manifest.assets, ...(manifest.groups || []).flatMap((group) => group.assets), ...(manifest.biber?.assets || []), ...provenance.distributionAssets]) {
    if (allPins.has(asset.path)) assert.deepEqual(allPins.get(asset.path), asset, 'Repeated distribution pins must agree')
    allPins.set(asset.path, asset)
  }
  for (const asset of allPins.values()) {
    const content = await readFile(path.join(staticDirectory, asset.path))
    assert.equal(content.length, asset.bytes, `${asset.path}: size`)
    assert.equal(sha256(content), asset.sha256, `${asset.path}: SHA-256`)
  }
  for (const name of ['busytex.js.bin', 'busytex.wasm']) {
    const pin = downloads.find((item) => item.name === (name === 'busytex.js.bin' ? 'busytex.js' : name))
    const content = await readFile(path.join(staticDirectory, name))
    assert.equal(content.length, pin.bytes); assert.equal(sha256(content), pin.sha256)
  }
  const snapshot = gunzipSync(await readFile(path.join(staticDirectory, 'texlive.snapshot.tar.gz')))
  const index = JSON.parse(await readFile(path.join(staticDirectory, 'snapshot-index.json'), 'utf8'))
  const entries = tarEntries(snapshot)
  assert.equal(snapshot.length, index.unpackedBytes)
  assert.equal(entries.length, index.files.length)
  const style = entries.find((entry) => entry.path.endsWith('/bibtex/bst/base/plain.bst'))
  assert.ok(style, 'The pinned snapshot must provide the known bibliography style used as local ZIP source')
  plainStyle = style.content.toString('utf8')
  for (const entry of entries) {
    const pin = index.files.find((item) => item.path === entry.path)
    assert.ok(pin, `Unrecorded snapshot file: ${entry.path}`)
    assert.equal(entry.content.length, pin.bytes); assert.equal(sha256(entry.content), pin.sha256)
    assert.ok(!entry.path.includes('/bin/') && !/\.exe$/.test(entry.path), 'Native executable in runtime snapshot')
  }
  for (const extension of ['pdftex/pdflatex', 'xetex/xelatex', 'luahbtex/luahblatex']) assert.ok(entries.some((item) => item.path.endsWith(`/web2c/${extension}.fmt`)))
  for (const name of ['fontspec', 'polyglossia', 'enumitem', 'titlesec', 'geometry', 'hyperref']) assert.ok(entries.some((item) => item.path.endsWith(`/${name}.sty`)), `Missing actual package: ${name}`)
  assert.ok(entries.some((item) => item.path.endsWith('/fonts/truetype/mr-resume/NotoSansBengali.ttf')))
  const groupExpandedBytes = new Map()
  const groupPaths = new Map()
  for (const group of manifest.groups || []) {
    assert.deepEqual(Object.keys(group).sort(), ['id', 'kind', 'profiles', 'packages', 'archive', 'index', 'assets', 'files', 'requires'].sort())
    const archive = gunzipSync(await readFile(path.join(staticDirectory, group.archive)))
    const groupIndex = JSON.parse(await readFile(path.join(staticDirectory, group.index), 'utf8'))
    const members = tarEntries(archive)
    assert.equal(groupIndex.version, 1); assert.equal(archive.length, groupIndex.unpackedBytes); assert.equal(members.length, groupIndex.files.length)
    if (Object.hasOwn(groupIndex, 'root')) assert.equal(groupIndex.root, 'texlive')
    groupExpandedBytes.set(group.id, archive.length)
    for (const member of members) {
      const pin = groupIndex.files.find((item) => item.path === member.path)
      assert.ok(pin, 'Group archives may only contain indexed original TeX paths')
      assert.ok(member.path.startsWith('texlive/') && /^[A-Za-z0-9_./-]+$/.test(member.path) && !member.path.split('/').some((part) => !part || part === '.' || part === '..' || part.endsWith('.')))
      assert.equal(member.content.length, pin.bytes); assert.equal(sha256(member.content), pin.sha256)
      const parts = member.path.split('/')
      for (let at = 1; at <= parts.length; at++) {
        const name = parts.slice(0, at).join('/'), key = name.toLowerCase(), kind = at === parts.length ? 'file' : 'directory'
        const previous = groupPaths.get(key)
        assert.ok(!previous || (previous.name === name && previous.kind === kind && kind === 'directory'), 'Groups must not overlap or alias installed files/directories')
        groupPaths.set(key, { name, kind })
      }
    }
    if (group.kind === 'package') assert.ok(group.assets.find((asset) => asset.path === group.archive).bytes <= 12 * 1024 * 1024)
  }
  for (const engine of manifest.engines) assert.ok((manifest.groups || []).filter((group) => group.profiles.includes(engine.id)).reduce((sum, group) => sum + groupExpandedBytes.get(group.id), 0) <= 96 * 1024 * 1024)
  const runtimePins = new Map([...manifest.assets, ...(manifest.groups || []).flatMap((group) => group.assets), ...(manifest.biber?.assets || []), ...(manifest.synctex ? [manifest.synctex] : [])].map((asset) => [asset.path, asset]))
  assert.ok(runtimePins.size <= 64 && [...runtimePins.values()].reduce((sum, asset) => sum + asset.bytes, 0) <= 256 * 1024 * 1024)
  const offer = JSON.parse(await readFile(path.join(staticDirectory, 'source-offer.json'), 'utf8'))
  assert.equal(offer.binary.sha256, downloads.find((item) => item.name === 'busytex.wasm').sha256)
  for (const archive of offer.archives) {
    const parts = await Promise.all(archive.parts.map(async (pin) => {
      const content = await readFile(path.join(staticDirectory, pin.path))
      assert.equal(content.length, pin.bytes); assert.equal(sha256(content), pin.sha256)
      return content
    }))
    const content = Buffer.concat(parts)
    assert.equal(content.length, archive.bytes); assert.equal(sha256(content), archive.sha256)
    const upstream = downloads.find((item) => item.name === archive.name) || provenance.packageDownloads.find((item) => item.name === archive.name) || (archive.name === provenance.biber.sourceArchive.name ? provenance.biber.sourceArchive : archive.name === provenance.packageSources?.archive.name ? provenance.packageSources.archive : undefined)
    assert.equal(archive.sha256, upstream?.sha256, 'Every source archive must match its recorded upstream input')
  }
  const wrapperSources = tarEntries(gunzipSync(await readFile(path.join(staticDirectory, offer.build.provisioningSources))))
  const wrapper = wrapperSources.find((entry) => entry.path === 'nextjs-frontend/public/mr-resume/latex/busytex-v2/compiler-worker.js')
  assert.ok(wrapper, 'The corresponding source must include the deployed application-owned worker')
  assert.equal(sha256(wrapper.content), sha256(await readFile(path.join(staticDirectory, 'compiler-worker.js'))))
  const notices = await readFile(path.join(staticDirectory, 'licenses/texlive-notices.txt'), 'utf8')
  assert.match(notices, /GNU GENERAL PUBLIC LICENSE/)
  assert.match(await readFile(path.join(staticDirectory, 'licenses/busytex-notices.txt'), 'utf8'), /Permission is hereby granted/)
  assert.match(await readFile(path.join(staticDirectory, 'licenses/NotoSansBengali-OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/)
  assert.match(await readFile(path.join(staticDirectory, 'licenses/LatinModern-GUST.txt'), 'utf8'), /GUST Font License/)
  assert.ok(manifest.limitations.some((item) => item.includes('real Perl Biber 2.22')))
  assert.match(await readFile(path.join(staticDirectory, 'licenses/TEXLYRE-AGPL-3.0.txt'), 'utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/)
  console.log(`ASSETS PASS: ${entries.length} package/font files; runtime ${manifest.assets.reduce((sum, item) => sum + item.bytes, 0)} bytes; snapshot ${snapshot.length} unpacked bytes; complete source archive SHA-256 verified.`)
}

function session(tamper, options = {}) {
  const worker = new Worker(new URL('./smoke-worker.mjs', import.meta.url), { workerData: { staticDirectory, tamper, noNetwork: options.noNetwork }, execArgv: ['--experimental-vm-modules'] })
  const events = [], waiters = []
  let fatal = null, boot = null, requests = [], scripts = [], consoleLines = []
  worker.on('message', (event) => {
    if (event.kind === 'boot') { boot = event }
    else if (event.kind === 'harness-error') fatal = new Error(event.message)
    else if (event.kind === 'message') { events.push(event.value); requests = event.requests; scripts = event.scripts; consoleLines = event.consoleLines }
    for (const wake of [...waiters]) wake()
  })
  worker.on('error', (error) => { fatal = error; for (const wake of [...waiters]) wake() })
  const until = (select, milliseconds = 120000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Worker timeout after ${milliseconds} ms; last public phases: ${events.filter((event) => event.type === 'progress' && event.stage === 'compiling').slice(-4).map((event) => event.message).join(' / ')}`)), milliseconds)
    const finish = (error, value) => { clearTimeout(timer); const index = waiters.indexOf(wake); if (index >= 0) waiters.splice(index, 1); if (error) reject(error); else resolve(value) }
    const wake = () => { if (fatal) return finish(fatal); const value = select(); if (value) finish(null, value) }
    waiters.push(wake); wake()
  })
  return {
    worker, events,
    async init(mainFile = 'main.tex', engine = 'pdflatex', options = {}) {
      const start = await until(() => boot)
      assert.deepEqual(start.requests, []); assert.deepEqual(start.scripts, []); assert.deepEqual(start.consoleLines, [])
      const bundle = options.manifest || manifest, approvedGroups = packageClosure(engine, options.approvedGroups || [], bundle)
      const pins = selectedAssets(engine, approvedGroups, bundle)
      const request = { type: 'init', mainFile, ...(options.omitEngine ? {} : { engine }), ...(approvedGroups.length ? { approvedGroups } : {}) }
      if (options.supplied) Object.assign(request, { manifest: bundle, assets: await assetBuffers(pins) })
      if (options.change) options.change(request)
      worker.postMessage(request)
      const ready = await until(() => events.find((event) => ['ready', 'error'].includes(event.type)))
      if (ready.type === 'error') return ready
      assert.equal(ready.version, manifest.profileVersion)
      assert.deepEqual(ready.engines, manifest.engines.map((item) => item.id))
      assert.deepEqual([...new Set(requests)].sort(), options.supplied ? [] : ['manifest.json', ...pins.map((pin) => pin.path)].sort())
      assert.deepEqual(scripts, ['busytex.js.bin', ...(bundle.biber && approvedGroups.includes(bundle.biber.group) ? ['tools/biber/biber.js.bin'] : [])]); assert.deepEqual(consoleLines, [])
      const progress = events.filter((event) => event.type === 'progress' && event.assetPath)
      assert.ok(progress.length, 'Asset preparation must report actual byte verification')
      const total = pins.reduce((sum, pin) => sum + pin.bytes, 0)
      let downloaded = 0, verified = 0
      for (const event of progress) {
        assert.ok(pins.some((pin) => pin.path === event.assetPath), 'Progress paths must be selected public asset pins')
        for (const key of ['downloadedBytes', 'verifiedBytes', 'totalBytes', 'cachedBytes']) assert.ok(Number.isSafeInteger(event[key]) && event[key] >= 0)
        assert.equal(event.totalBytes, total); assert.equal(event.cachedBytes, 0)
        assert.ok(event.downloadedBytes >= downloaded && event.downloadedBytes <= total && event.verifiedBytes >= verified && event.verifiedBytes <= total)
        downloaded = event.downloadedBytes; verified = event.verifiedBytes
        assert.equal(event.percent, undefined)
      }
      assert.equal(downloaded, options.supplied ? 0 : total); assert.equal(verified, total)
      return ready
    },
    async compile(request) {
      const initialRequests = [...requests], initialScripts = [...scripts]
      const start = performance.now()
      worker.postMessage({ type: 'compile', ...request })
      const result = await until(() => events.find((event) => ['result', 'error'].includes(event.type) && event.operationKey === request.operationKey), 180000)
      const duration = Math.round(performance.now() - start)
      assert.deepEqual(requests, initialRequests, 'Compilation must not fetch a source, filename, PDF or remote package')
      assert.deepEqual(scripts, initialScripts); assert.deepEqual(consoleLines, [], 'Vendor console must not emit private source/logs')
      assert.ok(Buffer.byteLength(result.log || '', 'utf8') <= 128 * 1024)
      return { result, duration }
    },
    until,
    stop: () => worker.terminate(),
  }
}

async function pdfSemantics(data, expect) {
  assert.ok(data instanceof ArrayBuffer)
  const bytes = new Uint8Array(data)
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-')
  assert.ok(bytes.length > 1000 && bytes.length <= 3 * 1024 * 1024)
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  const strictProof = await verifyBrowserLatexPdf(data)
  assert.equal(strictProof.bytes, bytes.length); assert.equal(strictProof.sha256, sha256(bytes)); assert.equal(strictProof.pages, document.getPageCount())
  assert.ok(document.getPageCount() >= 1 && document.getPageCount() <= 32)
  if (expect.pages) assert.equal(document.getPageCount(), expect.pages)
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise
  let text = '', images = 0
  const fonts = [], textPositions = [], urls = []
  try {
    assert.equal(pdf.numPages, document.getPageCount())
    for (let page = 1; page <= pdf.numPages; page++) {
      const current = await pdf.getPage(page)
      const items = (await current.getTextContent()).items
      text += items.map((item) => 'str' in item ? item.str : '').join(' ') + '\n'
      for (const item of items) if ('str' in item) textPositions.push({ page, text: item.str, x: item.transform[4], y: item.transform[5] })
      for (const annotation of await current.getAnnotations()) if (annotation.url) urls.push(annotation.url)
      const resources = document.getPage(page - 1).node.Resources()
      const dictionary = resources.lookupMaybe(PDFName.of('Font'), (await import('pdf-lib')).PDFDict)
      if (dictionary) for (const [, ref] of dictionary.entries()) {
        const font = document.context.lookup(ref)
        fonts.push(font.get(PDFName.of('BaseFont'))?.toString() || '')
      }
      const objects = resources.lookupMaybe(PDFName.of('XObject'), (await import('pdf-lib')).PDFDict)
      if (objects) for (const [, ref] of objects.entries()) {
        const image = document.context.lookup(ref)
        if (image.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') images++
      }
    }
  } finally { await pdf.destroy() }
  const normalized = text.normalize('NFC').replace(/\s+/gu, ' ')
  for (const phrase of expect.text || []) assert.ok(normalized.includes(phrase.normalize('NFC')), `PDF semantic text missing: ${phrase}; extracted: ${normalized}`)
  // PDF.js omits discretionary hyphens in LuaHBTeX text; the unchanged PDF
  // glyphs remain visibly present. Compare bibliography words, not that parser's
  // discretionary-hyphen choice, without rewriting the PDF or its text layer.
  const folded = (text) => text.normalize('NFKC').replace(/[-\u00ad\u2010\u2011]/gu, '').toLowerCase()
  for (const phrase of expect.caseInsensitiveText || []) assert.ok(folded(normalized).includes(folded(phrase)), `PDF content missing: ${phrase}; extracted: ${normalized}`)
  for (const phrase of expect.absent || []) assert.ok(!normalized.includes(phrase), `Unexpected PDF text: ${phrase}`)
  for (const url of expect.urls || []) assert.ok(urls.includes(url), `Original link missing or substituted: ${url}; actual: ${urls.join(', ')}`)
  if (expect.columns) {
    const left = textPositions.find((item) => item.page === 1 && item.text === 'EXPERIENCE'), right = textPositions.find((item) => item.page === 1 && item.text === 'MY LIFE PHILOSOPHY')
    assert.ok(left && right, 'Original left/right headings must render')
    const points = 72 / 2.54, usable = document.getPage(0).getWidth() - (2 * 1.25 + 1.2) * points
    assert.ok(Math.abs(left.x - 1.25 * points) < 1, 'Original left margin')
    assert.ok(Math.abs((right.x - left.x - 1.2 * points) / usable - 0.6) < 0.005, 'Actual 6:4 paracol ratio, not equal-width adapted columns')
  }
  if (expect.images) assert.ok(images >= expect.images, `Expected ${expect.images} actual PDF image XObjects, got ${images}`)
  if (expect.font) assert.ok(fonts.some((font) => expect.font.test(font)), `Expected embedded font family ${expect.font}; got ${fonts.join(', ')}`)
  for (const family of expect.fonts || []) assert.ok(fonts.some((font) => family.test(font)), `Required actual font family ${family} missing; got ${fonts.join(', ')}`)
  if (expect.bengaliGlyphs) {
    assert.match(normalized, /[\u0980-\u09ff]/u, 'The actual PDF must contain Bengali glyph text and embedded Noto fonts.')
    const exact = expect.bengaliGlyphs.every((phrase) => normalized.includes(phrase.normalize('NFC')))
    if (!exact || normalized.includes('\ufffd')) console.log('LIMITATION: Bengali glyph/font compilation passed, but complex-cluster PDF.js text extraction is not fully faithful; search/copy/ATS compatibility is not claimed.')
  }
  return { bytes: bytes.length, sha256: sha256(bytes), pages: document.getPageCount(), images, fonts: [...new Set(fonts)], text: normalized, urls }
}

async function successful(id, engine, files, expect, mainFile = 'main.tex', initOptions = {}) {
  if (only && only !== id) return
  selectedCases.add(id)
  if (!initOptions.approvedGroups && files.some((file) => typeof file.content === 'string' && /\\usepackage(?:\[[^\]]*\])?\{[^}]*amsmath/.test(file.content))) initOptions = { ...initOptions, approvedGroups: ['math'] }
  const current = session(undefined, { noNetwork: initOptions.supplied })
  try {
    const initialized = await current.init(mainFile, engine, initOptions)
    assert.equal(initialized.type, 'ready', `Init failed: ${JSON.stringify(initialized)}`)
    const { result, duration } = await current.compile({ operationKey: id, engine, mainFile, files })
    if (result.type === 'error' && result.log) {
      if (outputDirectory) { await mkdir(outputDirectory, { recursive: true }); await writeFile(path.join(outputDirectory, `${id}.failure.log`), result.log) }
      console.error(result.log.slice(-6000))
    }
    assert.equal(result.type, 'result', `${id}: ${result.code || ''} ${result.message || ''}`)
    assert.equal(result.engine, engine); assert.equal(result.exitCode, 0)
    const diagnosticSource = { ...createTemplateProject(), engine, mainFile, files: files.filter((file) => typeof file.content === 'string').map((file, index) => ({ ...file, id: `source-${index}` })), assets: [] }
    const finalDiagnostics = browserLatexDiagnostics(result.log, diagnosticSource, false)
    assert.deepEqual(finalDiagnostics.filter((item) => item.severity === 'error'), [], `${id}: the real worker result must also pass the independent parent diagnostic gate`)
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(path.join(outputDirectory, `${id}.pdf`), new Uint8Array(result.pdf))
      await writeFile(path.join(outputDirectory, `${id}.log`), result.log)
    }
    const proof = await pdfSemantics(result.pdf, expect)
    proof.diagnostics = finalDiagnostics
    if (outputDirectory) {
      await writeFile(path.join(outputDirectory, `${id}.json`), JSON.stringify(proof, null, 2) + '\n')
    }
    const passes = current.events.filter((event) => event.type === 'progress' && event.stage === 'compiling' && /^Running (?:pdfLaTeX|XeLaTeX|LuaHBTeX) pass/.test(event.message)).map((event) => event.pass)
    assert.ok(passes.length >= 1 && passes.length <= 3)
    assert.deepEqual(passes, Array.from({ length: passes.length }, (_, index) => index + 1))
    const bibliographies = current.events.filter((event) => event.type === 'progress' && event.message.includes('classic BibTeX pass'))
    const biber = current.events.filter((event) => event.type === 'progress' && event.message === 'Running the real local Biber 2.22 bibliography pass.')
    assert.ok(bibliographies.length <= 1)
    assert.ok(biber.length <= 1)
    if (expect.bibliography) { assert.equal(bibliographies.length, 1); assert.equal(passes.length, 3) }
    if (expect.biber) { assert.equal(bibliographies.length, 0); assert.equal(biber.length, 1); assert.equal(passes.length, 3) }
    await current.compile({ operationKey: id + '-reuse', engine, mainFile, files }).then(({ result: reused }) => assert.equal(reused.code, 'worker_used'))
    console.log(`COMPILE PASS ${id}: ${engine}; ${passes.length} TeX + ${bibliographies.length} BibTeX + ${biber.length} real Biber passes; ${proof.pages} page(s), ${proof.bytes} PDF bytes; ${duration} ms; SHA-256 ${proof.sha256}`)
    results.push({ id, engine, passes: passes.length, bibliographyPasses: bibliographies.length, biberPasses: biber.length, duration, ...proof })
    return result
  } finally { await current.stop() }
}

async function refused(id, engine, files, code, mainFile = 'main.tex', initOptions = {}) {
  if (only && only !== id) return
  selectedCases.add(id)
  const current = session()
  try {
    assert.equal((await current.init(initOptions.mainFile || mainFile, initOptions.engine || (['pdflatex', 'xelatex', 'lualatex'].includes(engine) ? engine : 'pdflatex'))).type, 'ready')
    const { result } = await current.compile({ operationKey: id, engine, mainFile, files })
    assert.equal(result.type, 'error', JSON.stringify(result)); assert.equal(result.code, code, JSON.stringify(result)); assert.equal(result.pdf, undefined)
    assert.equal(current.events.filter((event) => ['result', 'error'].includes(event.type) && event.operationKey === id).length, 1)
    if (id === 'invalid-tex') assert.match(result.log, /Undefined control sequence/)
    if (!['compile_failed', 'missing_glyph', 'pass_limit'].includes(code) && id !== 'included-biblatex') assert.equal(current.events.filter((event) => event.type === 'progress' && event.stage === 'compiling').length, 0)
    console.log(`REFUSAL PASS ${id}: ${code}; no PDF returned.`)
  } finally { await current.stop() }
}

async function initializationRefused(id, change, code = 'asset_integrity') {
  if (only && only !== id) return
  selectedCases.add(id)
  const current = session(undefined, { noNetwork: true })
  try {
    const result = await current.init('main.tex', 'pdflatex', { supplied: true, change })
    assert.equal(result.type, 'error'); assert.equal(result.code, code, JSON.stringify(result)); assert.equal(result.pdf, undefined)
    assert.ok(!current.events.some((event) => event.type === 'ready' || event.stage === 'compiling'))
    console.log(`INITIALIZATION REFUSAL PASS ${id}: ${code}; no compile or network fetch.`)
  } finally { await current.stop() }
}

const file = (path, content) => ({ path, content })
const png = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: '#285a82' } }).png().toBuffer())
const jpeg = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: '#985022' } }).jpeg().toBuffer())
const core = (engine) => String.raw`\documentclass[11pt,a4paper]{article}
${engine === 'pdflatex' ? String.raw`\usepackage{lmodern}` : String.raw`\usepackage{fontspec}\setmainfont{Latin Modern Roman}`}
\usepackage[margin=18mm]{geometry}
\usepackage{enumitem,titlesec,hyperref,graphicx,amsmath}
\hypersetup{hidelinks}
\setlist[itemize]{nosep}
\titleformat{\section}{\large\bfseries}{}{0pt}{}
\begin{document}
Plain ${engine} resume. \textbf{Bold typography}. \textit{Italic typography}. \textbf{\textit{Bold italic typography}}.
\section{First section}\label{sec:first}
\input{sections/body.tex}
See Section~\ref{sec:first} and page~\pageref{sec:first}. Mathematical proof: $\frac{2}{1}=2$.
\includegraphics[width=12mm]{assets/proof.png}\includegraphics[width=12mm]{assets/proof.jpg}
\end{document}`

async function importedZip(engine) {
  const name = `zip-import-${engine}`
  if (only && only !== name) return
  const zip = new JSZip()
  const main = core(engine).replace('{article}', '{zipimport}').replace('Plain ', 'ZIPSELECTEDPROFILE Plain ')
    .replace('\\begin{document}', '\\usepackage{local}\n\\begin{document}\n\\ZipStyle.')
    .replace('\\input{sections/body.tex}', '\\input{sections/header.tex}\n\\include{sections/body}')
    .replace('\\end{document}', 'Imported citation~\\cite{imported}.\n\\bibliographystyle{styles/custom}\\bibliography{references}\n\\end{document}')
  const sources = [file('template/cv.tex', '\ufeff' + main.replace(/\n/g, '\r\n')),
    file('template/unused.tex', '\\documentclass{article}\\begin{document}UNSELECTEDDOCUMENT \\intentionallyUndefinedCommand\\end{document}'),
    file('template/sections/body.tex', '\\section*{WRAPPEDCHAPTER} Original ZIP source.\r\n'),
    file('template/sections/header.tex', 'ZIPINPUTPROOF\r\n'),
    file('template/styles/local.sty', '\\ProvidesPackage{local}\r\n\\newcommand{\\ZipStyle}{ZIPSTYLEPROOF}\r\n'),
    file('template/zipimport.cls', '\\ProvidesClass{zipimport}\r\n\\LoadClassWithOptions{article}\r\n'),
    file('template/references.bib', '@article{imported,author={Ayesha Rahman},title={{ZIPBIBLIOGRAPHYPROOF}},journal={Import Journal},year={2026}}\r\n'),
    file('template/styles/custom.bst', plainStyle)]
  for (const { path, content } of sources) zip.file(path, content)
  zip.file('template/assets/proof.png', png); zip.file('template/assets/proof.jpg', jpeg)
  const draft = await readProjectZip(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), 'ZIP import smoke')
  assert.equal(draft.mainFile, null, 'Import must not arbitrarily choose or create a main')
  assert.deepEqual(draft.files.map(({ path, content }) => ({ path, content })), sources)
  const restored = await readProjectZip(await createProjectZip(draft))
  assert.equal(restored.mainFile, null, 'Portable export must preserve the unselected draft')
  assert.deepEqual(restored.files, draft.files)
  for (const asset of restored.assets) assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), asset.path.endsWith('.png') ? png : jpeg)
  const selected = reviseProject(restored, { mainFile: 'template/cv.tex', engine })
  const files = [...selected.files.map(({ path, content }) => ({ path, content })), ...await Promise.all(selected.assets.map(async (asset) => ({ path: asset.path, content: new Uint8Array(await asset.blob.arrayBuffer()) })))]
  await successful(name, engine, files, { text: ['ZIPSELECTEDPROFILE', 'WRAPPEDCHAPTER', 'ZIPINPUTPROOF', 'ZIPSTYLEPROOF', 'ZIPBIBLIOGRAPHYPROOF', 'See Section 1 and page 1'], absent: ['UNSELECTEDDOCUMENT', '??'], images: 2, pages: 3, bibliography: true }, selected.mainFile)
}

async function altaCV(engine, variant = 'import') {
  const legacy = only === `altacv-legacy-copy-${engine}`
  const name = legacy ? `altacv-legacy-copy-${engine}` : `altacv-${variant}-${engine}`
  if (only && only !== name) return
  const archive = await readFile(new URL('../../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url))
  const original = await readProjectZip(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength), 'Actual AltaCV template')
  assert.equal(original.mainFile, 'sample.tex', 'Only the complete document, not a publication preamble, is the main')
  if (!legacy) {
    const project = reviseProject(original, { engine })
    assert.deepEqual(project.files, original.files, 'Selecting an engine must not adapt the source')
    assert.equal(sha256(archive), 'a4cfbd5be6521ee6a6854bc4dd702e70951bb2529f18ead4d24406454f02a1c3')
    const files = [...project.files.map(({ path, content }) => ({ path, content })), ...await Promise.all(project.assets.map(async (asset) => ({ path: asset.path, content: new Uint8Array(await asset.blob.arrayBuffer()) })))]
    // Explicit qualification variants only: the imported project/ZIP and all
    // assets remain untouched. Exercise the other supplied preamble/photos.
    if (variant === 'authoryear') files.find((file) => file.path === project.mainFile).content = files.find((file) => file.path === project.mainFile).content.replace('\\input{pubs-num}', '\\input{pubs-authoryear}')
    if (variant === 'all-photos') files.find((file) => file.path === project.mainFile).content = files.find((file) => file.path === project.mainFile).content.replace('% \\photoL{2.5cm}{Yacht_High,Suitcase_High}', '\\photoL{2.5cm}{Yacht_High,Suitcase_High}')
    console.log(`ALTACV ${variant}: ${original.files.length} preserved original source/config files; all ${original.assets.length} unchanged images; main ${project.mainFile}; no adapter.`)
    return successful(name, engine, files, {
      text: ['YOUR NAME HERE', 'Your Position or Tagline Here', 'Job Title 1', 'Job Title 2', 'Project 1', 'Project 2', 'Sleep', 'Hopeful novelist', 'Daytime job', 'Spending time with family', 'Thesis title: Wonderful Research', 'Alpha Beta', 'Gamma Delta', 'Statistical Analysis', 'German'],
      caseInsensitiveText: ['A fictional research', 'A study into fireside story-telling', 'A non-existant paper', 'Another paper something something', '2010', '2011', '2008', '2013'],
      absent: ['??'], images: variant === 'all-photos' ? 3 : 1, pages: 2, biber: true, columns: true, urls: ['https://x.com/@x-handle'], fonts: [/RobotoSlab/i, /Lato/i, /FontAwesome/i, /SimpleIcons/i],
    }, project.mainFile, { supplied: true, approvedGroups: ['cv-layout', 'cv-fonts', 'bibliography'] })
  }
  const copy = createAltaCvBrowserProject(original)
  assert.notEqual(copy.id, original.id)
  assert.equal(original.mainFile, 'sample.tex')
  assert.deepEqual(copy.files.slice(0, original.files.length), original.files)
  const exportProject = legacy ? { ...copy, templateVersion: 1, engine, files: copy.files.map((source) => source.path === copy.mainFile
    ? { ...source, content: source.content.replace('\\usepackage{geometry}', '\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage{geometry}') }
    : source.path.endsWith('/altacv-browser.sty')
      ? { ...source, content: source.content.replace('support, version 2.', 'support, version 1.').replace(/% SmilePDF managed fonts v2:[\s\S]*?\\fi\n/u, '') }
      : source) } : copy
  const exported = await createProjectZip(exportProject)
  const imported = await readProjectZip(exported, 'AltaCV_Template (1) copy')
  assert.equal(imported.mainFile, copy.mainFile)
  assert.deepEqual(imported.files, exportProject.files)
  const prepared = legacy ? repairAltaCvBrowserProject(imported) : imported
  if (legacy) {
    assert.equal(prepared.templateVersion, 2)
    assert.equal(prepared.revision, imported.revision + 1)
    const oldMain = imported.files.find((source) => source.path === imported.mainFile).content
    const newMain = prepared.files.find((source) => source.path === prepared.mainFile).content
    assert.equal(newMain.slice(newMain.indexOf('\\begin{document}')), oldMain.slice(oldMain.indexOf('\\begin{document}')))
  }
  const project = reviseProject(prepared, { engine })
  console.log(`ALTACV COPY: ${original.files.length} untouched original sources, ${original.assets.length} original images; adapted entry: ${project.mainFile}`)
  const files = [...project.files.map(({ path, content }) => ({ path, content })), ...await Promise.all(project.assets.map(async (asset) => ({ path: asset.path, content: new Uint8Array(await asset.blob.arrayBuffer()) })))]
  await successful(name, engine, files, { text: ['Your Name Here', 'Your Position or Tagline Here', 'Job Title 1', 'Job Title 2', 'Project 1', 'Project 2', 'Sleep', 'Hopeful novelist', 'Daytime job', 'Spending time with family', 'A Fictional Research', 'A study into fireside story-telling', 'A non-existant paper', 'Another paper something something', 'Thesis title: Wonderful Research', 'Alpha Beta', 'Gamma Delta', 'Statistical Analysis', '2008', 'German 3.5/5'], images: 1, bibliography: true }, project.mainFile)
}

console.log(`REAL NODE/WASM SMOKE: Node ${process.version}; exact deployed classic worker, local-file asset adapter, no browser/HTTP/native compiler.`)
await checkAssets()
selectedCases.add('assets')
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) await successful(`supplied-assets-${engine}`, engine,
  [file('main.tex', String.raw`\documentclass{article}\begin{document}SUPPLIEDASSETSPROOF ${engine}. $2+2=4$.\end{document}`)], { text: ['SUPPLIEDASSETSPROOF', engine], pages: 1 }, 'main.tex', { supplied: true })
const legacyManifest = { ...manifest }
delete legacyManifest.groups
delete legacyManifest.biber
await successful('legacy-manifest-default-engine', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}LEGACYMANIFESTPROOF\end{document}`)],
  { text: ['LEGACYMANIFESTPROOF'], pages: 1 }, 'main.tex', { supplied: true, manifest: legacyManifest, omitEngine: true })
await successful('legacy-direct-init-default-engine', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}LEGACYDIRECTPROOF\end{document}`)],
  { text: ['LEGACYDIRECTPROOF'], pages: 1 }, 'main.tex', { omitEngine: true })
await successful('plain-pdflatex', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}PLAINPDFLATEXPROOF. Standard Computer Modern text. $2+2=4$.\end{document}`)], { text: ['PLAINPDFLATEXPROOF', 'Standard Computer Modern text'], pages: 1, font: /CMR|CMMI/ })
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) {
  await successful(`${engine}-core`, engine, [file('main.tex', core(engine)), file('sections/body.tex', String.raw`\begin{itemize}\item MULTIFILEPROOF\end{itemize}`), file('assets/proof.png', png), file('assets/proof.jpg', jpeg)],
    { text: [`Plain ${engine} resume`, 'MULTIFILEPROOF', 'See Section 1 and page 1', 'Bold typography', 'Italic typography'], absent: ['??'], images: 2, pages: 1, font: /LMRoman/i })
}
await successful('nested-main-labels', 'pdflatex', [file('documents/main.tex', core('pdflatex')), file('sections/body.tex', 'NESTEDMAINPROOF'), file('assets/proof.png', png), file('assets/proof.jpg', jpeg)], { text: ['NESTEDMAINPROOF', 'See Section 1 and page 1'], images: 2, pages: 1 }, 'documents/main.tex')
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) await importedZip(engine)
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) await altaCV(engine)
await altaCV('lualatex', 'authoryear')
await altaCV('lualatex', 'all-photos')
const career = latexSourceTemplates.find((template) => template.id === 'career-source')
await successful('career-template-as-is', career.engine, career.files, { text: ['Ayesha Rahman', 'Profile', 'Senior Product Designer', 'Education', 'Skills'], pages: 1, font: /LMRoman10/i })
const academic = latexSourceTemplates.find((template) => template.id === 'academic-source')
await successful('academic-template-as-is', academic.engine, academic.files, { text: ['Samira Ahmed', 'Research interests', 'An example study', 'Fictional Journal'], bibliography: true, font: /LMRoman10/i })
await successful('unused-biblatex-backup', 'lualatex', [...career.files, file('backup.tex', String.raw`\usepackage{biblatex} BACKUPNOTCOMPILED`)], { text: ['Ayesha Rahman'], absent: ['BACKUPNOTCOMPILED'], pages: 1 })
const bangla = latexSourceTemplates.find((template) => template.id === 'bangla-source')
await successful('bangla-template-as-is', bangla.engine, bangla.files, { text: ['Northstar Studio', 'English'], bengaliGlyphs: ['আয়েশা রহমান', 'সংক্ষিপ্ত পরিচয়'], pages: 1, font: /NotoSansBengali/i })
// Recreate the wrong effective scope, not just a main-font token: the v2
// Bengali default would otherwise still select its explicit Noto family.
const legacyBangla = bangla.files.map((item) => ({ ...item, content: item.content.replace('\\setmainfont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}', '\\setmainfont{Latin Modern Roman}').replace('\\newfontfamily\\englishfont{Latin Modern Roman}\n', '')
  .replace('\\setdefaultlanguage{bengali}', '\\setdefaultlanguage{english}').replace('\\setotherlanguage{english}', '\\setotherlanguage{bengali}') }))
await refused('legacy-bangla-v1-missing-glyph', 'lualatex', legacyBangla, 'missing_glyph')
await successful('bangla-harfbuzz-explicit-font', 'lualatex', [file('main.tex', String.raw`\documentclass[11pt]{article}
\usepackage{fontspec,polyglossia}
\setdefaultlanguage{bengali}\setotherlanguage{english}
\setmainfont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\newfontfamily\bengalifont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\newfontfamily\englishfont{Latin Modern Roman}
\begin{document}
আয়েশা রহমান
\section{সংক্ষিপ্ত পরিচয়}
বাংলা লেখা এবং কর্ম অভিজ্ঞতা।
\textenglish{ENGLISHPROOF}
\end{document}`)], { text: ['ENGLISHPROOF'], bengaliGlyphs: ['আয়েশা রহমান', 'সংক্ষিপ্ত পরিচয়'], pages: 1, font: /NotoSansBengali/i })
for (const engine of ['pdflatex', 'xelatex', 'lualatex']) {
  const source = String.raw`\documentclass{article}
${engine === 'pdflatex' ? '' : String.raw`\usepackage{fontspec}\setmainfont{Latin Modern Roman}`}
\begin{document}Classic bibliography proof~\cite{example}.
\bibliographystyle{plain}\bibliography{references}\end{document}`
  await successful(`${engine}-classic-bibtex`, engine, [file('main.tex', source), file('references.bib', '@article{example,author={Ayesha Rahman},title={{BIBLIOGRAPHYPROOF}},journal={Fixture Journal},year={2026},volume={1},pages={1--2}}')],
    { text: ['Classic bibliography proof', 'BIBLIOGRAPHYPROOF', '2026'], pages: 1, bibliography: true })
}
await refused('invalid-tex', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}\ACommandThatDoesNotExist\end{document}`)], 'compile_failed')
await successful('warning-only-ready', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}\PackageWarning{fixture}{A harmless fixture warning}WARNINGONLYPROOF\end{document}`)], { text: ['WARNINGONLYPROOF'], pages: 1 })
await refused('unresolved-citation', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}A required citation~\cite{missing-entry}.\end{document}`)], 'pass_limit')
await refused('included-biblatex', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\input{preamble.tex}\begin{document}Proof\end{document}`), file('preamble.tex', String.raw`\usepackage{biblatex}`)], 'package_group_required')
await refused('unsupported-engine', 'tectonic', [file('main.tex', String.raw`\documentclass{article}\begin{document}Proof\end{document}`)], 'unsupported_engine')
await refused('initialized-engine-mismatch', 'lualatex', [file('main.tex', 'Proof')], 'invalid_request', 'main.tex', { engine: 'pdflatex' })
await refused('initialized-main-mismatch', 'pdflatex', [file('main.tex', 'Proof')], 'invalid_request', 'main.tex', { mainFile: 'other.tex' })
await refused('unsafe-traversal', 'pdflatex', [file('main.tex', 'Proof'), file('../private.tex', 'NOTALLOWED')], 'unsafe_path')
await refused('case-alias', 'pdflatex', [file('main.tex', 'Proof'), file('MAIN.tex', 'NOTALLOWED')], 'duplicate_path')
await refused('source-limit', 'pdflatex', [file('main.tex', 'x'.repeat(1024 * 1024 + 1))], 'project_too_large')
await refused('invalid-image', 'pdflatex', [file('main.tex', 'Proof'), file('assets/bad.png', new Uint8Array([1, 2, 3]))], 'invalid_asset')
await refused('missing-glyph-before-truncated-log', 'lualatex', [file('main.tex', String.raw`\documentclass{article}
\usepackage{fontspec}\setmainfont{Latin Modern Roman}
\begin{document}\char"0985\par
\directlua{for i=1,3000 do texio.write_nl('log', 'Bounded diagnostic filler after the missing glyph: '..string.rep('x',80)) end}
\end{document}`)], 'missing_glyph')
await successful('shell-socket-filesystem-isolation', 'lualatex', [file('main.tex', String.raw`\documentclass{article}
\begin{document}
\immediate\write18{echo unsafe > /job/shell-proof.txt}
\directlua{local ok = pcall(require, 'socket'); if ok then error('Sockets were enabled') end}
\directlua{local f = io.open('/texlive/texmf-dist/fonts/opentype/public/lm/lmroman10-regular.otf', 'wb'); if f then f:close(); error('Packages were writable') end}
\directlua{local f = io.open([[${staticDirectory.replace(/\\/g, '/')}/busytex.js.bin]], 'rb'); if f then f:close(); error('Native filesystem was enabled') end}
\IfFileExists{shell-proof.txt}{UNSAFE SHELL}{SHELLDISABLED}
\InputIfFileExists{private.tex}{STALEPROJECT}{FRESHFILESYSTEM}
\end{document}`)], { text: ['SHELLDISABLED', 'FRESHFILESYSTEM'], absent: ['UNSAFE SHELL', 'STALEPROJECT'], pages: 1 })
await initializationRefused('supplied-duplicate-asset', (request) => { request.assets[1] = request.assets[0] })
await initializationRefused('supplied-unselected-asset', (request) => { request.assets[0] = { ...request.assets[0], path: 'groups/unselected/snapshot.tar.gz' } })
await initializationRefused('supplied-hash-mismatch', (request) => { const bytes = request.assets[0].content; new Uint8Array(bytes instanceof Uint8Array ? bytes.buffer : bytes)[0] ^= 1 })
await initializationRefused('unapproved-package-id', (request) => { request.approvedGroups = ['not-present-in-this-manifest'] }, 'invalid_request')
if (!only) {
const tampered = session('busytex.wasm')
try { const result = await tampered.init(); assert.equal(result.type, 'error'); assert.equal(result.code, 'asset_integrity'); console.log('INTEGRITY REFUSAL PASS: corrupted WASM rejected before initialization/compile.') }
finally { await tampered.stop() }
const hanging = session()
try {
  assert.equal((await hanging.init()).type, 'ready')
  hanging.worker.postMessage({ type: 'compile', operationKey: 'real-termination', engine: 'pdflatex', mainFile: 'main.tex', files: [file('main.tex', String.raw`\documentclass{article}\begin{document}\loop\iftrue\repeat\end{document}`)] })
  await hanging.until(() => hanging.events.find((event) => event.type === 'progress' && event.stage === 'compiling'), 30000)
  await hanging.stop()
  assert.ok(!hanging.events.some((event) => event.type === 'result'))
  console.log('TERMINATION PASS: actual compiling worker terminated, no stale PDF returned.')
} finally { await hanging.stop() }
await successful('fresh-worker-after-termination', 'pdflatex', [file('main.tex', String.raw`\documentclass{article}\begin{document}FRESHAFTERTERMINATION\end{document}`)], { text: ['FRESHAFTERTERMINATION'], pages: 1 })
console.log(`SMOKE PASS: ${results.length} real PDF compilations; all advertised engines, Career/Academic/Bangla sources as-is on their declared engines, Noto/HarfBuzz glyph coverage (not universal text/ATS fidelity), legacy Bangla font-scope refusal, original AltaCV with real Biber, labels/multiple files, PNG/JPEG, classic BibTeX, warning-only success and final citation/engine/path/limit/glyph refusals, asset integrity, privacy, and true worker termination verified. No E2E/browser suites run.`)
} else {
  assert.ok(selectedCases.has(only), `Unknown smoke case: ${only}. No selected compilation or refusal was exercised.`)
  console.log(`SELECTED SMOKE PASS: ${only}; ${results.length} real PDF compilation(s). No full-corpus coverage claimed for this selected run.`)
}
