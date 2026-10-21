// Live reproduction + verification for TablePicker positioning and preview
// table overflow. Run: node scripts/verify-table-picker.mjs <baseURL>
import { chromium } from '@playwright/test'

const baseURL = process.argv[2] || 'http://localhost:3000'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })

await page.goto(`${baseURL}/mr-markdown`, { waitUntil: 'domcontentloaded' })

// ── Open a blank editor workspace ────────────────────────────────────────────
const blank = page.getByRole('button', { name: /write in editor|blank markdown/i }).first()
await blank.waitFor({ state: 'visible', timeout: 20000 })
await blank.click()
const workspace = page.locator('.mr-markdown-workspace')
await workspace.waitFor({ state: 'visible', timeout: 20000 })

const results = {}

// ── 1. Rail → Table builder → "Choose table size" → picker position ─────────
await page.getByRole('button', { name: 'Table builder' }).click()
// Let the panel's entrance animation (180ms, scaled transform) fully settle so
// every rect below is final geometry, not mid-animation geometry.
await page.waitForTimeout(300)
// Measure the rail panel BEFORE clicking "Choose table size" — the panel
// unmounts the moment that click fires.
const panelRect = await page.locator('.mr-premium-rail-panel').evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { right: r.right, top: r.top }
})
await page.getByRole('button', { name: /choose table size/i }).click()
const picker = page.locator('.pm-table-picker')
await picker.waitFor({ state: 'visible', timeout: 5000 })
await page.waitForTimeout(200) // let the picker's own entrance animation settle

results.picker = await picker.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return {
    rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    overflowRight: r.right > window.innerWidth + 1,
    overflowBottom: r.bottom > window.innerHeight + 1,
    offsetParent: el.offsetParent ? el.offsetParent.className : null,
    computedPosition: getComputedStyle(el).position,
  }
})
// Correct placement assertions (relational, scrollbar-proof):
//  1. picker sits just beside the settled rail panel (its right edge + 8px gap)
//  2. picker never reaches into the preview pane  ← the original bug symptom
//  3. no viewport overflow
const p = results.picker.rect
const editorPaneLeft = await page.locator('.pm-ws-editor').evaluate((el) => el.getBoundingClientRect().left)
const previewLeft = await page.locator('.pm-ws-preview').evaluate((el) => el.getBoundingClientRect().left)
results.railPanelRef = panelRect
results.pickerBesideRail = p.left >= panelRect.right - 2 && p.left <= panelRect.right + 8 + 6
results.pickerClearOfPreview = p.right <= previewLeft
results.pickerLeftOfEditorEnd = p.left < editorPaneLeft + 200
results.previewLeftRef = previewLeft

// Outside-click must close it (baseline behavior)
await page.mouse.click(700, 500)
results.pickerOutsideClickCloses = await picker.count() === 0

// ── 1b. Toolbar button flow: picker must open under the button, still inside
//        the editor column (never over the preview pane).
const toolbarBtn = page.getByRole('button', { name: 'Insert table' })
await toolbarBtn.click()
await picker.waitFor({ state: 'visible', timeout: 5000 })
results.toolbarPicker = await picker.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const btn = document.querySelector('button[title="Insert table"]').getBoundingClientRect()
  const pane = document.querySelector('.pm-ws-editor').getBoundingClientRect()
  return {
    rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
    btnRect: { top: btn.top, left: btn.left, bottom: btn.bottom },
    // Picker hangs below the button's top edge, roughly left-aligned with it.
    underButton: Math.abs(r.left - btn.left) < 40 && r.top >= btn.top - 2,
    // And it must never spill into the preview pane.
    insideEditorColumn: r.right <= pane.right + 1,
  }
})
await page.keyboard.press('Escape')
await picker.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})

