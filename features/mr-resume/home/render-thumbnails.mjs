// Renders every gallery thumbnail from the template's REAL output and writes
// templateThumbnails.ts. Nothing is drawn by hand:
//   - Regular: the editor page itself, opened through the gallery deep link
//     with the template's specimen (/mr-resume/regular-editor?template=<id>&sample=1)
//     in a fresh browser profile: the page a guest gets from "Start with the sample text".
//   - LaTeX: the pinned browser compiler's PDF (browser/gallery-smoke.mjs fixtures),
//     page 1 rasterised with PDF.js.
//
// Run (Node >= 22.12, with the frontend dev server on BASE_URL):
//   node --experimental-strip-types features/mr-resume/home/render-thumbnails.mjs [--base=http://localhost:3000] [--only=regular|latex] [--id=<regular template id>]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../../..')
const publicRoot = path.join(frontend, 'public')
const outputRoot = path.join(publicRoot, 'mr-resume', 'templates')
const base = process.argv.find((item) => item.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000'
const only = process.argv.find((item) => item.startsWith('--only='))?.slice(7)
// One Regular template while iterating on its specimen: --only=regular --id=<template id>
const onlyId = process.argv.find((item) => item.startsWith('--id='))?.slice(5)
const CARD_WIDTH = 480, FULL_WIDTH = 1100

const { resumeTemplates } = await import('../components/resumeTemplates.ts')
const { resumeSpecimen } = await import('../components/resumeSpecimens.ts')
const { latexTemplateCards } = await import('../latex/latexTemplateCards.ts')
const { latexSourceTemplates } = await import('../latex/templates.ts')
const { latexArchiveTemplates } = await import('../latex/archiveTemplates.ts')
const { regularTemplateFingerprint, latexTemplateFingerprint } = await import('./thumbnailFingerprints.ts')
const manifestPath = path.join(here, 'templateThumbnails.ts')
// The pictures not rendered in this run (--only, --id) keep their manifest rows.
// The object is read from its own declaration: the first "= {" in the file is the
// type above it, and reading from there silently dropped every other entry.
const MANIFEST_DECLARATION = 'export const templateThumbnails: Readonly<Record<string, TemplateThumbnail>> = '
const existing = await readFile(manifestPath, 'utf8').then((text) => {
  const start = text.indexOf(MANIFEST_DECLARATION)
  if (start < 0) throw new Error(`${manifestPath} has no templateThumbnails declaration to merge into`)
  return JSON.parse(text.slice(start + MANIFEST_DECLARATION.length))
}, (error) => { if (error.code === 'ENOENT') return {}; throw error })
const thumbnails = { ...existing }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function store(editor, id, png, pages, sourceSha256) {
  const directory = path.join(outputRoot, editor)
  await mkdir(directory, { recursive: true })
  const card = await sharp(png).resize({ width: CARD_WIDTH }).webp({ quality: 82 }).toBuffer()
  const full = await sharp(png).resize({ width: FULL_WIDTH, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer()
  const meta = await sharp(card).metadata()
  await writeFile(path.join(directory, `${id}.webp`), card)
  await writeFile(path.join(directory, `${id}@full.webp`), full)
  thumbnails[`${editor}:${id}`] = {
    card: `/mr-resume/templates/${editor}/${id}.webp`, full: `/mr-resume/templates/${editor}/${id}@full.webp`,
    width: meta.width, height: meta.height, pages, sha256: sha(card), sourceSha256,
  }
  console.log(`THUMB ${editor}:${id} ${pages} page(s) ${card.length} + ${full.length} bytes`)
}

// Editor overlays that never print (selection bracket, hover controls, toasts).
const hideEditorChrome = `
  [class*="__registrationSettle"], [class*="__blockControls"], [class*="__dropMarker"], [class*="__notice"], [class*="__photoResize"] { display: none !important; }
  [class*="__paperSelected"]::before { content: none !important; }
  [class*="__correctableWord"] { text-decoration: none !important; }`

async function renderRegular(browser) {
  for (const template of resumeTemplates) {
    if (onlyId && template.id !== onlyId) continue
    const specimen = resumeSpecimen(template.id)
    if (!specimen) throw new Error(`Regular template ${template.id} has no specimen to picture`)
    const context = await browser.newContext({ viewport: { width: 1680, height: 1300 }, deviceScaleFactor: 2, colorScheme: 'light' })
    await context.addInitScript(() => { localStorage.setItem('smilepdf-theme', 'light'); localStorage.setItem('mr-resume:editor-language:v1', 'English') })
    const page = await context.newPage()
    await page.goto(`${base}/mr-resume/regular-editor?template=${template.id}&sample=1`, { waitUntil: 'networkidle', timeout: 180000 })
    const paper = page.locator(`article[data-layout="${template.layout}"]`)
    await paper.waitFor({ timeout: 60000 })
    await page.waitForFunction((name) => document.querySelector('article[data-layout] h2')?.textContent?.includes(name), specimen.fullName, { timeout: 60000 })
    await page.addStyleTag({ content: hideEditorChrome })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    const { box, height, pageHeight } = await paper.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const scale = rect.width / element.offsetWidth
      const a4 = element.offsetWidth * 297 / 210
      return { box: { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, a4 * scale) }, height: element.offsetHeight, pageHeight: a4 }
    })
    const png = await page.screenshot({ clip: box })
    // The editor's own measure: content taller than one sheet spills onto more pages.
    const pages = Math.max(1, Math.ceil((height - 2) / pageHeight))
    await store('regular', template.id, png, pages, regularTemplateFingerprint(template, specimen))
    // A specimen that spills a few lines onto a second sheet is worth trimming; this says by how much.
    console.log(`      ${template.id} fills ${(height / pageHeight).toFixed(2)} sheet(s)`)
    await context.close()
  }
}

