import assert from 'node:assert/strict'
import test from 'node:test'
import { addTextFile, applyNativeFontChoices, assertLatexPath, cloneAsNewProject, deleteProjectFile, isCurrentProof, isWellFormedText,
  makeCheckpoint, projectSize, projectSnapshotHash, referencesToFile, renameProjectFile, requiredNativeFonts, restoreCheckpointProject,
  reviseProject, sameProjectSource, sourceOutline, utf8Bytes, validateLatexProject } from './project.ts'
import { createTemplateProject, latexSourceTemplates } from './templates.ts'
import { LATEX_LIMITS, type LatexProof } from './types.ts'

test('three genuine versioned source templates are independent, with local style/bibliography and actual Bangla text', () => {
  assert.equal(latexSourceTemplates.length, 3)
  const career = createTemplateProject(), academic = createTemplateProject('academic-source'), bangla = createTemplateProject('bangla-source')
  assert.notEqual(career.id, createTemplateProject().id)
  assert.ok(career.files.some((file) => file.path === 'resume.sty' && file.content.includes('ProvidesPackage')))
  assert.ok(academic.files.find((file) => file.path === 'main.tex')!.content.includes('backend=biber'))
  assert.ok(academic.files.some((file) => file.path === 'references.bib' && file.content.includes('@article')))
  assert.match(bangla.files[0].content, /[\u0980-\u09ff]/u)
  assert.match(bangla.files[0].content, /Renderer=HarfBuzz/u)
  for (const project of [career, academic, bangla]) { assert.equal(project.revision, 1); assert.equal(project.templateVersion, 1); assert.equal(validateLatexProject(project), project) }
})

test('raw TeX, Unicode joiners, spaces, CRLF and plain-text specials are never globally escaped or normalized', () => {
  const source = '  % raw\r\n\\newcommand{\\custom}[1]{#1 & 50%}\r\nক্\u200dষ ক্\u200cষ  e\u0301\r\n'
  const project = reviseProject(createTemplateProject(), { files: [{ id: 'main-source', path: 'main.tex', content: source }] })
  assert.equal(validateLatexProject(project).files[0].content, source)
  assert.equal(projectSize(project).source, utf8Bytes(source))
  assert.ok(utf8Bytes(source) > source.length)
  assert.equal(isWellFormedText(source), true)
  assert.equal(isWellFormedText('\ud800'), false)
  assert.throws(() => reviseProject(project, { files: [{ ...project.files[0], content: '\ud800' }] }), /surrogates/u)
})

for (const path of ['../main.tex', '/main.tex', 'a//main.tex', './main.tex', 'a\\main.tex', 'C:/main.tex', '.hidden.tex', 'a./main.tex', 'con.tex', 'a/../main.tex', 'my resume.tex', 'e\u0301.tex']) {
  test(`unsafe path is rejected without normalization: ${JSON.stringify(path)}`, () => assert.throws(() => assertLatexPath(path)))
}

test('supported NFC Unicode filenames and nested relative paths remain exact', () => {
  assert.equal(assertLatexPath('অভিজ্ঞতা/লেখা.tex'), 'অভিজ্ঞতা/লেখা.tex')
  assert.equal(assertLatexPath('assets/profile-photo.jpeg', 'asset'), 'assets/profile-photo.jpeg')
  assert.throws(() => assertLatexPath('fonts/custom.ttf'), /Unsupported file/u)
})

