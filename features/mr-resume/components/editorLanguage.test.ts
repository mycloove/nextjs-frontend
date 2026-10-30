import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { editorText } from './editorLanguage.ts'
import { resumeTemplates } from './resumeTemplates.ts'

const componentNames = ['BanglishInput', 'BanglishTools', 'BanglishCorrection', 'ResumeTemplateLibrary', 'ResumeLanguageSuggestions']
const components = componentNames.map((name) => ts.createSourceFile(`${name}.tsx`, readFileSync(new URL(`./${name}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
const stylesheet = readFileSync(new URL('./MrResumeStudio.module.css', import.meta.url), 'utf8')
const themeStylesheet = readFileSync(new URL('./MrResumeTheme.module.css', import.meta.url), 'utf8')

function literalChoices(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node)) return [node.text]
  if (ts.isConditionalExpression(node)) return [...literalChoices(node.whenTrue), ...literalChoices(node.whenFalse)]
  return []
}

test('every static Banglish, correction, template and bilingual label has a Bengali translation', () => {
  const missing = new Set<string>()
  for (const component of components) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0]) {
        for (const label of literalChoices(node.arguments[0])) {
          assert.equal(editorText(label, 'English'), label)
          if (!/[\u0980-\u09ff]/u.test(editorText(label, 'Bangla'))) missing.add(label)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(component)
  }
  assert.deepEqual([...missing], [])
})

test('all nine template names and descriptions are localized without changing authored text', () => {
  for (const template of resumeTemplates) {
    for (const label of [template.name, template.detail]) {
      assert.match(editorText(label, 'Bangla'), /[\u0980-\u09ff]/u, label)
      assert.equal(editorText(label, 'English'), label)
    }
  }
  for (const label of ['constructor', 'toString', '__proto__', 'My custom heading']) assert.equal(editorText(label, 'Bangla'), label)
})

test('typing and review panels never reference missing CSS-module classes', () => {
  const missing = new Set<string>()
  for (const component of components) {
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'styles') {
        if (!new RegExp(`\\.${node.name.text}(?![\\w-])`, 'u').test(stylesheet)) missing.add(node.name.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(component)
  }
  assert.deepEqual([...missing], [])
})

test('review surfaces have legible light/dark role tokens without changing the global palette', () => {
  const light = themeStylesheet.match(/\.theme\s*\{([^}]+)/u)![1]
  const dark = themeStylesheet.match(/:global\(html\[data-theme="dark"\]\) \.theme\s*\{([^}]+)/u)![1]
  const luminance = (hex: string) => hex.match(/[a-f\d]{2}/giu)!.map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  for (const [theme, block] of [['light', light], ['dark', dark]]) {
    const token = (name: string) => block.match(new RegExp(`--rs-${name}:\\s*(#[a-f\\d]{6})`, 'iu'))![1]
    for (const [foreground, background, minimum] of [['ink', 'panel', 7], ['accent', 'panel', 4.5], ['on-primary', 'primary', 4.5], ['muted', 'panel', 4.5], ['focus', 'panel', 3], ['control-line', 'panel', 3]] as const) {
      const a = luminance(token(foreground))
      const b = luminance(token(background))
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      assert.ok(ratio >= minimum, `${theme} ${foreground}/${background}: ${ratio.toFixed(2)}:1`)
    }
  }
})
