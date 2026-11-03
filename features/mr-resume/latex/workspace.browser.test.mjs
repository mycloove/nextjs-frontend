// Run against a dev server: node features/mr-resume/latex/workspace.browser.test.mjs
// The compiler is a bounded HTTP fixture; the real editor, storage and PDF.js viewer run unchanged.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3101'
const artifacts = process.env.LATEX_UI_ARTIFACT_DIR || join(tmpdir(), 'kilo', 'latex-ui-verification')
await mkdir(artifacts, { recursive: true })
const sha = (data) => createHash('sha256').update(data).digest('hex')
const pdf = await PDFDocument.create()
for (const text of ['LaTeX proof UI fixture - page 1', 'LaTeX proof UI fixture - page 2']) pdf.addPage([595, 842]).drawText(text, { x: 50, y: 780, size: 16 })
const pdfBytes = Buffer.from(await pdf.save({ useObjectStreams: false }))
const limits = { files: 32, sourceBytes: 1048576, uploadBytes: 3145728, pdfBytes: 3145728, pages: 32, logBytes: 131072, syncBytes: 8388608, deadlineSeconds: 30 }
const results = []
const fixtures = []
const browser = await chromium.launch({ headless: true })
let page

function compileResult(manifest, assets) {
  const sort = (items) => [...items].sort((a, b) => {
    const left = Array.from(a.path, (letter) => letter.codePointAt(0)), right = Array.from(b.path, (letter) => letter.codePointAt(0))
    for (let index = 0; index < Math.min(left.length, right.length); index++) if (left[index] !== right[index]) return left[index] - right[index]
    return left.length - right.length
  })
  const snapshotHash = sha(JSON.stringify({ version: manifest.version, projectId: manifest.projectId, revision: manifest.revision, mainFile: manifest.mainFile, engine: manifest.engine, files: sort(manifest.files), assets: sort(assets) }))
  return { status: 'ready', operationKey: manifest.operationKey, projectId: manifest.projectId, revision: manifest.revision, snapshotHash, engine: manifest.engine, profileVersion: 'browser-fixture', pdf: { id: `artifact-${manifest.operationKey}`, sha256: sha(pdfBytes), bytes: pdfBytes.length, pages: 2 }, diagnostics: [], log: 'Browser fixture: two-page PDF artifact.\n', syncAvailable: true, createdAt: new Date().toISOString() }
}

async function compiler(context) {
  const state = { calls: 0, mode: 'ready', manifest: null, requests: [], uploads: [], markersAtUpload: [], operations: new Map(), heldCompiles: new Map(), heldRecoveries: new Map(), holdRecovery: new Set(), unexpected: [], errors: [] }
  fixtures.push(state)
  context.on('page', (target) => target.on('pageerror', (error) => state.errors.push(error.message)))
  await context.addInitScript(() => {
    window.__latexTestProofInputs = []
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, ...args) {
      // Observe the actual PDF.js input before its copy is transferred; never replace data or worker behavior.
      if (message?.action === 'GetDocRequest' && message.data?.data instanceof Uint8Array) window.__latexTestProofInputs.push(Array.from(message.data.data))
      return post.call(this, message, ...args)
    }
  })
  state.releaseCompile = (key, status = 'ready') => { state.operations.get(key).status = status; state.heldCompiles.get(key)?.(); state.heldCompiles.delete(key) }
  state.releaseRecovery = (key, status) => { if (status) state.operations.get(key).status = status; state.heldRecoveries.get(key)?.(); state.heldRecoveries.delete(key); state.holdRecovery.delete(key) }
  await context.route(/\/(?:api\/|mr-resume-latex(?:\/|$)|convert\/)/, async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== new URL(baseURL).origin || !url.pathname.startsWith('/api/mr-resume/latex/')) {
      state.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    }
    const action = url.pathname.split('/latex/')[1]
    state.requests.push({ method: request.method(), action, operationKey: request.headers()['x-resume-operation-key'] })
    const headers = { 'x-request-id': request.headers()['x-request-id'], 'cache-control': 'no-store' }
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: JSON.stringify(body) })
    if (action === 'capabilities') {
      assert.equal(request.method(), 'GET')
      return json({ enabled: true, ready: true, reason: 'Browser-test compiler fixture.', limits, profiles: ['lualatex', 'xelatex'].map((id) => ({ id, name: id === 'lualatex' ? 'LuaLaTeX' : 'XeLaTeX', version: 'browser-fixture', fonts: ['Latin Modern Roman'], packages: ['fontspec', 'geometry', 'hyperref'] })) })
    }
    if (action === 'compile') {
      assert.equal(request.method(), 'POST')
      state.calls++
      state.markersAtUpload.push((await storedWorkspace(request.frame())).stores.operations.find((record) => record.id === 'active'))
      const form = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData()
      const manifest = JSON.parse(String(form.get('manifest')))
      state.manifest = manifest
      const assets = []
      for (const asset of manifest.assets) assets.push({ ...asset, sha256: sha(Buffer.from(await form.get(`asset:${asset.id}`).arrayBuffer())) })
      const result = compileResult(manifest, assets), operation = { status: state.mode === 'hold' ? 'running' : state.mode, result }
      state.operations.set(manifest.operationKey, operation)
      state.uploads.push({ manifest, result })
      if (state.mode === 'failed') return json({ error: 'Fixture undefined control sequence.', code: 'tex_error', request_id: headers['x-request-id'], operationKey: manifest.operationKey, diagnostics: [{ severity: 'error', message: 'Fixture undefined control sequence.', file: manifest.mainFile, line: 3 }], log: '! Fixture undefined control sequence.\nl.3' }, 422)
      if (state.mode === 'hold') {
        await new Promise((resolve) => state.heldCompiles.set(manifest.operationKey, resolve))
        // Reload, Stop waiting and acknowledged cancel legitimately abort this held HTTP request.
        if (request.failure() || request.frame().isDetached() || request.frame().page().isClosed()) return
      }
      if (operation.status === 'cancelled') return json({ error: 'The captured operation was cancelled.', code: 'operation_cancelled', request_id: headers['x-request-id'], operationKey: manifest.operationKey }, 409)
      return json(result)
    }
    if (action.startsWith('operations/')) {
      assert.equal(request.method(), 'GET')
      assert.equal(request.postData(), null)
      const key = action.slice('operations/'.length)
      if (state.holdRecovery.has(key)) await new Promise((resolve) => state.heldRecoveries.set(key, resolve))
      const operation = state.operations.get(key)
      if (!operation || operation.httpStatus) return json({ error: 'The private operation is unavailable.', code: operation?.errorCode ?? 'operation_not_found', request_id: headers['x-request-id'], operationKey: key }, operation?.httpStatus ?? 404)
      return json(operation.status === 'ready' ? operation.result : { status: operation.status, operationKey: key, ...(operation.status === 'failed' ? { error: 'This captured operation failed.' } : {}) })
    }
    if (action === 'cancel') {
      assert.equal(request.method(), 'POST')
      const key = request.postDataJSON().operationKey, operation = state.operations.get(key)
      if (operation?.status === 'running') { operation.status = 'cancelled'; return json({ cancelled: true, status: 'cancelled' }) }
      return json({ cancelled: false, status: operation?.status ?? 'not_found' })
    }
    if (action.startsWith('artifacts/')) {
      assert.equal(request.method(), 'GET')
      const operation = [...state.operations.values()].find((operation) => operation.status === 'ready' && operation.result.pdf.id === action.slice('artifacts/'.length))
      assert.ok(operation, 'Nonready operations cannot return PDF bytes')
      return route.fulfill({ status: 200, headers: { ...headers, 'x-resume-pdf-sha256': sha(pdfBytes) }, contentType: 'application/pdf', body: operation.artifactBytes ?? pdfBytes })
    }
    if (action === 'sync') {
      assert.equal(request.method(), 'POST')
      const query = request.postDataJSON()
      return json({ available: true, file: state.manifest.mainFile, line: 3, locations: [{ page: 1, x: 50, y: 780, width: 150, height: 18 }] }, 200, { 'x-resume-snapshot-hash': query.snapshotHash, 'x-resume-pdf-sha256': query.pdfHash })
    }
    state.unexpected.push(`${request.method()} ${action}`)
    return route.abort('blockedbyclient')
  })
  return state
}

