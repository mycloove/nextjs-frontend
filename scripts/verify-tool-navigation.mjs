// Standalone, browser-mocked navigation verification; never updates repo goldens.
// node scripts/verify-tool-navigation.mjs http://127.0.0.1:3110 --baseline
// node scripts/verify-tool-navigation.mjs http://127.0.0.1:3110
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import sharp from 'sharp'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node scripts/verify-tool-navigation.mjs [http://127.0.0.1:3110] [--baseline]')
  process.exit(0)
}
const baselineMode = args.includes('--baseline')
const urls = args.filter((arg) => !arg.startsWith('--'))
assert(args.every((arg) => arg === '--baseline' || !arg.startsWith('--')), 'Unknown CLI option')
assert(urls.length <= 1, 'Supply one positional baseURL')
const baseURL = new URL(urls[0] || 'http://127.0.0.1:3110')
assert(['127.0.0.1', 'localhost', '[::1]'].includes(baseURL.hostname), 'Use an isolated localhost preview, not a live account/database')
assert(['http:', 'https:'].includes(baseURL.protocol) && !baseURL.username && !baseURL.password, 'Invalid preview URL')
const TEMP_PARENT = 'C:\\Users\\iamji\\AppData\\Local\\Temp\\kilo'
const OUT = path.join(TEMP_PARENT, 'tool-navbar-verification')
const baselineFile = path.join(OUT, 'baseline.json')
const runName = `${baselineMode ? 'baseline' : 'verify'}-${new Date().toISOString().replace(/[:.]/g, '-')}`
const runDir = path.join(OUT, runName)
const shotDir = path.join(runDir, 'screenshots')
const NAV = '[data-tool-navbar]'
const TRIGGER = '[data-tool-switcher-trigger]'
const DIALOG = '[data-tool-switcher-dialog]'
const themes = ['light', 'dark']
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]
const tools = [
  ['image-to-pdf', '/image-to-pdf', 'Images to PDF', '.i2p'],
  ['pdf-to-images', '/pdf-to-images', 'PDF to Images', '.p2i'],
  ['pdf-to-word', '/pdf-to-word', 'PDF to Word', '.p2w'],
  ['word-to-pdf', '/word-to-pdf', 'Word to PDF', '.w2p'],
  ['image-to-text', '/image-to-text', 'Image to Text', '.i2t'],
  ['pdf-to-markdown', '/mr-markdown', 'Mr. Markdown', '.pm-shell'],
  ['markdown-to-pdf', '/markdown-to-pdf', 'Markdown to PDF', '.m2p'],
  ['ai-analyzer', '/ai-analyzer', 'AI Analyzer', '.da'],
  ['batch-process', '/batch-process', 'Batch Process', '.bw'],
  ['fasta-tools', '/fasta-tools', 'FASTA Tools', '.ft-root'],
  ['bijoy-converter', '/bijoy-converter', 'Bijoy to Unicode', '.b2u'],
  ['merge-pdf', '/merge-pdf', 'Merge PDF', '[role="group"][aria-label^="Merge PDF workbench"]'],
  ['split-pdf', '/split-pdf', 'Split PDF', '.spl'],
  ['rotate-pdf', '/rotate-pdf', 'Rotate PDF', '.rt'],
  ['compress-pdf', '/compress-pdf', 'Compress PDF', '.acx-main'],
].map(([id, href, label, surface]) => ({ id, href, label, surface, kind: 'tool' }))
const workspaces = [
  { id: 'pdf-editor', href: '/pdf-editor', label: 'PDF Editor', header: '.pe-drop-head', surface: '.pe-drop-shell', anchors: ['.pe-drop-head', '.pe-drop-brand', '.pe-drop-shell', '.pe-drop-intro', '.pe-drop-title', '.pe-drop-sheet'] },
  { id: 'document-ai', href: '/document-ai', label: 'Document AI', header: '.doc-ai-shell .topbar', surface: '.doc-ai-shell .content-row', anchors: ['.doc-ai-shell', '.doc-ai-shell .topbar', '.doc-ai-shell .sidebar', '.doc-ai-shell .panel-chat', '.doc-ai-shell .composer-wrap', '.doc-ai-shell .right-panel', '.doc-ai-shell .status-footer'] },
  { id: 'image-editor', href: '/image-editor', label: 'Image Editor', header: '.ie-topbar', surface: '.ie-editor-wrap', anchors: ['.ie-page', '.ie-topbar', '.ie-topbar-left', '.ie-topbar-right', '.ie-editor-wrap', '.ie-container', '.ie-main', '.ie-footer'] },
]
const home = { id: 'home', href: '/', label: 'Home', header: '.home-topbar', surface: '.home-hero', anchors: ['.home-topbar', '.home-nav-shell', '.home-brand', '.home-desktop-nav', '.home-nav-actions', '.home-hero', '.home-hero-copy', '#hero-title', '.home-visual', '.home-file-workflow'] }
const allDestinations = [...tools, ...workspaces]
const maskSelectors = ['nextjs-portal', '[class*="AnimatedBrandLogo"][class*="eyes"]', '.home-visual']
const report = {
  version: 1, mode: baselineMode ? 'baseline' : 'verification', baseURL: baseURL.origin,
  startedAt: new Date().toISOString(), runDir, mocks: 'Disposable guest; 18 enabled tools; valid legacy CreditSnapshot. All browser API traffic intercepted. All unplanned mutations blocked.',
  screenshotPolicy: { animations: 'disabled', caret: 'hide', masks: maskSelectors, reasons: ['Next development UI is not product chrome', 'Animated octopus eyes', 'Animated homepage quantum cube; its unmasked parent geometry/CSS is fingerprinted'] },
  cases: [], checks: [], failures: [], warnings: [], browserErrors: [], blockedRequests: [],
  gaps: ['Browser mocks do not verify real conversion services, credit accounting, or server-side database reads. The preview server must itself use a disposable/empty database.'],
}