// ── 2. Insert an 8×8 table via the toolbar picker and measure preview overflow
const ta = page.locator('.pm-editor-textarea')
await ta.click()
await ta.fill(
  '# Big table test\n\n' +
  '| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
  Array.from({ length: 8 }, (_, i) => `| R${i}c1 | R${i}c2 | R${i}c3 | R${i}c4 | R${i}c5 | R${i}c6 | R${i}c7 | R${i}c8 |`).join('\n') +
  '\n',
)
// Trigger preview render (edit event already fired via fill) and give it a beat
await page.waitForTimeout(400)

const pane = page.locator('.pm-ws-preview')
results.preview = await pane.evaluate((el) => {
  const table = el.querySelector('table')
  const body = el.querySelector('.pm-preview-body')
  const inner = el.querySelector('.pm-preview-inner')
  const paneR = el.getBoundingClientRect()
  const bodyR = body ? body.getBoundingClientRect() : null
  const tableR = table ? table.getBoundingClientRect() : null
  return {
    paneRect: { w: paneR.width, right: paneR.right },
    bodyScrollWidth: body ? body.scrollWidth : null,
    bodyClientWidth: body ? body.clientWidth : null,
    bodyHorizontalScrollable: body ? body.scrollWidth > body.clientWidth + 1 : null,
    tableRight: tableR ? tableR.right : null,
    tableWidth: tableR ? tableR.width : null,
    innerWidth: inner ? inner.getBoundingClientRect().width : null,
    tableComputedWidth: table ? getComputedStyle(table).width : null,
  }
})

// Check cells actually wrap instead of stretching the table
results.previewFirstCellWrap = await page.locator('.pm-preview-body td').first().evaluate((el) => {
  const s = getComputedStyle(el)
  const cellR = el.getBoundingClientRect()
  return { wordBreak: s.wordBreak, overflowWrap: s.overflowWrap, width: cellR.width }
})

console.log(JSON.stringify(results, null, 2))
if (logs.length) console.log('PAGE ERRORS:\n' + logs.join('\n'))
await page.screenshot({ path: 'test-results/mr-markdown/table-picker-verify.png', fullPage: false })
await browser.close()

// ── 3. Narrow-viewport stress test: preview pane is much smaller here, so the
//        8×8 table must still stay inside the card (scroll within, not overflow).
const browser2 = await chromium.launch()
const page2 = await browser2.newPage({ viewport: { width: 1024, height: 760 } })
await page2.goto(`${baseURL}/mr-markdown`, { waitUntil: 'domcontentloaded' })
const blank2 = page2.getByRole('button', { name: /write in editor|blank markdown/i }).first()
await blank2.waitFor({ state: 'visible', timeout: 20000 })
await blank2.click()
await page2.locator('.mr-markdown-workspace').waitFor({ state: 'visible', timeout: 20000 })
const ta2 = page2.locator('.pm-editor-textarea')
await ta2.click()
await ta2.fill(
  '# Narrow viewport\n\n' +
  '| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
  Array.from({ length: 8 }, (_, i) => `| R${i}c1 | R${i}c2 | R${i}c3 | R${i}c4 | R${i}c5 | R${i}c6 | R${i}c7 | R${i}c8 |`).join('\n') +
  '\n',
)
await page2.waitForTimeout(400)
const narrow = await page2.evaluate(() => {
  const card = document.querySelector('.pm-preview-inner')
  const table = document.querySelector('.pm-preview-body table')
  const pane = document.querySelector('.pm-ws-preview')
  if (!card || !table || !pane) return { found: false }
  const cr = card.getBoundingClientRect()
  const tr = table.getBoundingClientRect()
  const pr = pane.getBoundingClientRect()
  return {
    found: true,
    cardInsidePane: cr.right <= pr.right + 1,
    tableInsideCard: tr.right <= cr.right + 1 && tr.left >= cr.left - 1,
    tableScrollsInside: getComputedStyle(table).overflowX === 'auto',
    cardRight: cr.right,
    tableRight: tr.right,
  }
})
console.log('NARROW VIEWPORT (1024px):', JSON.stringify(narrow, null, 2))
await page2.screenshot({ path: 'test-results/mr-markdown/table-picker-narrow.png', fullPage: false })
await browser2.close()
