import assert from 'node:assert/strict'
import test from 'node:test'

import {
  figuresFromResponse,
  missingFigurePaths,
  pickFigures,
  prepareFiguresForExport,
  referencedFigurePaths,
  resolveFigureSources,
  selectFiguresWithin,
} from './figures.ts'
import { renderMarkdownToHtml } from './utils.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const JPG = 'data:image/jpeg;base64,/9j/4AAQ'

test('only well-formed figure entries are accepted from the response', () => {
  const { figures, omitted } = figuresFromResponse({
    asset_data: {
      'assets/asset-a.png': PNG,
      'assets/asset-b.jpg': JPG,
      '../escape.png': PNG,
      'assets/asset-c.png': 'javascript:alert(1)',
      'assets/asset-d.svg': 'data:image/svg+xml;base64,PHN2Zz4=',
    },
    assets_omitted: ['assets/asset-e.png', 42, '/etc/passwd'],
  })
  assert.deepEqual(figures, { 'assets/asset-a.png': PNG, 'assets/asset-b.jpg': JPG })
  assert.deepEqual(omitted, ['assets/asset-e.png'])
  assert.deepEqual(figuresFromResponse(null), { figures: {}, omitted: [] })
})

test('references are read in document order without duplicates', () => {
  const markdown = '![A](assets/asset-a.png)\n\n![B](assets/asset-b.jpg "title")\n\n![A again](assets/asset-a.png)\n\n![web](https://x.test/a.png)'
  assert.deepEqual(referencedFigurePaths(markdown), ['assets/asset-a.png', 'assets/asset-b.jpg'])
  assert.deepEqual(missingFigurePaths(markdown, { 'assets/asset-a.png': PNG }), ['assets/asset-b.jpg'])
  assert.deepEqual(pickFigures('![B](assets/asset-b.jpg)', { 'assets/asset-a.png': PNG }, { 'assets/asset-b.jpg': JPG }), { 'assets/asset-b.jpg': JPG })
})

test('rendered figures point at their bytes and keep their path for the rich editor', () => {
  const markdown = '# Report\n\n![Figure 1 on page 1](assets/asset-a.png)\n\n![web](https://x.test/a.png)'
  const html = resolveFigureSources(renderMarkdownToHtml(markdown), { 'assets/asset-a.png': PNG })
  assert.match(html, new RegExp(`src="${PNG.replace(/[+/=]/g, '\\$&')}"`))
  assert.match(html, /data-mr-figure="assets\/asset-a\.png"/)
  assert.match(html, /src="https:\/\/x\.test\/a\.png"/)
})

test('exports ship referenced figures beside rewritten Markdown and report the rest', () => {
  const markdown = '![A](assets/asset-a.png)\n![A](assets/asset-a.png)\n![Gone](assets/asset-z.png)'
  const prepared = prepareFiguresForExport(markdown, { 'assets/asset-a.png': PNG, 'assets/unused.png': JPG })
  assert.equal(prepared.markdown, '![A](images/asset-a.png)\n![A](images/asset-a.png)\n![Gone](assets/asset-z.png)')
  assert.deepEqual(prepared.assets, [{ filename: 'asset-a.png', dataUrl: PNG, mimeType: 'image/png', alt: 'A' }])
  assert.deepEqual(prepared.missing, ['assets/asset-z.png'])
  // Export HTML rendered from the rewritten Markdown still resolves.
  assert.match(resolveFigureSources(renderMarkdownToHtml(prepared.markdown), { 'assets/asset-a.png': PNG }), /src="data:image\/png/)
})

test('documents without figures pass through untouched', () => {
  const markdown = '# Plain\n\nNo images here.'
  assert.deepEqual(prepareFiguresForExport(markdown, undefined), { markdown, assets: [], missing: [] })
  const html = renderMarkdownToHtml(markdown)
  assert.equal(resolveFigureSources(html, undefined), html)
})

test('an export takes the figures that fit its limits and names the rest', () => {
  const big = `data:image/png;base64,${'A'.repeat(40)}`
  const markdown = '![a](assets/a.png) ![b](assets/b.png) ![c](assets/c.png) ![d](assets/d.png)'
  const figures = { 'assets/a.png': PNG, 'assets/b.png': big, 'assets/c.png': JPG, 'assets/d.png': PNG }
  const fit = selectFiguresWithin(markdown, figures, { maxCount: 2, maxBytes: 20 })
  assert.deepEqual(Object.keys(fit.figures), ['assets/a.png', 'assets/c.png'])
  assert.deepEqual(fit.excluded, ['assets/b.png', 'assets/d.png'])
})
