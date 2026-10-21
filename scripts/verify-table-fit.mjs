// Standalone CSS verification — NO dev server needed. Loads the real
// 02-workspace-layout.css into a synthetic page and measures table geometry:
//  1. narrow table → border hugs the last column (no dead gap after column 8)
//  2. wide table   → stays inside the card, scrolls horizontally inside
// Run: node scripts/verify-table-fit.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'

const css = readFileSync(new URL('../components/PDFToMarkdown/styles/premium/02-workspace-layout.css', import.meta.url), 'utf8')

const vars = `:root{
  --pm-border-strong:#8a8278; --pm-border-subtle:#ddd6cc; --pm-r-sm:6px; --pm-r-md:8px;
  --pm-bg-inset:#f6f3ec; --pm-bg-elevated:#fff; --pm-bg-surface:#fff; --pm-bg-canvas:#f7f4ef;
  --pm-text-primary:#1a1612; --pm-text-secondary:#4a443c; --pm-text-muted:#8a8278;
  --pm-brand-300:#b9a7ff; --pm-brand-400:#8b6cff; --pm-brand-500:#7c5cff; --pm-info-soft:#eef;
  --pm-dur-fast:100ms; --pm-font-sans:sans-serif; --pm-font-display:sans-serif; --pm-font-mono:monospace;
}
.pm-preview-body{width:1200px;padding:0;} /* wide full-view pane */
.card{max-width:680px;margin:0 auto;padding:46px 48px;border:1px solid #ccc;background:#fff}
.card.narrow{max-width:none;width:380px}
`

const table8 = (() => {
  const head = `| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |`
  const sep = `| --- | --- | --- | --- | --- | --- | --- | --- |`
  const rows = Array.from({ length: 8 }, (_, i) => `| R${i}c1 | R${i}c2 | R${i}c3 | R${i}c4 | R${i}c5 | R${i}c6 | R${i}c7 | R${i}c8 |`)
  // raw markdown → hand-rendered html identical to renderMarkdownToHtml output
  const th = (t) => `<th style="text-align:left">${t}</th>`
  const td = (t) => `<td style="text-align:left">${t}</td>`
  return `<table><thead><tr>${['C1','C2','C3','C4','C5','C6','C7','C8'].map(th).join('')}</tr></thead><tbody>` +
    Array.from({ length: 8 }, (_, i) => `<tr>${[1,2,3,4,5,6,7,8].map(c => td(`R${i}c${c}`)).join('')}</tr>`).join('') +
    `</tbody></table>`
})()

const tableWide = `<table><thead><tr>${Array.from({ length: 12 }, (_, i) => `<th style="text-align:left">ColumnHeader${i + 1} VeryLongHeaderName</th>`).join('')}</tr></thead><tbody>` +
  Array.from({ length: 6 }, (_, r) => `<tr>${Array.from({ length: 12 }, (_, c) => `<td style="text-align:left">cell-${r}-${c}-with-a-really-long-unbreakable-token-value-${r}${c}</td>`).join('')}</tr>`).join('') +
  `</tbody></table>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.setContent(`<html><head><style>${vars}</style><style>${css}</style></head>
<body>
  <div class="pm-preview-body">
    <div class="card pm-preview-inner" id="wide-card">${table8}</div>
    <div class="card pm-preview-inner narrow" id="narrow-card">${tableWide}</div>
    <div class="card pm-preview-inner" id="small-card"><table><thead><tr><th style="text-align:left">ID</th></tr></thead><tbody><tr><td style="text-align:left">42</td></tr></tbody></table></div>
  </div>
</body></html>`)
await page.waitForTimeout(100)

const out = await page.evaluate(() => {
  const measure = (cardSel) => {
    const card = document.querySelector(cardSel)
    const table = card.querySelector('table')
    const lastCell = table.querySelector('tbody tr:last-child td:last-child')
    const cardR = card.getBoundingClientRect()
    const tR = table.getBoundingClientRect()
    const cR = lastCell.getBoundingClientRect()
    const cardContentRight = cardR.right - parseFloat(getComputedStyle(card).paddingRight)
    return {
      tableWidth: Math.round(tR.width),
      // dead gap between the last column's right edge and the table border:
      gapAfterLastColumn: Math.round(tR.right - cR.right),
      insideCard: tR.right <= cardContentRight + 2,
      horizontalScroll: table.scrollWidth > table.clientWidth + 1,
    }
  }
  return {
    narrow8x8_inWideCard: measure('#wide-card'),
    wideTable_inNarrowCard: measure('#narrow-card'),
    tinyTable: measure('#small-card'),
  }
})
console.log(JSON.stringify(out, null, 2))
await page.screenshot({ path: 'test-results/mr-markdown/table-fit-verify.png', fullPage: true })
await browser.close()

const a = out.narrow8x8_inWideCard
const b = out.wideTable_inNarrowCard
const pass = a.gapAfterLastColumn <= 2 && a.insideCard && !a.horizontalScroll &&
  b.insideCard && b.gapAfterLastColumn <= 2 &&
  out.tinyTable.gapAfterLastColumn <= 2
console.log(pass ? 'ALL TABLE FIT CHECKS PASS' : 'TABLE FIT CHECKS FAILED')
process.exit(pass ? 0 : 1)
