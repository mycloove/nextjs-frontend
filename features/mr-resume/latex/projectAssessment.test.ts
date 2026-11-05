import assert from 'node:assert/strict'
import test from 'node:test'
import { assessLatexProject, bibliographyCapabilities, findLatexDocumentRoots } from './projectAssessment.ts'
import { validateLatexProject } from './project.ts'
import type { LatexEngine, LatexProfile, LatexProject } from './types.ts'

const document = '\\documentclass{article}\n\\begin{document}Writing\\end{document}\n'
const profile: LatexProfile = { id: 'xelatex', name: 'Unit profile', version: 'inventory-only-v1', fonts: ['Lato', 'Lato Bold', 'Noto Sans Bengali', 'Font Awesome 5 Free'],
  packages: ['article', 'fontspec', 'geometry', 'xcolor', 'biblatex', 'biblatex-ieee', 'biber', 'classic-bibtex'] }
function project(entries: Record<string, string>, mainFile: string | null = 'main.tex', engine: LatexEngine = 'xelatex'): LatexProject {
  return validateLatexProject({ version: 1, id: 'assessment-project', title: 'Source assessment', revision: 1, mainFile, engine,
    files: Object.entries(entries).map(([path, content], index) => ({ id: `source-${index}`, path, content })), assets: [], templateId: null, templateVersion: null,
    createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' })
}

test('root discovery uses ordered top-level literal document boundaries, not names, comments or macro examples', () => {
  const input = project({ 'main.tex': '\\section{Fragment}', 'nested/cv.tex': '\ufeff% retained CRLF\r\n' + document.replaceAll('\n', '\r\n'),
    'comment.tex': '% ' + document.replaceAll('\n', '\n% '),
    'macro.tex': '\\newcommand{\\example}{' + document + '}',
    'unbraced-macro.tex': '\\def\\documentclass{altacv}\\begin{document}Not a declaration\\end{document}',
    'conditional.tex': '\\ifcustom\n' + document + '\\fi',
    'escaped.tex': document.replace('\\documentclass', '\\\\documentclass'),
    'verbatim.tex': '\\begin{verbatim}\n' + document + '\\end{verbatim}',
    'verb.tex': '\\verb|' + document.replaceAll('\n', ' ') + '|',
    'wrong-order.tex': '\\begin{document}\\documentclass{article}\\end{document}',
    'duplicate-class.tex': '\\documentclass{a}' + document,
    'class.sty': document,
  })
  assert.deepEqual(findLatexDocumentRoots(input.files), [{ path: 'nested/cv.tex', className: 'article', line: 2 }])
  const percent = project({ 'cv.tex': '\\% Literal percent\n' + document }, 'cv.tex')
  assert.equal(findLatexDocumentRoots(percent.files)[0].line, 2)
})

test('reachable literal class, package and input inventory excludes unused roots, data and inert configuration', () => {
  const input = project({
    'cv/main.tex': '\\documentclass{styles/cv}\n\\usepackage{local,xcolor}\n\\input{sections/body}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\begin{document}Writing\\end{document}',
    'styles/cv.cls': '\\LoadClass{article}\n\\RequirePackage{fontspec,geometry}\n',
    'cv/local.sty': '\\ProvidesPackage{local}\n\\setsansfont{Lato}',
    'cv/sections/body.tex': '\\input{../shared}\n\\includegraphics{../assets/photo}\n',
    'cv/shared.tex': '\\input sections/body\n\\setmainfont{Noto Sans Bengali}',
    'cv/refs.bib': '@article{x,title={\\usepackage{Not-a-package}}}',
    'backup.tex': '\\usepackage{MissingBackup}\n\\setmainfont{Missing Backup Font}',
    'latexmkrc': '$pdflatex = "another executable";\n\\usepackage{Not-an-input}',
    'README.md': '\\input{backup}',
  }, 'cv/main.tex')
  input.assets.push({ id: 'photo', path: 'cv/assets/photo.png', mediaType: 'image/png', blob: new Blob(['unit-inventory-only']) })
  const before = structuredClone(input)
  input.files.forEach(Object.freeze); Object.freeze(input.files); Object.freeze(input)
  const assessment = assessLatexProject(input, [profile])
  assert.deepEqual(assessment.reachablePaths, ['cv/main.tex', 'styles/cv.cls', 'cv/local.sty', 'cv/sections/body.tex', 'cv/shared.tex'])
  assert.deepEqual(assessment.inertConfigPaths, ['latexmkrc'])
  assert.deepEqual(assessment.references.find((item) => item.requested === 'styles/cv')?.projectPaths, ['styles/cv.cls'])
  assert.deepEqual(assessment.references.find((item) => item.requested === '../shared')?.projectPaths, ['cv/shared.tex'])
  assert.deepEqual(assessment.references.find((item) => item.kind === 'image')?.projectPaths, ['cv/assets/photo.png'])
  assert.deepEqual(assessment.references.find((item) => item.kind === 'bibliography')?.projectPaths, ['cv/refs.bib'])
  assert.equal(assessment.references.find((item) => item.requested === 'fontspec')?.profileAvailability, 'listed')
  assert.deepEqual(assessment.fonts.map((font) => font.requested), ['Lato', 'Noto Sans Bengali'])
  assert.equal(assessment.bibliography.backend, 'bibtex')
  assert.equal(assessment.bibliography.result, 'not-verified')
  assert.equal(assessment.execution, 'not-verified')
  assert.equal(assessment.macroExpansion, 'not-determined')
  assert.equal(assessment.truncated, false)
  assert.deepEqual(input, before)
})

test('conditional and macro-dependent references are only possible evidence, never static compile refusals', () => {
  const input = project({ 'main.tex': '\\documentclass{article}\n\\ifcustom\n\\input{optional}\n\\fi\n\\newcommand{\\example}{\\usepackage{NotInInventory}}\n\\input{\\selectedFile}\n\\begin{document}Writing\\end{document}',
    'optional.tex': '\\usepackage[backend=biber]{biblatex}\n\\setmainfont{\\ChosenFont}',
  }, 'main.tex', 'pdflatex')
  const assessment = assessLatexProject(input, [{ ...profile, id: 'pdflatex', packages: ['article'] }])
  assert.deepEqual(assessment.reachablePaths, ['main.tex', 'optional.tex'])
  assert.equal(assessment.references.find((item) => item.requested === 'optional')?.context, 'not-determined')
  assert.equal(assessment.references.find((item) => item.requested === 'NotInInventory')?.context, 'not-determined')
  assert.equal(assessment.references.find((item) => item.requested === null)?.context, 'direct')
  assert.equal(assessment.fonts[0].requested, null)
  assert.equal(assessment.fonts[0].profileAvailability, 'not-determined')
  assert.equal(assessment.bibliography.backend, 'not-determined')
  assert.ok(assessment.notDetermined.some((item) => item.reason.includes('Not determined')))
  assert.equal(Object.hasOwn(assessment, 'diagnostics'), false)
  assert.equal(Object.hasOwn(assessment, 'canCompile'), false)
  assert.equal(input.engine, 'pdflatex')
})

test('ambiguous file candidates, exact package case, malformed references and unavailable inventory remain explicit', () => {
  const input = project({ 'cv/main.tex': '\\documentclass{article}\n\\input{part}\n\\input{PART}\n\\usepackage{Fontspec}\n\\include{\\macro}\n\\input{unterminated',
    'part.tex': '\\setmainfont{Lato}', 'cv/part.tex': '\\setsansfont{Other Font}',
  }, 'cv/main.tex')
  const assessment = assessLatexProject(input, [profile])
  assert.deepEqual(assessment.references.find((item) => item.requested === 'part')?.projectPaths, ['part.tex', 'cv/part.tex'])
  assert.deepEqual(assessment.references.find((item) => item.requested === 'PART')?.projectPaths, [])
  assert.equal(assessment.references.find((item) => item.requested === 'Fontspec')?.profileAvailability, 'not-listed')
  assert.equal(assessment.references.filter((item) => item.requested === null).length, 2)
  assert.ok(assessment.fonts.every((item) => item.context === 'not-determined'))
  assert.ok(assessment.notDetermined.some((item) => item.reason.includes('More than one project path')))
  const unknown = assessLatexProject(input, [{ ...profile, id: 'lualatex' }])
  assert.equal(unknown.profile, null)
  assert.ok(unknown.fonts.every((font) => font.profileAvailability === 'not-recorded'))
})

test('requested family, file/variant lookups and PDF usage stay separate for Bangla, mixed script, bold, italic and icons', () => {
  const source = '\ufeff\\documentclass{article}\r\n'
    + '\\setmainfont[BoldFont={Lato Bold},ItalicFont=*Italic]{lato}\r\n'
    + '\\newfontfamily{\\bengalifont}[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}\r\n'
    + '\\newfontface\\iconfont{Font Awesome 5 Free}\r\n'
    + '\\setmonofont{lmmono10-regular.otf}[Extension=.otf]\r\n'
    + '\\setsansfont[Path={fonts/}]{Lato}\r\n'
    + '\\fontspec{\\SelectedFont}\r\n'
    + '\\begin{document}English / \u0995\u09cd\u09b7 \u0995\u09bf \u0995\u09cd\u200d\u09b7 / \\textbf{Bold} \\textit{Italic} \\faGithub\\end{document}\r\n'
  const input = project({ 'main.tex': source }), assessment = assessLatexProject(input, [profile])
  assert.deepEqual(assessment.fonts.map((font) => [font.requested, font.profileAvailability, font.requestKind, font.feature]), [
    ['lato', 'listed', 'family', undefined], ['Lato Bold', 'listed', 'family', 'BoldFont'], [null, 'not-determined', 'not-determined', 'ItalicFont'],
    ['Noto Sans Bengali', 'listed', 'family', undefined], ['Font Awesome 5 Free', 'listed', 'family', undefined],
    ['lmmono10-regular.otf', 'not-determined', 'file', undefined], ['Lato', 'not-determined', 'file', undefined], [null, 'not-determined', 'not-determined', undefined],
  ])
  assert.equal(assessment.fonts[0].matchedFamily, 'Lato')
  assert.equal(assessment.fonts[0].line, 2)
  assert.ok(assessment.fonts.every((font) => font.pdfUsage === 'not-verified'))
  assert.equal(assessment.fonts[5].matchedFamily, null)
  assert.equal(input.files[0].content, source)
  assert.ok(assessLatexProject(input, []).fonts.filter((font) => font.requestKind === 'family').every((font) => font.profileAvailability === 'not-recorded'))
})

test('profile bibliography capabilities never infer Biber from a runtime name, version or biblatex package', () => {
  assert.deepEqual(bibliographyCapabilities(profile), { biber: 'listed', bibtex: 'listed', biblatex: 'listed' })
  assert.deepEqual(bibliographyCapabilities(), { biber: 'not-recorded', bibtex: 'not-recorded', biblatex: 'not-recorded' })
  assert.deepEqual(bibliographyCapabilities({ ...profile, fonts: [], packages: [] }), { biber: 'not-recorded', bibtex: 'not-recorded', biblatex: 'not-recorded' })
  const native = { ...profile, name: 'Native', version: 'Biber 2.22', packages: ['biblatex'] }
  assert.deepEqual(bibliographyCapabilities(native), { biber: 'not-listed', bibtex: 'not-listed', biblatex: 'listed' })
  assert.equal(bibliographyCapabilities({ ...profile, packages: ['bibtex'] }).bibtex, 'listed')
})

test('reachable Biber backend and style requests retain explicit evidence without claiming a completed bibliography', () => {
  const input = project({ 'main.tex': '\\documentclass{article}\n\\input{pubs-num}\n\\addbibresource{refs.bib}\n\\begin{document}\\printbibliography\\end{document}',
    'pubs-num.tex': '\\usepackage[backend=biber,style={ieee},sorting=ydnt]{biblatex}',
    'pubs-authoryear.tex': '\\usepackage[backend=biber,style=apa6]{biblatex}', 'refs.bib': '@article{original,title={Original publications}}',
  })
  const before = structuredClone(input), assessment = assessLatexProject(input, [profile])
  assert.equal(assessment.bibliography.backend, 'biber')
  assert.deepEqual(assessment.bibliography.requests.map((item) => [item.file, item.backend, item.evidence]), [['pubs-num.tex', 'biber', 'explicit-option']])
  assert.deepEqual(assessment.bibliography.styles.map((item) => [item.requested, item.profileAvailability]), [['ieee', 'listed']])
  assert.equal(assessment.bibliography.result, 'not-verified')
  assert.deepEqual(input, before)
  const other = project({ 'main.tex': '\\usepackage[backend=biber,style=arbitrary]{biblatex}' })
  assert.equal(assessLatexProject(other, [profile]).bibliography.styles[0].profileAvailability, 'not-listed')
})

test('biblatex defaults, explicit BibTeX, option macros, conflicting declarations and missing backend evidence are distinguished', () => {
  const cases: [string, string, string][] = [
    ['\\usepackage{biblatex}', 'biber', 'biblatex-default'],
    ['\\usepackage[backend=bibtex]{biblatex}', 'bibtex', 'explicit-option'],
    ['\\usepackage[backend=\\ChosenBackend]{biblatex}', 'not-determined', 'not-determined'],
    ['\\usepackage[\\options]{biblatex}', 'not-determined', 'not-determined'],
    ['\\PassOptionsToPackage{\\options}{biblatex}\\usepackage{biblatex}', 'not-determined', 'not-determined'],
    ['\\PassOptionsToPackage{backend=bibtex}{biblatex}\\usepackage{biblatex}', 'not-determined', 'explicit-option'],
    ['\\bibliography{refs}', 'bibtex', 'classic-command'],
  ]
  for (const [source, backend, evidence] of cases) {
    const assessment = assessLatexProject(project({ 'main.tex': source }), [profile])
    assert.equal(assessment.bibliography.backend, backend, source)
    assert.equal(assessment.bibliography.requests[0].evidence, evidence, source)
  }
  assert.equal(assessLatexProject(project({ 'main.tex': '\\printbibliography' }), [profile]).bibliography.backend, 'not-determined')
  assert.equal(assessLatexProject(project({ 'main.tex': '\\input{\\macro}' }), [profile]).bibliography.backend, 'not-determined')
  assert.equal(assessLatexProject(project({ 'main.tex': document }), [profile]).bibliography.backend, 'not-requested')
})

test('an unselected main and bounded assessment never invent complete dependency or import provenance', () => {
  const unselected = assessLatexProject(project({ 'main.tex': document }, null), [profile])
  assert.deepEqual(unselected.reachablePaths, [])
  assert.deepEqual(unselected.fonts, [])
  assert.equal(unselected.bibliography.backend, 'not-determined')
  assert.ok(unselected.notDetermined[0].reason.includes('not recorded'))
  const input = project({ 'main.tex': `\\usepackage{${Array.from({ length: 600 }, (_, index) => `p${index}`).join(',')}}` })
  const bounded = assessLatexProject(input, [profile])
  assert.equal(bounded.references.length, 512)
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.bibliography.backend, 'not-determined')
  assert.ok(bounded.notDetermined.some((item) => item.reason.includes('512-entry')))
  const repeated = assessLatexProject(project({ 'main.tex': '\\bibliography{refs}\n'.repeat(600) }), [profile])
  assert.equal(repeated.references.length + repeated.bibliography.requests.length, 512)
  assert.equal(repeated.truncated, true)
})
