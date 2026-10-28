import assert from 'node:assert/strict'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'

// Run against an already-started frontend: node tests/mr-resume/studio.ui.test.mjs
const baseUrl = process.env.MR_RESUME_BASE_URL || 'http://127.0.0.1:3125'
const screenshots = path.resolve('test-results/mr-resume-ui')
const browser = await chromium.launch({ headless: true })
const reports = []

async function openStudio(theme, viewport, touch = false, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, colorScheme: theme, hasTouch: touch, isMobile: touch, reducedMotion })
  await context.addInitScript((value) => localStorage.setItem('smilepdf-theme', value), theme)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  const backendCalls = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|uncaught|TypeError|ReferenceError/i.test(message.text())) errors.push(message.text())
  })
  page.on('request', (request) => {
    if (/\/api\//.test(new URL(request.url()).pathname)) backendCalls.push(request.url())
  })
  const response = await page.goto(`${baseUrl}/mr-resume`, { waitUntil: 'networkidle', timeout: 120000 })
  assert.equal(response.status(), 200)
  // A static SSR input is not evidence of hydration. Verify a real state round-trip
  // before screenshots temporarily hide carets and could disturb unfinished hydration.
  await expect(async () => {
    await page.getByLabel('Full name', { exact: true }).fill('Ready to write')
    await expect(page.locator('[data-paper-section="profile"] h2')).toHaveText('Ready to write', { timeout: 1000 })
  }).toPass({ timeout: 60000 })
  await page.getByLabel('Full name', { exact: true }).fill('Ayesha Rahman')
  await expect(page.locator('[data-paper-section="profile"] h2')).toHaveText('Ayesha Rahman')
  assert.deepEqual(errors, [])
  // Exclude only Next's development chrome; its badge covers the first phone tab.
  // Runtime and hydration errors are still collected and asserted in every case.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  return { context, page, errors, backendCalls }
}

async function order(page) {
  return page.locator('[data-outline-section]').evaluateAll((rows) => rows.map((row) => row.dataset.outlineSection))
}

async function assertOrder(page, expected) {
  await expect.poll(() => order(page)).toEqual(expected)
  await settleMotion(page)
  const previewOrder = await page.locator('[data-paper-section]').evaluateAll((rows) => rows.map((row) => row.dataset.paperSection))
  assert.deepEqual(previewOrder, ['profile', ...expected])
}

// New intent snaps ongoing reorder motion (stopFlip); a synthetic driver like
// this suite must likewise measure settled geometry, not mid-flight boxes.
async function settleMotion(page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), { timeout: 5000 }).toBe(0)
}

async function selectSection(page, id) {
  await page.locator(`[data-outline-section="${id}"]`).locator('button').last().click()
}

