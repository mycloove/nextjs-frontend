import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { createProjectZip, decodeSourceBytes, imageDimensions, inspectProjectZip, readProjectZip, readProjectZipWithReport, readTexProject, readTexProjectWithReport } from './projectArchive.ts'
import { exportProjectFile, importProjectFile, importProjectFileWithReport } from './projectImport.ts'
import { assessLatexProject } from './projectAssessment.ts'
import { createTemplateProject } from './templates.ts'
import { addTextFile, reviseProject, sha256, validateLatexProject } from './project.ts'

const source = '\\documentclass{article}\n\\begin{document}ক্\u200dষ #&%\\end{document}\r\n'
const document = '\\documentclass{article}\r\n\\begin{document}Original writing.\\end{document}\r\n'
function pngChunk(name: string, payload: Uint8Array) {
  const chunk = Buffer.alloc(payload.length + 12)
  chunk.writeUInt32BE(payload.length, 0); chunk.write(name, 4, 'ascii'); chunk.set(payload, 8)
  let crc = 0xffffffff
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return chunk
}
const imageHeader = Buffer.alloc(13)
imageHeader.writeUInt32BE(1, 0); imageHeader.writeUInt32BE(1, 4); imageHeader[8] = 8; imageHeader[9] = 6
const png = new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', imageHeader),
  pngChunk('IDAT', deflateSync(new Uint8Array([0, 255, 255, 255, 255]))), pngChunk('IEND', new Uint8Array())]))
async function zip(entries: Record<string, string | Uint8Array>, compression: 'STORE' | 'DEFLATE' = 'STORE') {
  const value = new JSZip()
  for (const [path, content] of Object.entries(entries)) value.file(path, content)
  return value.generateAsync({ type: 'uint8array', compression })
}
function headers(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22, count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const entries: { central: number; local: number; data: number; nameLength: number }[] = []
  for (let i = 0; i < count; i++) {
    const local = view.getUint32(offset + 42, true), nameLength = view.getUint16(offset + 28, true)
    entries.push({ central: offset, local, data: local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), nameLength })
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  return entries
}

test('portable source ZIP roundtrip keeps all files, build settings, image bytes, Unicode and CRLF, as a new project', async () => {
  const original = reviseProject(createTemplateProject('academic-source'), { files: [{ id: 'source-file', path: 'main.tex', content: source }, { id: 'bibliography', path: 'refs/references.bib', content: '@article{x,title={My writing}}\r\n' }],
    assets: [{ id: 'photo', path: 'assets/photo.png', mediaType: 'image/png', blob: new Blob([png], { type: 'image/png' }) }] })
  const buffer = await createProjectZip(original), restored = await readProjectZip(buffer)
  assert.notEqual(restored.id, original.id)
  assert.equal(restored.revision, 1)
  assert.equal(restored.title, original.title)
  assert.equal(restored.mainFile, original.mainFile)
  assert.equal(restored.engine, original.engine)
  assert.deepEqual(restored.files, original.files)
  assert.equal(restored.assets[0].path, 'assets/photo.png')
  assert.deepEqual(new Uint8Array(await restored.assets[0].blob.arrayBuffer()), png)
  assert.equal(await sha256(await restored.assets[0].blob.arrayBuffer()), await sha256(png))
})

test('.tex import keeps valid UTF-8/BOM/joiners and refuses lossy byte conversion', () => {
  const content = '\ufeff' + source
  assert.equal(readTexProject(new TextEncoder().encode(content), 'resume.tex', 'Imported').files[0].content, content)
  assert.throws(() => decodeSourceBytes(new Uint8Array([0xff, 0xfe])), /UTF-8/u)
  assert.throws(() => readTexProject(new Uint8Array([65]), '../main.tex', 'x'))
})

test('unsupported archive entries are all named and nothing is imported', async () => {
  const bytes = await zip({ 'main.tex': source, 'fonts/custom.otf': 'font', 'vector.svg': 'vector' })
  assert.throws(() => inspectProjectZip(bytes), (error: unknown) => error instanceof Error && /custom\.otf/u.test(error.message) && /vector\.svg/u.test(error.message) && /Nothing was discarded/u.test(error.message))
})