async function directory(dir) {
  assert((await stat(path.dirname(dir))).isDirectory(), `Output parent is not a directory: ${path.dirname(dir)}`)
  await mkdir(dir).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error
    assert((await stat(dir)).isDirectory(), `Output path is not a directory: ${dir}`)
  })
}

function creditSnapshot(mode = 'legacy', available = 25) {
  return {
    mode, audience: 'guest', account_active: false,
    available: mode === 'metered' ? available : null, allowance: mode === 'metered' ? 25 : null,
    used: mode === 'metered' ? 25 - available : null, reserved: mode === 'metered' ? 0 : null,
    period_hours: 24, next_return_at: null, next_return_amount: 0, next_expiry_at: null, next_expiry_amount: 0,
    revision: 1, as_of: '2026-10-22T00:00:00.000Z',
    prices: Object.fromEntries(allDestinations.map(({ id }) => [id, { cost: 1, version: 1 }])),
    message: mode === 'unavailable' ? 'Mocked unavailable credit service.' : null,
  }
}

function caseKey(spec) {
  return `${spec.id}-${spec.state}-${spec.theme}-${spec.viewport.width}`
}

function specs() {
  const result = []
  for (const theme of themes) for (const viewport of viewports) {
    for (const tool of tools) result.push({ ...tool, state: 'entry', theme, viewport })
    result.push({ ...tools.find(({ id }) => id === 'pdf-to-markdown'), state: 'editor', theme, viewport })
    for (const app of [home, ...workspaces]) result.push({ ...app, kind: 'protected', state: 'entry', theme, viewport })
    for (const app of workspaces.filter(({ id }) => id !== 'pdf-editor')) result.push({ ...app, kind: 'protected', state: 'disabled', theme, viewport })
  }
  return result
}

async function session(browser, spec, overrides = {}) {
  const key = caseKey(spec)
  const state = { disabled: spec.state === 'disabled' ? [spec.id] : [], credit: creditSnapshot(), degraded: false, ...overrides }
  const requests = []
  const errors = []
  const context = await browser.newContext({
    viewport: spec.viewport, colorScheme: spec.theme, reducedMotion: 'reduce',
    locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1, serviceWorkers: 'block',
  })
  context.setDefaultTimeout(12_000)
  context.setDefaultNavigationTimeout(90_000)
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ type: 'console', message: message.text(), location: message.location() })
    })
    page.on('requestfailed', (request) => errors.push({ type: 'requestfailed', message: `${request.method()} ${request.url()}: ${request.failure()?.errorText}` }))
  })
  await context.addInitScript(({ theme }) => {
    // These preferences live only in this throwaway context, never the operator's browser.
    for (const key of ['smilepdf-theme', 'smilepdf-theme-editor', 'docai_shell_theme', 'mr-markdown-theme']) localStorage.setItem(key, theme)
  }, { theme: spec.theme })
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const api = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/v1/')
    if (!api) return route.continue()
    const method = request.method()
    requests.push({ method, path: url.pathname, query: url.search })
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': baseURL.origin }, body: JSON.stringify(body) })
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      report.blockedRequests.push({ case: key, method, path: url.pathname, reason: 'Mutation blocked; never forwarded' })
      return json({ error: 'Read-only navbar verification blocks mutations', code: 'verification_read_only' }, 403)
    }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': baseURL.origin, 'Access-Control-Allow-Headers': '*' } })
    if (url.pathname === '/api/tools/availability') return json({ tools: state.degraded ? [] : allDestinations.map(({ id }) => ({ tool_id: id, enabled: !state.disabled.includes(id) })), degraded: state.degraded })
    if (url.pathname === '/api/credits') {
      if (state.creditDelay) await new Promise((resolve) => setTimeout(resolve, state.creditDelay))
      return json(state.credit, state.creditError ? 503 : 200)
    }
    if (url.pathname === '/api/profile') return json({ profile: null })
    if (url.pathname.startsWith('/auth/v1/')) return json({ error: 'No session in disposable guest context', code: 'session_not_found' }, 401)
    if (url.pathname === '/api/integrations/github/connection') return json({ configured: false, app_slug: null, connection: null, capabilities: { read: false, write: false } })
    if (url.pathname === '/api/diagrams/capabilities') return json({ capabilities: [], configured: false })
    report.blockedRequests.push({ case: key, method, path: url.pathname, reason: 'Unmocked API read blocked; never forwarded' })
    return json({ error: 'API outside navigation verification scope', code: 'verification_unmocked_read' }, 503)
  })
  const page = await context.newPage()
  return { context, page, state, requests, errors, key }
}