test('project version/identity/main and alias failures leave their originals untouched', () => {
  const original = createTemplateProject(), future = { ...original, version: 7, files: original.files.map((file) => ({ ...file })) }
  const serialized = JSON.stringify(future)
  assert.throws(() => validateLatexProject(future), /format/u)
  assert.equal(JSON.stringify(future), serialized)
  assert.throws(() => validateLatexProject({ ...original, files: [...original.files, { id: 'alias', path: 'MAIN.tex', content: '' }] }), /case alias/u)
  assert.throws(() => validateLatexProject({ ...original, mainFile: 'missing.tex' }), /existing/u)
  assert.throws(() => validateLatexProject({ ...original, templateVersion: null }), /identity/u)
  assert.throws(() => validateLatexProject({ ...original, id: 'constructor' }), /identity/u)
  assert.throws(() => validateLatexProject({ ...original, futureMetadata: 'preserve this' }), /unsupported metadata/u)
  assert.throws(() => validateLatexProject({ ...original, files: original.files.map((file) => ({ ...file, futureField: true })) }), /unsupported metadata/u)
})

test('source and transport limits use actual UTF-8 and JSON bytes, with no file dropping', () => {
  const project = createTemplateProject()
  assert.throws(() => reviseProject(project, { files: [{ id: 'source', path: 'main.tex', content: 'ক'.repeat(Math.ceil(LATEX_LIMITS.sourceBytes / 3)) }] }), /exceeds/u)
  assert.equal(project.files.length, 2)
  const tooMany = Array.from({ length: 33 }, (_, i) => ({ id: `file-${i}`, path: i === 0 ? 'main.tex' : `file-${i}.tex`, content: '' }))
  assert.throws(() => validateLatexProject({ ...project, files: tooMany }), /1-32/u)
})

test('rename updates only file/main paths, warns about literal references, and never rewrites raw TeX', () => {
  let project = addTextFile(createTemplateProject(), 'details.tex', '\\section*{Details}\n')
  project = reviseProject(project, { files: project.files.map((file) => file.path === 'main.tex' ? { ...file, content: '\\input{details}\n% \\input{details}\n' } : file) })
  assert.deepEqual(referencesToFile(project, 'details.tex'), [{ file: 'main.tex', line: 1 }])
  const renamed = renameProjectFile(project, project.files.find((file) => file.path === 'details.tex')!.id, 'sections/details.tex')
  assert.equal(renamed.files.find((file) => file.path === 'main.tex')!.content, project.files.find((file) => file.path === 'main.tex')!.content)
  const main = renameProjectFile(project, project.files[0].id, 'resume.tex')
  assert.equal(main.mainFile, 'resume.tex')
  assert.throws(() => deleteProjectFile(main, main.files[0].id), /another main/u)
  assert.throws(() => renameProjectFile(main, main.files[0].id, 'resume.bib'), /\.tex/u)
})

test('checkpoint restore is a new monotone revision; independent copies preserve content, not Regular state', () => {
  const original = createTemplateProject(), checkpoint = makeCheckpoint(original, 'Before editing')
  const changed = reviseProject(original, { title: 'Changed', files: original.files.map((file) => ({ ...file, content: `${file.content}\n% edit` })) })
  const restored = restoreCheckpointProject(changed, checkpoint), copy = cloneAsNewProject(changed)
  assert.equal(restored.revision, changed.revision + 1)
  assert.equal(restored.id, original.id)
  assert.deepEqual(restored.files, original.files)
  assert.notEqual(copy.id, changed.id)
  assert.equal(copy.revision, 1)
  assert.deepEqual(copy.files, changed.files)
  assert.throws(() => restoreCheckpointProject(copy, checkpoint), /different project/u)
  assert.throws(() => reviseProject({ ...original, revision: Number.MAX_SAFE_INTEGER }, { title: 'x' }), /Revision limit/u)
})

test('outline is source-derived and best effort, with file/line positions and escaped comment handling', () => {
  const outline = sourceOutline([{ id: 'source', path: 'main.tex', content: '% \\section{Not visible}\n\\section*{কর্ম-অভিজ্ঞতা}\r\n\\subsection{Details}\n\\newcommand{\\custom}{No invented heading}\n\\% \\section{After literal percent}' }])
  assert.deepEqual(outline.map((item) => [item.title, item.line, item.level]), [['কর্ম-অভিজ্ঞতা', 2, 0], ['Details', 3, 1], ['After literal percent', 5, 0]])
})