test('Markdown/text/license and latexmkrc files roundtrip as inert UTF-8 data without being selected as main', async () => {
  const entries = { 'first.tex': source, 'second.tex': source, 'README.md': '# Original notes\r\n', 'LICENSE.txt': 'Exact license\r\n', 'latexmkrc': '$hash_calc_ignore_pattern = "timestamp";\r\n' }
  const imported = await readProjectZip((await zip(entries)).buffer as ArrayBuffer)
  assert.equal(imported.mainFile, null)
  assert.deepEqual(Object.fromEntries(imported.files.map((file) => [file.path, file.content])), entries)
  const restored = await readProjectZip(await createProjectZip(imported))
  assert.deepEqual(restored.files, imported.files)
})

test('untouched actual AltaCV ZIP imports every original source, notice, config and PNG without discarding data', async () => {
  const archive = await readFile(new URL('../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url))
  const original = await JSZip.loadAsync(archive)
  const { project: imported, report } = await readProjectZipWithReport(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength))
  assert.equal(imported.mainFile, 'sample.tex')
  assert.equal(imported.files.length, 10)
  assert.equal(imported.assets.length, 3)
  assert.equal(imported.engine, 'xelatex')
  assert.equal(imported.templateId, null)
  assert.deepEqual(report.main, { selected: 'sample.tex', origin: 'single-document', candidates: ['sample.tex'] })
  assert.deepEqual(report.engine, { selected: 'xelatex', origin: 'altacv-recommendation', file: 'sample.tex' })
  assert.deepEqual(report.inertConfigPaths, ['latexmkrc'])
  assert.equal(report.sourceCount, 10)
  assert.equal(report.imageCount, 3)
  assert.deepEqual(report.sourcePaths, imported.files.map((file) => file.path))
  assert.deepEqual(report.imagePaths, imported.assets.map((asset) => asset.path))
  assert.ok(imported.files.some((file) => file.path === 'pubs-num.tex' && /backend=biber/u.test(file.content)))
  const assessment = assessLatexProject(imported)
  assert.ok(assessment.reachablePaths.includes('altacv.cls'))
  assert.ok(assessment.reachablePaths.includes('pubs-num.tex'))
  assert.ok(!assessment.reachablePaths.includes('pubs-authoryear.tex'))
  assert.equal(assessment.bibliography.backend, 'biber')
  assert.ok(assessment.fonts.some((font) => font.requested === 'Roboto Slab'))
  assert.ok(assessment.fonts.some((font) => font.requested === 'Lato'))
  assert.ok(assessment.fonts.every((font) => font.pdfUsage === 'not-verified'))
  for (const file of imported.files) assert.deepEqual(new TextEncoder().encode(file.content), new Uint8Array(await original.file(file.path)!.async('nodebuffer')))
  for (const asset of imported.assets) assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), new Uint8Array(await original.file(asset.path)!.async('nodebuffer')))
  const restored = await readProjectZip(await createProjectZip(imported))
  assert.equal(restored.mainFile, 'sample.tex')
  assert.deepEqual(restored.files, imported.files)
})

for (const path of ['../main.tex', '/main.tex', 'a\\main.tex', 'my resume.tex', 'a/../main.tex', 'e\u0301.tex']) {
  test(`ZIP unsafe path preflight refuses ${JSON.stringify(path)}`, async () => { const bytes = await zip({ [path]: source }); assert.throws(() => inspectProjectZip(bytes)) })
}

test('case aliases and exact duplicate entries cannot be hidden by JSZip normalization', async () => {
  const aliases = await zip({ 'main.tex': source, 'MAIN.tex': source })
  assert.throws(() => inspectProjectZip(aliases), /alias/u)
  const bytes = await zip({ 'main.tex': source, 'part.tex': source }), entry = headers(bytes)[1]
  bytes.set(new TextEncoder().encode('main.tex'), entry.central + 46); bytes.set(new TextEncoder().encode('main.tex'), entry.local + 30)
  assert.throws(() => inspectProjectZip(bytes), /Duplicate/u)
})