const latexFixtures = {
  'career-source': 'career-template-current-pin', 'academic-source': 'academic-template-current-pin', 'bangla-source': 'bangla-template-current-pin',
}

async function renderLatex(browser) {
  const work = path.join(tmpdir(), `mr-resume-thumbs-${process.pid}`)
  await mkdir(work, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })
  const pdfjs = await readFile(path.join(frontend, 'node_modules/pdfjs-dist/build/pdf.min.mjs'))
  const worker = await readFile(path.join(frontend, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))
  let current = null
  await page.route('https://thumbs.invalid/**', (route) => {
    const name = new URL(route.request().url()).pathname
    if (name === '/pdf.mjs') return route.fulfill({ body: pdfjs, contentType: 'text/javascript' })
    if (name === '/pdf.worker.mjs') return route.fulfill({ body: worker, contentType: 'text/javascript' })
    if (name === '/doc.pdf') return route.fulfill({ body: current, contentType: 'application/pdf' })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="c"></canvas></body>' })
  })
  await page.goto('https://thumbs.invalid/index.html')
  for (const card of latexTemplateCards) {
    const fixture = latexFixtures[card.id] ?? card.qualification
    const run = spawnSync(process.execPath, ['--experimental-strip-types', path.join(frontend, 'features/mr-resume/latex/browser/gallery-smoke.mjs'), `--case=${fixture}`, `--output-dir=${work}`], { cwd: frontend, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (run.status !== 0) throw new Error(`Compiler fixture ${fixture} failed:\n${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`)
    current = await readFile(path.join(work, `${fixture}.pdf`))
    const pages = (await PDFDocument.load(current, { updateMetadata: false })).getPageCount()
    await page.evaluate(async () => {
      const lib = await import('https://thumbs.invalid/pdf.mjs')
      lib.GlobalWorkerOptions.workerSrc = 'https://thumbs.invalid/pdf.worker.mjs'
      const document = await lib.getDocument('https://thumbs.invalid/doc.pdf').promise
      const first = await document.getPage(1)
      const viewport = first.getViewport({ scale: 2.4 })
      const canvas = window.document.getElementById('c')
      canvas.width = viewport.width; canvas.height = viewport.height
      canvas.style.width = `${viewport.width / 2}px`; canvas.style.height = `${viewport.height / 2}px`
      await first.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      await document.destroy()
    })
    const png = await page.locator('#c').screenshot()
    const archive = latexArchiveTemplates.find((item) => item.id === card.id)
    const source = archive ? archive.sha256 : latexTemplateFingerprint(latexSourceTemplates.find((item) => item.id === card.id))
    await store('latex', card.id, png, pages, source)
  }
  await page.close()
  await rm(work, { recursive: true, force: true })
}

const browser = await chromium.launch()
try {
  if (only !== 'latex') await renderRegular(browser)
  if (only !== 'regular') await renderLatex(browser)
} finally { await browser.close() }

const ordered = Object.fromEntries(Object.entries(thumbnails).sort(([a], [b]) => a.localeCompare(b)))
const header = (await readFile(manifestPath, 'utf8')).split('export const templateThumbnails')[0]
await writeFile(manifestPath, `${header}export const templateThumbnails: Readonly<Record<string, TemplateThumbnail>> = ${JSON.stringify(ordered, null, 2)}\n`)
console.log(`Wrote ${Object.keys(ordered).length} thumbnails to ${path.relative(frontend, manifestPath)}`)