async function dragSection(page, id, target, placement, canvas = false) {
  // Measure drop geometry only after in-flight motion (FLIP, settle) drains.
  await settleMotion(page)
  const attribute = canvas ? 'data-paper-section' : 'data-outline-section'
  const source = page.locator(`[${attribute}="${id}"]`)
  if (canvas) await source.click()
  await source.hover()
  const handle = source.getByRole('button', { name: /^Reorder / })
  await handle.scrollIntoViewIfNeeded()
  const from = await handle.boundingBox()
  const to = await page.locator(`[${attribute}="${target}"]`).boundingBox()
  assert.ok(from && to, 'Both drag endpoints must be visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * (placement === 'before' ? .2 : .8), { steps: 12 })
  await page.mouse.up()
}

async function noPageOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  const stage = page.locator('[data-sort-scroll="canvas"]')
  if (await stage.isVisible()) await expect.poll(() => stage.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

async function dismissNotice(page) {
  const close = page.getByRole('button', { name: 'Dismiss notification' })
  if (await close.count()) await close.click()
}

function luminance(color) {
  const values = color.startsWith('#')
    ? color.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16))
    : color.match(/[\d.]+/g).slice(0, 3).map(Number)
  return values.map((value) => {
    const channel = value / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

async function auditControls(page, theme) {
  const tokens = await page.locator('[data-mobile-panel]').evaluate((element) => {
    const style = getComputedStyle(element)
    return Object.fromEntries(['ink', 'muted', 'panel', 'raised', 'accent', 'accent-soft', 'primary', 'on-primary', 'control-line', 'focus', 'gold'].map((name) => [name, style.getPropertyValue(`--rs-${name}`).trim()]))
  })
  const pairs = {
    body: contrast(tokens.ink, tokens.panel),
    secondary: contrast(tokens.muted, tokens.panel),
    action: contrast(tokens['on-primary'], tokens.primary),
    selected: contrast(tokens.accent, tokens['accent-soft']),
    brandLabel: contrast(tokens.gold, tokens.panel),
    boundary: contrast(tokens['control-line'], tokens.raised),
    focus: contrast(tokens.focus, tokens.panel),
  }
  for (const [name, ratio] of Object.entries(pairs)) assert.ok(ratio >= (['boundary', 'focus'].includes(name) ? 3 : 4.5), `${theme} ${name} contrast is ${ratio.toFixed(2)}`)
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, textarea, select')].filter((element) => {
    if (!element.getClientRects().length) return false
    return !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent.trim() && !element.labels?.length
  }).map((element) => element.outerHTML))
  assert.deepEqual(unnamed, [], 'Visible controls need accessible names')
  assert.equal(await page.locator('[aria-hidden="true"] button, [aria-hidden="true"] input').count(), 0)
  return Object.fromEntries(Object.entries(pairs).map(([name, ratio]) => [name, Number(ratio.toFixed(2))]))
}