test('encrypted entries and Unix symlinks are refused before extraction', async () => {
  const encrypted = await zip({ 'main.tex': source }), view = new DataView(encrypted.buffer), entry = headers(encrypted)[0]
  view.setUint16(entry.central + 8, 1, true); view.setUint16(entry.local + 6, 1, true)
  assert.throws(() => inspectProjectZip(encrypted), /Encrypted/u)
  const symlink = new JSZip(); symlink.file('main.tex', 'target', { unixPermissions: 0xa1ff })
  const symlinkBytes = await symlink.generateAsync({ type: 'uint8array', platform: 'UNIX' })
  assert.throws(() => inspectProjectZip(symlinkBytes), /symlinks/u)
})

test('declared AND observed expanded byte limits defeat forged ZIP size fields', async () => {
  const hugeDeclared = await zip({ 'main.tex': source }, 'DEFLATE'), first = headers(hugeDeclared)[0], view = new DataView(hugeDeclared.buffer)
  view.setUint32(first.central + 24, 1024 * 1024 + 1, true); view.setUint32(first.local + 22, 1024 * 1024 + 1, true)
  assert.throws(() => inspectProjectZip(hugeDeclared), /declared expanded/u)
  const forged = await zip({ 'main.tex': source.repeat(2048) }, 'DEFLATE'), header = headers(forged)[0], forgedView = new DataView(forged.buffer)
  forgedView.setUint32(header.central + 24, 10, true); forgedView.setUint32(header.local + 22, 10, true)
  await assert.rejects(readProjectZip(forged.buffer as ArrayBuffer), /Observed expanded/u)
})

test('streamed CRC validation rejects corrupt actual source bytes', async () => {
  const bytes = await zip({ 'main.tex': source }), entry = headers(bytes)[0]
  bytes[entry.data + 1] ^= 1
  await assert.rejects(readProjectZip(bytes.buffer as ArrayBuffer), /checksum/u)
})

test('truncated, overlapping, ZIP64 and excessive entry directories are refused', async () => {
  const bytes = await zip({ 'main.tex': source, 'part.tex': source })
  assert.throws(() => inspectProjectZip(bytes.subarray(0, bytes.length - 1)))
  const zip64 = new Uint8Array(bytes); new DataView(zip64.buffer).setUint32(zip64.length - 22 + 12, 0xffffffff, true)
  assert.throws(() => inspectProjectZip(zip64), /ZIP64/u)
  const overlap = new Uint8Array(bytes), entries = headers(overlap)
  new DataView(overlap.buffer).setUint32(entries[1].central + 42, entries[0].local, true)
  assert.throws(() => inspectProjectZip(overlap), /local path|Overlapping/u)
  const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i === 0 ? 'main.tex' : `part-${i}.tex`, '']))
  const excessive = await zip(tooMany)
  assert.throws(() => inspectProjectZip(excessive), /limits/u)
})

test('multiple TeX entry points import as an unselected draft with every nested source and original image byte', async () => {
  const entries = { 'template/cv.tex': '\ufeff' + source, 'template/alternate.tex': source,
    'template/sections/body.tex': '\\section{My writing}\r\n', 'template/styles/resume.sty': '\\ProvidesPackage{resume}\r\n',
    'template/references.bib': '@article{x,title={Exact source}}\r\n', 'template/assets/photo.png': png }
  const imported = await readProjectZip((await zip(entries, 'DEFLATE')).buffer as ArrayBuffer, 'Imported CV')
  assert.equal(imported.mainFile, null)
  assert.equal(imported.title, 'Imported CV')
  assert.deepEqual(Object.fromEntries(imported.files.map((file) => [file.path, file.content])), Object.fromEntries(Object.entries(entries).filter(([, content]) => typeof content === 'string')))
  assert.equal(imported.assets[0].path, 'template/assets/photo.png')
  assert.deepEqual(new Uint8Array(await imported.assets[0].blob.arrayBuffer()), png)
  const restored = await readProjectZip(await createProjectZip(imported))
  assert.equal(restored.mainFile, null)
  assert.deepEqual(restored.files, imported.files)
  assert.deepEqual(new Uint8Array(await restored.assets[0].blob.arrayBuffer()), png)
  const selected = reviseProject(imported, { mainFile: 'template/alternate.tex' })
  assert.equal(selected.mainFile, 'template/alternate.tex')
  assert.deepEqual(selected.files, imported.files)
  assert.equal(imported.mainFile, null)
})

