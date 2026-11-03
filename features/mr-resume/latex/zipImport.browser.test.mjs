import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

// Standalone: use the existing server and dependencies; never provision an engine.
const expect = playwrightExpect.configure({ timeout: 20_000 })
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
const artifactDir = process.env.LATEX_UI_ARTIFACT_DIR || 'C:\\Users\\JISHAN~1\\AppData\\Local\\Temp\\kilo\\latex-zip-import'
const altaCvOnly = process.argv.includes('--altacv-only')
const api = '/api/mr-resume/latex/'
const manifestName = 'smilepdf-project.json'
const limits = { files: 32, sourceBytes: 1024 * 1024, uploadBytes: 3 * 1024 * 1024, pdfBytes: 3 * 1024 * 1024, pages: 32, logBytes: 128 * 1024, syncBytes: 8 * 1024 * 1024, deadlineSeconds: 30 }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
const originalSources = {
  'template/first.tex': '\ufeff% ZIP_IMPORT_FIRST_SOURCE: \u0995\u09cd\u200d\u09b7 / \u0995\u09cd\u200c\u09b7\r\n\\documentclass{article}\r\n\\begin{document}\r\nUnrelated first document.\r\n\\end{document}\r\n',
  'template/cv.tex': '% ZIP_IMPORT_CV_SOURCE: retain CRLF and joiner \u200d in this comment\r\n\\documentclass{article}\r\n\\usepackage{graphicx}\r\n\\usepackage{template/styles/local}\r\n\\begin{document}\r\nImported CV document.\r\n\\input{template/sections/body}\r\n\\includegraphics{template/assets/pixel.png}\r\n\\includegraphics{template/assets/photo.jpg}\r\n\\bibliographystyle{plain}\r\n\\bibliography{template/refs/references}\r\n\\end{document}\r\n',
  'template/sections/body.tex': '% ZIP_IMPORT_BODY_SOURCE: independent section\r\n\\section{Experience}\r\nOriginal section text.\r\n',
  'template/styles/local.sty': '% ZIP_IMPORT_STYLE_SOURCE\n\\ProvidesPackage{local}\n\\newcommand{\\localword}{Preserved style}\n',
  'template/refs/references.bib': '% ZIP_IMPORT_BIB_SOURCE\r\n@article{sample, title={Preserved bibliography}, author={Example, A}, year={2026}}\r\n',
}
const rootSource = '% ZIP_IMPORT_ROOT_SOURCE: creating main.tex must not select it\n\\documentclass{article}\n\\begin{document}Optional root document.\\end{document}\n'
const customPath = 'drafts/custom-entry.tex'
const customSource = '% ZIP_IMPORT_CUSTOM_SOURCE\n\\documentclass{article}\n\\begin{document}\nChosen arbitrary entry.\n\\input{template/sections/body}\n\\end{document}\n'

// Read the real v1 stores, without seeding records or calling production helpers.
async function storedWorkspace(page) {
  return page.evaluate(async () => {
    const name = 'mr-resume:latex:v1'
    if (!(await indexedDB.databases()).some((database) => database.name === name)) throw new Error('The LaTeX workspace did not create its IndexedDB database.')
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('LaTeX database read was blocked.'))
    })
    try {
      const names = ['projects', 'assets', 'checkpoints', 'artifacts']
      const transaction = database.transaction(names, 'readonly')
      const committed = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve
        transaction.onabort = () => reject(transaction.error)
        transaction.onerror = () => reject(transaction.error)
      })
      const values = await Promise.all(names.map((store) => new Promise((resolve, reject) => {
        const request = transaction.objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })))
      await committed
      const digest = async (buffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const snapshot = async (project) => ({ ...project, assets: await Promise.all(project.assets.map(async ({ blob, ...asset }) => blob
        ? { ...asset, size: blob.size, sha256: await digest(await blob.arrayBuffer()) } : asset)) })
      return {
        projects: values[0].map((record) => record.project),
        assets: await Promise.all(values[1].map(async (record) => ({ projectId: record.projectId, storedHash: record.sha256, ...(await snapshot({ assets: [record.asset] })).assets[0] }))),
        checkpoints: await Promise.all(values[2].map(async ({ checkpoint }) => ({ ...checkpoint, project: await snapshot(checkpoint.project) }))),
        artifacts: await Promise.all(values[3].map(async (record) => ({ projectId: record.projectId, snapshot: await snapshot(record.snapshot), proof: { ...record.proof, data: Array.from(new Uint8Array(record.proof.data)) } }))),
      }
    } finally { database.close() }
  })
}

function assertSourceAndAssets(project, sources, assets, mainFile) {
  assert.equal(project.mainFile, mainFile)
  assert.deepEqual(Object.fromEntries(project.files.map((file) => [file.path, file.content])), sources, 'Stored raw source changed or a path was lost.')
  assert.deepEqual(project.assets.map(({ path, mediaType, size, sha256 }) => ({ path, mediaType, size, sha256 })).sort(byPath),
    Object.entries(assets).map(([path, asset]) => ({ path, mediaType: asset.mediaType, size: asset.bytes.length, sha256: hash(asset.bytes) })).sort(byPath))
}

async function downloaded(page, action, filename) {
  const [download] = await Promise.all([page.waitForEvent('download'), action()])
  assert.equal(await download.failure(), null)
  assert.equal(path.extname(download.suggestedFilename()), path.extname(filename))
  const stream = await download.createReadStream()
  assert.ok(stream, 'The browser download has no readable bytes.')
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  await download.saveAs(path.join(artifactDir, filename))
  return Buffer.concat(chunks)
}

async function assertSourceZip(bytes, project, sources, assets, mainFile) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
  assert.deepEqual(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort(), [...Object.keys(sources), ...Object.keys(assets), manifestName].sort())
  for (const [file, source] of Object.entries(sources)) assert.deepEqual(await zip.file(file).async('nodebuffer'), Buffer.from(source, 'utf8'), `Export changed UTF-8/BOM/CRLF bytes in ${file}.`)
  for (const [file, asset] of Object.entries(assets)) {
    const original = await zip.file(file).async('nodebuffer')
    assert.deepEqual(original, asset.bytes, `Export changed original image bytes in ${file}.`)
    assert.equal(hash(original), hash(asset.bytes))
  }
  const manifest = JSON.parse(await zip.file(manifestName).async('string'))
  assert.equal(manifest.format, 'smilepdf-latex')
  assert.equal(manifest.version, 1)
  assert.ok(Object.hasOwn(manifest, 'mainFile'), 'The portable manifest omitted explicit mainFile.')
  assert.equal(manifest.mainFile, mainFile)
  assert.equal(manifest.sourceProjectId, project.id)
  assert.equal(manifest.engine, project.engine)
  assert.deepEqual(manifest.files, project.files.map(({ id, path }) => ({ id, path })))
  assert.deepEqual(manifest.assets, project.assets.map(({ id, path, mediaType, size, sha256 }) => ({ id, path, mediaType, bytes: size, sha256 })))
  return manifest
}