async function settle(page) {
  const fonts = await page.evaluate(async () => {
    const ready = await Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 8_000))])
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { ready, status: document.fonts.status, faces: [...document.fonts].map((font) => ({ family: font.family, status: font.status, weight: font.weight })) }
  })
  // UI effects, image decode and finite entrances settle before reading geometry.
  await page.waitForTimeout(450)
  return fonts
}

async function load(page, spec) {
  const response = await page.goto(new URL(spec.href, baseURL).href, { waitUntil: 'domcontentloaded' })
  assert(response && response.ok(), `${spec.href} returned HTTP ${response?.status()}`)
  if (spec.state === 'disabled') {
    await expect(page.getByRole('heading', { name: `${spec.label} is off the bench` })).toBeVisible()
  } else if (spec.state === 'editor') {
    await page.getByRole('button', { name: /write in editor|blank markdown/i }).first().click()
    await expect(page.locator('.mr-markdown-workspace')).toBeVisible()
    await expect(page.locator('.pm-editor-textarea')).toBeVisible()
  } else {
    await expect(page.locator(spec.surface).first()).toBeVisible()
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', spec.theme)
  if (spec.state !== 'disabled' && spec.id === 'document-ai') await expect(page.locator('.doc-ai-shell')).toHaveAttribute('data-theme', spec.theme)
  if (spec.state !== 'disabled' && spec.id === 'image-editor') await expect(page.locator('.ie-page')).toHaveClass(new RegExp(`ie-page-${spec.theme}`))
  if (spec.state === 'editor') await expect(page.locator('.mr-markdown-workspace')).toHaveAttribute('data-theme', spec.theme)
  return settle(page)
}

function selectors(spec) {
  if (spec.state === 'disabled') return { header: null, content: 'h1', surface: 'h1' }
  if (spec.state === 'editor') return { header: '.pm-ws-topbar', content: '.pm-ws-editor', surface: '.mr-markdown-workspace' }
  if (spec.kind === 'protected') return { header: spec.header, content: spec.surface, surface: spec.surface }
  if (spec.id === 'pdf-to-markdown') return { header: '.pm-studio-topbar', content: '.pm-shell', surface: '.pm-shell' }
  if (spec.id === 'split-pdf') return { header: '.spl-sitebar', content: '.spl', surface: '.spl' }
  if (spec.id === 'compress-pdf') return { header: '.acx-sitebar', content: '.acx-main', surface: '.acx-main' }
  return { header: `${NAV}, header`, content: `main:has(> section[aria-label="${spec.label} workspace"])`, surface: `section[aria-label="${spec.label} workspace"]` }
}

async function fingerprint(page, spec) {
  return page.evaluate(({ selectors, protectedCase, anchors, gate }) => {
    const round = (n) => Math.round(n * 100) / 100
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return Object.fromEntries(['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'].map((key) => [key, round(r[key])]))
    }
    const properties = ['display', 'position', 'color', 'backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderBottomWidth', 'borderColor', 'borderRadius', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'margin', 'gap', 'maxWidth', 'overflowX', 'overflowY', 'boxShadow']
    const node = (el) => {
      if (!el) return null
      const css = getComputedStyle(el)
      return { tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), href: el.getAttribute('href'), type: el.getAttribute('type'), text: [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim(), rect: rect(el), css: Object.fromEntries(properties.map((key) => [key, css[key]])) }
    }
    const header = selectors.header ? document.querySelector(selectors.header) : null
    const content = gate ? document.querySelector('h1')?.parentElement : document.querySelector(selectors.content)
    const surface = gate ? content : document.querySelector(selectors.surface)
    const chrome = header || content
    const masked = (el) => !!el.closest('nextjs-portal, .home-visual, [class*="AnimatedBrandLogo"][class*="eyes"]')
    const tree = protectedCase && chrome ? [chrome, ...chrome.querySelectorAll('*')].filter((el) => !masked(el)).slice(0, 220).map(node) : null
    return {
      geometry: { header: rect(header), content: rect(content), surface: rect(surface) },
      fingerprint: protectedCase ? { tree, anchors: anchors.map((selector) => ({ selector, node: node(document.querySelector(selector)) })), theme: document.documentElement.dataset.theme, ownerTheme: document.querySelector('.doc-ai-shell, .mr-markdown-workspace')?.getAttribute('data-theme') ?? null } : null,
      headerCount: document.querySelectorAll('[data-tool-navbar]').length,
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      themes: Object.fromEntries(['smilepdf-theme', 'smilepdf-theme-editor', 'docai_shell_theme', 'mr-markdown-theme'].map((key) => [key, localStorage.getItem(key)])),
    }
  }, { selectors: selectors(spec), protectedCase: spec.kind === 'protected', anchors: spec.state === 'disabled' ? ['h1', 'h1 + span', 'h1 + span + a'] : spec.anchors || [], gate: spec.state === 'disabled' })
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

async function pixels(beforePath, afterPath, diffPath) {
  const before = await sharp(beforePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const after = await sharp(afterPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) return { pass: false, reason: 'Screenshot dimensions changed', before: before.info, after: after.info }
  let changed = 0, significant = 0, totalDelta = 0, maxDelta = 0
  const diff = Buffer.alloc(before.data.length)
  for (let i = 0; i < before.data.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 3; c++) {
      const value = Math.abs(before.data[i + c] - after.data[i + c])
      totalDelta += value
      delta = Math.max(delta, value)
    }
    if (delta) changed++
    if (delta > 12) significant++
    maxDelta = Math.max(maxDelta, delta)
    diff[i] = delta ? 255 : after.data[i] / 3
    diff[i + 1] = delta ? 0 : after.data[i + 1] / 3
    diff[i + 2] = delta ? 80 : after.data[i + 2] / 3
    diff[i + 3] = 255
  }
  const count = before.info.width * before.info.height
  if (changed) await sharp(diff, { raw: before.info }).png().toFile(diffPath)
  return { pass: significant === 0, changedPixels: changed, significantPixels: significant, totalPixels: count, changedRatio: changed / count, significantRatio: significant / count, maxChannelDelta: maxDelta, meanChannelDelta: totalDelta / (count * 3), perChannelTolerance: 12, diffPath: changed ? diffPath : null }
}

async function check(name, action) {
  try {
    const details = await action()
    report.checks.push({ name, pass: true, ...(details ? { details } : {}) })
  } catch (error) {
    report.checks.push({ name, pass: false, error: error.message })
    report.failures.push({ check: name, error: error.message })
    console.error(`FAIL ${name}: ${error.message.split('\n')[0]}`)
  }
}

async function basicNavbar(page, spec) {
  const header = page.locator(`${NAV}[data-tool-navbar="${spec.id}"]`)
  await expect(header).toHaveCount(1)
  await expect(header).toBeVisible()
  await expect(page.locator(TRIGGER)).toHaveCount(1)
  const trigger = header.locator(TRIGGER)
  await expect(trigger).toHaveAccessibleName('Tools')
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.locator(DIALOG)
  await expect(dialog).toBeVisible()
  assert(await dialog.evaluate((el) => el instanceof HTMLDialogElement && el.matches(':modal')), 'Chooser must be a native modal dialog in the top layer')
  await expect(dialog).toHaveRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Choose a tool' })).toBeVisible()
  await expect(dialog.locator(`a[data-tool-link="${spec.id}"]`)).toHaveAttribute('aria-current', 'page')
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  assert(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, `Chooser overflows ${viewport.width}px viewport: ${JSON.stringify(bounds)}`)
  const inherited = await dialog.evaluate((el) => ['--tn-surface', '--tn-text'].map((key) => ({ key, dialog: getComputedStyle(el).getPropertyValue(key).trim(), host: getComputedStyle(el.parentElement).getPropertyValue(key).trim() })))
  assert(inherited.every(({ dialog, host }) => dialog && dialog === host), `Dialog must inherit host theme aliases: ${JSON.stringify(inherited)}`)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  return { bounds, inherited }
}

async function openChooser(page, key = 'Enter') {
  const trigger = page.locator(TRIGGER)
  await trigger.focus()
  await page.keyboard.press(key)
  const dialog = page.locator(DIALOG)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('searchbox', { name: 'Search tools' })).toBeFocused()
  return dialog
}

