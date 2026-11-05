import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import type { BrowserCompilerManifest } from './browserCompiler.ts'
import { compilerEditorDiagnostics } from './editorDiagnostics.ts'
import { reviewPackageDeclaration, reviewedSourceFixTransaction } from './editorFixes.ts'
import { sourceLineSeparator } from './editorHelpers.ts'
import { missingDependency, packageAssistance } from './packageAssistance.ts'
import { validateLatexProject } from './project.ts'
import type { LatexDiagnostic, LatexProject } from './types.ts'

const manifest = JSON.parse(readFileSync(new URL('../../../public/mr-resume/latex/busytex-v2/manifest.json', import.meta.url), 'utf8')) as BrowserCompilerManifest
const documentSource = (body: string, preamble = '', newline = '\n') => `\\documentclass[11pt]{article}${newline}${preamble}\\begin{document}${newline}${body}${newline}\\end{document}${newline}`
function project(content: string, other: Record<string, string> = {}, mainFile = 'main.tex'): LatexProject {
  return validateLatexProject({ version: 1, id: 'package-test', title: 'Package fixture', revision: 1, mainFile, engine: 'xelatex',
    files: Object.entries({ [mainFile]: content, ...other }).map(([path, content], index) => ({ id: `f-${index}`, path, content })), assets: [], templateId: null, templateVersion: null,
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' })
}
function undefinedIssue(source: LatexProject, command: string, path = source.mainFile!) {
  const file = source.files.find((item) => item.path === path)!, line = file.content.slice(0, file.content.indexOf(command)).split(/\r\n|\r|\n/u).length
  return compilerEditorDiagnostics(source, [{ severity: 'error', file: path, line, message: 'Undefined control sequence.', help: `Undefined control sequence: ${command}` }], 'browser')[0]
}
const missingIssue = (source: LatexProject, name: string, code = 'missing_package') => compilerEditorDiagnostics(source, [{ severity: 'error', file: source.mainFile!, line: 1, code, message: `LaTeX Error: File '${name}' not found.` }], 'browser')[0]

test('curated commands offer reviewed declarations, not installed/cache claims or arbitrary providers', () => {
  for (const [command, packageName] of [['\\includegraphics', 'graphicx'], ['\\href', 'hyperref'], ['\\faGithub', 'fontawesome5']]) {
    const source = project(documentSource(`${command}{text}`)), original = source.files[0].content
    const assistance = packageAssistance(source, undefinedIssue(source, command), { manifest })!
    assert.equal(assistance.kind, 'declaration', command)
    assert.equal(assistance.packageName, packageName)
    assert.equal(assistance.cache, 'not-checked')
    assert.equal(assistance.declaration!.replacement, `\\usepackage{${packageName}}\n`)
    assert.equal(assistance.declaration!.from, original.indexOf('\\begin{document}'))
    assert.equal(assistance.declaration!.expectedText, '')
    assert.equal(source.files[0].content, original)
    assert.equal(Object.hasOwn(assistance, 'installed'), false)
    assert.equal(Object.hasOwn(assistance, 'downloadBytes'), false, 'The helper never guesses a group/dependency byte total')
  }
  const source = project(documentSource('\\customCommand{Text}'))
  assert.equal(packageAssistance(source, undefinedIssue(source, '\\customCommand'), { manifest })!.kind, 'ambiguous')
  const noEvidence = { ...undefinedIssue(source, '\\customCommand'), diagnostic: { severity: 'error' as const, file: 'main.tex', line: 3, message: 'Undefined control sequence.' } }
  assert.equal(packageAssistance(source, noEvidence, { manifest })!.kind, 'ambiguous')
})

test('the supplied profile is only an inventory, even when it lists optional groups', () => {
  const source = project(documentSource('\\faGithub')), issue = undefinedIssue(source, '\\faGithub')
  const listed = packageAssistance(source, issue, { profiles: manifest.engines })!
  assert.equal(listed.kind, 'declaration')
  assert.equal(listed.availability, 'profile-listed')
  assert.deepEqual(listed.groupIds, [])
  assert.equal(listed.cache, 'not-checked')
  const grouped = packageAssistance(source, issue, { manifest })!
  assert.equal(grouped.availability, 'optional-group')
  assert.ok(grouped.groupIds.length > 0)
  assert.match(grouped.message, /may still require consent/u)
  assert.equal(packageAssistance(source, issue)!.kind, 'ambiguous')
  assert.equal(grouped.preparation, undefined, 'Missing declaration must be reviewed before a package-consent action')
})

test('reachable imports, local definitions, duplicate declarations and ambiguous paths prevent automatic declarations', () => {
  const cases = [
    project(documentSource('\\href{url}{text}', '\\usepackage{hyperref}\n')),
    project(documentSource('\\href{url}{text}', '\\input{defs}\n'), { 'defs.tex': '\\usepackage{hyperref}' }),
    project(documentSource('\\href{url}{text}', '\\usepackage{local}\n'), { 'local.sty': '\\newcommand{\\href}[2]{#2}' }),
    project(documentSource('\\href{url}{text}', '\\input{\\ChosenSource}\n')),
    project(documentSource('\\href{url}{text}', '\\input{missing}\n')),
    project(documentSource('\\href{url}{text}', '\\input{defs}\n'), { 'defs.tex': '', 'cv/defs.tex': '' }, 'cv/main.tex'),
    project(documentSource('\\href{url}{text}', '\\ifcustom\\usepackage{hyperref}\\fi\n')),
    project(documentSource('\\href{url}{text}', '\\catcode`\\@=11\n')),
  ]
  for (const source of cases) {
    const result = packageAssistance(source, undefinedIssue(source, '\\href'), { manifest })!
    assert.equal(result.kind, 'ambiguous', source.files[0].content)
    assert.equal(result.declaration, undefined)
  }
  const localPackage = project(documentSource('\\href{url}{text}', '\\usepackage{hyperref}\n'), { 'hyperref.sty': '\\newcommand{\\href}[2]{#2}' })
  assert.equal(packageAssistance(localPackage, undefinedIssue(localPackage, '\\href'), { manifest })!.availability, 'local-project')
  const olderIcons = project(documentSource('\\faGithub', '\\usepackage{fontawesome}\n'))
  assert.equal(packageAssistance(olderIcons, undefinedIssue(olderIcons, '\\faGithub'), { manifest })!.kind, 'ambiguous')
})

test('unused source and literal examples do not invent existing package declarations', () => {
  const source = project(documentSource('\\href{url}{text}\n\\begin{verbatim}\n\\usepackage{hyperref}\n\\end{verbatim}', '% \\usepackage{hyperref}\n'), {
    'unused.sty': '\\newcommand{\\href}[2]{#2}\n\\usepackage{hyperref}', 'notes.txt': '\\usepackage{hyperref}', 'refs.bib': '@book{x,title={\\usepackage{hyperref}}}',
  })
  assert.equal(packageAssistance(source, undefinedIssue(source, '\\href'), { manifest })!.kind, 'declaration')
  const literal = project(documentSource('\\verb|\\href|'))
  assert.equal(packageAssistance(literal, undefinedIssue(literal, '\\href'), { manifest })!.kind, 'ambiguous')
})

test('missing source, bibliography, images and fonts are not package download requests, even with a generic code', () => {
  const source = project(documentSource('Writing'))
  for (const [name, kind, canImport] of [['parts/work.tex', 'source', true], ['references.bib', 'bibliography', true], ['main.bbl', 'bibliography', false],
    ['plain.bst', 'bibliography-style', true], ['photo.png', 'image', true], ['drawing.pdf', 'image', false], ['fonts/icon.otf', 'font', false], ['opaque.xyz', 'unknown', false]] as const) {
    const result = packageAssistance(source, missingIssue(source, name), { manifest })!
    assert.equal(result.kind, 'missing-project-file', name)
    assert.equal(result.fileKind, kind, name)
    assert.equal(result.canImport, canImport, name)
    assert.deepEqual(result.groupIds, [], name)
    assert.equal(result.declaration, undefined)
  }
  const font: LatexDiagnostic = { severity: 'error', message: 'Package fontspec Error: The font "Unknown Family" cannot be found.' }
  assert.deepEqual(missingDependency(font), { requested: 'Unknown Family', kind: 'font' })
  assert.equal(packageAssistance(source, compilerEditorDiagnostics(source, [font], 'browser')[0], { manifest })!.kind, 'missing-project-file')
  assert.equal(missingDependency({ severity: 'error', code: 'missing_package', message: 'Dependency unavailable.' }), null)
  assert.deepEqual(missingDependency({ severity: 'error', message: "I couldn't open database file refs.bib" }), { requested: 'refs.bib', kind: 'bibliography' })
})

test('class and package missing-file classifications stay distinct; downloads only name compatible pinned optional groups', () => {
  const source = project(documentSource('Writing', '\\usepackage{fontawesome5}\n'))
  const optional = packageAssistance(source, missingIssue(source, 'fontawesome5.sty'), { manifest })!
  assert.equal(optional.kind, 'optional-group')
  assert.equal(optional.fileKind, 'package')
  assert.ok(optional.groupIds.every((id) => manifest.groups!.some((group) => group.id === id && group.kind === 'package' && group.profiles.includes('xelatex') && group.packages.includes('fontawesome5'))))
  assert.match(optional.message, /Approval records consent/u)
  assert.equal(optional.preparation!.profileVersion, manifest.profileVersion)
  assert.deepEqual(optional.preparation!.groups.map((group) => group.id), [...optional.groupIds].sort())
  const bundledClass = packageAssistance(source, missingIssue(source, 'article.cls'), { manifest })!
  assert.equal(bundledClass.fileKind, 'class')
  assert.equal(bundledClass.kind, 'ambiguous', 'A class listed in the core inventory is not an optional package download')
  assert.equal(packageAssistance(source, missingIssue(source, 'unlisted-custom.cls'), { manifest })!.kind, 'unsupported')
  assert.equal(packageAssistance(source, missingIssue(source, 'unlisted-package.sty'), { manifest })!.kind, 'unsupported')
  assert.equal(packageAssistance(source, missingIssue(source, 'https://example.com/evil.sty'), { manifest })!.kind, 'ambiguous')
  const incompatible = { ...manifest, groups: manifest.groups!.map((group) => group.kind === 'package' && group.packages.includes('fontawesome5') ? { ...group, profiles: ['pdflatex' as const] } : group) }
  const unsupported = packageAssistance(source, missingIssue(source, 'fontawesome5.sty'), { manifest: incompatible })!
  assert.equal(unsupported.kind, 'unsupported')
  assert.equal(unsupported.preparation, undefined)
})

test('unlisted template classes and packages offer local source import, never an invented package download', () => {
  for (const path of ['my-resume.cls', 'styles/private-layout.sty']) {
    const source = project(documentSource('Resume')), issue = missingIssue(source, path)
    const action = packageAssistance(source, issue, { manifest })!
    assert.equal(action.kind, path.includes('/') ? 'missing-project-file' : 'unsupported')
    assert.equal(action.canImport, true)
    assert.equal(action.preparation, undefined)
    assert.deepEqual(action.groupIds, [])
    assert.match(action.message, /original \.sty\/\.cls file.*relative path/u)
  }
  const source = project(documentSource('Resume')), issue = missingIssue(source, '../private.cls')
  assert.notEqual(packageAssistance(source, issue, { manifest })?.canImport, true)
  const supplied = project(documentSource('Resume'), { 'styles/private-layout.sty': '\\ProvidesPackage{private-layout}' })
  const knownFile = packageAssistance(supplied, missingIssue(supplied, 'styles/private-layout.sty'), { manifest })!
  assert.equal(knownFile.kind, 'ambiguous')
  assert.equal(knownFile.canImport, false)
})

test('optional bibliography group reports the transport preparation including pinned Biber dependencies', () => {
  const source = project(documentSource('Writing', '\\usepackage{biblatex}\n'))
  const result = packageAssistance(source, missingIssue(source, 'biblatex.sty'), { manifest })!
  assert.equal(result.kind, 'optional-group')
  const preparation = result.preparation!
  assert.ok(preparation.groups.some((group) => group.id === manifest.biber!.group))
  assert.equal(preparation.downloadBytes, preparation.groups.reduce((sum, group) => sum + group.assets.reduce((bytes, pin) => bytes + pin.bytes, 0), 0)
    + manifest.biber!.assets.reduce((sum, pin) => sum + pin.bytes, 0))
  assert.notEqual(preparation.groups[0], manifest.groups!.find((group) => group.id === preparation.groups[0].id), 'Transport returns copies, not cache or mutable manifest state')
})

test('a reviewable declaration preserves BOM, non-BMP/joiner text and mixed source line endings in one Undo', () => {
  const original = '\ufeff% \u0995\u09cd\u200d\u09b7 \ud83d\ude00\r\n\\documentclass{article}\r\n\\begin{document}\n\\href{url}{text}\r\\end{document}\n'
  const source = project(original), assistance = packageAssistance(source, undefinedIssue(source, '\\href'), { manifest })!
  assert.equal(assistance.kind, 'declaration')
  assert.equal(assistance.declaration!.replacement, '\\usepackage{hyperref}\r\n')
  const review = reviewPackageDeclaration(source, assistance)!
  let state = EditorState.create({ doc: original, extensions: [EditorState.lineSeparator.of(sourceLineSeparator(original)), history()] })
  state = reviewedSourceFixTransaction(state, source, 'f-0', 'browser', review, () => null).state
  assert.equal(state.sliceDoc(), original.replace('\\begin{document}', '\\usepackage{hyperref}\r\n\\begin{document}'))
  assert.equal(undo({ state, dispatch: (transaction) => { state = transaction.state } }), true)
  assert.equal(state.sliceDoc(), original)
})

test('declarations refuse fragments, inline openers and stale same-rN projects rather than guessing a preamble', () => {
  for (const content of ['\\href{url}{text}', '\\documentclass{article}\\begin{document}\n\\href{url}{text}\n\\end{document}', '\\documentclass{article}\n\\customWrapper{\n\\begin{document}\n\\href{url}{text}\n\\end{document}}']) {
    const source = project(content)
    assert.equal(packageAssistance(source, undefinedIssue(source, '\\href'), { manifest })!.kind, 'ambiguous')
  }
  const source = project(documentSource('\\href{url}{text}'), { 'other.tex': 'unchanged' }), issue = undefinedIssue(source, '\\href')
  const assistance = packageAssistance(source, issue, { manifest })!
  source.files[1].content = 'same-rN fork'
  assert.equal(packageAssistance(source, issue, { manifest }), null)
  assert.equal(reviewPackageDeclaration(source, assistance), null)
})
