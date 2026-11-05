import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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
  assert.match(host, /workspaceVisited && <>/u)
  assert.match(host, /if \(mode && !workspaceVisited\) setWorkspaceVisited\(true\)/u)
  assert.match(host, /if \(mode === 'latex' && !latexVisited\) setLatexVisited\(true\)/u)
  assert.doesNotMatch(host, /if \(!mode\) return/u)
})

test('editor panels remain named regions and inactive panels cannot print', () => {
  assert.doesNotMatch(host, /role="tablist"|mr-resume-mode-(regular|latex)/u)
  for (const mode of ['regular', 'latex']) assert.match(host, new RegExp(`id="mr-resume-panel-${mode}" role="region" aria-label="${mode === 'regular' ? 'Regular' : 'LaTeX'} resume editor"`, 'u'))
  assert.doesNotMatch(css, /modeStrip|modeHint|copyButton|tabs\s*\{/u)
  assert.match(css, /\.panel\[hidden\]\s*\{\s*display: none !important/u)
  assert.match(css, /data-editor-mode="latex"[^}]+display: none !important/u)
  assert.match(css, /prefers-reduced-motion/u)
})

test('history navigation cancels retained Regular dialogs before relinquishing focus ownership', () => {
  const source = ts.createSourceFile('workspace.tsx', host, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect: ts.ArrowFunction | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useLayoutEffect' && ts.isArrowFunction(node.arguments[0])) effect = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(effect)
  const javascript = ts.transpileModule(`(${effect.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  // Execute the production lifecycle callback with DOM doubles, not browser E2E.
  for (const mode of [null, 'regular', 'latex']) {
    const events: string[] = []
    const dialog = {
      open: true,
      dispatchEvent(event: Event) { assert.equal(event.type, 'cancel'); assert.equal(event.cancelable, true); events.push('cancel'); event.preventDefault(); return false },
      close() { this.open = false; events.push('close') },
    }
    const regularElement = {
      querySelectorAll(selector: string) { assert.equal(selector, 'dialog[open]'); return [dialog] },
      set inert(value: boolean) { events.push(`inert:${value}`) },
    }
    const latexElement = { inert: false }
    const apply = runInNewContext(javascript, { Event, mode, regularPanel: { current: regularElement }, latexPanel: { current: latexElement } }) as () => void
    apply()
    assert.deepEqual(events, mode === 'regular' ? ['inert:false'] : ['cancel', 'close', 'inert:true'])
    assert.equal(dialog.open, mode === 'regular')
    assert.equal(latexElement.inert, mode !== 'latex')
  }
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

test('availability check remains beside Compile and uses the isolated typed feedback presenter', () => {
  assert.match(latex, /styles\.primaryButton[\s\S]*?styles\.availabilityButton/u)
  assert.match(latex, /Check availability/u)
  assert.match(latex, /const ready = result\.enabled && result\.ready/u)
  assert.match(latex, /Private LaTeX compilation is available\./u)
  assert.match(latex, /workspace.notify\(ready \? 'success' : 'action', 'runtime', 'availability'/u)
  assert.match(latex, /<LatexReceipt fact=\{receipt\} active=\{active\}/u)
  assert.match(latex, /<LatexAnnouncements attention=\{attention.primary\}/u)
  assert.doesNotMatch(regular, /LatexFeedback|feedbackReducer|LatexReceipt/u)
  assert.doesNotMatch(latex, /capabilityTopbar/u)
  for (const name of ['availabilityButton', 'receiptAnchor']) assert.match(latexCss, new RegExp(`\\.${name}(?![\\w-])`, 'u'))
  assert.doesNotMatch(latexCss, /availabilityToast|statusStack/u)
})

test('the route selects the chooser or editor without restoring a conflicting mode preference', () => {
  assert.match(host, /const segment = useSelectedLayoutSegment\(\)/u)
  assert.match(host, /segment === 'regular-editor' \? 'regular' : segment === 'latex' \? 'latex' : null/u)
  assert.match(host, /useState\(mode !== null\)/u)
  assert.match(host, /useState\(mode === 'latex'\)/u)
  assert.match(host, /!mode && <main[\s\S]*?Choose how you want to build/u)
  assert.match(host, /onClick=\{\(\) => chooseMode\('regular'\)\}/u)
  assert.match(host, /onClick=\{\(\) => chooseMode\('latex'\)\}/u)
  assert.match(host, /Your projects stay separate/u)
  assert.match(host, /data-editor-mode=\{mode \?\? undefined\}/u)
  assert.doesNotMatch(host, /getItem\(LATEX_MODE_KEY\)|setMode\(/u)
})

test('chooser, copy, and fallback navigation use the dedicated editor routes', () => {
  assert.match(host, /regular: '\/mr-resume\/regular-editor', latex: '\/mr-resume\/latex'/u)
  for (const name of ['chooseMode', 'changeMode']) {
    assert.match(host, new RegExp(`function ${name}\\(next: EditorMode\\)[\\s\\S]*?router\\.push\\(editorPaths\\[next\\], \\{ scroll: false \\}\\)`, 'u'))
  }
  assert.match(host, /if \(mode !== 'latex'\) router\.push\(editorPaths\.latex, \{ scroll: false \}\)/u)
})

test('all Mr. Resume entry routes share one persistent feature host and unchanged metadata', () => {
  const layout = read('../../../app/mr-resume/layout.tsx')
  assert.match(layout, /import MrResumeWorkspace from '@\/features\/mr-resume'/u)
  assert.match(layout, /<MrResumeWorkspace \/>\{children\}/u)
  assert.match(layout, /robots: \{ index: false, follow: false \}/u)
  for (const route of ['page.tsx', 'regular-editor/page.tsx', 'latex/page.tsx']) {
    const page = read(`../../../app/mr-resume/${route}`)
    assert.match(page, /export default function/u)
    assert.match(page, /return null/u)
    assert.doesNotMatch(page, /import|redirect\(/u)
  }
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