try {
  for (const theme of ['light', 'dark']) {
    const { context, page, errors, backendCalls } = await openStudio(theme, { width: 1440, height: 1000 })
    await assertOrder(page, ['summary', 'experience', 'education', 'skills'])
    await noPageOverflow(page)
    await page.screenshot({ path: path.join(screenshots, `desktop-${theme}.png`) })
    const ratios = await auditControls(page, theme)

    await page.getByLabel('Full name', { exact: true }).fill('Ayesha Rahman & Co.')
    await page.getByLabel('Role and contact details').fill('Product designer\nDhaka, Bangladesh\nhttps://example.com/a:b\nhello@example.com')
    await expect(page.locator('[data-paper-section="profile"]')).toContainText('https://example.com/a:b')
    await expect(page.locator('[data-paper-section="profile"]')).toContainText('hello@example.com')

    await selectSection(page, 'experience')
    await page.getByLabel('Section content', { exact: true }).fill('Senior designer at Northstar\n2022 - Present\nImproved completion by 28%.\nResearch and delivery responsibilities.')
    await page.getByLabel('Section content', { exact: true }).evaluate((element) => {
      const start = element.value.indexOf('Improved')
      element.setSelectionRange(start, start + 'Improved completion by 28%.'.length)
    })
    await page.getByRole('button', { name: 'Add bullet', exact: true }).click()
    await expect(page.locator('[data-paper-section="experience"] li')).toHaveText('Improved completion by 28%.')
    await expect(page.locator('[data-paper-section="experience"] p').first()).toContainText('Senior designer at Northstar')

    await selectSection(page, 'summary')
    await page.getByLabel('Section heading', { exact: true }).fill('Career overview')
    const body = 'I build useful products with measurable results.\n\n- Improved completion by 28%.\n- Kept A&B, $50, #1, and <img src=x> as text.'
    await page.getByLabel('Section content', { exact: true }).fill(body)
    await expect(page.locator('[data-paper-section="summary"] h3')).toHaveText('Career overview')
    await expect(page.locator('[data-paper-section="summary"] li')).toHaveCount(2)
    assert.equal(await page.locator('[data-paper-section="summary"] img').count(), 0)

    await page.getByRole('button', { name: 'Add section', exact: true }).click()
    await page.screenshot({ path: path.join(screenshots, `section-library-${theme}.png`) })
    await page.getByRole('button', { name: 'Add Selected projects', exact: true }).click()
    await expect(page.getByLabel('Section heading', { exact: true })).toBeFocused()
    await page.getByLabel('Section heading', { exact: true }).fill('Featured work')
    await page.getByLabel('Section content', { exact: true }).fill('Accessible toolkit\nUsed by 12 teams.')
    await page.getByRole('button', { name: 'Move section up', exact: true }).click()
    await assertOrder(page, ['summary', 'experience', 'education', 'projects', 'skills'])
    const skillsHandle = page.locator('[data-outline-section="skills"]').getByRole('button', { name: 'Reorder Skills', exact: true })
    await skillsHandle.focus()
    await skillsHandle.press('ArrowUp')
    await expect(skillsHandle).toBeFocused()
    await assertOrder(page, ['summary', 'experience', 'education', 'skills', 'projects'])

    await dragSection(page, 'projects', 'summary', 'before')
    await assertOrder(page, ['projects', 'summary', 'experience', 'education', 'skills'])
    await dragSection(page, 'projects', 'education', 'after')
    await assertOrder(page, ['summary', 'experience', 'education', 'projects', 'skills'])
    await page.locator('[data-sort-scroll="canvas"]').evaluate((element) => { element.scrollTop = 0 })
    await dragSection(page, 'experience', 'summary', 'before', true)
    await assertOrder(page, ['experience', 'summary', 'education', 'projects', 'skills'])

    const handle = page.locator('[data-outline-section="skills"]').getByRole('button', { name: 'Reorder Skills', exact: true })
    const from = await handle.boundingBox()
    const to = await page.locator('[data-outline-section="experience"]').boundingBox()
    await page.mouse.move(from.x + 8, from.y + 12)
    await page.mouse.down()
    await page.mouse.move(to.x + 30, to.y + 12, { steps: 8 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await assertOrder(page, ['experience', 'summary', 'education', 'projects', 'skills'])
    await expect(page.getByRole('status')).toContainText('cancelled')

    await selectSection(page, 'projects')
    await page.getByRole('button', { name: 'Remove from document' }).click()
    await assertOrder(page, ['experience', 'summary', 'education', 'skills'])
    await page.getByRole('button', { name: 'Add section', exact: true }).click()
    await page.getByRole('button', { name: 'Add Featured work', exact: true }).click()
    await expect(page.getByLabel('Section content', { exact: true })).toHaveValue('Accessible toolkit\nUsed by 12 teams.')

    await page.getByRole('button', { name: 'Add section', exact: true }).click()
    await page.getByRole('button', { name: /^Custom section/ }).click()
    const customId = await page.locator('[data-outline-section]').last().getAttribute('data-outline-section')
    await page.getByLabel('Section heading', { exact: true }).fill('Awards & distinctions')
    await page.getByLabel('Section content', { exact: true }).fill('Community design award')
    await page.getByRole('button', { name: 'Add bullet', exact: true }).click()
    await expect(page.getByLabel('Section content', { exact: true })).toHaveValue('- Community design award')
    await expect(page.locator(`[data-paper-section="${customId}"] li`)).toHaveText('Community design award')
    await expect.poll(() => page.locator(`[data-paper-section="${customId}"]`).evaluate((element) => {
      const stage = element.closest('[data-sort-scroll="canvas"]').getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      return bounds.top >= stage.top && bounds.top < stage.bottom - 20
    })).toBe(true)
    await dismissNotice(page)
    await page.screenshot({ path: path.join(screenshots, `section-editor-${theme}.png`) })

    await page.getByRole('button', { name: 'Page settings', exact: true }).first().click()
    await page.getByRole('group', { name: 'Page size', exact: true }).getByRole('button', { name: /US Letter/ }).click()
    await page.getByRole('combobox', { name: 'Typeface', exact: true }).click()
    await page.getByRole('option', { name: 'Georgia' }).click()
    await page.getByLabel('Body text size').fill('')
    await page.getByLabel('Body text size').pressSequentially('12.5')
    await expect(page.getByLabel('Body text size')).toHaveValue('12.5')
    await page.getByLabel('Body text size').press('Enter')
    await page.getByRole('button', { name: 'Airy', exact: true }).click()
    const margins = page.getByLabel('Page margins', { exact: true })
    await margins.press('End')
    for (let step = 0; step < 3; step++) await margins.press('ArrowLeft')
    await page.getByRole('button', { name: 'Violet accent', exact: true }).click()
    const geometry = await page.getByRole('article', { name: 'Resume draft' }).evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: parseFloat(style.width), minHeight: parseFloat(style.minHeight), padding: parseFloat(style.paddingLeft), font: style.fontFamily, fontSize: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight), gap: style.getPropertyValue('--resume-section-gap'), background: style.backgroundColor }
    })
    assert.equal(geometry.width, 816)
    assert.equal(geometry.minHeight, 1056)
    assert.ok(Math.abs(geometry.padding - 23 * 96 / 25.4) < .1)
    assert.ok(geometry.font.includes('Georgia'))
    assert.ok(Math.abs(geometry.fontSize - 12.5 * 96 / 72) < .1)
    assert.ok(Math.abs(geometry.leading / geometry.fontSize - 1.7) < .01)
    assert.equal(geometry.gap.trim(), '28px')
    assert.equal(geometry.background, 'rgb(255, 255, 255)')
    await page.screenshot({ path: path.join(screenshots, `page-settings-${theme}.png`) })
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    const afterZoom = await page.getByRole('article', { name: 'Resume draft' }).evaluate((element) => getComputedStyle(element).fontSize)
    assert.equal(parseFloat(afterZoom), geometry.fontSize)
    await page.getByRole('button', { name: 'Fit document to screen' }).click()

    await page.getByRole('group', { name: 'Document view', exact: true }).getByRole('button', { name: /Source/ }).click()
    const source = await page.locator('pre[aria-label="Generated LaTeX source"]').innerText()
    assert.ok(source.includes('letterpaper,margin=23mm'))
    assert.ok(source.includes('\\setmainfont{Georgia}'))
    assert.ok(source.includes('\\fontsize{12.5}{21.25}'))
    assert.ok(source.includes('Awards \\& distinctions'))
    assert.ok(source.includes('\\item Community design award'))
    assert.ok(source.includes('\\item Improved completion by 28\\%.'))
    assert.ok(source.includes('Ayesha Rahman \\& Co.'))
    assert.ok(source.indexOf('\\section*{Experience}') < source.indexOf('\\section*{Career overview}'))
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export .tex', exact: true }).click()
    const download = await downloadPromise
    assert.ok(download.suggestedFilename().endsWith('.tex'))
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString('utf8'), source)

    await page.getByRole('group', { name: 'Document view', exact: true }).getByRole('button', { name: 'Visual', exact: true }).click()
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
    await expect(page.getByLabel('Body text size')).toHaveValue('11')
    await expect(page.getByRole('group', { name: 'Page size', exact: true }).getByRole('button', { name: /^A4/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator(`[data-paper-section="${customId}"]`)).toContainText('Community design award')

    // Draft PDF: the print pipeline runs with @page setup built from the page
    // settings, and the temporary document title names the file plainly.
    const pageTitle = await page.title()
    await page.evaluate(() => {
      window.__pdfPrint = { calls: 0, page: null, title: null }
      window.print = () => {
        window.__pdfPrint.calls += 1
        window.__pdfPrint.page = document.getElementById('mr-resume-print-setup')?.textContent ?? null
        window.__pdfPrint.title = document.title
      }
    })
    await page.getByRole('button', { name: 'Download draft PDF', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__pdfPrint.calls)).toBe(1)
    assert.equal(await page.evaluate(() => window.__pdfPrint.page), '@page { size: 210mm 297mm; margin: 18mm; }')
    assert.ok((await page.evaluate(() => window.__pdfPrint.title)).endsWith('-draft-pdf'))
    // The @page rule and the real document title are restored after the dialog.
    await expect.poll(() => page.evaluate(() => document.getElementById('mr-resume-print-setup'))).toBe(null)
    await expect.poll(() => page.evaluate(() => document.title)).toBe(pageTitle)
    await page.evaluate(() => { delete window.__pdfPrint })

    await page.getByRole('combobox', { name: 'Document language', exact: true }).click()
    await page.getByRole('option', { name: 'বাংলা' }).click()
    const banglaName = '\u0986\u09ae\u09be\u09b0 \u09b0\u09c7\u099c\u09c1\u09ae\u09c7'
    await page.getByLabel('Document title', { exact: true }).fill(banglaName)
    const banglaDownloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export .tex', exact: true }).click()
    assert.equal((await banglaDownloadPromise).suggestedFilename(), `${banglaName.replace(' ', '-')}.tex`)
    await expect(page.getByRole('article', { name: 'Resume draft' })).toHaveAttribute('lang', 'bn')
    await expect(page.locator('[data-paper-section="summary"] h3')).toHaveText('Career overview')
    await expect(page.locator('[data-paper-section="summary"]')).toContainText('I build useful products')
    await page.getByRole('combobox', { name: 'Document purpose', exact: true }).click()
    await page.getByRole('option', { name: 'Biodata' }).click()
    await assertOrder(page, ['education', 'personal'])
    await page.getByRole('combobox', { name: 'Document purpose', exact: true }).click()
    await page.getByRole('option', { name: 'Resume' }).click()
    await page.getByRole('combobox', { name: 'Document language', exact: true }).click()
    await page.getByRole('option', { name: 'English' }).click()

    // Guest autosave: a reload restores the saved document from this device.
    // The outline selection is deliberately not persisted — Profile is active
    // again after the reload, so its restored fields are checked first.
    // 'Career overview' also lives in the framework's intermediate Biodata
    // snapshot (content is kept in the library after a section is removed), so
    // the flush is signalled by the final snapshot's own section list instead.
    await expect.poll(() => page.evaluate(() => {
      try {
        const document = JSON.parse(localStorage.getItem('mr-resume:draft:v1') || '')?.document
        return Array.isArray(document?.enabled) ? document.enabled.join(',') : ''
      } catch {
        return ''
      }
    })).toBe('profile,summary,experience,education,skills')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(async () => {
      await page.getByLabel('Full name', { exact: true }).fill('Ayesha Rahman & Co.')
      await expect(page.locator('[data-paper-section="profile"] h2')).toHaveText('Ayesha Rahman & Co.', { timeout: 1000 })
    }).toPass({ timeout: 60000 })
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Ayesha Rahman & Co.')
    await expect(async () => {
      await selectSection(page, 'summary')
      await expect(page.getByLabel('Section heading', { exact: true })).toHaveValue('Career overview', { timeout: 2000 })
    }).toPass({ timeout: 60000 })
    await expect(page.getByLabel('Section content', { exact: true })).toHaveValue(body)
    await noPageOverflow(page)
    assert.deepEqual(errors, [])
    assert.deepEqual(backendCalls, [], 'The UI must not invoke a backend')
    reports.push({ case: `desktop-${theme}`, status: 'passed', contrast: ratios })
    console.log(`PASS desktop-${theme}: editing, ordering, page settings, source and export`)
    await context.close()
  }

  for (const [name, viewport] of [['tablet', { width: 820, height: 1180 }], ['compact', { width: 640, height: 960 }], ['mobile', { width: 390, height: 844 }], ['narrow', { width: 320, height: 740 }]]) {
    for (const theme of ['light', 'dark']) {
      const { context, page, errors, backendCalls } = await openStudio(theme, viewport, true, 'reduce')
      const panels = page.getByRole('navigation', { name: 'Studio panels', exact: true })
      await page.getByRole('combobox', { name: 'Document purpose', exact: true }).click()
      await page.getByRole('option', { name: 'Statement of purpose' }).click()
      await noPageOverflow(page)
      await page.getByRole('combobox', { name: 'Document purpose', exact: true }).click()
      await page.getByRole('option', { name: 'Resume', exact: true }).click()
      await expect(page.locator('#section-content')).toBeVisible()
      assert.ok(await page.locator('#section-content').evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 16 || innerWidth > 600))
      await noPageOverflow(page)
      await page.screenshot({ path: path.join(screenshots, `${name}-write-${theme}.png`) })
      await panels.getByRole('button', { name: 'Sections', exact: true }).click()
      await expect(page.locator('[aria-label="Resume sections"]')).toBeVisible()
      await expect(page.locator('[aria-label="Live document preview"]')).toBeHidden()
      const handle = page.locator('[data-outline-section="experience"]').getByRole('button', { name: 'Reorder Experience', exact: true })
      await handle.scrollIntoViewIfNeeded()
      const from = await handle.boundingBox()
      const to = await page.locator('[data-outline-section="summary"]').boundingBox()
      const cdp = await context.newCDPSession(page)
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      const finish = { x: to.x + to.width / 2, y: to.y + 10 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
      for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (finish.x - start.x) * step / 8, y: start.y + (finish.y - start.y) * step / 8, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(() => order(page)).toEqual(['experience', 'summary', 'education', 'skills'])

      // Releasing a second finger must not commit or cancel the first finger's drag.
      const primary = page.locator('[data-outline-section="summary"]').getByRole('button', { name: 'Reorder Professional summary', exact: true })
      await primary.scrollIntoViewIfNeeded()
      const primaryBox = await primary.boundingBox()
      const secondaryBox = await page.locator('[data-outline-section="experience"]').getByRole('button', { name: 'Reorder Experience', exact: true }).boundingBox()
      const targetBox = await page.locator('[data-outline-section="experience"]').boundingBox()
      const first = { x: primaryBox.x + primaryBox.width / 2, y: primaryBox.y + primaryBox.height / 2, id: 11 }
      const moved = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 12, id: 11 }
      const second = { x: secondaryBox.x + secondaryBox.width / 2, y: secondaryBox.y + secondaryBox.height / 2, id: 22 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] })
      await expect(page.locator('[data-dragging]')).toHaveAttribute('data-dragging', 'true')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, second] })
      // CDP releases a removed contact through the next active-point set.
      // touchEnd itself ends the entire gesture and must have no touch points.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] })
      await expect(page.locator('[data-dragging]')).toHaveAttribute('data-dragging', 'true')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await expect(page.locator('[data-dragging]')).toHaveAttribute('data-dragging', 'false')
      await expect.poll(() => order(page)).toEqual(['experience', 'summary', 'education', 'skills'])
      await cdp.detach()
      await selectSection(page, 'experience')
      await expect(page.locator('#section-title')).toBeFocused()
      await page.getByLabel('Section content', { exact: true }).fill('Edited on a small screen.\n\n- All content stays editable.')
      await panels.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(page.locator('[aria-label="Document inspector"]')).toBeHidden()
      await expect(page.getByRole('article', { name: 'Resume draft' })).toBeVisible()
      await expect(page.locator('[data-paper-section="experience"]')).toContainText('Edited on a small screen.')
      await assertOrder(page, ['experience', 'summary', 'education', 'skills'])
      await noPageOverflow(page)
      await page.screenshot({ path: path.join(screenshots, `${name}-preview-${theme}.png`) })
      await panels.getByRole('button', { name: 'Page', exact: true }).click()
      const fileName = `${name}-${theme}-document`
      await page.getByLabel(viewport.width <= 750 ? 'Document name' : 'Document title', { exact: true }).fill(fileName)
      const mobileDownloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export .tex', exact: true }).click()
      assert.equal((await mobileDownloadPromise).suggestedFilename(), `${fileName}.tex`)
      await page.getByRole('group', { name: 'Page size', exact: true }).getByRole('button', { name: /US Letter/ }).click()
      await panels.getByRole('button', { name: 'Preview', exact: true }).click()
      await noPageOverflow(page)
      await panels.getByRole('button', { name: 'Write', exact: true }).click()
      await expect(page.getByLabel('Section content', { exact: true })).toHaveValue('Edited on a small screen.\n\n- All content stays editable.')
      await noPageOverflow(page)
      assert.deepEqual(errors, [])
      assert.deepEqual(backendCalls, [])
      reports.push({ case: `${name}-${theme}-touch-reduced-motion`, status: 'passed' })
      console.log(`PASS ${name}-${theme}: touch ownership, focus, naming and responsive panels`)
      await context.close()
    }
  }
  console.log(JSON.stringify({ results: reports, screenshots }, null, 2))
} finally {
  await browser.close()
}