async function enterEditor(target, mode = 'LaTeX') {
  // A cold Next dev load can paint before its client bundle hydrates.
  await target.waitForFunction((value) => [...document.querySelectorAll('button')].some((button) => button.textContent.includes(`Open ${value} editor`) && Object.keys(button).some((key) => key.startsWith('__reactProps'))), mode, { timeout: 60000 })
  await target.getByRole('button', { name: `Open ${mode} editor`, exact: true }).click()
  if (mode === 'LaTeX') await expect(target.getByRole('textbox', { name: 'Editable project source', exact: true })).toBeVisible({ timeout: 60000 })
  else await expect(target.getByRole('region', { name: 'Regular resume editor', exact: true })).toBeVisible({ timeout: 60000 })
  // The dev-only launcher otherwise covers the Files navigation hit target on phones.
  // Runtime exceptions are still collected and fail the test below.
  await target.addStyleTag({ content: 'nextjs-portal { visibility: hidden !important; pointer-events: none !important; }' })
}

async function openEditor(target) {
  await target.goto(`${baseURL}/mr-resume`, { waitUntil: 'load', timeout: 120000 })
  await enterEditor(target)
}

async function storedWorkspace(target = page) {
  return target.evaluate(async () => {
    const opening = indexedDB.open('mr-resume:latex:v1')
    const database = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error) })
    const names = [...database.objectStoreNames], transaction = database.transaction(names, 'readonly')
    const committed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error) })
    const keyPaths = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name).keyPath]))
    const values = await Promise.all(names.map((name) => new Promise((resolve, reject) => {
      const reading = transaction.objectStore(name).getAll(); reading.onsuccess = () => resolve(reading.result); reading.onerror = () => reject(reading.error)
    })))
    await committed
    const version = database.version
    database.close()
    const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const describe = async (value) => {
      if (value instanceof Blob) return { type: value.type, bytes: value.size, sha256: await digest(await value.arrayBuffer()) }
      if (value instanceof ArrayBuffer) return { bytes: value.byteLength, sha256: await digest(value) }
      if (Array.isArray(value)) return Promise.all(value.map(describe))
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await describe(item)])))
      return value
    }
    return { version, keyPaths, stores: Object.fromEntries(await Promise.all(names.map(async (name, index) => [name, await describe(values[index])]))) }
  })
}

function seededResult(project, operationKey) {
  const assets = project.assets.map(({ bytes, ...asset }) => ({ ...asset, size: bytes.length, sha256: sha(Buffer.from(bytes)) }))
  return compileResult({ ...project, projectId: project.id, operationKey }, assets)
}