test('explicit font compatibility changes only literal declarations and preserves all resume writing', () => {
  const source = '\\setmainfont{Inter}\n\\newfontfamily\\bengalifont[Script=Bengali]{Tiro Bangla}\nInter in my raw writing ক্\u200dষ #&%\n'
  assert.deepEqual(requiredNativeFonts(source), ['Inter', 'Tiro Bangla'])
  const changed = applyNativeFontChoices(source, { Inter: 'Latin Modern Roman', 'Tiro Bangla': 'Noto Sans Bengali' })
  assert.match(changed, /setmainfont\{Latin Modern Roman\}/u)
  assert.ok(changed.endsWith('Inter in my raw writing ক্\u200dষ #&%\n'))
  assert.throws(() => applyNativeFontChoices(source, { Inter: 'bad}\\input{secret' }))
  const inheritedName = '\\setmainfont{constructor}\n\\setmainfont{toString}\n'
  assert.equal(applyNativeFontChoices(inheritedName, {}), inheritedName)
})

test('authoritative hash canonicalization matches code-point path ordering and ignores only title metadata', async () => {
  const project = createTemplateProject()
  const hash = await projectSnapshotHash(project)
  assert.equal(await projectSnapshotHash({ ...project, title: 'Different title', files: [...project.files].reverse() }), hash)
  assert.notEqual(await projectSnapshotHash({ ...project, engine: 'xelatex' }), hash)
  assert.notEqual(await projectSnapshotHash(reviseProject(project, { title: project.title })), hash)
  assert.notEqual(await projectSnapshotHash({ ...project, files: project.files.map((file, i) => i ? file : { ...file, content: file.content + ' ' }) }), hash)
})

test('proof freshness changes immediately after source, engine or main-file revision changes', () => {
  const project = createTemplateProject(), proof = { projectId: project.id, revision: project.revision, engine: project.engine } as LatexProof
  assert.equal(isCurrentProof(project, proof), true)
  assert.equal(isCurrentProof(reviseProject(project, { title: 'New revision' }), proof), false)
  assert.equal(isCurrentProof({ ...project, engine: 'xelatex' }, proof), false)
  assert.equal(isCurrentProof(cloneAsNewProject(project), proof), false)
})

test('same-revision source forks after multi-tab recovery cannot be mistaken for the captured proof source', () => {
  const source = createTemplateProject(), fork = { ...source, files: source.files.map((file, i) => i ? file : { ...file, content: file.content + '\n% other tab' }) }
  assert.equal(source.revision, fork.revision)
  assert.equal(sameProjectSource(source, fork), false)
  assert.equal(sameProjectSource(source, { ...source, files: [...source.files].reverse() }), true)
  assert.equal(sameProjectSource(source, cloneAsNewProject(source)), true)
  assert.equal(sameProjectSource(source, { ...source, mainFile: 'different.tex' }), false)
  const withImage = { ...source, assets: [{ id: 'asset', path: 'photo.jpg', mediaType: 'image/jpeg' as const, blob: new Blob(['original']) }] }
  assert.equal(sameProjectSource(withImage, { ...withImage, assets: [{ ...withImage.assets[0], blob: new Blob(['changed!']) }] }), false)
})

test('source/asset hash matches the independently verified Unicode wire contract vector', async () => {
  const project = { ...createTemplateProject(), id: 'project-one', revision: 7, mainFile: 'resume.tex',
    files: [{ id: 'main', path: 'resume.tex', content: '\\documentclass{article}\r\n% বাংলা \u200d\u200c e\u0301\n' }],
    assets: [{ id: 'photo', path: 'assets/photo.png', mediaType: 'image/png' as const, blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99])], { type: 'image/png' }) }] }
  assert.equal(await projectSnapshotHash(project), '485563523cce7bb5b37491180005fb568a5406a807f16e58159d481ae271bc10')
})