async function seedInput(page, spec) {
  if (spec.state === 'editor' || spec.id === 'bijoy-converter') {
    await page.locator('textarea:not([readonly])').first().fill('# Navigation state\n\nKeep this text unchanged.\n')
    return 'text input'
  }
  const fileInput = page.locator('input[type="file"]').first()
  await expect(fileInput).toHaveCount(1)
  let file
  if (['image-to-pdf', 'image-to-text'].includes(spec.id)) {
    file = { name: 'navigation-fixture.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#456789' } }).png().toBuffer() }
  } else if (spec.id === 'fasta-tools') {
    file = { name: 'navigation-fixture.fasta', mimeType: 'text/plain', buffer: Buffer.from('>navigation_test\nACGTACGTACGT\n') }
  } else if (spec.id === 'markdown-to-pdf') {
    file = { name: 'navigation-fixture.md', mimeType: 'text/markdown', buffer: Buffer.from('# Navigation state\n\nKeep this file selected.\n') }
  } else if (spec.id === 'word-to-pdf') {
    // No conversion is invoked; selection is the state under test, not DOCX processing.
    file = { name: 'navigation-fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('Disposable selection-only DOCX fixture') }
  } else {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let index = 1; index <= 3; index++) pdf.addPage([300, 400]).drawText(`Navigation state page ${index}`, { x: 24, y: 340, size: 12, font })
    file = { name: 'navigation-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  }
  await fileInput.setInputFiles(file)
  await page.waitForTimeout(['split-pdf', 'rotate-pdf', 'merge-pdf'].includes(spec.id) ? 900 : 300)
  assert(await fileInput.evaluate((el, name) => el.files?.[0]?.name === name, file.name), 'Fixture selection did not stick')
  return `selected ${file.name}; no processing request invoked`
}

async function inputState(page) {
  return page.evaluate(() => ({
    url: location.href, historyLength: history.length,
    inputs: [...document.querySelectorAll('input, textarea, select')].filter((el) => !el.closest('[data-tool-switcher-dialog], nextjs-portal')).map((el) => ({
      tag: el.tagName, type: el.type, label: el.getAttribute('aria-label'), value: el.type === 'file' ? null : el.value,
      checked: el.checked ?? null, files: el.files ? [...el.files].map((file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified })) : null,
    })),
    selected: [...document.querySelectorAll('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]')].filter((el) => !el.closest('[data-tool-switcher-dialog]')).map((el) => ({ label: el.getAttribute('aria-label'), text: el.textContent?.trim() })),
  }))
}