test('explicitly unselected main survives portable export even when main.tex or a sole TeX file exists', async () => {
  for (const files of [createTemplateProject().files, [{ id: 'source', path: 'cv.tex', content: source }]]) {
    const draft = reviseProject(createTemplateProject(), { mainFile: null, files })
    const restored = await readProjectZip(await createProjectZip(draft))
    assert.equal(restored.mainFile, null)
    assert.deepEqual(restored.files, files)
  }
})

test('a single complete root or sole TeX file remains selected without renaming source paths', async () => {
  assert.equal((await readProjectZip((await zip({ 'main.tex': document, 'other.tex': '\\section{Fragment}' })).buffer as ArrayBuffer)).mainFile, 'main.tex')
  assert.equal((await readProjectZip((await zip({ 'template/cv.tex': source })).buffer as ArrayBuffer)).mainFile, 'template/cv.tex')
  assert.equal((await readProjectZip((await zip({ 'first.tex': source, 'second.tex': source })).buffer as ArrayBuffer)).mainFile, null)
})

test('main.tex fragments cannot outweigh an actual nested Unicode root; source bytes and report paths stay exact', async () => {
  const entries = { 'main.tex': '\\section{Only a fragment}\r\n', '\u0985\u09ad\u09bf\u099c\u09cd\u099e\u09a4\u09be/\u09ae\u09c2\u09b2.tex': '\ufeff% !TeX program = XeLaTeX\r\n' + document,
    'styles/local.sty': '\\ProvidesPackage{local}\r\n', 'images/photo.png': png }
  const { project, report } = await readProjectZipWithReport((await zip(entries, 'DEFLATE')).buffer as ArrayBuffer)
  const path = Object.keys(entries)[1]
  assert.equal(project.mainFile, path)
  assert.deepEqual(report.main, { selected: path, origin: 'single-document', candidates: [path] })
  assert.deepEqual(report.engine, { selected: 'xelatex', origin: 'tex-program', file: path, line: 1 })
  assert.equal(report.sourceCount, 3)
  assert.equal(report.imageCount, 1)
  assert.equal(report.projectId, project.id)
  assert.equal(report.revision, project.revision)
  const exported = await JSZip.loadAsync(await createProjectZip(project))
  for (const [path, content] of Object.entries(entries)) assert.deepEqual(await exported.file(path)!.async('uint8array'), typeof content === 'string' ? new TextEncoder().encode(content) : content)
})

test('multiple complete documents stay ambiguous even when one is called main.tex, without borrowing another file engine', async () => {
  const { project, report } = await readProjectZipWithReport((await zip({ 'main.tex': '% !TeX program = xelatex\n' + document, 'other.tex': '% !TeX program = pdflatex\n' + document })).buffer as ArrayBuffer)
  assert.equal(project.mainFile, null)
  assert.deepEqual(report.main, { selected: null, origin: 'ambiguous', candidates: ['main.tex', 'other.tex'] })
  assert.deepEqual(report.engine, { selected: 'lualatex', origin: 'default' })
  assert.equal(project.files.length, 2)
  const explicit = reviseProject(project, { mainFile: 'other.tex', engine: 'xelatex' })
  const selected = await readProjectZipWithReport(await createProjectZip(explicit))
  assert.equal(selected.project.mainFile, 'other.tex')
  assert.equal(selected.report.main.origin, 'manifest')
  assert.deepEqual(selected.report.engine, { selected: 'xelatex', origin: 'manifest', file: 'smilepdf-project.json' })
})