async function seedSchemaOne(target, project) {
  await target.evaluate(async ({ project, proof, pdf }) => {
    const asset = ({ bytes, ...value }) => ({ ...value, blob: new Blob([Uint8Array.from(bytes)], { type: value.mediaType }) })
    const snapshot = { ...project, assets: project.assets.map(asset) }
    const refs = project.assets.map(({ bytes, ...value }, index) => ({ ...value, size: bytes.length, sha256: proof.assetHashes[index] }))
    const opening = indexedDB.open('mr-resume:latex:v1', 1)
    opening.onupgradeneeded = () => { for (const name of ['projects', 'assets', 'checkpoints', 'artifacts']) opening.result.createObjectStore(name, { keyPath: name === 'assets' ? 'key' : name === 'artifacts' ? 'projectId' : 'id' }) }
    const database = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error) })
    const transaction = database.transaction(['projects', 'assets', 'checkpoints', 'artifacts'], 'readwrite')
    const committed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error) })
    transaction.objectStore('projects').put({ storageVersion: 1, id: project.id, project: { ...snapshot, assets: refs } })
    project.assets.forEach((value, index) => transaction.objectStore('assets').put({ storageVersion: 1, key: `${project.id}:${value.id}`, projectId: project.id, asset: snapshot.assets[index], sha256: proof.assetHashes[index] }))
    const checkpoint = { id: 'schema-one-checkpoint', label: 'Schema1 original checkpoint', project: snapshot, createdAt: project.createdAt }
    transaction.objectStore('checkpoints').put({ storageVersion: 1, id: checkpoint.id, checkpoint })
    const result = { ...proof }; delete result.assetHashes
    transaction.objectStore('artifacts').put({ storageVersion: 1, projectId: project.id, proof: { ...result, data: Uint8Array.from(pdf).buffer }, snapshot })
    transaction.objectStore('projects').put({ storageVersion: 2, id: 'future-project', project: { ...snapshot, id: 'future-project', assets: [] }, future: 'original project metadata' })
    transaction.objectStore('assets').put({ storageVersion: 2, key: 'future-project:photo', projectId: 'future-project', asset: snapshot.assets[0], future: 'original image bytes' })
    transaction.objectStore('checkpoints').put({ storageVersion: 2, id: 'future-checkpoint', checkpoint, future: 'original checkpoint' })
    transaction.objectStore('artifacts').put({ storageVersion: 2, projectId: 'future-project', proof: { ...result, data: Uint8Array.from(pdf).buffer }, snapshot, future: 'original PDF bytes' })
    await committed
    database.close()
  }, { project, proof: { ...seededResult(project, 'schema-one-proof'), assetHashes: project.assets.map((asset) => sha(Buffer.from(asset.bytes))) }, pdf: [...pdfBytes] })
}

async function putPending(project, operationKey, changes = {}) {
  const record = { storageVersion: 1, id: 'active', intent: { operationKey, snapshot: project, snapshotHash: seededResult(project, operationKey).snapshotHash, createdAt: project.createdAt }, ...changes }
  await page.evaluate(async (record) => {
    record.intent.snapshot.assets = record.intent.snapshot.assets.map(({ bytes, ...asset }) => ({ ...asset, blob: new Blob([Uint8Array.from(bytes)], { type: asset.mediaType }) }))
    const opening = indexedDB.open('mr-resume:latex:v1')
    const database = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error) })
    const transaction = database.transaction('operations', 'readwrite')
    const committed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error) })
    transaction.objectStore('operations').put(record)
    await committed
    database.close()
  }, record)
}

async function compileExplicitly(needsConsent = false, target = page) {
  await target.getByRole('button', { name: /^Compile\s*Ctrl Enter$/ }).click()
  const privacy = target.getByRole('dialog', { name: 'Compile this source revision', exact: true })
  if (needsConsent || await privacy.isVisible()) {
    await expect(privacy).toBeVisible()
    await target.getByLabel('I understand that source and image assets are uploaded when I compile.').check()
    await target.getByRole('button', { name: 'Compile this revision', exact: true }).click()
  }
}

async function shot(name) {
  // Hide only the Next development indicator, not any product controls or status.
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true, animations: 'disabled', style: 'nextjs-portal { visibility: hidden; }' })
}

async function download(action) {
  const pending = page.waitForEvent('download')
  await action()
  const file = await pending
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
}

async function exportMenu() { await page.locator('summary[aria-label="Export and workspace actions"]').click() }

function settings(target = page) { return target.locator('summary[aria-label="Editor settings"]') }

async function fileActions(path) {
  await page.getByRole('button', { name: `Actions for ${path}`, exact: true }).click()
  return page.getByRole('group', { name: `Actions for ${path}`, exact: true })
}

async function mainSourceBytes() {
  await exportMenu()
  return (await download(() => page.getByRole('button', { name: 'Main source (.tex)', exact: true }).click())).bytes
}