async function statePreservation(page, spec, requests) {
  const seeded = await seedInput(page, spec)
  const root = await page.locator(spec.state === 'editor' ? '.mr-markdown-workspace' : spec.surface).first().elementHandle()
  const before = await inputState(page)
  const requestCount = requests.length
  const dialog = await openChooser(page)
  await dialog.getByRole('searchbox', { name: 'Search tools' }).fill('OCR')
  await expect(dialog.locator('[data-tool-link="image-to-text"]')).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear tool search' }).click()
  await dialog.locator(`a[data-tool-link="${spec.id}"]`).click()
  await expect(dialog).not.toBeVisible()
  assert(await root.evaluate((el) => el.isConnected), 'Tool DOM root remounted when its current link was activated')
  assert.deepEqual(await inputState(page), before, 'Current-tool chooser interaction reset inputs/selections/history')
  const unexpected = requests.slice(requestCount).filter(({ method, path }) => method !== 'GET' || path === '/api/tools/availability' || path === '/api/profile')
  assert.equal(unexpected.length, 0, `Chooser re-resolved availability/account or made a mutation: ${JSON.stringify(unexpected)}`)
  await root.dispose()
  return { seeded, inputsRetained: before.inputs.length, historyLength: before.historyLength, requestsDuringChooser: requests.slice(requestCount) }
}

