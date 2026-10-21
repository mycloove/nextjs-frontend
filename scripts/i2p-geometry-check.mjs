/* Geometry assertions for the Light Table rewrite — verifies the
   design's honesty claims numerically instead of by eye:
   1. Each .i2p-page box has the image's true aspect ratio (the
      route embeds at native size up to a 4000 px long-side cap,
      preserving the image's ratio — the tile must not lie).
   2. The bottom-trim cut overlay covers exactly cropPercentage%
      of the page box.
   3. The corner-trim overlay is square in *page-box* percentage
      terms (matching cropImage's pct-from-both-edges semantics).
   4. Collate press applies a staggered delay per page. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'i2p-verify-out')
const BASE = process.env.I2P_BASE || 'http://localhost:3000'

async function makeImages() {
  const dir = path.join(OUT, 'imgs')
  const specs = [
    ['geo-landscape.jpg', 900, 620],
    ['geo-portrait.png', 620, 900],
    ['geo-panorama.png', 1400, 360],
  ]
  for (const [name, w, h] of specs) {
    await sharp({ create: { width: w, height: h, channels: 3, background: '#456' } })
      [name.endsWith('.jpg') ? 'jpeg' : 'png']().toFile(path.join(dir, name))
  }
  return specs.map(([name]) => path.join(dir, name))
}

const close = (a, b, tol) => Math.abs(a - b) <= tol

async function run() {
  const images = await makeImages()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
  await page.addInitScript(() => localStorage.setItem('smilepdf-theme', 'dark'))
  await page.goto(BASE + '/image-to-pdf', { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', images)
  await page.waitForFunction(() => {
    const metas = Array.from(document.querySelectorAll('.i2p-meta-text'))
    return metas.length === 3 && metas.every(m => !m.textContent.includes('…'))
  }, { timeout: 15000 })
  await page.waitForTimeout(700) // let the entrance settle

  const ratios = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.i2p-page')).map(p => {
      const r = p.getBoundingClientRect()
      return { w: r.width, h: r.height, ar: r.width / r.height }
    }))

  const expected = [
    { name: 'landscape', ar: 900 / 620 },
    { name: 'portrait', ar: 620 / 900 },
    { name: 'panorama', ar: 1400 / 360 },
  ]
  let failed = 0
  ratios.forEach((r, i) => {
    const ok = close(r.ar, expected[i].ar, 0.02)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} page[${expected[i].name}] ratio ${r.ar.toFixed(3)} ≈ ${expected[i].ar.toFixed(3)} (${r.w.toFixed(0)}×${r.h.toFixed(0)}px)`)
  })

  // Bottom-trim overlay: height must be cropPercentage% of the IMAGE
  // (the honest reference — cropImage trims pct of image pixels; the
  // page's 1px border must not pollute the measurement).
  await page.click('.i2p-panel-head')
  await page.click('.i2p-radio-row:nth-child(2)') // bottom edge
  await page.selectOption('.i2p-select', '10')
  await page.waitForTimeout(200)
  const bottomCut = await page.evaluate(() => {
    const cut = document.querySelector('.i2p-cut--bottom')
    const img = cut.closest('.i2p-page').querySelector('img')
    const cr = cut.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    return { pct: (cr.height / ir.height) * 100, widthPct: (cr.width / ir.width) * 100 }
  })
  {
    const ok = close(bottomCut.pct, 10, 0.6) && close(bottomCut.widthPct, 100, 0.6)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} bottom-cut covers ${bottomCut.pct.toFixed(1)}% of image height (want 10) and ${bottomCut.widthPct.toFixed(1)}% of width (want 100)`)
  }

  // Corner-trim overlay: square cut from the bottom-right corner
  await page.click('.i2p-radio-row:nth-child(1)')
  await page.waitForTimeout(200)
  const cornerCut = await page.evaluate(() => {
    const cut = document.querySelector('.i2p-cut--corner')
    const img = cut.closest('.i2p-page').querySelector('img')
    const cr = cut.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    return { wPct: (cr.width / ir.width) * 100, hPct: (cr.height / ir.height) * 100 }
  })
  {
    const ok = close(cornerCut.wPct, 10, 0.6) && close(cornerCut.hPct, 10, 0.6)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} corner-cut is ${cornerCut.wPct.toFixed(1)}%×${cornerCut.hPct.toFixed(1)}% of the image (want 10×10)`)
  }

  // Collate stagger: hold the API open so the table stays mounted
  // mid-bind, then read each tile's computed animation delay.
  await page.click('.i2p-panel-head') // trim off
  await page.route('**/api/images-to-pdf', async route => {
    await new Promise(r => setTimeout(r, 2500))
    await route.continue()
  })
  await page.click('.i2p-bind-btn')
  await page.waitForTimeout(300)
  const delays = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.i2p-tile')).map(t =>
      parseFloat(getComputedStyle(t).animationDelay) * 1000))
  await page.unroute('**/api/images-to-pdf')
  const staggered = delays.length === 3 && delays[1] > delays[0] && delays[2] > delays[1]
  if (!staggered) failed++
  console.log(`${staggered ? 'PASS' : 'FAIL'} collate stagger delays: ${delays.map(d => d + 'ms').join(', ')}`)

  await browser.close()
  if (failed) { console.error(`\n${failed} assertion(s) FAILED`); process.exit(1) }
  console.log('\nALL GEOMETRY ASSERTIONS PASSED')
}

run().catch(e => { console.error(e); process.exit(1) })
