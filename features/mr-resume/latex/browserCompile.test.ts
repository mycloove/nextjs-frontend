import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { browserDiagnostics, browserSourceRefusal, isBrowserProof, verifyBrowserPdf } from './browserCompile.ts'
import { createTemplateProject, latexSourceTemplates } from './templates.ts'
import { reviseProject } from './project.ts'
import type { LatexProof } from './types.ts'

test('XeLaTeX templates remain compatible with the legacy Xe-only adapter without rewriting stored projects', () => {
  for (const item of latexSourceTemplates.filter((item) => item.engine === 'xelatex')) {
    const project = createTemplateProject(item.id)
    assert.equal(project.engine, 'xelatex')
    // The original starters are on v2; gallery starters began at v1.
    assert.equal(item.version, ['career-source', 'academic-source'].includes(item.id) ? 2 : 1)
    assert.equal(browserSourceRefusal(project), null)
  }
  const lua = reviseProject(createTemplateProject(), { engine: 'lualatex' })
  assert.match(browserSourceRefusal(lua)!, /Switch the engine explicitly/u)
  assert.equal(lua.engine, 'lualatex')
  const bangla = createTemplateProject('bangla-source')
  assert.equal(bangla.engine, 'lualatex')
  assert.match(browserSourceRefusal(bangla)!, /Switch the engine explicitly/u)
})

test('browser source refuses Lua, Biber and Lua-only renderer while preserving input', () => {
  for (const content of ['\\directlua{os.execute("echo unsafe")}', '\\usepackage[backend=biber]{biblatex}', '\\setmainfont[Renderer=HarfBuzz]{Noto Sans Bengali}']) {
    const original = createTemplateProject()
    const source = reviseProject(original, { files: original.files.map((file, index) => index === 0 ? { ...file, content } : file) })
    assert.ok(browserSourceRefusal(source))
    assert.equal(source.files[0].content, content)
  }
})

test('browser diagnostics expose original in-project TeX lines and missing glyph errors', () => {
  const project = createTemplateProject()
  const result = browserDiagnostics('main.tex:4: Undefined control sequence\n../outside.tex:1: not a project path\nMissing character: There is no X in font\n! LaTeX Error: unavailable package.', project)
  assert.equal(result[0].file, 'main.tex')
  assert.equal(result[0].line, 4)
  assert.ok(result.some((item) => item.code === 'missing_glyph' && item.severity === 'error'))
  assert.ok(result.every((item) => item.file !== '../outside.tex'))
})

test('actual local PDF verification counts pages and rejects incomplete/non-PDF bytes', async () => {
  const document = await PDFDocument.create()
  document.addPage([300, 420])
  assert.equal(await verifyBrowserPdf(await document.save()), 1)
  await assert.rejects(verifyBrowserPdf(new TextEncoder().encode('not a PDF')), /bounded PDF/u)
})

test('local PDF verification refuses active scripts without displaying that PDF', async () => {
  const document = await PDFDocument.create()
  document.addPage()
  document.catalog.set(PDFName.of('OpenAction'), document.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert("unsafe")') }))
  await assert.rejects(verifyBrowserPdf(await document.save()), /Active scripts|Unsafe PDF actions/u)
})

test('local PDF verification refuses unsafe URI actions', async () => {
  const document = await PDFDocument.create()
  document.addPage()
  document.context.register(document.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('javascript:alert(1)') }))
  await assert.rejects(verifyBrowserPdf(await document.save()), /unsafe link URI/u)
})

test('browser proofs are not mislabelled as native certification', () => {
  assert.equal(isBrowserProof(null), false)
  assert.equal(isBrowserProof({ profileVersion: 'native-lualatex/approved' } as LatexProof), false)
  assert.equal(isBrowserProof({ profileVersion: 'browser-xetex/pinned-engine' } as LatexProof), true)
})