async function indexChecks(page) {
  let dialog = await openChooser(page, 'Space')
  for (const label of ['Convert Files', 'PDF Operations', 'Read And Extract', 'Analyze And Automate', 'Sequences', 'Workspaces']) await expect(dialog.getByRole('heading', { name: label, exact: true })).toBeVisible()
  await expect(dialog.locator('[data-tool-link]')).toHaveCount(18)
  assert.equal(await dialog.locator('a[href="/pdf-tools"], a[href="/pdf-to-markdown"]').count(), 0, 'Retired routes are in the index')
  await expect(dialog.getByText('Switching tools does not transfer files. Open in a new tab to keep this workspace open.')).toBeVisible()
  for (const destination of allDestinations) {
    const link = dialog.locator(`a[data-tool-link="${destination.id}"]`)
    await expect(link).toHaveAttribute('href', destination.href)
    const sibling = dialog.getByRole('link', { name: `Open ${destination.label} in new tab`, exact: true })
    await expect(sibling).toHaveAttribute('href', destination.href)
    await expect(sibling).toHaveAttribute('target', '_blank')
    const valid = await sibling.evaluate((el) => el.relList.contains('noopener') && el.relList.contains('noreferrer') && !el.closest('a a') && el.parentElement.querySelector('[data-tool-link]')?.parentElement === el.parentElement)
    assert(valid, `${destination.label}: new-tab control must be a safe sibling link`)
  }
  const search = dialog.getByRole('searchbox', { name: 'Search tools' })
  for (const [term, id] of [['OCR', 'image-to-text'], ['docx', 'pdf-to-word'], ['DNA', 'fasta-tools'], ['Bangla', 'bijoy-converter'], ['chat', 'document-ai']]) {
    await search.fill(term)
    await expect(dialog.locator(`[data-tool-link="${id}"]`)).toBeVisible()
  }
  await search.fill('zz-no-matching-instrument-991')
  await expect(dialog.getByText('No matching tools', { exact: true })).toBeVisible()
  await expect(dialog.locator('[data-tool-link]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(dialog.locator('[data-tool-link]')).toHaveCount(18)
  const visited = new Set()
  for (let index = 0; index < 42; index++) {
    await page.keyboard.press('Tab')
    const active = await dialog.evaluate((el) => ({ inside: el.contains(document.activeElement), name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() }))
    assert(active.inside, `Tab escaped native modal at step ${index}`)
    visited.add(active.name)
  }
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Shift+Tab')
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Reverse Tab escaped native modal')
  }
  await dialog.getByRole('button', { name: 'Close tool switcher' }).click()
  await expect(page.locator(TRIGGER)).toBeFocused()
  dialog = await openChooser(page)
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  const point = bounds.y > 4 ? { x: viewport.width - 2, y: 2 } : { x: 2, y: viewport.height - 2 }
  await page.mouse.click(point.x, point.y)
  await expect(dialog).not.toBeVisible()
  await expect(page.locator(TRIGGER)).toBeFocused()
  return { destinations: 18, searchQueries: 6, keyboardTargetsVisited: visited.size }
}

async function nativeLinks(page) {
  const before = { url: page.url(), length: await page.evaluate(() => history.length) }
  let dialog = await openChooser(page)
  const newTab = dialog.getByRole('link', { name: 'Open PDF to Images in new tab', exact: true })
  const [popup] = await Promise.all([page.waitForEvent('popup'), newTab.click()])
  await popup.waitForURL('**/pdf-to-images', { waitUntil: 'domcontentloaded' })
  assert.equal(page.url(), before.url, 'New-tab link navigated the current workspace')
  await popup.close()
  if (!await dialog.isVisible()) dialog = await openChooser(page)
  const [modified] = await Promise.all([page.waitForEvent('popup'), dialog.locator('a[data-tool-link="bijoy-converter"]').click({ modifiers: ['Control'] })])
  await modified.waitForURL('**/bijoy-converter', { waitUntil: 'domcontentloaded' })
  assert.equal(page.url(), before.url, 'Modifier click navigated the current workspace')
  await modified.close()
  if (!await dialog.isVisible()) dialog = await openChooser(page)
  await dialog.locator('a[data-tool-link="bijoy-converter"]').click()
  await page.waitForURL('**/bijoy-converter')
  assert.equal(await page.evaluate(() => history.length), before.length + 1, 'Same-tab link did not push ordinary history')
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.waitForURL(before.url)
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/bijoy-converter')
  return { explicitNewTab: true, modifierClick: true, sameTab: true, backForward: true }
}

async function availabilityChecks(browser) {
  const spec = { ...tools.find(({ id }) => id === 'pdf-to-word'), state: 'entry', theme: 'light', viewport: viewports[0] }
  const run = await session(browser, spec, { disabled: ['image-to-text', 'document-ai', 'image-editor'] })
  try {
    await load(run.page, spec)
    let dialog = await openChooser(run.page)
    for (const id of run.state.disabled) {
      const unavailable = dialog.locator(`[data-tool-link="${id}"]`)
      await expect(unavailable).toHaveAttribute('aria-disabled', 'true')
      await expect(unavailable).toContainText('Unavailable')
      assert.equal(await unavailable.evaluate((el) => el.tagName === 'A' || el.hasAttribute('href')), false, `${id} is still an activatable link`)
      await unavailable.click()
      assert.equal(run.page.url(), new URL(spec.href, baseURL).href)
      assert.equal(await dialog.locator(`a[href="${allDestinations.find((item) => item.id === id).href}"]`).count(), 0, `${id} still has a new-tab escape link`)
    }
    await run.page.keyboard.press('Escape')
    run.state.degraded = true
    await load(run.page, spec)
    dialog = await openChooser(run.page)
    await expect(dialog.locator('a[data-tool-link]')).toHaveCount(18)
    await expect(dialog.getByRole('status')).toContainText('availability not confirmed')
    return { disabled: run.state.disabled, degradedFailOpen: true }
  } finally { await run.context.close() }
}

async function mrChecks(browser) {
  const spec = { ...tools.find(({ id }) => id === 'pdf-to-markdown'), state: 'editor', theme: 'dark', viewport: viewports[0] }
  const run = await session(browser, spec)
  try {
    await load(run.page, spec)
    const page = run.page, editor = page.locator('.pm-editor-textarea')
    await editor.fill('# Retained document\n\nEditor text must survive navigation chrome.\n')
    const content = await editor.inputValue(), before = await inputState(page)
    await editor.focus()
    await page.keyboard.press('Control+k')
    await expect(page.locator('.pm-cmdk')).toBeVisible()
    await expect(page.locator(DIALOG)).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.pm-cmdk')).toHaveCount(0)
    const chooser = await openChooser(page)
    await page.keyboard.press('Control+k')
    await expect(page.locator('.pm-cmdk')).toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    await page.keyboard.press('Control+/')
    await expect(page.locator('.mr-focus-header')).toHaveCount(0)
    assert.deepEqual(await inputState(page), before, 'Modal keyboard events reached underlying editor or history')
    await chooser.getByRole('searchbox', { name: 'Search tools' }).evaluate((el) => {
      const data = new DataTransfer()
      data.setData('text/html', '<h1>Do not paste into the editor</h1>')
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    })
    await expect(editor).toHaveValue(content)
    await page.keyboard.press('Escape')
    await expect(page.locator(TRIGGER)).toBeFocused()
    await editor.focus()
    await page.keyboard.press('Control+/')
    await expect(page.locator('.mr-focus-header')).toBeVisible()
    await expect(page.locator('.pm-ws-topbar')).not.toBeVisible()
    await expect(page.locator(TRIGGER)).toHaveCount(0)
    await expect(page.locator(DIALOG)).toHaveCount(0)
    await expect(editor).toHaveValue(content)
    await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
    await expect(page.locator(TRIGGER)).toBeVisible()
    await expect(editor).toHaveValue(content)
    await check('Mr. Markdown: editor current link retains text/history', () => statePreservation(page, spec, run.requests))
    return { commandPaletteShortcutPreserved: true, modalKeyboardAndPasteIsolation: true, focusUnmountsChooser: true, textRetained: true }
  } finally { await run.context.close() }
}

async function responsiveChecks(browser) {
  const hosts = ['pdf-to-word', 'merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-markdown']
  for (const id of hosts) for (const theme of themes) {
    const spec = { ...tools.find((tool) => tool.id === id), state: 'entry', theme, viewport: viewports[0] }
    const run = await session(browser, spec)
    try {
      await load(run.page, spec)
      for (const width of [320, 390, 768, 1024, 1440]) await check(`responsive ${id} ${theme} ${width}px`, async () => {
        await run.page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
        await settle(run.page)
        const header = run.page.locator(`${NAV}[data-tool-navbar="${id}"]`)
        const rect = await header.boundingBox()
        assert(rect && rect.x >= -1 && rect.x + rect.width <= width + 1, 'Header overflows the layout viewport')
        if (id !== 'pdf-to-markdown') assert(Math.abs(rect.height - 62) <= 1, `Header is ${rect.height}px, expected preserved 62px`)
        const account = header.locator('button[aria-haspopup="dialog"]:not([data-tool-switcher-trigger])').last()
        await expect(account).toBeVisible()
        const dialog = await openChooser(run.page)
        await run.page.waitForTimeout(220)
        const bounds = await dialog.boundingBox()
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= run.page.viewportSize().height + 1, `Dialog viewport overflow: ${JSON.stringify(bounds)}`)
        assert(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'Chooser has horizontal overflow')
        assert.equal(await dialog.evaluate((el) => getComputedStyle(el).animationName), 'none', 'Reduced-motion chooser still animates')
        await run.page.keyboard.press('Escape')
        await expect(run.page.locator(TRIGGER)).toBeFocused()
        return { header: rect, dialog: bounds }
      })
      await check(`responsive ${id} ${theme}: live resize and normal motion`, async () => {
        await run.page.emulateMedia({ reducedMotion: 'no-preference' })
        await openChooser(run.page)
        await run.page.waitForTimeout(250)
        await run.page.setViewportSize({ width: 390, height: 420 })
        await run.page.waitForTimeout(100)
        const dialog = run.page.locator(DIALOG), bounds = await dialog.boundingBox()
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 421, 'Open chooser did not clamp after a mobile-keyboard-height resize')
        await run.page.screenshot({ path: path.join(shotDir, `dialog-${id}-${theme}-390.png`), animations: 'disabled', caret: 'hide', mask: [run.page.locator('nextjs-portal')] })
        await run.page.keyboard.press('Escape')
        return { viewport: { width: 390, height: 420 }, bounds, reducedMotion: false }
      })
    } catch (error) {
      report.failures.push({ check: `responsive ${id} ${theme}`, error: error.message })
    } finally { await run.context.close() }
  }
  report.gaps.push('The viewport resize emulates a mobile keyboard height, not an OS keyboard. Native desktop 200% browser zoom and coarse-pointer hardware were not automated.')
}