async function main() {
  let browser, page, artifactReady = false, authorized = false, expectedCompile = null
  const pdfs = new Map()
  const sourceMarkers = [Buffer.from('ZIP_IMPORT_'), Buffer.from('SmilePDF browser-compatible COPY of '), Buffer.from('\u00c5ddr\u00e9s\u015f', 'utf8')]
  const report = { test: altaCvOnly ? 'AltaCV exported legacy copy and explicit local font repair' : 'ambiguous ZIP draft and explicit main selection', baseURL, artifactDir, status: 'running', stage: 'setup', fixture: altaCvOnly ? 'Actual existing AltaCV ZIP, real browser WASM TeX output; no compile fixture.' : 'Native HTTP transport fixture generated with pdf-lib, not real TeX output.', apiRequests: [], privateUploads: [], engineRequests: [], sourceLeaks: [], workerTraffic: [], assetFetches: [], layouts: [], compiles: [], actualCompiles: [], fixtureErrors: [], pageErrors: [] }
  try {
    await mkdir(artifactDir, { recursive: true })
    artifactReady = true
    const image = sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 71, g: 137, b: 93 } } })
    const assets = {
      'template/assets/pixel.png': { mediaType: 'image/png', bytes: await image.clone().png().toBuffer() },
      'template/assets/photo.jpg': { mediaType: 'image/jpeg', bytes: await image.clone().jpeg({ quality: 90 }).toBuffer() },
    }
    const zip = new JSZip()
    for (const [file, content] of Object.entries(originalSources)) zip.file(file, Buffer.from(content, 'utf8'), { createFolders: false })
    for (const [file, asset] of Object.entries(assets)) zip.file(file, asset.bytes, { createFolders: false })
    assert.equal(zip.file('main.tex'), null)
    assert.equal(zip.file(manifestName), null)
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true })

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce', acceptDownloads: true })
    page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.setDefaultNavigationTimeout(45_000)
    page.on('pageerror', (error) => report.pageErrors.push(error.stack || error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      const body = request.postDataBuffer()
      if (url.pathname.startsWith(api)) report.apiRequests.push({ path: url.pathname, method: request.method(), bytes: body?.length || 0 })
      if (url.pathname.startsWith('/api/') && request.method() === 'POST') report.privateUploads.push({ path: url.pathname, method: request.method(), bytes: body?.length || 0 })
      if (/\/mr-resume\/latex\/.*(?:compiler-worker\.js|busytex\.js\.bin|\.wasm(?:$|\.)|\.data(?:$|\.))/u.test(url.pathname)) report.engineRequests.push(url.pathname)
      if (body && sourceMarkers.some((marker) => body.includes(marker)) && !url.pathname.startsWith(api)) report.sourceLeaks.push({ url: request.url(), method: request.method() })
    })
    await page.addInitScript(() => {
      window.__latexZipProbe = []
      window.__latexFetchProbe = []
      const nativeFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('/mr-resume/latex/busytex-v1/')) window.__latexFetchProbe.push({ url, method: init?.method || 'GET', cache: init?.cache, credentials: init?.credentials })
        return nativeFetch(input, init)
      }
      const NativeWorker = window.Worker
      // Observe the actual workers; do not replace archive processing or engine results.
      window.Worker = new Proxy(NativeWorker, { construct(target, args) {
        const worker = Reflect.construct(target, args)
        const url = String(args[0]), name = args[1]?.name || ''
        const record = (direction, value) => {
          const message = value && typeof value === 'object' ? value : {}
          if (message.type === 'progress' && Number.isFinite(message.bytesLoaded)) return
          const source = message.project || message.manifest || message.snapshot || message
          window.__latexZipProbe.push({ direction, url, name, action: String(message.action || message.type || message.kind || message.command || ''), keys: Object.keys(message), hasSource: Array.isArray(source.files) || typeof source.source === 'string', mainFile: source.mainFile, engine: message.engine, paths: Array.isArray(source.files) ? source.files.map((file) => file.path) : [], bufferBytes: message.buffer instanceof ArrayBuffer ? message.buffer.byteLength : 0, pdfBytes: message.pdf instanceof ArrayBuffer ? message.pdf.byteLength : 0, exitCode: message.exitCode })
        }
        record('construct', {})
        worker.addEventListener('message', (event) => record('receive', event.data))
        const post = worker.postMessage.bind(worker)
        worker.postMessage = (message, ...rest) => { record('send', message); return post(message, ...rest) }
        return worker
      } })
    })

    // ONLY the native LaTeX API is intercepted. ZIP workers, editor, IDB and PDF.js stay real.
    if (!altaCvOnly) await context.route('**/api/mr-resume/latex/**', async (route) => {
      const request = route.request(), url = new URL(request.url()), requestId = request.headers()['x-request-id']
      const headers = { 'x-request-id': requestId || 'latex-fixture', 'cache-control': 'no-store' }
      try {
        assert.ok(requestId, 'Native requests must carry their own request identity.')
        if (url.pathname === `${api}capabilities` && request.method() === 'GET') {
          return await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ enabled: true, ready: true, reason: 'Deterministic native transport fixture; no TeX engine is being invoked.', profiles: ['lualatex', 'xelatex', 'pdflatex'].map((id) => ({ id, name: id, version: 'zip-import-transport-fixture-v1', fonts: ['Latin Modern Roman'], packages: ['article', 'graphicx'] })), limits }) })
        }
        if (url.pathname === `${api}compile` && request.method() === 'POST') {
          assert.ok(authorized && expectedCompile, 'Source was uploaded without the test observing explicit privacy consent.')
          authorized = false
          const form = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData()
          const manifest = JSON.parse(form.get('manifest'))
          const snapshot = expectedCompile
          assert.equal(manifest.mainFile, snapshot.mainFile, 'Compile used the visible tab instead of the chosen entry point.')
          assert.equal(typeof manifest.mainFile, 'string')
          for (const key of ['version', 'projectId', 'title', 'revision', 'engine']) assert.equal(manifest[key], key === 'projectId' ? snapshot.id : snapshot[key])
          assert.equal(request.headers()['x-resume-operation-key'], manifest.operationKey)
          assert.deepEqual(manifest.files, snapshot.files, 'The native upload did not contain every exact raw source file.')
          assert.deepEqual(manifest.assets, snapshot.assets.map(({ id, path, mediaType, size }) => ({ id, path, mediaType, size })))
          assert.deepEqual([...form.keys()].sort(), ['manifest', ...manifest.assets.map((asset) => `asset:${asset.id}`)].sort())
          const fingerprints = [], uploadedImages = []
          for (const asset of manifest.assets) {
            const file = form.get(`asset:${asset.id}`)
            assert.ok(file instanceof Blob)
            const bytes = Buffer.from(await file.arrayBuffer())
            assert.equal(file.type, asset.mediaType)
            assert.equal(bytes.length, asset.size)
            assert.deepEqual(bytes, assets[asset.path].bytes, `Native upload changed ${asset.path}.`)
            fingerprints.push({ ...asset, sha256: hash(bytes) })
            uploadedImages.push({ mediaType: asset.mediaType, bytes })
          }
          const snapshotHash = hash(Buffer.from(JSON.stringify({ version: manifest.version, projectId: manifest.projectId, revision: manifest.revision, mainFile: manifest.mainFile, engine: manifest.engine, files: [...manifest.files].sort(byPath), assets: fingerprints.sort(byPath) }), 'utf8'))
          const document = await PDFDocument.create()
          const font = await document.embedFont(StandardFonts.Helvetica)
          document.setTitle('ZIP import native transport fixture, not TeX output')
          document.setCreationDate(new Date('2026-01-01T00:00:00Z'))
          document.setModificationDate(new Date('2026-01-01T00:00:00Z'))
          const sheet = document.addPage([480, 240])
          sheet.drawText('pdf-lib HTTP transport fixture, NOT TeX output', { x: 24, y: 205, size: 13, font })
          sheet.drawText(`Chosen main: ${manifest.mainFile}`, { x: 24, y: 175, size: 12, font })
          sheet.drawText(`Snapshot SHA-256: ${snapshotHash.slice(0, 32)}`, { x: 24, y: 145, size: 10, font })
          for (const [index, image] of uploadedImages.entries()) sheet.drawImage(await (image.mediaType === 'image/png' ? document.embedPng(image.bytes) : document.embedJpg(image.bytes)), { x: 24 + index * 60, y: 65, width: 42, height: 28 })
          const bytes = Buffer.from(await document.save({ useObjectStreams: false }))
          assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1)
          const id = `zip-fixture-${report.compiles.length + 1}`
          const result = { status: 'ready', operationKey: manifest.operationKey, projectId: manifest.projectId, revision: manifest.revision, snapshotHash, engine: manifest.engine, profileVersion: 'zip-import-transport-fixture-v1', pdf: { id, sha256: hash(bytes), bytes: bytes.length, pages: 1 }, diagnostics: [{ severity: 'info', message: 'Transport regression fixture generated by pdf-lib, not a TeX compile.', code: 'transport_fixture' }], log: `pdf-lib transport fixture. No TeX engine ran.\nChosen main: ${manifest.mainFile}\nSnapshot: ${snapshotHash}\n`, syncAvailable: false, createdAt: new Date().toISOString() }
          pdfs.set(id, { bytes, result })
          report.compiles.push({ mainFile: manifest.mainFile, projectId: manifest.projectId, revision: manifest.revision, sourcePaths: manifest.files.map((file) => file.path), assets: fingerprints, snapshotHash, pdfHash: result.pdf.sha256, consentObserved: true })
          return await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(result) })
        }
        if (url.pathname.startsWith(`${api}artifacts/`) && request.method() === 'GET') {
          const fixture = pdfs.get(url.pathname.slice(`${api}artifacts/`.length))
          assert.ok(fixture, 'The viewer requested an unknown fixture artifact.')
          assert.equal(request.headers()['x-resume-operation-key'], fixture.result.operationKey)
          return await route.fulfill({ status: 200, contentType: 'application/pdf', headers: { ...headers, 'content-length': String(fixture.bytes.length), 'x-resume-pdf-sha256': fixture.result.pdf.sha256, 'x-resume-snapshot-hash': fixture.result.snapshotHash }, body: fixture.bytes })
        }
        assert.fail(`Unexpected native endpoint: ${request.method()} ${url.pathname}`)
      } catch (error) {
        report.fixtureErrors.push(error.stack || error.message)
        await route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ error: 'The native transport fixture rejected an unexpected or mismatched request.', code: 'fixture_assertion_failed', request_id: headers['x-request-id'] }) })
      }
    })

    const studio = page.locator('#mr-resume-panel-latex [data-compiler-runtime]')
    const rail = studio.locator('#resume-latex-file-rail')
    const mainSelect = studio.getByLabel('Select main LaTeX file', { exact: true })
    const editor = studio.locator('[aria-label="Editable LaTeX source"]')
    const compile = studio.locator(':scope > header').getByRole('button', { name: /^Compile\b/u })
    const exportSummary = studio.locator('summary[aria-label="Export and workspace actions"]')
    const settings = studio.locator('summary[aria-label="Editor settings"]')
    const projectSelect = studio.locator('select[aria-label="Select LaTeX project"]')
    const posts = () => report.apiRequests.filter((request) => request.method === 'POST').length
    async function drainWorkers() { report.workerTraffic.push(...await page.evaluate(() => window.__latexZipProbe.splice(0))) }
    async function noCompile(count) {
      await drainWorkers()
      assert.equal(posts(), count, 'Importing, editing, saving or unresolved compile intent made a compiler POST.')
      assert.deepEqual(report.sourceLeaks, [], 'Synthetic project source escaped the LaTeX compile API.')
      assert.deepEqual(report.engineRequests, [], 'A draft action began downloading/loading browser engine assets.')
      assert.deepEqual(report.workerTraffic.filter((event) => /busytex|compiler[-_.]?worker/iu.test(`${event.url} ${event.name}`)), [], 'A browser compiler worker was initialized.')
      assert.deepEqual(report.workerTraffic.filter((event) => event.direction === 'send' && event.name !== 'mr-resume-pdf' && !/pdf(?:js|[._-]?worker)/iu.test(event.url) && ((event.hasSource && event.action !== 'export') || /^(?:init|compile)$/iu.test(event.action))), [], 'Source or an init intent was transferred to a non-archive worker.')
      await expect(studio.locator('[data-stage="waiting"], [data-stage="recovering"], [data-stage="cancelling"]')).toHaveCount(0)
    }
    async function openStudio() {
      await page.waitForLoadState('networkidle')
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
      await page.getByRole('button', { name: 'Open LaTeX editor' }).click()
      await expect(studio).toHaveAttribute('aria-busy', 'false')
      await expect(editor).toBeVisible()
      await save()
    }
    async function chooseProject(id) {
      if (await projectSelect.inputValue() === id) return
      await studio.locator('summary[aria-label="Projects and source templates"]').click()
      await projectSelect.selectOption(id)
      await expect(projectSelect).toHaveValue(id)
    }
    async function reloadStudio(id) {
      await drainWorkers()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openStudio()
      await chooseProject(id)
    }
    async function showPanel(panel) {
      const navigation = studio.getByRole('navigation', { name: 'LaTeX workspace views' })
      if (await navigation.isVisible()) await navigation.getByRole('button', { name: panel === 'files' ? 'Files' : 'Source', exact: true }).click()
      else if (panel === 'files' && !await rail.isVisible()) await studio.getByRole('button', { name: 'Show project files', exact: true }).click()
    }
    async function sourceTab(file) {
      await showPanel('source')
      const tab = studio.locator(`[role="tab"][title="${file}"]`)
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(editor).toBeVisible()
    }
    async function save() {
      await editor.focus()
      await editor.press('Control+s')
      const saved = studio.locator('[data-state="saved"]')
      await expect(saved).toContainText(/Saved r\d+/u)
      const revision = Number((await saved.innerText()).match(/Saved r(\d+)/u)[1])
      const id = await projectSelect.inputValue()
      const project = (await storedWorkspace(page)).projects.find((project) => project.id === id)
      assert.ok(project, 'The selected project has not committed to IndexedDB.')
      assert.equal(project.revision, revision, 'The save acknowledgement does not match the committed editor revision.')
      return project
    }
    async function exportSource(filename) {
      await exportSummary.click()
      const bytes = await downloaded(page, () => studio.getByRole('button', { name: /^Complete source ZIP/u }).click(), filename)
      await expect(studio.getByRole('button', { name: 'Dismiss LaTeX notice' })).toBeVisible()
      return bytes
    }
    async function importArchive(bytes, filename, expectedMain = null) {
      const previousId = await projectSelect.inputValue()
      await studio.locator('summary[aria-label="Projects and source templates"]').click()
      const chooser = page.waitForEvent('filechooser')
      await studio.locator('details[data-latex-menu][open]').getByRole('button', { name: 'Import .tex / source ZIP', exact: true }).click()
      await (await chooser).setFiles({ name: filename, mimeType: 'application/zip', buffer: bytes })
      await expect.poll(() => projectSelect.inputValue()).not.toBe(previousId)
      await expect(studio.getByRole('status').filter({ hasText: expectedMain ? 'Imported' : 'No main file was assigned' })).toBeVisible()
      const project = await save()
      assert.equal(project.mainFile, expectedMain, 'ZIP import changed the explicit stored main-file setting.')
      return project
    }
    async function setMain(file) {
      await showPanel('files')
      const before = await save()
      const trigger = studio.getByRole('button', { name: `Actions for ${file}`, exact: true })
      await trigger.focus()
      await trigger.press('Enter')
      const popup = page.getByRole('group', { name: `Actions for ${file}`, exact: true })
      await expect(popup).toBeVisible()
      await popup.getByRole('button', { name: 'Set as main', exact: true }).press('Enter')
      await expect(popup).not.toBeVisible()
      const project = await save()
      assert.equal(project.revision, before.revision + 1)
      assert.equal(project.mainFile, file)
      assert.deepEqual(project.files, before.files)
      assert.deepEqual(project.assets, before.assets)
      await expect(rail.locator('[data-main="true"]')).toHaveCount(1)
      await expect(rail.locator(`button[title="${file}"] [data-main="true"]`)).toHaveText('Main')
      return project
    }
    async function localProof(snapshot, filename) {
      await expect(studio.locator('[data-stage]')).toHaveAttribute('data-stage', /^(?:ready|failed|cancelled|recoverable)$/u, { timeout: 120_000 })
      const stage = await studio.locator('[data-stage]').getAttribute('data-stage')
      if (stage !== 'ready') {
        await studio.locator('#resume-latex-build-tab-log').click()
        const log = await studio.getByRole('region', { name: 'Compile log details', exact: true }).innerText()
        report.localFailure = { stage, message: await studio.locator('[data-stage]').innerText(), log }
        assert.fail(`Actual local AltaCV build ${stage}: ${log}`)
      }
      await expect.poll(async () => (await storedWorkspace(page)).artifacts.find((artifact) => artifact.projectId === snapshot.id)?.proof.revision).toBe(snapshot.revision)
      const retained = (await storedWorkspace(page)).artifacts.find((artifact) => artifact.projectId === snapshot.id)
      assert.deepEqual(retained.snapshot, snapshot, 'The proof did not capture the canonical stored project.')
      assert.equal(retained.proof.runtime, 'browser')
      assert.equal(retained.proof.engine, snapshot.engine)
      assert.equal(retained.proof.syncAvailable, false)
      assert.deepEqual(retained.proof.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [])
      assert.equal(retained.proof.snapshotHash, hash(Buffer.from(JSON.stringify({ version: snapshot.version, projectId: snapshot.id, revision: snapshot.revision, mainFile: snapshot.mainFile, engine: snapshot.engine, files: [...snapshot.files].sort(byPath), assets: [...snapshot.assets].sort(byPath) }), 'utf8')))
      await expect(studio.locator('#resume-latex-proof-pane [data-state="current"]')).toBeVisible()
      await expect(studio.locator('#resume-latex-proof-pane [data-ready="true"]')).toBeVisible()
      const bytes = await downloaded(page, () => studio.getByRole('button', { name: 'Download PDF', exact: true }).click(), filename)
      assert.deepEqual(bytes, Buffer.from(retained.proof.data), 'Download and retained preview do not use the original PDF bytes.')
      assert.equal(bytes.length, retained.proof.pdf.bytes)
      assert.equal(hash(bytes), retained.proof.pdf.sha256)
      const document = await PDFDocument.load(bytes, { updateMetadata: false })
      assert.equal(document.getPageCount(), 2)
      assert.equal(retained.proof.pdf.pages, 2)
      assert.match(document.getProducer() ?? '', snapshot.engine === 'pdflatex' ? /pdfTeX/u : /Lua(?:HB)?TeX/u, 'The original PDF producer is not the actual selected TeX engine.')
      const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
      let text = '', images = 0
      try {
        assert.equal(pdf.numPages, 2)
        for (let number = 1; number <= pdf.numPages; number++) {
          const sheet = await pdf.getPage(number)
          text += (await sheet.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ') + '\n'
          images += (await sheet.getOperatorList()).fnArray.filter((op) => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].includes(op)).length
        }
      } finally { await pdf.destroy() }
      text = text.normalize('NFC').replace(/\s+/gu, ' ')
      for (const writing of ['Your Name Here', 'Your Position or Tagline Here', 'Job Title 1', 'Job Title 2', 'Wonderful Research', 'a.beta@university.edu', 'g.delta@university.edu']) assert.ok(text.includes(writing), `The actual PDF omitted ${writing}.`)
      for (const title of snapshot.files.find((file) => file.path === 'sample.bib').content.matchAll(/title\s*=\s*\{([^}]+)\}/giu)) assert.ok(text.toLowerCase().includes(title[1].toLowerCase()), `The actual PDF omitted publication ${title[1]}.`)
      if (snapshot.engine === 'lualatex') assert.ok(text.includes('\u015f'), 'The repaired Unicode-engine PDF lost U+015F (s with cedilla).')
      assert.ok(images >= 1, 'The real PDF did not draw the original photo.')
      assert.doesNotMatch(text, /NOT TeX output|HTTP transport fixture/u)
      await writeFile(path.join(artifactDir, filename.replace(/\.pdf$/u, '.txt')), text)
      await writeFile(path.join(artifactDir, filename.replace(/\.pdf$/u, '.log')), retained.proof.log)
      report.actualCompiles.push({ projectId: snapshot.id, mainFile: snapshot.mainFile, engine: snapshot.engine, revision: snapshot.revision, profileVersion: retained.proof.profileVersion, snapshotHash: retained.proof.snapshotHash, pdfHash: retained.proof.pdf.sha256, bytes: bytes.length, pages: 2, images, producer: document.getProducer(), unicodeCedilla: text.includes('\u015f') })
      return retained
    }
    async function newFile(filename, source) {
      await showPanel('files')
      await studio.getByRole('button', { name: 'New file', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Create a source file', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Relative filename').fill(filename)
      await dialog.getByLabel('Initial raw source').fill(source)
      await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      return save()
    }
    async function nativeRuntime() {
      await showPanel('source')
      await settings.click()
      await studio.getByLabel('LaTeX compiler runtime', { exact: true }).selectOption('native')
      await expect(studio).toHaveAttribute('data-compiler-runtime', 'native')
      await expect(studio.getByLabel('LaTeX compiler runtime', { exact: true })).toBeEnabled()
      await expect(settings.locator('..').locator('label').filter({ hasText: /^Engine\b/u }).locator('select')).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(settings).toBeFocused()
    }
    async function captureMainState(state, selected) {
      for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 812 }]) {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.evaluate((value) => { localStorage.setItem('smilepdf-theme', value); document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value }, theme)
        await showPanel('files')
        await expect(mainSelect).toBeVisible()
        await expect(mainSelect).toHaveValue(selected || '')
        await expect(rail.locator('[data-main="true"]')).toHaveCount(selected ? 1 : 0)
        await expect(studio.locator('#resume-latex-file-tabs small')).toHaveCount(selected ? 1 : 0)
        await expect(studio.getByRole('button', { name: 'New file', exact: true })).toBeEnabled()
        await studio.getByRole('button', { name: 'New file', exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(studio.getByRole('button', { name: 'Add file or image', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(mainSelect).toBeFocused()
        const focus = await mainSelect.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) }))
        assert.notEqual(focus.style, 'none')
        assert.ok(focus.width >= 2, 'Main selection lost its visible keyboard focus ring.')
        const box = await mainSelect.boundingBox()
        assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height, 'Main selection is clipped or outside the viewport.')
        await page.screenshot({ path: path.join(artifactDir, `${state}-${theme}-${viewport.width}.png`) })
        await exportSummary.focus()
        await exportSummary.press('Enter')
        await expect(studio.getByRole('button', { name: /^Complete source ZIP/u })).toBeEnabled()
        if (selected) await expect(studio.getByRole('button', { name: 'Main source (.tex)', exact: true })).toBeEnabled()
        else await expect(studio.getByRole('button', { name: 'Main source (.tex)', exact: true })).toBeDisabled()
        await page.keyboard.press('Escape')
        await expect(exportSummary).toBeFocused()
        await showPanel('source')
        await expect(editor).toBeVisible()
        const layout = await studio.evaluate((element) => ({ documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), rootWidth: element.clientWidth, rootScrollWidth: element.scrollWidth, sourceHeight: element.querySelector('.cm-scroller').getBoundingClientRect().height, sourceWidth: element.querySelector('.cm-scroller').clientWidth, sourceScrollWidth: element.querySelector('.cm-scroller').scrollWidth }))
        assert.ok(layout.documentWidth <= viewport.width + 1 && layout.rootScrollWidth <= layout.rootWidth + 1, 'The workspace overflows horizontally.')
        assert.ok(layout.sourceHeight >= 180, `Source editing has no useful height at ${viewport.width}px: ${layout.sourceHeight}.`)
        assert.ok(layout.sourceScrollWidth <= layout.sourceWidth + 1, 'Wrapped source overflows horizontally.')
        report.layouts.push({ state, theme, ...viewport, ...layout })
        await editor.focus()
        await editor.press('Escape')
        await expect(studio.getByRole('button', { name: 'Undo', exact: true })).toBeFocused()
        await settings.focus()
        await settings.press('Enter')
        const auto = studio.getByRole('checkbox', { name: 'Auto Compile', exact: true })
        await expect(auto).not.toBeChecked()
        if (selected) await expect(auto).toBeEnabled()
        else await expect(auto).toBeDisabled()
        await page.keyboard.press('Escape')
        if (selected) await expect(compile).toBeEnabled()
        else await expect(compile).toBeDisabled()
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.evaluate(() => { localStorage.setItem('smilepdf-theme', 'light'); document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light' })
    }
    async function compileSelected(snapshot, filename) {
      const visibleTab = await studio.locator('[role="tab"][aria-selected="true"]').getAttribute('title')
      assert.notEqual(visibleTab, snapshot.mainFile, 'This transport check must compile a main file other than the visible source tab.')
      const previous = posts()
      expectedCompile = snapshot
      await editor.focus()
      await editor.press('Control+Enter')
      const dialog = page.getByRole('dialog', { name: 'Compile with the private runtime', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('LaTeX source and image assets')
      const submit = dialog.getByRole('button', { name: 'Compile this revision', exact: true })
      await expect(submit).toBeDisabled()
      assert.equal(posts(), previous, 'Opening privacy consent uploaded source.')
      const consent = dialog.getByRole('checkbox', { name: 'I understand that source and image assets are uploaded when I compile.', exact: true })
      await consent.focus()
      await page.keyboard.press('Space')
      await expect(consent).toBeChecked()
      await expect(submit).toBeEnabled()
      assert.equal(posts(), previous, 'Checking privacy consent uploaded source before confirmation.')
      authorized = true
      await submit.click()
      await expect.poll(() => report.compiles.length).toBe(previous + 1)
      report.compiles.at(-1).visibleTab = visibleTab
      await expect(studio.locator('[data-stage]')).toHaveAttribute('data-stage', /^(?:ready|failed|recoverable)$/u)
      assert.deepEqual(report.fixtureErrors, [])
      await expect(studio.locator('[data-stage]')).toHaveAttribute('data-stage', 'ready')
      await expect.poll(async () => (await storedWorkspace(page)).artifacts.find((artifact) => artifact.projectId === snapshot.id)?.proof.revision).toBe(snapshot.revision)
      const fixture = [...pdfs.values()].at(-1)
      const retained = (await storedWorkspace(page)).artifacts.find((artifact) => artifact.projectId === snapshot.id)
      assert.deepEqual(Buffer.from(retained.proof.data), fixture.bytes)
      assert.equal(retained.proof.snapshotHash, fixture.result.snapshotHash)
      assertSourceAndAssets(retained.snapshot, Object.fromEntries(snapshot.files.map((file) => [file.path, file.content])), assets, snapshot.mainFile)
      await expect(studio.locator('#resume-latex-proof-pane [data-ready="true"]')).toBeVisible()
      await expect(studio.locator('[aria-label="Selectable text on PDF page 1"]')).toContainText('NOT TeX output')
      assert.deepEqual(await downloaded(page, () => studio.getByRole('button', { name: 'Download PDF', exact: true }).click(), filename), fixture.bytes)
      assert.equal(hash(fixture.bytes), retained.proof.pdf.sha256)
      return fixture
    }

    if (!altaCvOnly) {
    report.stage = 'Regular isolation'
    await page.goto(new URL('/mr-resume', baseURL).href, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: 'Open Regular editor' }).click()
    const regular = page.getByRole('region', { name: 'Regular resume editor', exact: true })
    await expect(regular.locator('[data-editor-language]')).toBeVisible()
    await regular.focus()
    await regular.press('Control+Enter')
    await expect(studio).toHaveCount(0)
    assert.deepEqual(report.apiRequests, [], 'Opening Regular contacted the LaTeX compiler API.')
    assert.equal((await page.evaluate(() => indexedDB.databases())).some((database) => database.name === 'mr-resume:latex:v1'), false)
    await noCompile(0)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openStudio()
    const initialId = await projectSelect.inputValue()
    const initialStore = await storedWorkspace(page)
    const initialProject = initialStore.projects.find((project) => project.id === initialId)

    report.stage = 'ambiguous ZIP import and exact source export'
    const imported = await importArchive(archive, 'ambiguous-template.zip')
    assert.notEqual(imported.id, initialId)
    assertSourceAndAssets(imported, originalSources, assets, null)
    await expect(mainSelect).toHaveValue('')
    await expect(mainSelect.locator('option:checked')).toHaveText('Not selected (choose later)')
    await expect(rail.locator('[data-main="true"]')).toHaveCount(0)
    await expect(studio.getByRole('tablist', { name: 'Source files' }).getByText('Main', { exact: true })).toHaveCount(0)
    await expect(studio.getByRole('tab')).toHaveCount(Object.keys(originalSources).length)
    for (const file of Object.keys(originalSources)) {
      await expect(rail.locator(`button[title="${file}"]`)).toBeEnabled()
      await rail.locator(`button[title="${file}"]`).click()
      await expect(studio.locator(`[role="tab"][title="${file}"]`)).toHaveAttribute('aria-selected', 'true')
      await sourceTab(file)
      await expect(editor).toContainText(originalSources[file].match(/ZIP_IMPORT_[A-Z_]+/u)[0])
    }
    for (const file of Object.keys(assets)) {
      const asset = rail.locator(`button[title="${file}"]`)
      await asset.click()
      await expect(asset).toHaveAttribute('aria-current', 'true')
    }
    const tabs = studio.getByRole('tab')
    await tabs.first().focus()
    await tabs.first().press('ArrowRight')
    await expect(tabs.nth(1)).toBeFocused()
    await tabs.nth(1).press('Enter')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await tabs.nth(1).press('End')
    await expect(tabs.last()).toBeFocused()
    await tabs.last().press('Enter')
    await tabs.last().press('Home')
    await expect(tabs.first()).toBeFocused()
    await tabs.first().press('Enter')
    await assertSourceZip(await exportSource('original-source.zip'), imported, originalSources, assets, null)
    await expect(compile).toBeDisabled()
    await expect(studio.getByRole('button', { name: 'Compile now', exact: true })).toBeDisabled()
    await editor.focus()
    await editor.press('Control+Enter')
    await expect(studio.getByRole('status').filter({ hasText: 'Choose any .tex file as main' })).toBeVisible()
    await studio.getByLabel('LaTeX project title', { exact: true }).press('Control+Enter')
    await expect(studio.locator('[data-stage]')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The real Auto Compile debounce is 1.8s; a zero-request assertion needs that window.
    await page.waitForTimeout(2200)
    await noCompile(0)

    report.stage = 'null draft edit, save, clone, checkpoint and manifest roundtrip'
    const sources = { ...originalSources }
    await sourceTab('template/sections/body.tex')
    await editor.focus()
    await editor.press('Control+End')
    await page.keyboard.insertText('% UI_EDIT: retained while main is unresolved')
    sources['template/sections/body.tex'] += '% UI_EDIT: retained while main is unresolved'
    const editedOriginal = await save()
    assertSourceAndAssets(editedOriginal, sources, assets, null)
    await studio.locator('summary[aria-label="Projects and source templates"]').click()
    await studio.locator('details[data-latex-menu][open]').getByRole('button', { name: 'Duplicate current project', exact: true }).click()
    let draft = await save()
    assert.notEqual(draft.id, imported.id)
    assertSourceAndAssets(draft, sources, assets, null)
    draft = await newFile('main.tex', rootSource)
    sources['main.tex'] = rootSource
    assertSourceAndAssets(draft, sources, assets, null)
    await expect(mainSelect).toHaveValue('')
    await exportSummary.click()
    await studio.locator('details[data-latex-menu][open]').getByRole('button', { name: 'Create checkpoint', exact: true }).click()
    await expect(studio.getByRole('status').filter({ hasText: 'Checkpoint committed' })).toBeVisible()
    const manual = (await storedWorkspace(page)).checkpoints.find((checkpoint) => checkpoint.project.id === draft.id && checkpoint.label === 'Manual checkpoint')
    assert.ok(manual)
    assertSourceAndAssets(manual.project, sources, assets, null)
    await studio.locator('#resume-latex-build-tab-history').click()
    const history = studio.getByRole('region', { name: 'Project history details', exact: true })
    const checkpoint = history.locator('li').filter({ has: page.getByText('Manual checkpoint', { exact: true }) })
    await expect(checkpoint).toHaveCount(1)
    await expect(checkpoint.getByRole('button', { name: 'ZIP', exact: true })).toBeVisible()
    await assertSourceZip(await downloaded(page, () => checkpoint.getByRole('button', { name: 'ZIP', exact: true }).click(), 'checkpoint-null-source.zip'), draft, sources, assets, null)
    await studio.locator('#resume-latex-build-tab-history').click()
    const nullZip = await exportSource('null-draft-source.zip')
    const nullManifest = await assertSourceZip(nullZip, draft, sources, assets, null)
    const roundtrip = await importArchive(nullZip, 'null-draft-roundtrip.zip')
    assert.notEqual(roundtrip.id, draft.id)
    assertSourceAndAssets(roundtrip, sources, assets, null)
    assert.deepEqual(roundtrip.files, draft.files)
    assert.deepEqual(roundtrip.assets, draft.assets)
    assert.equal(nullManifest.mainFile, null, 'A conventional main.tex must not override explicit null.')
    await reloadStudio(roundtrip.id)
    let current = (await storedWorkspace(page)).projects.find((project) => project.id === roundtrip.id)
    assertSourceAndAssets(current, sources, assets, null)
    assertSourceAndAssets((await storedWorkspace(page)).checkpoints.find((item) => item.id === manual.id).project, sources, assets, null)
    await assertSourceZip(await exportSource('null-reloaded-source.zip'), current, sources, assets, null)
    await captureMainState('null-main', null)
    await nativeRuntime()
    await settings.click()
    await expect(studio.getByRole('checkbox', { name: 'Auto Compile', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await editor.focus()
    await editor.press('Control+Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(studio.locator('[data-stage]')).toHaveCount(0)
    await noCompile(0)

    report.stage = 'existing main selection and consented native transport'
    await showPanel('files')
    assert.deepEqual(await mainSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)), ['', ...Object.keys(sources).filter((file) => file.endsWith('.tex'))])
    await mainSelect.selectOption('template/cv.tex')
    await sourceTab('template/sections/body.tex')
    await expect(mainSelect).toHaveValue('template/cv.tex')
    await expect(rail.locator('[data-main="true"]')).toHaveCount(1)
    await expect(rail.locator('button[title="template/cv.tex"] [data-main="true"]')).toHaveText('Main')
    current = await save()
    assertSourceAndAssets(current, sources, assets, 'template/cv.tex')
    await expect(compile).toBeEnabled()
    await compile.click()
    await expect(page.getByRole('dialog', { name: 'Compile with the private runtime', exact: true })).toBeVisible()
    assert.equal(posts(), 0)
    await page.keyboard.press('Escape')
    await expect(compile).toBeFocused()
    const cvFixture = await compileSelected(current, 'cv-transport-fixture.pdf')
    const cvAttempt = await studio.locator('[data-stage]').textContent()
    await noCompile(1)

    report.stage = 'unresolved Auto Compile guard and arbitrary new main'
    await settings.click()
    await studio.getByRole('checkbox', { name: 'Auto Compile', exact: true }).check()
    await page.keyboard.press('Escape')
    await mainSelect.selectOption('')
    await sourceTab('template/sections/body.tex')
    await editor.focus()
    await editor.press('Control+End')
    await page.keyboard.insertText('; UI_AUTO_GUARD: no selected entry')
    sources['template/sections/body.tex'] += '; UI_AUTO_GUARD: no selected entry'
    current = await save()
    assertSourceAndAssets(current, sources, assets, null)
    await editor.press('Control+Enter')
    await page.waitForTimeout(2200)
    await noCompile(1)
    await expect(studio.locator('[data-stage]')).toHaveAttribute('data-stage', 'ready')
    await expect(studio.locator('[data-stage]')).toHaveText(cvAttempt)
    await settings.click()
    const auto = studio.getByRole('checkbox', { name: 'Auto Compile', exact: true })
    await expect(auto).toBeChecked()
    await auto.uncheck()
    await expect(auto).toBeDisabled()
    await page.keyboard.press('Escape')
    assert.deepEqual(await downloaded(page, () => studio.getByRole('button', { name: 'Download PDF', exact: true }).click(), 'retained-cv-transport-fixture.pdf'), cvFixture.bytes)
    current = await newFile(customPath, customSource)
    sources[customPath] = customSource
    assertSourceAndAssets(current, sources, assets, null)
    await showPanel('files')
    const actions = studio.getByRole('button', { name: `Actions for ${customPath}`, exact: true })
    await actions.focus()
    await actions.press('Enter')
    const popup = page.getByRole('group', { name: `Actions for ${customPath}`, exact: true })
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(actions).toBeFocused()
    await actions.press('Enter')
    await popup.getByRole('button', { name: 'Set as main', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(popup).not.toBeVisible()
    await expect(actions).toBeFocused()
    await expect(mainSelect).toHaveValue(customPath)
    current = await save()
    assertSourceAndAssets(current, sources, assets, customPath)
    await reloadStudio(current.id)
    current = (await storedWorkspace(page)).projects.find((project) => project.id === current.id)
    assertSourceAndAssets(current, sources, assets, customPath)
    await expect(mainSelect).toHaveValue(customPath)
    await assertSourceZip(await exportSource('selected-main-source.zip'), current, sources, assets, customPath)
    await exportSummary.click()
    assert.deepEqual(await downloaded(page, () => studio.getByRole('button', { name: 'Main source (.tex)', exact: true }).click(), 'custom-entry.tex'), Buffer.from(customSource, 'utf8'))
    await nativeRuntime()
    await captureMainState('selected-main', customPath)
    await sourceTab('template/sections/body.tex')
    await expect(mainSelect).toHaveValue(customPath)
    const chosenFixture = await compileSelected(current, 'custom-main-transport-fixture.pdf')

    report.stage = 'retained proof and project isolation after reload'
    await reloadStudio(current.id)
    await expect(mainSelect).toHaveValue(customPath)
    await expect(studio.locator('#resume-latex-proof-pane [data-state="current"]')).toBeVisible()
    await expect(studio.locator('#resume-latex-proof-pane [data-ready="true"]')).toBeVisible()
    assert.deepEqual(await downloaded(page, () => studio.getByRole('button', { name: 'Download PDF', exact: true }).click(), 'reloaded-custom-main-transport-fixture.pdf'), chosenFixture.bytes)
    const finalStore = await storedWorkspace(page)
    assert.equal(finalStore.projects.length, initialStore.projects.length + 3)
    assert.deepEqual(finalStore.projects.find((project) => project.id === initialId), initialProject, 'Import changed the pre-existing independent project.')
    assert.deepEqual(finalStore.assets.filter((asset) => asset.projectId === initialId), initialStore.assets.filter((asset) => asset.projectId === initialId), 'Import changed the pre-existing project assets.')
    assert.deepEqual(finalStore.projects.find((project) => project.id === imported.id), editedOriginal, 'Editing the clone changed the original imported project.')
    assertSourceAndAssets(finalStore.projects.find((project) => project.id === draft.id), { ...originalSources, 'template/sections/body.tex': editedOriginal.files.find((file) => file.path === 'template/sections/body.tex').content, 'main.tex': rootSource }, assets, null)
    assertSourceAndAssets(finalStore.projects.find((project) => project.id === current.id), sources, assets, customPath)
    for (const asset of finalStore.assets) assert.equal(asset.storedHash, asset.sha256, 'The stored original image checksum disagrees with its blob.')
    const retained = finalStore.artifacts.find((artifact) => artifact.projectId === current.id)
    assert.equal(retained.snapshot.mainFile, customPath)
    assertSourceAndAssets(retained.snapshot, sources, assets, customPath)
    assert.deepEqual(Buffer.from(retained.proof.data), chosenFixture.bytes)
    await noCompile(2)
    assert.deepEqual(report.compiles.map((compile) => compile.mainFile), ['template/cv.tex', customPath])
    assert.equal(report.apiRequests.filter((request) => request.path.startsWith(`${api}artifacts/`)).length, 2, 'Reload fetched a proof again instead of using its committed original bytes.')
    assert.ok(report.workerTraffic.some((event) => event.direction === 'send' && event.action === 'import'), 'No actual archive import worker ran.')
    assert.ok(report.workerTraffic.some((event) => event.direction === 'receive' && event.hasSource && event.mainFile === null), 'The archive worker never returned an explicit-null draft.')
    assert.ok(report.workerTraffic.some((event) => event.direction === 'send' && event.action === 'export'), 'No actual archive export worker ran.')
    assert.deepEqual(report.fixtureErrors, [])
    } else {
      await page.goto(new URL('/mr-resume', baseURL).href, { waitUntil: 'domcontentloaded' })
      await openStudio()
    }
    report.stage = 'Actual AltaCV browser-compatible copy'
    const beforeAlta = await storedWorkspace(page)
    const altaArchive = await readFile(new URL('../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url))
    const originalZip = await JSZip.loadAsync(altaArchive, { checkCRC32: true })
    const altaSources = {}, altaAssets = {}
    for (const entry of Object.values(originalZip.files).filter((entry) => !entry.dir)) {
      const bytes = await entry.async('nodebuffer')
      if (/\.png$/iu.test(entry.name)) altaAssets[entry.name] = { mediaType: 'image/png', bytes }
      else { altaSources[entry.name] = bytes.toString('utf8'); assert.deepEqual(Buffer.from(altaSources[entry.name], 'utf8'), bytes) }
    }
    assert.equal(Object.keys(altaSources).length, 10)
    assert.equal(Object.keys(altaAssets).length, 3)
    sourceMarkers.push(...Object.values(altaSources).flatMap((source) => (source.match(/[A-Za-z][A-Za-z ,.'-]{24,64}/gu) || []).slice(0, 2).map((text) => Buffer.from(text))))
    let altaOriginal = await importArchive(altaArchive, 'AltaCV_Template.zip')
    assertSourceAndAssets(altaOriginal, altaSources, altaAssets, null)
    await assertSourceZip(await exportSource('actual-altacv-original-source.zip'), altaOriginal, altaSources, altaAssets, null)
    altaOriginal = await setMain('sample.tex')
    assertSourceAndAssets(altaOriginal, altaSources, altaAssets, 'sample.tex')
    const altaOriginalId = altaOriginal.id
    const nativeBeforeAlta = posts()
    await studio.getByRole('button', { name: 'Create browser-compatible copy', exact: true }).click()
    await expect(studio.getByRole('status').filter({ hasText: 'Browser-compatible AltaCV copy created' })).toBeVisible()
    const altaCopyId = await projectSelect.inputValue()
    assert.notEqual(altaCopyId, altaOriginalId)
    const altaCopy = await save()
    for (const originalFile of altaOriginal.files) assert.deepEqual(altaCopy.files.find((file) => file.path === originalFile.path), originalFile)
    assert.deepEqual(altaCopy.assets, altaOriginal.assets)
    assert.equal(altaCopy.templateVersion, 2)
    assert.equal(altaCopy.engine, 'pdflatex')
    const copySources = Object.fromEntries(altaCopy.files.map((file) => [file.path, file.content]))
    assert.ok(Object.values(copySources).some((source) => source.includes('\u015f')))
    await expect(studio).toHaveAttribute('data-compiler-runtime', 'browser')
    await expect(compile).toBeEnabled()
    await compile.click()
    await localProof(altaCopy, 'actual-altacv-browser.pdf')
    assert.equal(posts(), nativeBeforeAlta, 'The browser copy must not use the private compiler')
    assert.deepEqual((await storedWorkspace(page)).projects.find((project) => project.id === altaOriginalId), altaOriginal)
    await page.screenshot({ path: path.join(artifactDir, 'actual-altacv-browser-pdf.png'), fullPage: true })
    report.altaCvBrowserCopy = { original: altaOriginalId, copy: altaCopyId, main: altaCopy.mainFile, nativeUploads: 0 }
    report.stage = 'Re-import and repair existing AltaCV_Template (1) copy ZIP'
    const exportedAlta = await exportSource('actual-altacv-exported-copy.zip')
    await assertSourceZip(exportedAlta, altaCopy, copySources, altaAssets, altaCopy.mainFile)
    const legacyZip = await JSZip.loadAsync(exportedAlta)
    const legacyManifest = JSON.parse(await legacyZip.file('smilepdf-project.json').async('string'))
    legacyManifest.engine = 'lualatex'; legacyManifest.templateVersion = 1
    const legacyMain = await legacyZip.file(legacyManifest.mainFile).async('string')
    const stylePath = legacyManifest.mainFile.replace(/[^/]+$/, 'altacv-browser.sty')
    const legacyStyle = (await legacyZip.file(stylePath).async('string')).replace('support, version 2.', 'support, version 1.').replace(/% SmilePDF managed fonts v2:[\s\S]*?\\fi\n/u, '')
    const oldMain = legacyMain.replace('\\usepackage{geometry}', '\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage{geometry}')
    assert.notEqual(oldMain, legacyMain)
    assert.notEqual(legacyStyle, await legacyZip.file(stylePath).async('string'))
    assert.doesNotMatch(legacyStyle, /SmilePDF managed fonts v2/u)
    legacyZip.file(legacyManifest.mainFile, oldMain); legacyZip.file(stylePath, legacyStyle)
    legacyZip.file('smilepdf-project.json', JSON.stringify(legacyManifest))
    const legacyArchive = await legacyZip.generateAsync({ type: 'nodebuffer' })
    await writeFile(path.join(artifactDir, 'AltaCV_Template (1) copy.zip'), legacyArchive)
    const checkpointsBeforeImport = (await storedWorkspace(page)).checkpoints
    const importedCopy = await importArchive(legacyArchive, 'AltaCV_Template (1) copy.zip', legacyManifest.mainFile)
    assert.equal(importedCopy.engine, 'lualatex'); assert.equal(importedCopy.templateVersion, 1)
    const legacySources = { ...copySources, [legacyManifest.mainFile]: oldMain, [stylePath]: legacyStyle }
    assertSourceAndAssets(importedCopy, legacySources, altaAssets, legacyManifest.mainFile)
    assert.deepEqual(importedCopy.files.map(({ id, path }) => ({ id, path })), legacyManifest.files)
    assert.deepEqual((await storedWorkspace(page)).checkpoints, checkpointsBeforeImport, 'Import repaired/checkpointed source before an explicit compile.')
    const originalBody = oldMain.slice(oldMain.indexOf('\\begin{document}'))
    await expect(compile).toBeEnabled()
    await compile.click()
    await expect.poll(async () => (await storedWorkspace(page)).projects.find((project) => project.id === importedCopy.id)?.revision).toBe(importedCopy.revision + 1)
    const repairedCopy = await save()
    assert.equal(repairedCopy.id, importedCopy.id)
    assert.equal(repairedCopy.revision, importedCopy.revision + 1)
    assert.equal(repairedCopy.templateVersion, 2)
    assert.equal(repairedCopy.engine, 'lualatex')
    assert.equal(repairedCopy.files.find((file) => file.path === repairedCopy.mainFile).content.slice(repairedCopy.files.find((file) => file.path === repairedCopy.mainFile).content.indexOf('\\begin{document}')), originalBody)
    for (const file of altaOriginal.files) assert.deepEqual(repairedCopy.files.find((item) => item.path === file.path), file)
    assert.deepEqual(repairedCopy.assets, altaOriginal.assets)
    for (const file of importedCopy.files) if (![importedCopy.mainFile, stylePath].includes(file.path)) assert.deepEqual(repairedCopy.files.find((item) => item.path === file.path), file)
    assert.match(repairedCopy.files.find((file) => file.path === stylePath).content, /SmilePDF managed fonts v2/u)
    const repairedProof = await localProof(repairedCopy, 'reimported-altacv-copy-repaired.pdf')
    const repairedWorkspace = await storedWorkspace(page)
    const repairCheckpoints = repairedWorkspace.checkpoints.filter((checkpoint) => checkpoint.project.id === repairedCopy.id && /^Before AltaCV font repair r/u.test(checkpoint.label))
    assert.equal(repairCheckpoints.length, 1, 'Repair created zero or multiple canonical checkpoints.')
    assert.equal(repairCheckpoints[0].label, `Before AltaCV font repair r${importedCopy.revision}`)
    assert.deepEqual(repairCheckpoints[0].project, importedCopy, 'The repair checkpoint did not preserve the exact v1 snapshot and image hashes.')
    assert.deepEqual(repairedWorkspace.projects.find((project) => project.id === altaOriginalId), altaOriginal, 'Repair overwrote the independent original AltaCV project.')
    assert.deepEqual(repairedWorkspace.projects.find((project) => project.id === altaCopy.id), altaCopy, 'Repair overwrote the exported v2 copy.')
    for (const project of beforeAlta.projects) assert.deepEqual(repairedWorkspace.projects.find((item) => item.id === project.id), project, 'AltaCV changed an unrelated pre-existing project.')
    for (const asset of repairedWorkspace.assets) assert.equal(asset.storedHash, asset.sha256)
    await studio.locator('#resume-latex-build-tab-history').click()
    const repairHistory = studio.getByRole('region', { name: 'Project history details', exact: true }).locator('li').filter({ has: page.getByText(repairCheckpoints[0].label, { exact: true }) })
    await assertSourceZip(await downloaded(page, () => repairHistory.getByRole('button', { name: 'ZIP', exact: true }).click(), 'legacy-before-font-repair-checkpoint.zip'), importedCopy, legacySources, altaAssets, importedCopy.mainFile)
    await studio.locator('#resume-latex-build-tab-history').click()
    await assertSourceZip(await exportSource('repaired-altacv-source.zip'), repairedCopy, Object.fromEntries(repairedCopy.files.map((file) => [file.path, file.content])), altaAssets, repairedCopy.mainFile)
    assert.equal(posts(), nativeBeforeAlta)
    assert.deepEqual(report.privateUploads.slice(nativeBeforeAlta), [], 'Actual AltaCV import/export/compile made a private API POST.')
    assert.deepEqual(report.sourceLeaks, [])
    await drainWorkers()
    const localCompiles = report.workerTraffic.filter((event) => event.name === 'mr-resume-local-tex' && event.direction === 'send' && event.action === 'compile')
    assert.deepEqual(localCompiles.map((event) => event.engine), ['pdflatex', 'lualatex'])
    for (const event of localCompiles) { assert.equal(event.mainFile, altaCopy.mainFile); assert.deepEqual([...event.paths].sort(), [...Object.keys(copySources), ...Object.keys(altaAssets)].sort()) }
    assert.equal(report.workerTraffic.filter((event) => event.name === 'mr-resume-local-tex' && event.direction === 'receive' && event.action === 'result' && event.exitCode === 0 && event.pdfBytes > 0).length, 2)
    report.assetFetches = await page.evaluate(() => window.__latexFetchProbe)
    const metadata = report.assetFetches.find((request) => request.url.includes('manifest.json?profile='))
    assert.ok(metadata)
    assert.equal(metadata.cache, 'no-cache')
    assert.equal(metadata.credentials, 'omit')
    const profileVersion = 'browser-busytex-v1-tl2023-4499aa69-r4'
    assert.equal(new URL(metadata.url, baseURL).searchParams.get('profile'), profileVersion)
    for (const result of report.actualCompiles) assert.equal(result.profileVersion, profileVersion)
    const publicManifest = JSON.parse(await readFile(new URL('../../../public/mr-resume/latex/busytex-v1/manifest.json', import.meta.url), 'utf8'))
    const workerHash = publicManifest.assets.find((asset) => asset.path === 'compiler-worker.js').sha256
    const bootstraps = report.assetFetches.filter((request) => request.url.includes('compiler-worker.js?sha256='))
    assert.equal(bootstraps.length, 2)
    for (const request of bootstraps) { assert.equal(request.cache, 'force-cache'); assert.equal(request.credentials, 'omit'); assert.equal(new URL(request.url, baseURL).searchParams.get('sha256'), workerHash); assert.equal(request.method, 'GET') }
    assert.deepEqual(report.pageErrors, [])
    await page.screenshot({ path: path.join(artifactDir, 'reimported-altacv-copy-repaired-pdf.png'), fullPage: true })
    report.altaCvImportedCopyRepair = { id: repairedCopy.id, engine: repairedCopy.engine, before: importedCopy.revision, after: repairedCopy.revision, nativeUploads: 0, originalSources: Object.keys(altaSources).length, originalAssets: Object.keys(altaAssets).length, checkpoint: repairCheckpoints[0].label, checkpointSnapshotPreserved: true, actualPdfHash: repairedProof.proof.pdf.sha256 }
    report.status = 'passed'
    console.log(`PASS: ${altaCvOnly ? 'AltaCV v1 ZIP imports unchanged; explicit local repair commits one revision and preserves originals/checkpoint; real pdfLaTeX and LuaLaTeX PDFs verified' : 'ZIP draft browser regression; native PDF fixture is not TeX output'}. Artifacts: ${artifactDir}`)
  } catch (error) {
    report.status = 'failed'
    report.failure = error.stack || String(error)
    process.exitCode = 1
    if (page && !page.isClosed()) {
      try { report.workerTraffic.push(...await page.evaluate(() => window.__latexZipProbe?.splice(0) || [])) } catch { /* Navigation or browser startup may have failed. */ }
      try { await page.screenshot({ path: path.join(artifactDir, 'failure.png'), timeout: 10_000 }) } catch (capture) { report.captureFailure = String(capture) }
    }
    console.error(`FAIL at ${report.stage}: ${report.failure}`)
  } finally {
    if (artifactReady) {
      try { await writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2)) }
      catch (error) { console.error(`Could not write browser regression report: ${error}`); process.exitCode = 1 }
    }
    if (browser) {
      try { await browser.close() } catch (error) { console.error(`Could not close Chromium: ${error}`); process.exitCode = 1 }
    }
  }
}

await main()