test('a manifest null remains unselected and neither receipts nor new metadata enter portable v1 records', async () => {
  const original = reviseProject(createTemplateProject(), { mainFile: null })
  const { project, report } = await readProjectZipWithReport(await createProjectZip(original))
  assert.equal(report.main.origin, 'manifest')
  assert.equal(report.main.selected, null)
  assert.equal(validateLatexProject(project), project)
  assert.equal(Object.hasOwn(project, 'report'), false)
  assert.equal(Object.hasOwn(project, 'importReport'), false)
  const archive = await JSZip.loadAsync(await createProjectZip(project))
  const manifest = JSON.parse(await archive.file('smilepdf-project.json')!.async('string'))
  assert.deepEqual(Object.keys(manifest).sort(), ['format', 'version', 'sourceProjectId', 'title', 'mainFile', 'engine', 'templateId', 'templateVersion', 'files', 'assets', 'nativeFonts', 'requirements', 'templateNotice'].sort())
  assert.equal(manifest.version, 1)
  assert.equal(manifest.mainFile, null)
  manifest.importReport = report
  archive.file('smilepdf-project.json', JSON.stringify(manifest))
  await assert.rejects(readProjectZipWithReport(await archive.generateAsync({ type: 'arraybuffer' })), /unsupported fields/u)
})

test('engine precedence is valid manifest, supported main directive, original AltaCV recommendation, then default', async () => {
  const altacv = document.replace('{article}', '{altacv}')
  const entries = { 'cv.tex': '\ufeff% !TeX TS-program = pdfLaTeX\r\n' + altacv, 'altacv.cls': '\\ProvidesClass{altacv}' }
  const declared = await readProjectZipWithReport((await zip(entries)).buffer as ArrayBuffer)
  assert.deepEqual(declared.report.engine, { selected: 'pdflatex', origin: 'tex-program', file: 'cv.tex', line: 1 })
  assert.equal(declared.project.files[0].content, entries['cv.tex'])
  const explicit = reviseProject(declared.project, { engine: 'lualatex' })
  const exported = await readProjectZipWithReport(await createProjectZip(explicit))
  assert.deepEqual(exported.report.engine, { selected: 'lualatex', origin: 'manifest', file: 'smilepdf-project.json' })
  assert.equal(readTexProjectWithReport(new TextEncoder().encode(altacv), 'cv.tex', 'CV').report.engine.origin, 'altacv-recommendation')
  assert.equal(readTexProjectWithReport(new TextEncoder().encode(document), 'cv.tex', 'CV').report.engine.origin, 'default')
  for (const engine of [null, 42, 'latex', 'XeLaTeX']) {
    const manifest = { format: 'smilepdf-latex', version: 1, files: [{ id: 'source', path: 'cv.tex' }], assets: [], mainFile: 'cv.tex', engine }
    await assert.rejects(readProjectZipWithReport((await zip({ 'cv.tex': entries['cv.tex'], 'smilepdf-project.json': JSON.stringify(manifest) })).buffer as ArrayBuffer), /unsupported engine/u)
  }
})

test('directive evidence handles BOM/CRLF, ignores unsupported programs and does not execute command arguments', () => {
  const values = [
    ['\ufeff% !TeX program = XeLaTeX\r\n', 'xelatex', 1],
    ['% ordinary comment\r% !TEX TS-program=LuaLaTeX\r', 'lualatex', 2],
    ['% !TeX program = latex\n% !TeX program = pdflatex\n', 'pdflatex', 2],
  ] as const
  for (const [prefix, engine, line] of values) {
    const content = prefix + document, bytes = new TextEncoder().encode(content)
    const { project, report } = readTexProjectWithReport(bytes, 'cv.tex', 'CV')
    assert.deepEqual(report.engine, { selected: engine, origin: 'tex-program', file: 'cv.tex', line })
    assert.deepEqual(new TextEncoder().encode(project.files[0].content), bytes)
    assert.equal(report.main.origin, 'tex-file')
  }
  for (const directive of ['% !TeX program = xelatex-extra', '% !TeX program = xelatex --shell-escape', '% !TeX program = latex', 'Not a directive % !TeX program = xelatex']) {
    const { report } = readTexProjectWithReport(new TextEncoder().encode(directive + '\n' + document), 'cv.tex', 'CV')
    assert.deepEqual(report.engine, { selected: 'lualatex', origin: 'default' })
  }
})

