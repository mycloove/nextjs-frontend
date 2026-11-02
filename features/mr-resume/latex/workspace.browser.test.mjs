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
const browser = await chromium.launch({ headless: true })
let page

async function compiler(context) {
  const state = { calls: 0, mode: 'ready', manifest: null }
  await context.route('**/api/mr-resume/latex/**', async (route) => {
    const request = route.request(), action = new URL(request.url()).pathname.split('/latex/')[1]
    const headers = { 'x-request-id': request.headers()['x-request-id'], 'cache-control': 'no-store' }
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: JSON.stringify(body) })
    if (action === 'capabilities') return json({ enabled: true, ready: true, reason: 'Browser-test compiler fixture.', limits, profiles: ['lualatex', 'xelatex'].map((id) => ({ id, name: id === 'lualatex' ? 'LuaLaTeX' : 'XeLaTeX', version: 'browser-fixture', fonts: ['Latin Modern Roman'], packages: ['fontspec', 'geometry', 'hyperref'] })) })
    if (action === 'compile') {
      state.calls++
      const form = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData()
      const manifest = JSON.parse(String(form.get('manifest')))
      state.manifest = manifest
      if (state.mode === 'failed') return json({ error: 'Fixture undefined control sequence.', code: 'tex_error', request_id: headers['x-request-id'], operationKey: manifest.operationKey, diagnostics: [{ severity: 'error', message: 'Fixture undefined control sequence.', file: manifest.mainFile, line: 3 }], log: '! Fixture undefined control sequence.\nl.3' }, 422)
      const assets = []
      for (const asset of manifest.assets) assets.push({ ...asset, sha256: sha(Buffer.from(await form.get(`asset:${asset.id}`).arrayBuffer())) })
      const sort = (items) => [...items].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      const snapshotHash = sha(JSON.stringify({ version: manifest.version, projectId: manifest.projectId, revision: manifest.revision, mainFile: manifest.mainFile, engine: manifest.engine, files: sort(manifest.files), assets: sort(assets) }))
      return json({ status: 'ready', operationKey: manifest.operationKey, projectId: manifest.projectId, revision: manifest.revision, snapshotHash, engine: manifest.engine, profileVersion: 'browser-fixture', pdf: { id: `artifact-${manifest.operationKey}`, sha256: sha(pdfBytes), bytes: pdfBytes.length, pages: 2 }, diagnostics: [], log: 'Browser fixture: two-page PDF artifact.\n', syncAvailable: true, createdAt: new Date().toISOString() })
    }
    if (action.startsWith('artifacts/')) return route.fulfill({ status: 200, headers: { ...headers, 'x-resume-pdf-sha256': sha(pdfBytes) }, contentType: 'application/pdf', body: pdfBytes })
    if (action === 'sync') {
      const query = request.postDataJSON()
      return json({ available: true, file: state.manifest.mainFile, line: 3, locations: [{ page: 1, x: 50, y: 780, width: 150, height: 18 }] }, 200, { 'x-resume-snapshot-hash': query.snapshotHash, 'x-resume-pdf-sha256': query.pdfHash })
    }
    throw new Error(`Unexpected compiler fixture request: ${action}`)
  })
  return state
}

async function openEditor(target) {
  await target.goto(`${baseURL}/mr-resume`, { waitUntil: 'load', timeout: 120000 })
  // A cold Next dev load can paint before its client bundle hydrates.
  await target.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Open LaTeX editor') && Object.keys(button).some((key) => key.startsWith('__reactProps'))), undefined, { timeout: 60000 })
  await target.getByRole('button', { name: 'Open LaTeX editor' }).click()
  await expect(target.locator('.cm-content')).toBeVisible({ timeout: 60000 })
  // The dev-only launcher otherwise covers the Files navigation hit target on phones.
  // Runtime exceptions are still collected and fail the test below.
  await target.addStyleTag({ content: 'nextjs-portal { visibility: hidden !important; pointer-events: none !important; }' })
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

  await page.getByText('Settings', { exact: true }).click()
  await page.getByLabel('Source font size').selectOption('16')
  await page.getByLabel('Source tab size').selectOption('4')
  await page.getByLabel('Wrap source lines').uncheck()
  await page.getByLabel('Source tab size').press('Escape')
  await expect(page.getByText('Settings', { exact: true })).toBeFocused()
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '16px')
  await source.press('Control+End')
  await source.press('Enter')
  await source.press('Tab')
  await source.pressSequentially('% FOUR_SPACES')
  assert.equal(fixture.calls, 0, 'Editor settings and typing must stay local')
  results.push('Local editing, per-file undo, rail collapse, keyboard resize, font and indentation controls')

  await page.getByRole('button', { name: 'Find / replace', exact: true }).click()
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
  await page.getByLabel('Insert a LaTeX snippet').selectOption('\\textbf')
  await expect(source).toContainText('\\textbf{')

  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Relative filename').fill('notes-renamed.tex')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes-renamed.tex' })).toBeVisible()
  await page.getByRole('button', { name: 'Set as main', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes-renamed.tex Main' })).toBeVisible()
  await page.getByRole('tab', { name: /^main.tex/ }).click()
  await page.getByRole('button', { name: 'Set as main', exact: true }).click()
  await page.getByRole('button', { name: 'Fold', exact: true }).click()
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await page.getByRole('button', { name: 'Unfold', exact: true }).click()
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)
  results.push('Find/replace and go-to-line focus, snippets, file rename/main selection, fold/unfold')

  await chooseUpload(() => page.getByRole('button', { name: 'Add file / image', exact: true }).click(), { name: 'photo.png', mimeType: 'image/png', buffer: imageBytes })
  await expect(page.getByRole('button', { name: /^photo.png/ })).toBeVisible()
  await page.getByRole('button', { name: /^photo.png/ }).click()
  await expect(page.getByRole('button', { name: 'Set as main', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
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

  await page.getByText('Settings', { exact: true }).click()
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
  const retained = await download(() => page.getByRole('button', { name: /^Download PDF r/ }).click())
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
  const recovered = await download(() => page.getByRole('button', { name: /^Download PDF r/ }).click())
  assert.equal(sha(recovered.bytes), sha(pdfBytes), 'Reload recovers the last committed original PDF')
  assert.equal(fixture.calls, callsBeforeReload, 'Draft/proof restoration never triggers compilation')
  results.push('Reload restores committed source and original PDF without compiling')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByLabel('Source font size')).toBeVisible()
  await page.getByLabel('Source font size').press('Escape')
  const projects = page.locator('summary[aria-label="Projects and source templates"]').locator('..')
  await projects.locator('summary').click()
  const originalId = await page.getByLabel('Select LaTeX project').inputValue()
  await projects.locator('button[title]').nth(1).click()
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
  await regularContext.close()
  results.push('Regular editor still opens without mounting LaTeX or compiling')
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