async function chooseUpload(action, file) {
  const pending = page.waitForEvent('filechooser')
  await action()
  await (await pending).setFiles(file)
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
  const fixture = await compiler(context)
  page = await context.newPage()
  const imageBytes = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1, height: 1 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openEditor(page)
  const source = page.locator('.cm-content')
  const compile = page.getByRole('button', { name: /^Compile\s*Ctrl Enter$/ })
  await expect(compile).toBeEnabled({ timeout: 30000 })
  assert.equal(fixture.calls, 0, 'Opening source must not compile')

  await source.evaluate((element) => { element.dataset.retainedEditor = 'yes' })
  await page.getByRole('button', { name: 'Hide project files', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'LaTeX project files and source outline' })).toBeHidden()
  await page.getByRole('button', { name: 'Show project files', exact: true }).click()
  await expect(source).toHaveAttribute('data-retained-editor', 'yes')
  const separator = page.getByRole('separator', { name: 'Resize source and proof panes' })
  await separator.focus()
  await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '52')
  await separator.press('ArrowLeft')

  await page.getByRole('button', { name: 'New file', exact: true }).click()
  await page.getByLabel('Relative filename').fill('notes.tex')
  await page.getByLabel('Initial raw source').fill('\\section*{Notes}\nSource fixture.\n')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes.tex' })).toHaveAttribute('aria-selected', 'true')
  await source.press('Control+End')
  await source.pressSequentially('% RETAINED_EDIT')
  await expect(source).toContainText('RETAINED_EDIT')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(source).not.toContainText('RETAINED_EDIT')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(source).toContainText('RETAINED_EDIT')
  await page.getByRole('tab', { name: /^main.tex/ }).click()
  await page.getByRole('tab', { name: 'notes.tex' }).click()
  await expect(source).toContainText('RETAINED_EDIT')

  await settings().click()
  await page.getByLabel('Source font size').selectOption('16')
  await page.getByLabel('Source tab size').selectOption('4')
  await page.getByLabel('Wrap source lines').uncheck()
  await page.getByLabel('Source tab size').press('Escape')
  await expect(settings()).toBeFocused()
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '16px')
  await source.press('Control+End')
  await source.press('Enter')
  await source.press('Tab')
  await source.pressSequentially('% FOUR_SPACES')
  assert.equal(fixture.calls, 0, 'Editor settings and typing must stay local')
  results.push('Local editing, per-file undo, rail collapse, keyboard resize, font and indentation controls')

  await page.getByRole('button', { name: 'Find and replace', exact: true }).click()
  const search = page.locator('.cm-search input[name="search"]')
  await expect(search).toBeFocused()
  await search.fill('RETAINED_EDIT')
  await search.press('Escape')
  await page.getByRole('button', { name: 'Go to line', exact: true }).click()
  const line = page.getByRole('textbox', { name: 'Go to line:', exact: true })
  await expect(line).toBeFocused()
  await line.fill('2')
  await line.press('Enter')
  await expect(page.locator('output')).toContainText('Ln 2')
  await page.locator('summary[aria-label="Insert LaTeX snippet"]').click()
  await page.getByRole('button', { name: 'Bold text \\textbf', exact: true }).click()
  await expect(source).toContainText('\\textbf{')

  await (await fileActions('notes.tex')).getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Relative filename').fill('notes-renamed.tex')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes-renamed.tex' })).toBeVisible()
  await (await fileActions('notes-renamed.tex')).getByRole('button', { name: 'Set as main', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes-renamed.tex Main' })).toBeVisible()
  await page.getByRole('tab', { name: /^main.tex/ }).click()
  await (await fileActions('main.tex')).getByRole('button', { name: 'Set as main', exact: true }).click()
  await page.getByRole('button', { name: 'Fold all matched LaTeX environments', exact: true }).click()
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await page.getByRole('button', { name: 'Unfold all environments', exact: true }).click()
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)
  results.push('Find/replace and go-to-line focus, snippets, file rename/main selection, fold/unfold')

  await chooseUpload(() => page.getByRole('button', { name: 'Add file or image', exact: true }).click(), { name: 'photo.png', mimeType: 'image/png', buffer: imageBytes })
  await expect(page.getByRole('button', { name: /^photo.png/ })).toBeVisible()
  await page.getByRole('button', { name: /^photo.png/ }).click()
  const imageActions = await fileActions('photo.png')
  await expect(imageActions.getByRole('button', { name: 'Set as main', exact: true })).toHaveCount(0)
  await imageActions.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Relative filename').fill('portrait.png')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: /^portrait.png/ })).toBeVisible()
  await page.getByRole('tab', { name: /^main.tex/ }).click()

  await exportMenu()
  const archive = await download(() => page.getByRole('button', { name: /Complete source ZIP/ }).click())
  const zip = await JSZip.loadAsync(archive.bytes)
  assert.match(await zip.file('notes-renamed.tex').async('string'), /\n {4}% FOUR_SPACES/)
  assert.ok(zip.file('main.tex') && zip.file('resume.sty'), 'The source ZIP retains every source')
  assert.equal(sha(await zip.file('portrait.png').async('nodebuffer')), sha(imageBytes), 'Image rename/export keeps original bytes')
  await expect(page.getByRole('button', { name: /Complete source ZIP/ })).toBeHidden()

  await page.getByRole('button', { name: /^History \d+$/ }).click()
  const history = page.getByRole('region', { name: 'Project history details' })
  await history.getByRole('button', { name: 'Create checkpoint', exact: true }).click()
  await expect(history).toContainText('Manual checkpoint')
  await history.getByRole('button', { name: 'Restore...' }).first().click()
  await page.getByRole('button', { name: 'Restore as new revision', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Collapse build panel' }).click()
  results.push('Images upload/rename/export losslessly; portable source ZIP and checkpoint create/restore work')

  await compile.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  assert.equal(fixture.calls, 0, 'Compile must wait for the privacy acknowledgement')
  await page.getByLabel('I understand that source and image assets are uploaded when I compile.').check()
  await page.getByRole('button', { name: 'Compile this revision', exact: true }).click()
  await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('[aria-label="Selectable text on PDF page 1"]')).toContainText('LaTeX proof UI fixture')
  const original = await download(() => page.getByRole('button', { name: 'Download PDF', exact: true }).click())
  assert.equal(sha(original.bytes), sha(pdfBytes), 'Downloaded proof must retain the exact original bytes')
  await exportMenu()
  const log = await download(() => page.getByRole('button', { name: 'Build log (.log)', exact: true }).click())
  assert.match(log.bytes.toString(), /Browser fixture: two-page PDF artifact/)
  await page.getByLabel('PDF zoom').selectOption('page')
  await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible()
  await page.waitForFunction(() => {
    const sheet = document.querySelector('canvas[aria-label="Typeset PDF page 1 of 2"]')
    return sheet && sheet.getBoundingClientRect().height < 800
  })
  await page.getByRole('button', { name: 'Next PDF page' }).click()
  await expect(page.getByLabel('Typeset PDF page 2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Rotate PDF page clockwise' }).click()
  await expect(page.getByLabel('Typeset PDF page 2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Show line', exact: false }).click()
  await expect(page.getByLabel('Measured source position')).toBeVisible()
  await page.getByRole('button', { name: 'Rotate PDF page clockwise' }).click()
  await page.getByRole('button', { name: 'Rotate PDF page clockwise' }).click()
  await page.getByRole('button', { name: 'Rotate PDF page clockwise' }).click()
  await page.getByLabel('PDF zoom').selectOption('fit')
  results.push('Privacy gate, real PDF.js/text layer, page/zoom/rotation, measured map and original-byte download')

  await settings().click()
  await page.getByLabel('Source font size').selectOption('auto')
  await page.getByLabel('Wrap source lines').check()
  await page.getByLabel('Source font size').press('Escape')

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme)
    for (const [name, width, height] of [['desktop', 1600, 1000], ['laptop', 1280, 800], ['tablet', 1024, 768], ['mobile', 390, 844], ['narrow', 320, 740]]) {
      await page.setViewportSize({ width, height })
      if (width <= 900) await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Source', exact: true }).click()
      await expect(source).toBeVisible()
      assert.ok(await page.locator('body').evaluate((element) => element.scrollWidth <= innerWidth), `${theme}/${name}: no page overflow`)
      assert.ok((await source.boundingBox()).height >= 120, `${theme}/${name}: source has useful height`)
      if (width > 900) await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 30000 })
      await shot(`${theme}-${name}-source`)
      if (width <= 900) {
        await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Proof', exact: true }).click()
        await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 30000 })
        await shot(`${theme}-${name}-proof`)
        await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Files', exact: true }).click()
        await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeVisible()
        await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Build', exact: true }).click()
        await expect(page.getByRole('region', { name: 'Build details' })).toBeVisible()
        await shot(`${theme}-${name}-build`)
        await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Source', exact: true }).click()
      }
    }
  }
  results.push('Light/dark at 1600, 1280, 1024, 390 and 320px; mobile files/source/proof/build; reduced motion')

  await page.setViewportSize({ width: 1600, height: 1000 })
  await source.press('Control+End')
  await source.press('Enter')
  await source.pressSequentially('% STALE_PROOF')
  await expect(page.getByRole('button', { name: 'Show line', exact: false })).toBeDisabled()
  await expect(page.getByText('Its source maps are disabled.', { exact: false })).toBeVisible()
  fixture.mode = 'failed'
  await compile.click()
  await expect(page.getByRole('region', { name: 'Problems details' })).toContainText('Fixture undefined control sequence.')
  await shot('dark-error-and-retained-proof')
  const retained = await download(() => page.getByRole('button', { name: 'Download PDF', exact: true }).click())
  assert.equal(sha(retained.bytes), sha(pdfBytes), 'A failed build must not replace the last good proof')
  await context.setOffline(true)
  await expect(compile).toBeDisabled()
  await source.press('Control+End')
  await source.pressSequentially(' offline writing')
  await expect(source).toContainText('offline writing')
  await context.setOffline(false)
  assert.deepEqual(errors, [], 'No unhandled client runtime errors')
  results.push('Stale maps disabled, errors auto-open, last-good PDF retained and offline writing remains usable')

  await source.press('Control+s')
  await expect(page.locator('[role="status"][data-state="saved"]')).toContainText('Saved')
  // CodeMirror virtualizes offscreen lines; exports prove the complete canonical source.
  const savedSource = await mainSourceBytes(), callsBeforeReload = fixture.calls
  await openEditor(page)
  assert.equal(sha(await mainSourceBytes()), sha(savedSource), 'Reload retains the complete source bytes')
  await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 30000 })
  const recovered = await download(() => page.getByRole('button', { name: 'Download PDF', exact: true }).click())
  assert.equal(sha(recovered.bytes), sha(pdfBytes), 'Reload recovers the last committed original PDF')
  assert.equal(fixture.calls, callsBeforeReload, 'Draft/proof restoration never triggers compilation')
  results.push('Reload restores committed source and original PDF without compiling')

  await page.setViewportSize({ width: 390, height: 844 })
  await settings().click()
  await expect(page.getByLabel('Source font size')).toBeVisible()
  await page.getByLabel('Source font size').press('Escape')
  const projects = page.locator('summary[aria-label="Projects and source templates"]').locator('..')
  await projects.locator('summary').click()
  const originalId = await page.getByLabel('Select LaTeX project').inputValue()
  await projects.getByRole('button', { name: /^Academic CV v1 \/ LuaLaTeX$/ }).click()
  await expect(page.getByLabel('Select LaTeX project')).not.toHaveValue(originalId)
  await projects.locator('summary').click()
  assert.notEqual(await page.getByLabel('Select LaTeX project').inputValue(), originalId)
  await page.getByLabel('Select LaTeX project').selectOption(originalId)
  assert.equal(sha(await mainSourceBytes()), sha(savedSource), 'Creating a template leaves original writing untouched')
  await projects.locator('summary').click()
  await chooseUpload(() => projects.getByRole('button', { name: 'Import .tex / source ZIP', exact: true }).click(), { name: 'source-recovery.zip', mimeType: 'application/zip', buffer: archive.bytes })
  await expect(page.getByLabel('Select LaTeX project')).not.toHaveValue(originalId)
  await expect(page.getByRole('tab', { name: 'notes-renamed.tex' })).toBeVisible()
  assert.equal(sha(await mainSourceBytes()), sha(await zip.file('main.tex').async('nodebuffer')), 'Source ZIP import restores the archived source exactly')
  await projects.locator('summary').click()
  assert.notEqual(await page.getByLabel('Select LaTeX project').inputValue(), originalId)
  await page.getByLabel('Select LaTeX project').selectOption(originalId)
  assert.equal(sha(await mainSourceBytes()), sha(savedSource), 'Source ZIP import leaves original writing untouched')
  await exportMenu()
  await expect(page.getByRole('button', { name: /Complete source ZIP/ })).toBeVisible()
  const mobileArchive = await download(() => page.getByRole('button', { name: /Complete source ZIP/ }).click())
  const mobileZip = await JSZip.loadAsync(mobileArchive.bytes)
  assert.equal(sha(await mobileZip.file('portrait.png').async('nodebuffer')), sha(imageBytes))
  assert.equal(fixture.calls, callsBeforeReload, 'Templates, imports and project switching remain local')
  assert.deepEqual(errors, [], 'Persistence and mobile project actions have no unhandled runtime errors')
  results.push('Mobile settings/export/project menus, independent templates and source-ZIP imports retain original writing')

  await context.close()
  const regularContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const regularFixture = await compiler(regularContext)
  page = await regularContext.newPage()
  await page.goto(`${baseURL}/mr-resume`, { waitUntil: 'load' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Open Regular editor') && Object.keys(button).some((key) => key.startsWith('__reactProps'))))
  await page.getByRole('button', { name: 'Open Regular editor' }).click()
  await expect(page.getByRole('region', { name: 'Regular resume editor' })).toBeVisible()
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  assert.equal(regularFixture.calls, 0)
  await shot('unchanged-regular-editor')
  results.push('Regular editor still opens without mounting LaTeX or compiling')

  await page.getByRole('textbox', { name: 'Document title', exact: true }).fill('Original Regular draft stays separate')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mr-resume:draft:v1'))?.document.documentTitle)).toBe('Original Regular draft stays separate')
  const regularDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('mr-resume:draft:v1')).document)
  const seed = { version: 1, id: 'schema-one-project', title: 'Schema1 retained source', revision: 1, mainFile: 'main.tex', engine: 'lualatex',
    files: [{ id: 'main-source', path: 'main.tex', content: '\\documentclass{article}\r\n\\begin{document}\r\n% \u09ac\u09be\u0982\u09b2\u09be \u200d\u200c e\u0301\r\nOriginal captured writing.\r\n\\end{document}\r\n' }, { id: 'local-style', path: 'resume.sty', content: '% Original local style\r\n' }],
    assets: [{ id: 'original-image', path: 'photo.png', mediaType: 'image/png', bytes: [...imageBytes] }], templateId: null, templateVersion: null,
    createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z' }
  await page.goto(`${baseURL}/mr-resume`, { waitUntil: 'load' })
  await seedSchemaOne(page, seed)
  const legacy = await storedWorkspace()
  assert.equal(legacy.version, 1)
  assert.deepEqual(legacy.keyPaths, { artifacts: 'projectId', assets: 'key', checkpoints: 'id', projects: 'id' })
  await enterEditor(page)
  const upgraded = await storedWorkspace()
  assert.equal(upgraded.version, 2)
  assert.equal(upgraded.keyPaths.operations, 'id')
  for (const name of ['projects', 'assets', 'checkpoints', 'artifacts']) assert.deepEqual(upgraded.stores[name], legacy.stores[name], `Schema1 ${name} originals must survive the additive upgrade`)
  assert.deepEqual(upgraded.stores.operations, [])
  assert.equal(sha(await mainSourceBytes()), sha(Buffer.from(seed.files[0].content)), 'Schema1 Unicode/CRLF source remains exact')
  await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 30000 })
  await expect(page.getByLabel('Selectable text on PDF page 1')).toContainText('LaTeX proof UI fixture')
  assert.equal(regularFixture.calls, 0, 'Schema upgrade and retained-proof rendering are local')
  results.push('Native IndexedDB schema1 upgrade preserves every project/image/checkpoint/PDF and all invalid/future originals')

  regularFixture.mode = 'hold'
  await compileExplicitly(true)
  await expect.poll(() => regularFixture.uploads.length).toBe(1)
  const captured = regularFixture.uploads[0], key = captured.manifest.operationKey
  const pending = (await storedWorkspace()).stores.operations[0]
  assert.equal(pending.id, 'active')
  assert.equal(pending.storageVersion, 1)
  assert.equal(pending.intent.operationKey, key)
  assert.equal(pending.intent.snapshotHash, captured.result.snapshotHash)
  assert.equal(pending.intent.snapshot.files[0].content, seed.files[0].content)
  assert.deepEqual(regularFixture.markersAtUpload[0], pending, 'The complete immutable operation must be committed before the upload starts')
  const recoverySource = page.getByRole('textbox', { name: 'Editable project source', exact: true })
  await recoverySource.press('Control+End')
  await recoverySource.press('Enter')
  await recoverySource.pressSequentially('% LATEST_LOCAL_WRITING')
  await recoverySource.press('Control+s')
  await expect(page.locator('[role="status"][data-state="saved"]')).toContainText('Saved')
  const latestSource = await mainSourceBytes()
  assert.match(latestSource.toString(), /LATEST_LOCAL_WRITING/)
  assert.notEqual(sha(latestSource), sha(Buffer.from(seed.files[0].content)))
  await page.locator('summary[aria-label="Projects and source templates"]').click()
  await page.getByRole('button', { name: 'Remove current project...', exact: true }).click()
  await page.getByRole('button', { name: 'Remove project', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Remove a local project', exact: true })).toBeVisible()
  await expect(page.getByLabel('LaTeX workspace notices')).toContainText('Resolve or cancel')
  await page.getByRole('button', { name: 'Close LaTeX dialog', exact: true }).click()
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending)

  await page.reload({ waitUntil: 'load', timeout: 120000 })
  regularFixture.releaseCompile(key, 'running')
  await enterEditor(page)
  await expect(page.getByRole('button', { name: 'Recover operation', exact: true })).toBeVisible()
  assert.equal(sha(await mainSourceBytes()), sha(latestSource), 'Reload restores the latest local source, not the captured compile source')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending, 'Reload must keep the original operation key, source hash and creation time')
  assert.equal(regularFixture.requests.filter((request) => request.action.startsWith('operations/')).length, 0, 'Restoration must not poll the server')
  await settings().click()
  await expect(page.getByRole('checkbox', { name: 'Auto Compile', exact: true })).not.toBeChecked()
  await page.getByLabel('Source font size').press('Escape')
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="recoverable"]')).toContainText('still reports this operation as running')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending)
  assert.equal(regularFixture.requests.filter((request) => request.action.startsWith('artifacts/')).length, 0)
  // This quiet window exceeds the editor's 1.8s Auto Compile debounce and checks negative request behavior.
  await page.waitForTimeout(2100)
  assert.equal(regularFixture.calls, 1)
  assert.equal(regularFixture.requests.filter((request) => request.action === `operations/${key}`).length, 1, 'Running recovery is one query, not polling or retry')

  const pendingOperation = regularFixture.operations.get(key)
  pendingOperation.httpStatus = 503; pendingOperation.errorCode = 'upstream_unavailable'
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="recoverable"]')).toBeVisible()
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending, 'Temporary backend failure cannot clear an admitted operation')
  delete pendingOperation.httpStatus; delete pendingOperation.errorCode
  pendingOperation.status = 'ready'
  const originalSnapshotHash = pendingOperation.result.snapshotHash
  pendingOperation.result.snapshotHash = '0'.repeat(64)
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="recoverable"]')).toContainText('different source or asset snapshot')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending, 'Untrusted ready metadata must remain explicitly recoverable')
  assert.equal(regularFixture.requests.filter((request) => request.action.startsWith('artifacts/')).length, 0)
  pendingOperation.result.snapshotHash = originalSnapshotHash
  pendingOperation.artifactBytes = Buffer.from(pdfBytes)
  pendingOperation.artifactBytes[pendingOperation.artifactBytes.length - 1] ^= 1
  const inputsBeforeCorruptArtifact = await page.evaluate(() => window.__latexTestProofInputs.length)
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="recoverable"]')).toContainText('original-byte integrity check')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], pending, 'A bad recovered PDF cannot clear the original captured marker')
  assert.equal(await page.evaluate(() => window.__latexTestProofInputs.length), inputsBeforeCorruptArtifact, 'An unverified PDF must never enter the viewer')
  assert.equal((await storedWorkspace()).stores.artifacts.find((record) => record.projectId === seed.id).proof.operationKey, 'schema-one-proof')
  delete pendingOperation.artifactBytes

  const proofInputsBefore = await page.evaluate(() => window.__latexTestProofInputs.length)
  regularFixture.operations.get(key).status = 'ready'
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="ready"]')).toContainText('Typeset PDF ready for revision 1')
  await expect(page.getByLabel('Selectable text on PDF page 1')).toContainText('LaTeX proof UI fixture', { timeout: 30000 })
  await expect.poll(() => page.evaluate(() => window.__latexTestProofInputs.length)).toBeGreaterThan(proofInputsBefore)
  assert.equal(sha(Buffer.from(await page.evaluate(() => window.__latexTestProofInputs.at(-1)))), sha(pdfBytes), 'Actual PDF.js worker input equals the downloaded PDF bytes')
  const recoveredPendingPdf = await download(() => page.getByRole('button', { name: 'Download PDF', exact: true }).click())
  assert.equal(sha(recoveredPendingPdf.bytes), sha(pdfBytes))
  await expect.poll(async () => (await storedWorkspace()).stores.operations.length).toBe(0)
  const recoveredWorkspace = await storedWorkspace(), recoveredRecord = recoveredWorkspace.stores.artifacts.find((record) => record.projectId === seed.id)
  assert.equal(recoveredRecord.proof.operationKey, key)
  assert.equal(recoveredRecord.proof.snapshotHash, pending.intent.snapshotHash)
  assert.equal(recoveredRecord.proof.data.sha256, sha(pdfBytes))
  assert.equal(recoveredRecord.snapshot.files[0].content, seed.files[0].content)
  assert.equal(sha(await mainSourceBytes()), sha(latestSource), 'Ready recovery cannot roll newer writing back')
  await expect(page.getByRole('button', { name: /^Show line \d+ in proof$/ })).toBeDisabled()
  assert.equal(regularFixture.calls, 1, 'Reload and ready recovery must have exactly one total compile POST')
  assert.equal(regularFixture.requests.filter((request) => request.action === `operations/${key}`).length, 5)
  assert.equal(regularFixture.requests.filter((request) => request.action.startsWith('artifacts/')).length, 2)
  for (const request of regularFixture.requests.filter((request) => request.action.startsWith('operations/') || request.action.startsWith('artifacts/'))) assert.equal(request.method, 'GET')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Proof', exact: true }).click()
    await expect(page.getByLabel('Typeset PDF page 1 of 2')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Its source maps are disabled.', { exact: false })).toBeVisible()
    await shot(`${theme}-mobile-recovered-stale-proof`)
    await page.getByRole('navigation', { name: 'LaTeX workspace views' }).getByRole('button', { name: 'Source', exact: true }).click()
    await recoverySource.press('Control+End')
    await expect(recoverySource).toContainText('LATEST_LOCAL_WRITING')
    assert.ok(await page.locator('body').evaluate((element) => element.scrollWidth <= innerWidth))
    assert.ok((await recoverySource.boundingBox()).height >= 120)
  }
  results.push('Real reload during operation keeps latest writing; running has no polling; backend/hash/PDF failures keep recovery identity; ready GET-only recovery retains original source hash and identical PDF.js/download bytes with one total compile POST')

  await page.setViewportSize({ width: 1280, height: 900 })
  const artifactsBeforeTerminal = regularFixture.requests.filter((request) => request.action.startsWith('artifacts/')).length
  for (const [status, stage, httpStatus] of [['cancelled', 'cancelled'], ['failed', 'failed'], ['missing', 'failed', 404], ['expired', 'failed', 410]]) {
    const terminalKey = `terminal-operation-${status}`
    regularFixture.operations.set(terminalKey, { status, httpStatus, result: seededResult(seed, terminalKey) })
    await putPending(seed, terminalKey)
    await page.reload({ waitUntil: 'load' })
    await enterEditor(page)
    await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
    await expect(page.locator(`[role="status"][data-stage="${stage}"]`)).toBeVisible()
    await expect.poll(async () => (await storedWorkspace()).stores.operations.length).toBe(0)
    assert.equal(sha(await mainSourceBytes()), sha(latestSource))
    assert.equal(regularFixture.requests.filter((request) => request.action === `operations/${terminalKey}`).length, 1)
    assert.equal(regularFixture.requests.filter((request) => request.action.startsWith('artifacts/')).length, artifactsBeforeTerminal)
    assert.equal(regularFixture.calls, 1)
  }
  await page.waitForTimeout(2100)
  assert.equal(regularFixture.calls, 1, 'Known terminal or missing recovery never automatically recompiles')
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mr-resume:draft:v1')).document), regularDraft, 'All original Regular draft fields remain untouched')
  results.push('Cancelled/failed/404/410 recovery clears only its marker, never fetches artifacts or retries, and leaves the original Regular draft unchanged')

  const currentProject = (await storedWorkspace()).stores.projects.find((record) => record.id === seed.id).project
  const raceSeed = { ...currentProject, assets: seed.assets }
  const peer = await regularContext.newPage()
  await openEditor(peer)
  regularFixture.mode = 'hold'
  await compileExplicitly(true)
  await expect.poll(() => regularFixture.uploads.length).toBe(2)
  const oldKey = regularFixture.uploads[1].manifest.operationKey
  const oldPending = (await storedWorkspace()).stores.operations[0]
  await compileExplicitly(true, peer)
  await expect(peer.locator('[role="status"][data-stage="failed"]')).toContainText('Another pending compile is saved on this device')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], oldPending, 'Another active key cannot overwrite the retained operation or clear it on failure')
  assert.equal(regularFixture.calls, 2, 'A stale tab with another active key cannot upload new source')
  await peer.locator('summary[aria-label="Projects and source templates"]').click()
  await peer.getByRole('button', { name: 'Remove current project...', exact: true }).click()
  await peer.getByRole('button', { name: 'Remove project', exact: true }).click()
  await expect(peer.getByRole('dialog', { name: 'Remove a local project', exact: true })).toBeVisible()
  await expect(peer.getByLabel('LaTeX workspace notices')).toContainText('Recover or cancel the saved compile before removing its source project')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], oldPending, 'Native storage must block associated deletion even when this tab never restored that operation')
  await peer.getByRole('button', { name: 'Close LaTeX dialog', exact: true }).click()
  await peer.reload({ waitUntil: 'load' })
  await enterEditor(peer)
  regularFixture.holdRecovery.add(oldKey)
  await peer.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect.poll(() => regularFixture.heldRecoveries.has(oldKey)).toBe(true)
  await expect(peer.getByRole('button', { name: 'Stop waiting', exact: true })).toBeVisible()
  await expect(peer.getByRole('button', { name: 'Cancel on server', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel on server', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="cancelled"]')).toContainText('acknowledged cancellation')
  await expect.poll(async () => (await storedWorkspace()).stores.operations.length).toBe(0)
  regularFixture.releaseCompile(oldKey, 'cancelled')
  assert.equal(sha(await mainSourceBytes()), sha(latestSource), 'Acknowledged cancellation cannot restore older source')
  await compileExplicitly()
  await expect.poll(() => regularFixture.uploads.length).toBe(3)
  const newKey = regularFixture.uploads[2].manifest.operationKey
  const newerPending = (await storedWorkspace()).stores.operations[0]
  assert.notEqual(newKey, oldKey)
  assert.equal(newerPending.intent.operationKey, newKey)
  regularFixture.releaseRecovery(oldKey, 'cancelled')
  await expect(peer.locator('[role="status"][data-stage="cancelled"]')).toBeVisible()
  await expect(peer.getByRole('button', { name: /^Compile\s*Ctrl Enter$/ })).toBeEnabled()
  assert.deepEqual((await storedWorkspace()).stores.operations[0], newerPending, 'A late terminal response in another tab cannot clear the newer active key')
  await peer.close()
  await page.getByRole('button', { name: 'Stop waiting', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="recoverable"]')).toContainText('Server cancellation has not been acknowledged')
  assert.deepEqual((await storedWorkspace()).stores.operations[0], newerPending, 'Stop waiting keeps recovery identity')
  regularFixture.releaseCompile(newKey, 'ready')
  await page.reload({ waitUntil: 'load' })
  await enterEditor(page)
  await page.getByRole('button', { name: 'Recover operation', exact: true }).click()
  await expect(page.locator('[role="status"][data-stage="ready"]')).toBeVisible()
  await expect.poll(async () => (await storedWorkspace()).stores.operations.length).toBe(0)
  assert.equal(regularFixture.calls, 3, 'Only the three explicit compile clicks may POST; peer/reload recovery cannot replay them')
  assert.equal(sha(await mainSourceBytes()), sha(latestSource))
  results.push('Valid active-key CAS blocks stale-tab uploads and associated deletion; cancel preserves source; late peer cleanup cannot clear newer active keys; Stop waiting keeps reload recovery')

  await putPending(raceSeed, 'protected-future-operation', { storageVersion: 2, future: 'untouched future operation metadata' })
  const futureRecord = (await storedWorkspace()).stores.operations[0]
  await page.reload({ waitUntil: 'load' })
  await enterEditor(page)
  await expect(page.getByRole('button', { name: 'Recover operation', exact: true })).toHaveCount(0)
  await compileExplicitly(true)
  await expect(page.locator('[role="status"][data-stage="failed"]')).toBeVisible()
  assert.deepEqual((await storedWorkspace()).stores.operations[0], futureRecord, 'Future active records cannot be applied, overwritten or cleared after an attempted compile')
  assert.equal(regularFixture.calls, 3, 'Protected active-record conflicts stop source before upload')
  await page.locator('summary[aria-label="Projects and source templates"]').click()
  await page.getByRole('button', { name: /^Academic CV v1 \/ LuaLaTeX$/ }).click()
  await page.getByRole('textbox', { name: 'Editable project source', exact: true }).press('Control+s')
  await expect(page.locator('[role="status"][data-state="saved"]')).toContainText('Saved')
  await compileExplicitly()
  await expect(page.locator('[role="status"][data-stage="failed"]')).toBeVisible()
  const protectedWorkspace = await storedWorkspace()
  assert.deepEqual(protectedWorkspace.stores.operations[0], futureRecord)
  for (const name of ['projects', 'assets', 'checkpoints', 'artifacts']) {
    const field = name === 'assets' ? 'key' : name === 'artifacts' ? 'projectId' : 'id'
    for (const original of legacy.stores[name].filter((record) => record.storageVersion === 2)) assert.deepEqual(protectedWorkspace.stores[name].find((record) => record[field] === original[field]), original)
  }
  assert.equal(regularFixture.calls, 3)
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mr-resume:draft:v1')).document), regularDraft)
  results.push('Invalid/future storage originals remain byte-for-byte protected, and the global active marker cannot be overwritten by another project')
  await regularContext.close()
  for (const fixture of fixtures) {
    assert.deepEqual(fixture.unexpected, [], 'No unexpected backend requests may escape the feature HTTP fixture')
    assert.deepEqual(fixture.errors, [], 'No unhandled runtime errors in any tested page or peer tab')
    for (const [index, upload] of fixture.uploads.entries()) {
      assert.equal(fixture.markersAtUpload[index]?.intent.operationKey, upload.manifest.operationKey)
      assert.equal(fixture.markersAtUpload[index]?.intent.snapshotHash, upload.result.snapshotHash)
    }
  }
  results.push('All browser source uploads had their exact operation/hash marker committed first; no unexpected backend requests or runtime exceptions')
  console.log(JSON.stringify({ passed: results, artifacts }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) {
    await shot('failure').catch(() => {})
  }
  console.error(error.stack || error)
  console.error(JSON.stringify({ completed: results, failureScreenshot: join(artifacts, 'failure.png') }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