test('invalid UTF-8 ZIP source, malformed JSON and mismatched local filenames are rejected without a report', async () => {
  await assert.rejects(readProjectZipWithReport((await zip({ 'main.tex': new Uint8Array([0xff]) })).buffer as ArrayBuffer), /UTF-8/u)
  await assert.rejects(readProjectZipWithReport((await zip({ 'main.tex': document, 'smilepdf-project.json': '{' })).buffer as ArrayBuffer), /JSON/u)
  const bytes = await zip({ 'main.tex': document }), header = headers(bytes)[0]
  bytes.set(new TextEncoder().encode('part.tex'), header.local + 30)
  await assert.rejects(readProjectZipWithReport(bytes.buffer as ArrayBuffer), /local path/u)
})

test('implicit folder aliases and file/folder collisions cannot hide behind different full ZIP paths', async () => {
  for (const paths of [['Folder/a.tex', 'folder/b.tex'], ['main.tex', 'main.tex/part.tex'], ['\u00c9.tex', '\u00e9.tex']]) {
    const archive = new JSZip()
    for (const path of paths) archive.file(path, document, { createFolders: false })
    const bytes = await archive.generateAsync({ type: 'uint8array' })
    assert.throws(() => inspectProjectZip(bytes), /Duplicate|alias|collision/u)
  }
})

test('source-only support packages import before the user creates and selects an arbitrary main', async () => {
  const imported = await readProjectZip((await zip({ 'styles/resume.sty': '\\ProvidesPackage{resume}\r\n', 'references.bib': '@article{x}\r\n' })).buffer as ArrayBuffer)
  assert.equal(imported.mainFile, null)
  const created = addTextFile(imported, 'my-entry.tex', source)
  assert.equal(created.mainFile, null)
  assert.deepEqual(created.files.slice(0, imported.files.length), imported.files)
  const selected = reviseProject(created, { mainFile: 'my-entry.tex' })
  assert.equal((await readProjectZip(await createProjectZip(selected))).mainFile, 'my-entry.tex')
})

test('invalid selected main and future/unsupported manifest metadata are still refused without fallback', async () => {
  const manifest = { format: 'smilepdf-latex', version: 1, files: [{ id: 'source', path: 'main.tex' }], assets: [], mainFile: 'main.tex', engine: 'lualatex', billing: 'unsupported' }
  await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify(manifest) })).buffer as ArrayBuffer), /unsupported fields/u)
  await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify({ ...manifest, billing: undefined, version: 99 }) })).buffer as ArrayBuffer), /format or version/u)
  await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify({ ...manifest, billing: undefined, mainFile: 'missing.tex' }) })).buffer as ArrayBuffer), /existing/u)
})

test('manifest entry metadata is strict v1 data, not a place to silently discard unrecognized import reports', async () => {
  const manifest = { format: 'smilepdf-latex', version: 1, files: [{ id: 'source', path: 'main.tex' }], assets: [] as Record<string, unknown>[], mainFile: 'main.tex', engine: 'lualatex' }
  for (const extra of [{ report: { engine: 'xelatex' } }, { content: 'Unpreserved metadata' }]) {
    const metadata = { ...manifest, files: [{ ...manifest.files[0], ...extra }] }
    await assert.rejects(readProjectZipWithReport((await zip({ 'main.tex': document, 'smilepdf-project.json': JSON.stringify(metadata) })).buffer as ArrayBuffer), /unsupported fields/u)
  }
  const metadata = { ...manifest, assets: [{ id: 'photo', path: 'photo.png', mediaType: 'image/png', bytes: png.length, sha256: await sha256(png), caption: 'Unpreserved metadata' }] }
  await assert.rejects(readProjectZipWithReport((await zip({ 'main.tex': document, 'photo.png': png, 'smilepdf-project.json': JSON.stringify(metadata) })).buffer as ArrayBuffer), /unsupported fields/u)
})

