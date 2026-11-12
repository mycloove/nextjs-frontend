// The gallery's live preview against a running frontend:
//   MR_RESUME_BASE_URL=http://localhost:3000 node --experimental-strip-types tests/mr-resume/preview.ui.test.mjs
//
// What it holds the preview to: the sheet in the dialog is the page the editor
// opens, block for block; its page count is the measured one; and a start from
// the preview never replaces a draft without the editor asking first.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const base = process.env.MR_RESUME_BASE_URL || 'http://127.0.0.1:3125'
const { resumeTemplates } = await import('../../features/mr-resume/components/resumeTemplates.ts')
const { templateThumbnails } = await import('../../features/mr-resume/home/templateThumbnails.ts')
const browser = await chromium.launch({ headless: true })

async function openHome({ reducedMotion = 'no-preference', viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion })
  await context.addInitScript(() => { localStorage.setItem('smilepdf-theme', 'light'); localStorage.setItem('mr-resume:editor-language:v1', 'English') })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/mr-resume`, { waitUntil: 'networkidle', timeout: 180000 })
  await page.locator('#templates button[aria-haspopup="dialog"]').first().waitFor({ timeout: 60000 })
  return { context, page, errors }
}

// Cards are listed in template order, so a template's card is at its own index.
async function openPreview(page, id) {
  const trigger = page.locator('#templates button[aria-haspopup="dialog"]').nth(resumeTemplates.findIndex((item) => item.id === id))
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  await settle(page)
}

async function settle(page) {
  await page.locator('dialog[open] [data-proof-stage] > [data-ready="true"]').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

// Every block's place on the unscaled page: equal lists mean one layout.
const geometry = (root) => root.locator('article[data-layout]').evaluate((paper) => ({
  height: paper.offsetHeight, layout: paper.dataset.layout, accent: paper.style.getPropertyValue('--resume-accent'), name: paper.querySelector('h2').textContent,
  blocks: [...paper.querySelectorAll('header, section, h2, h3, p, li, hr')].map((node) => `${node.tagName}:${node.offsetTop}:${node.offsetHeight}:${node.offsetWidth}`),
}))

async function startAndCompare(page, label) {
  const preview = await geometry(page.locator('dialog[open]'))
  await page.locator('dialog[open] [class*="previewActions"] button').click()
  return { preview, compare: async () => {
    await page.waitForFunction((name) => document.querySelector('#mr-resume-panel-regular article[data-layout] h2')?.textContent === name, preview.name)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1000)
    const editor = await geometry(page.locator('#mr-resume-panel-regular'))
    assert.deepEqual({ layout: editor.layout, accent: editor.accent, height: editor.height }, { layout: preview.layout, accent: preview.accent, height: preview.height }, `${label}: the editor opened another sheet`)
    assert.deepEqual(editor.blocks, preview.blocks, `${label}: a block sits elsewhere in the editor`)
  } }
}

try {
  // 1. A picture, not an editor: measured pages, no working links, none of the editor's hooks.
  {
    const { context, page, errors } = await openHome()
    await openPreview(page, resumeTemplates[0].id)
    for (const [index, template] of resumeTemplates.entries()) {
      await page.waitForFunction((layout) => document.querySelector('dialog[open] article[data-layout]')?.dataset.layout === layout, template.layout)
      await settle(page)
      const live = await page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]'), paper = dialog.querySelector('article[data-layout]')
        return { pages: Math.max(1, Math.ceil((paper.offsetHeight - 2) / (paper.offsetWidth * 297 / 210))), marks: dialog.querySelectorAll('[class*="pageEnd"]').length, hrefs: paper.querySelectorAll('a[href]').length, controls: paper.querySelectorAll('button, [data-flip-key], [data-sort-id], [data-banglish-field]').length, badge: [...dialog.querySelectorAll('[class*="previewInfo"] > ul li')].map((item) => item.textContent).join(' | ') }
      })
      assert.equal(live.pages, templateThumbnails[`regular:${template.id}`].pages, `${template.id}: the live page and its card disagree on pages`)
      assert.equal(live.marks, live.pages - 1, `${template.id}: one mark per page end`)
      assert.match(live.badge, live.pages === 1 ? /One page/u : new RegExp(`${live.pages} pages`, 'u'), `${template.id}: the badge follows the measured page`)
      assert.deepEqual([live.hrefs, live.controls], [0, 0], `${template.id}: the preview page is not interactive`)
      if (index < resumeTemplates.length - 1) await page.getByRole('button', { name: 'Next template', exact: true }).click()
    }
    // Arrow keys step through templates, except inside a field or the scrolling page.
    const title = () => page.locator('dialog[open] #resume-preview-title').textContent()
    const before = await title()
    await page.locator('dialog[open] fieldset select').focus(); await page.keyboard.press('ArrowLeft')
    await page.locator('dialog[open] [data-proof-stage]').focus(); await page.keyboard.press('ArrowLeft')
    assert.equal(await title(), before)
    await page.getByRole('button', { name: 'Previous template', exact: true }).focus(); await page.keyboard.press('ArrowLeft')
    await expectChange(title, before)
    await page.keyboard.press('Escape')
    await page.locator('dialog[open]').waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    await context.close()
  }

  // 2. The sheet in the preview is the page the editor opens: every template as made, then some redesigned.
  const redesigned = [['corporate-sidebar', 'banner', 7], ['creative-portfolio', 'twocol', null], ['teacher-cv', 'sidebar', 1], ['bank-officer', 'executive', 3], ['government-biodata', 'compact', null]]
  for (const [id, layout, ink] of [...resumeTemplates.map((item) => [item.id, null, null]), ...redesigned]) {
    const { context, page, errors } = await openHome()
    await openPreview(page, id)
    if (layout) await page.locator('dialog[open] fieldset select').selectOption(layout)
    if (ink !== null) await page.locator('dialog[open] fieldset input[type="radio"]').nth(ink).check({ force: true })
    await settle(page)
    const { compare } = await startAndCompare(page, `${id}${layout ? ` as ${layout}` : ''}`)
    await compare()
    // The request is taken out of the URL once handed over (the router's replace lands a moment after the page).
    await page.waitForURL((url) => url.search === '', { timeout: 15000 })
    assert.deepEqual(errors, [])
    await context.close()
  }

  // 3. With a draft on the device, the outline in another design asks first, names the design, and keeps a restore copy.
  {
    const { context, page } = await openHome()
    await openPreview(page, 'job-resume')
    await (await startAndCompare(page, 'job-resume')).compare()
    await page.waitForFunction(() => localStorage.getItem('mr-resume:draft:v1')?.includes('job-resume'))
    await page.goto(`${base}/mr-resume`, { waitUntil: 'networkidle' })
    await openPreview(page, 'corporate-sidebar')
    await page.locator('dialog[open] fieldset button', { hasText: 'Outline prompts' }).click()
    await page.locator('dialog[open] fieldset select').selectOption('banner')
    await settle(page)
    assert.equal(await page.locator('dialog[open] [class*="previewActions"] button').textContent(), 'Start with this outline')
    const { compare } = await startAndCompare(page, 'corporate-sidebar as banner')
    const confirm = page.locator('#mr-resume-panel-regular dialog[open]')
    await confirm.waitFor()
    assert.equal(await page.locator('#mr-resume-panel-regular article[data-layout]').getAttribute('data-layout'), 'classic', 'Nothing is applied before the answer')
    assert.match(await confirm.textContent(), /Chosen in the gallery: Layout: Banner/u)
    const apply = confirm.getByRole('button', { name: 'Apply with restore copy', exact: true })
    assert.equal(await apply.isDisabled(), true, 'An older restore copy is not replaced without saying so')
    await confirm.locator('input[type="checkbox"]').check()
    await apply.click()
    await compare()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mr-resume:template-backup:v1')).document.templateId), 'job-resume')
    // A design the catalog does not know is dropped, not applied.
    await page.goto(`${base}/mr-resume/regular-editor?template=bank-officer&layout=%3Cscript%3E&accent=ff0000`, { waitUntil: 'networkidle' })
    await confirm.waitFor()
    assert.doesNotMatch(await confirm.textContent(), /Chosen in the gallery/u)
    await context.close()
  }

  // 4. The proof pull flies the card's picture once; reduced motion skips it.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { context, page } = await openHome({ reducedMotion })
    await page.evaluate(() => { window.__flights = 0; const animate = Element.prototype.animate; Element.prototype.animate = function (...args) { if (this.matches('dialog img[aria-hidden="true"]')) window.__flights++; return animate.apply(this, args) } })
    await openPreview(page, 'corporate-sidebar')
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => window.__flights), reducedMotion === 'reduce' ? 0 : 1, reducedMotion)
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open] img[aria-hidden="true"]').hidden), true, 'The flown copy is put away')
    await context.close()
  }
  console.log(`preview.ui: ${resumeTemplates.length} templates, ${resumeTemplates.length + redesigned.length} sheets compared with the editor, all equal`)
} finally {
  await browser.close()
}

async function expectChange(read, before) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await read() !== before) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail('The arrow key on a plain control did not step to another template')
}
