import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = readFileSync(new URL('./PageThumbnail.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
type Props = {
  geometry: { width: number; height: number; padX: number; padY: number }
  children?: ReactNode
}
const componentModule = { exports: {} as { default: ComponentType<Props> } }
runInNewContext(compiled, {
  exports: componentModule.exports,
  module: componentModule,
  require: createRequire(import.meta.url),
})
const PageThumbnail = componentModule.exports.default
const geometry = { width: 794, height: 1123, padX: 68, padY: 52 }
const render = (children: ReactNode, setup = geometry) => renderToStaticMarkup(
  createElement(PageThumbnail, { geometry: setup }, children),
)

test('thumbnail contains real formatted page text, not summary bars', () => {
  const markup = render(createElement('div', { className: 'p2w-page-body' },
    createElement('h2', null, 'Ayesha Rahman'),
    createElement('p', null, createElement('strong', null, 'Product designer'), ' in Dhaka'),
  ))
  assert.match(markup, /<h2>Ayesha Rahman<\/h2>/)
  assert.match(markup, /<strong>Product designer<\/strong> in Dhaka/)
  assert.doesNotMatch(markup, /p2w-thumb-line/)
})

test('thumbnail preserves actual table cells and embedded images', () => {
  const markup = render(createElement('div', null,
    createElement('div', { className: 'p2w-doc-table' },
      createElement('div', { className: 'p2w-doc-td' }, 'Experience'),
      createElement('div', { className: 'p2w-doc-td' }, '2022-Present'),
    ),
    createElement('img', { src: 'blob:converted-document-photo', width: 180, height: 90, alt: 'Portrait' }),
  ))
  assert.match(markup, /p2w-doc-td">Experience/)
  assert.match(markup, /p2w-doc-td">2022-Present/)
  assert.match(markup, /src="blob:converted-document-photo"/)
  assert.match(markup, /width="180" height="90"/)
})

test('thumbnail uses the same page dimensions and padding as the main sheet', () => {
  const markup = render('Actual page')
  assert.match(markup, /aspect-ratio:794 \/ 1123/)
  assert.match(markup, /--p2w-thumb-source-width:794/)
  assert.match(markup, /width:794px;min-height:1123px;padding:52px 68px/)
  const landscape = render('Landscape page', { width: 1100, height: 780, padX: 40, padY: 32 })
  assert.match(landscape, /aspect-ratio:1100 \/ 780/)
  assert.match(landscape, /width:1100px;min-height:780px;padding:32px 40px/)
})

test('duplicate thumbnail content does not create navigation targets or accessible duplicates', () => {
  const markup = render('Page content')
  assert.match(markup, /aria-hidden="true"/)
  assert.doesNotMatch(markup, /data-page=|data-mblock=|tabindex=/)
  assert.match(render('<script>untrusted document text</script>'), /&lt;script&gt;/)
})

test('proof rail renders every block with the real sheet renderer and keeps responsive navigation', () => {
  const parent = readFileSync(new URL('../../../components/PDFToWord.tsx', import.meta.url), 'utf8')
  assert.match(parent, /<PageThumbnail geometry=\{preview\?\.geometry \?\? DEFAULT_GEOMETRY\}>/)
  assert.match(parent, /page\.map\(\(block, i\) => <BlockView key=\{i\} block=\{block\} \/>\)/)
  assert.doesNotMatch(parent, /thumbLines|p2w-thumb-line/)
  assert.match(parent, /--p2w-thumb-size: 64/)
  assert.match(parent, /\.p2w-thumb-content\s*\{[^}]*text-align: left;/)
  assert.match(parent, /aria-current=\{activePage === item\.page \? 'page' : undefined\}/)
})