test('PNG/JPEG signatures and pixel dimensions are bounded before browser/native decoding', () => {
  assert.deepEqual(imageDimensions(png, 'image/png'), { width: 1, height: 1 })
  const bomb = new Uint8Array(png); new DataView(bomb.buffer).setUint32(16, 8192)
  assert.throws(() => imageDimensions(bomb, 'image/png'), /4096/u)
  assert.throws(() => imageDimensions(new Uint8Array([1, 2, 3, 4]), 'image/jpeg'), /JPEG/u)
  const corrupt = new Uint8Array(png); corrupt[45] ^= 1
  assert.throws(() => imageDimensions(corrupt, 'image/png'), /checksum/u)
  assert.throws(() => imageDimensions(png.subarray(0, png.length - 12), 'image/png'), /missing/u)
})

test('the real archive worker handler preserves transient evidence and legacy import/export callers across structured cloning', async () => {
  const names = ['self', 'Worker', 'window', 'createImageBitmap']
  const originals = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const scope: { onmessage: ((event: { data: unknown }) => Promise<void>) | null; postMessage: (data: unknown, transfer?: Transferable[]) => void } = {
    onmessage: null, postMessage: () => { throw new Error('No unit worker receiver') },
  }
  const instances: LocalArchiveWorker[] = []
  let closedBitmaps = 0
  class LocalArchiveWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminated = 0
    constructor(url: URL) { assert.ok(url.pathname.endsWith('/projectImport.worker.ts')); instances.push(this) }
    terminate() { this.terminated++ }
    postMessage(data: unknown, transfer: Transferable[] = []) {
      scope.postMessage = (value, transfer = []) => {
        const message = structuredClone(value, { transfer }) as Record<string, unknown>
        this.onmessage?.({ data: { ...message, id: 'unrelated-operation' } } as MessageEvent<unknown>)
        this.onmessage?.({ data: message } as MessageEvent<unknown>)
      }
      void scope.onmessage!({ data: structuredClone(data, { transfer }) })
    }
  }
  try {
    Object.defineProperty(globalThis, 'self', { configurable: true, value: scope })
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: LocalArchiveWorker })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1, height: 1, close: () => { closedBitmaps++ } }) })
    await import('./projectImport.worker.ts')
    assert.ok(scope.onmessage)
    const original = '\ufeff% !TeX program = xelatex\r\n' + document
    const bytes = await zip({ 'nested/cv.tex': original, 'images/photo.png': png })
    const imported = await importProjectFileWithReport(new File([new Uint8Array(bytes)], 'cv.zip'))
    assert.equal(imported.report.engine.origin, 'tex-program')
    assert.equal(imported.report.engine.file, 'nested/cv.tex')
    assert.equal(imported.report.engine.line, 1)
    assert.equal(imported.project.files[0].content, original)
    assert.equal(imported.report.projectId, imported.project.id)
    assert.equal(imported.report.sourceCount, 1)
    assert.equal(imported.report.imageCount, 1)
    assert.deepEqual(new Uint8Array(await imported.project.assets[0].blob.arrayBuffer()), png)
    const exported = await exportProjectFile(imported.project)
    assert.equal(exported.type, 'application/zip')
    const restored = await importProjectFileWithReport(new File([exported], 'exported.zip'))
    assert.equal(restored.report.engine.origin, 'manifest')
    assert.deepEqual(restored.project.files, imported.project.files)
    const legacy = await importProjectFile(new File([original], 'cv.tex'))
    assert.equal(validateLatexProject(legacy), legacy)
    assert.equal(legacy.files[0].content, original)
    assert.equal(legacy.engine, 'xelatex')
    assert.equal(Object.hasOwn(legacy, 'report'), false)
    await assert.rejects(importProjectFileWithReport(new File([new Uint8Array([0])], 'broken.zip')))
    assert.equal(closedBitmaps, 2)
    assert.equal(instances.length, 5)
    for (const instance of instances) assert.equal(instance.terminated, 1)
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