async function interactions(browser) {
  for (const spec of tools.map((tool) => ({ ...tool, state: tool.id === 'pdf-to-markdown' ? 'editor' : 'entry', theme: 'light', viewport: viewports[0] }))) {
    const run = await session(browser, spec)
    try {
      await load(run.page, spec)
      await check(`${spec.id}: current-tool input/history/no-remount`, () => statePreservation(run.page, spec, run.requests))
      if (spec.id === 'pdf-to-word') {
        await check('index groups, search, empty state, sibling links, modal keyboard, backdrop', () => indexChecks(run.page))
        await check('native new tab, modifier click, same-tab history/back/forward', () => nativeLinks(run.page))
      }
    } catch (error) {
      report.failures.push({ check: `${spec.id}: interaction load`, error: error.message })
    } finally { await run.context.close() }
  }
  report.gaps.push('FASTA currently exposes file selection rather than a direct sequence textarea; the .fasta selection is verified without invoking live analysis. DOCX fixture is selection-only, not a processing fixture.')
  await check('disabled availability and degraded fail-open index', () => availabilityChecks(browser))
  await check('Mr. Markdown normal/editor/focus and Ctrl+K isolation', () => mrChecks(browser))
  await responsiveChecks(browser)
}

async function compareCase(entry, previous) {
  assert(previous, `No captured baseline for ${entry.key}`)
  if (entry.kind === 'protected') {
    await check(`${entry.key}: protected DOM/CSS`, () => assert.deepEqual(entry.fingerprint, previous.fingerprint))
    await check(`${entry.key}: protected pixels`, async () => {
      const result = await pixels(previous.screenshot, entry.screenshot, path.join(shotDir, `${entry.key}-diff.png`))
      entry.pixelComparison = result
      assert(result.pass, `Protected pixel difference: ${JSON.stringify(result)}`)
      return result
    })
  }
  await check(`${entry.key}: preserved geometry`, () => {
    for (const part of ['header', 'content', 'surface']) {
      const before = previous.geometry[part], after = entry.geometry[part]
      assert.equal(!!after, !!before, `${part} is missing`)
      if (!after) continue
      for (const dimension of ['x', 'y', 'width', 'height']) assert(Math.abs(after[dimension] - before[dimension]) <= 1, `${part}.${dimension}: before ${before[dimension]}, after ${after[dimension]}`)
    }
  })
}

