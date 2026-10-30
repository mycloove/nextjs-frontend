import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const host = read('./MrResumeWorkspace.tsx')
const regular = read('./MrResumeStudio.tsx')
const latex = read('../latex/LatexResumeStudio.tsx')
const css = read('./MrResumeWorkspace.module.css')
const regularCss = read('./MrResumeStudio.module.css')
const latexCss = read('../latex/LatexResumeStudio.module.css')

test('the existing feature shim remains the client boundary and uses the dual-mode host', () => {
  const shim = read('../index.tsx')
  assert.match(shim, /'use client'/u)
  assert.match(shim, /export \{ default \} from '\.\/components\/MrResumeWorkspace'/u)
  assert.match(host, /lazy\(\(\) => import\('\.\.\/latex\/LatexResumeStudio'\)\)/u)
  assert.doesNotMatch(regular, /@codemirror|compileTransport|toolRequest|LATEX_API/u)
})

test('Regular is retained rather than conditionally unmounted, with a separate mode preference', () => {
  const source = ts.createSourceFile('workspace.tsx', host, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let regularTag: ts.JsxSelfClosingElement | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'MrResumeStudio') regularTag = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(regularTag)
  assert.ok(ts.isJsxElement(regularTag.parent), 'Regular is a direct retained panel child')
  assert.match(host, /hidden=\{mode !== 'regular'\}/u)
  assert.match(host, /hidden=\{mode !== 'latex'\}/u)
  assert.match(host, /\.inert = mode !== 'regular'/u)
  assert.match(host, /\.inert = mode !== 'latex'/u)
  assert.match(host, /LATEX_MODE_KEY/u)
  assert.doesNotMatch(host, /mr-resume:draft|setFormat\(/u)
})

test('editor panels remain named regions and inactive panels cannot print', () => {
  assert.doesNotMatch(host, /role="tablist"|mr-resume-mode-(regular|latex)/u)
  for (const mode of ['regular', 'latex']) assert.match(host, new RegExp(`id="mr-resume-panel-${mode}" role="region" aria-label="${mode === 'regular' ? 'Regular' : 'LaTeX'} resume editor"`, 'u'))
  assert.doesNotMatch(css, /modeStrip|modeHint|copyButton|tabs\s*\{/u)
  assert.match(css, /\.panel\[hidden\]\s*\{\s*display: none !important/u)
  assert.match(css, /data-editor-mode="latex"[^}]+display: none !important/u)
  assert.match(css, /prefers-reduced-motion/u)
})

test('Regular exposes the separate LaTeX copy beside source export, with the existing round-trip handler', () => {
  assert.match(host, /onCopyToLatex=\{copyRegular\}/u)
  assert.match(regular, /onCopyToLatex\?: \(\) => void/u)
  assert.match(regular, /className=\{styles\.sourceActions\}>[\s\S]*?styles\.texButton[\s\S]*?styles\.copyToLatexButton/u)
  assert.match(regular, /onClick=\{onCopyToLatex\}/u)
  for (const name of ['sourceActions', 'copyToLatexButton', 'copyToLatexArrow']) assert.match(regularCss, new RegExp(`\\.${name}(?![\\w-])`, 'u'))
  assert.match(host, /setImportRequest\(\{ id: String\(\+\+importSequence\.current\), snapshot \}\)/u)
})

test('LaTeX header omits the editor-brand and cross-editor mode switcher', () => {
  assert.match(latex, /Resume typesetting editor/u)
  assert.doesNotMatch(latex, /identityBrand|identityMark|modeSwitcher|Resume editor mode|LaTeX resume workspace|onRegular/u)
  assert.doesNotMatch(latexCss, /identityBrand|identityMark|modeSwitcher/u)
  assert.match(latex, /className=\{styles\.projectIdentity\}/u)
  assert.match(latex, /className=\{styles\.primaryActions\}/u)
})

test('availability check sits beside Compile and reports its result as a temporary toast', () => {
  assert.match(latex, /styles\.primaryButton[\s\S]*?styles\.availabilityButton/u)
  assert.match(latex, /Check availability/u)
  assert.match(latex, /const ready = result\.enabled && result\.ready/u)
  assert.match(latex, /message: ready \? 'Private LaTeX compilation is available\.' : result\.reason/u)
  assert.match(latex, /className=\{styles\.availabilityToast\}[^>]*role="status" aria-live="polite"/u)
  assert.match(latex, /setAvailabilityToast\(null\), 5000\)/u)
  assert.doesNotMatch(latex, /capabilityTopbar/u)
  for (const name of ['availabilityButton', 'availabilityToast', 'availabilityToastMark']) assert.match(latexCss, new RegExp(`\\.${name}(?![\\w-])`, 'u'))
})

test('the entry chooser is the first state and each editor mounts only after its explicit choice', () => {
  assert.match(host, /useState<EditorMode \| null>\(null\)/u)
  assert.match(host, /if \(!mode\) return[\s\S]*?Choose how you want to build/u)
  assert.match(host, /onClick=\{\(\) => chooseMode\('regular'\)\}/u)
  assert.match(host, /onClick=\{\(\) => chooseMode\('latex'\)\}/u)
  assert.match(host, /Your projects stay separate/u)
  assert.match(host, /return <div className=\{`\$\{theme\.theme\} \$\{styles\.root\}`\} data-editor-mode=\{mode\}/u)
})

test('new host markup references only existing module-scoped style classes', () => {
  const source = ts.createSourceFile('workspace.tsx', host, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const missing = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'styles' && !new RegExp(`\\.${node.name.text}(?![\\w-])`, 'u').test(css)) missing.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual([...missing], [])
})