async function capture(browser, spec, previous) {
  const key = caseKey(spec)
  const run = await session(browser, spec)
  const entry = { key, id: spec.id, href: spec.href, kind: spec.kind, state: spec.state, theme: spec.theme, viewport: spec.viewport, status: 'blocked' }
  try {
    entry.fonts = await load(run.page, spec)
    const snapshot = await fingerprint(run.page, spec)
    Object.assign(entry, snapshot)
    assert(entry.geometry.content && entry.geometry.surface, 'Content/surface geometry unavailable')
    if (spec.state !== 'disabled') assert(entry.geometry.header, 'Header geometry unavailable')
    if (baselineMode || spec.kind === 'protected') {
      assert.equal(await run.page.locator(NAV).count(), 0, baselineMode ? 'Runtime navbar integrated before baseline capture' : 'New navbar leaked into a protected route')
      assert.equal(await run.page.locator(TRIGGER).count(), 0, 'Tool chooser must not exist on baseline/protected routes')
      assert.equal(await run.page.locator(DIALOG).count(), 0, 'Tool chooser dialog leaked into protected chrome')
    }
    if (!entry.fonts.ready) report.warnings.push({ case: key, warning: 'Font readiness timed out; inspect font statuses before treating this capture as deterministic' })
    entry.screenshot = path.join(shotDir, `${key}.png`)
    await run.page.screenshot({ path: entry.screenshot, animations: 'disabled', caret: 'hide', mask: maskSelectors.map((selector) => run.page.locator(selector)) })
    entry.fingerprintHash = entry.fingerprint ? hash(entry.fingerprint) : null
    entry.status = 'captured'
    if (!baselineMode) {
      if (previous) await compareCase(entry, previous)
      if (spec.kind === 'tool') await check(`${key}: native navbar`, () => basicNavbar(run.page, spec))
    }
    console.log(`CAPTURE ${key}`)
  } catch (error) {
    entry.error = error.message
    report.failures.push({ case: key, error: error.message })
    console.error(`BLOCKED ${key}: ${error.message.split('\n')[0]}`)
  } finally {
    entry.requests = run.requests
    entry.browserErrors = run.errors
    report.browserErrors.push(...run.errors.map((error) => ({ case: key, ...error })))
    report.cases.push(entry)
    await run.context.close()
  }
}

async function pool(items, limit, action) {
  let cursor = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) await action(items[cursor++])
  }))
}

async function main() {
  assert((await stat(TEMP_PARENT)).isDirectory(), 'Preapproved temp parent unavailable')
  await directory(OUT)
  if (baselineMode) {
    await stat(baselineFile).then(() => { throw new Error(`Baseline already exists: ${baselineFile}. It is immutable; normal mode never regenerates it.`) }, (error) => { if (error.code !== 'ENOENT') throw error })
  }
  const baseline = baselineMode ? null : await readFile(baselineFile, 'utf8').then((value) => JSON.parse(value), (error) => {
    if (error.code !== 'ENOENT') throw error
    report.gaps.push('BASELINE UNAVAILABLE: no pre-integration baseline.json exists. Current captures are not a substitute; protected pixel/DOM and before/after geometry comparisons were not run.')
    console.warn(`BASELINE UNAVAILABLE ${baselineFile}; verification will remain incomplete even if smoke checks pass`)
    return null
  })
  if (baseline) {
    assert.equal(baseline.mode, 'baseline')
    assert.equal(baseline.summary.captured, 88, 'Incomplete baseline cannot verify protected surfaces')
    assert.equal(baseline.baseURL, baseURL.origin, 'Compare against the same isolated preview origin')
    report.baselineFile = baselineFile
    report.preExistingBrowserErrors = baseline.browserErrors
  }
  await directory(runDir)
  await directory(shotDir)
  const captureSpecs = baselineMode || baseline ? specs() : specs().filter((spec) => spec.kind === 'protected' || (spec.theme === 'light' && spec.viewport.width === 1440))
  console.log(`${baselineMode ? 'BASELINE' : 'VERIFY'} ${baseURL.origin}; ${captureSpecs.length} cases; outputs ${runDir}`)
  const browser = await chromium.launch()
  try {
    const previous = new Map(baseline?.cases.map((entry) => [entry.key, entry]) || [])
    await pool(captureSpecs, 3, (spec) => capture(browser, spec, previous.get(caseKey(spec))))
    if (!baselineMode) await interactions(browser)
  } finally {
    await browser.close()
  }
  report.finishedAt = new Date().toISOString()
  const captured = report.cases.filter(({ status }) => status === 'captured').length
  report.summary = { expected: captureSpecs.length, captured, failedChecks: report.failures.length, browserErrors: report.browserErrors.length, blockedRequests: report.blockedRequests.length, outcome: report.failures.length ? 'failed' : !baselineMode && !baseline ? 'incomplete-no-baseline' : 'passed' }
  report.cases.sort((a, b) => a.key.localeCompare(b.key))
  await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  if (baselineMode && report.summary.captured === 88 && report.failures.length === 0) await writeFile(baselineFile, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(`REPORT ${path.join(runDir, 'report.json')}`)
  if (baselineMode && report.failures.length === 0) console.log(`BASELINE READY ${baselineFile}`)
  if (report.failures.length || captured !== captureSpecs.length) process.exitCode = 1
  else if (!baselineMode && !baseline) process.exitCode = 2
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
