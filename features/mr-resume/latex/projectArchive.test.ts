import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { createProjectZip, decodeSourceBytes, imageDimensions, inspectProjectZip, readProjectZip, readTexProject } from './projectArchive.ts'
import { createTemplateProject } from './templates.ts'
import { referencesToFile, reviseProject, sha256 } from './project.ts'
import { readLatexManifest } from './server/contract.ts'

const source = '\\documentclass{article}\n\\begin{document}ক্\u200dষ #&%\\end{document}\r\n'
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
  const bytes = await zip({ 'main.tex': source, 'fonts/custom.otf': 'font', 'script.py': 'executable', 'LICENSE.txt': 'license notice' })
  assert.throws(() => inspectProjectZip(bytes), (error: unknown) => error instanceof Error && /custom\.otf/u.test(error.message) && /script\.py/u.test(error.message) && /Nothing was discarded/u.test(error.message))
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

test('template ZIPs like AltaCV import their real entry point, declared engine and every file', async () => {
  // Root-level layout the Makefile template actually ships: one \documentclass
  // .tex, its class, and a photo asset — no build manifest inside.
  const bytes = await zip({
    'sample.tex': '% !TeX program = xelatex\n\\documentclass[10pt,A4,ragged2e]{altacv}\n\\begin{document}AltaCV\\end{document}\n',
    'altacv.cls': '\\ProvidesClass{altacv}[2023/10/01 v3.4]\n\\LoadClass[10pt]{article}\n',
    'PaTi.png': png,
  })
  const project = await readProjectZip(bytes.buffer as ArrayBuffer, 'AltaCV_Template')
  assert.equal(project.title, 'AltaCV_Template')
  assert.equal(project.mainFile, 'sample.tex')
  assert.equal(project.engine, 'xelatex')
  assert.deepEqual(project.files.map((file) => file.path), ['sample.tex', 'altacv.cls'])
  assert.deepEqual(project.assets.map((asset) => asset.path), ['PaTi.png'])
  // Overleaf-style wrapped folder layout: single nested entry point still opens.
  const wrapped = await zip({ 'AltaCV_Template/sample.tex': '\\documentclass{altacv}\n', 'AltaCV_Template/altacv.cls': '\\ProvidesClass{altacv}\n' })
  const nested = await readProjectZip(wrapped.buffer as ArrayBuffer, 'AltaCV_Template')
  assert.equal(nested.mainFile, 'AltaCV_Template/sample.tex')
  assert.equal(nested.engine, 'lualatex')
})

test('the supplied AltaCV ZIP imports and roundtrips all 13 original files through the compile contract', async () => {
  const bytes = readFileSync(new URL('../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url))
  const buffer = new Uint8Array(bytes).buffer
  const original = await JSZip.loadAsync(buffer)
  const project = await readProjectZip(buffer, 'AltaCV_Template')
  const paths = ['CHANGELOG.md', 'Yacht_High.png', 'Suitcase_High.png', 'Globe_High.png', 'sample.tex', 'sample.bib', 'pubs-num.tex', 'pubs-authoryear.tex', 'nicethings_icons_readme.txt', 'latexmkrc', 'altacv.cls', 'README.md', 'LICENSE.md']
  assert.equal(project.mainFile, 'sample.tex')
  assert.equal(project.engine, 'lualatex')
  assert.equal(project.files.length, 10)
  assert.equal(project.assets.length, 3)
  assert.ok(referencesToFile(project, 'Globe_High.png').some((reference) => reference.file === 'sample.tex'), 'AltaCV photoR image references remain visible before rename/delete')
  assert.deepEqual([...project.files, ...project.assets].map((file) => file.path).sort(), paths.sort())
  for (const file of project.files) assert.equal(file.content, await original.file(file.path)!.async('string'), file.path)
  for (const asset of project.assets) assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), await original.file(asset.path)!.async('uint8array'), asset.path)
  const manifest = readLatexManifest({ version: project.version, operationKey: 'altacv-regression', projectId: project.id, title: project.title, revision: project.revision,
    mainFile: project.mainFile, engine: project.engine, files: project.files, assets: project.assets.map((asset) => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.blob.size })) })
  assert.equal(manifest.files.length + manifest.assets.length, 13)
  const restored = await readProjectZip(await createProjectZip(project))
  assert.deepEqual(restored.files, project.files)
  assert.equal(restored.mainFile, project.mainFile)
  assert.equal(restored.engine, project.engine)
  for (let i = 0; i < project.assets.length; i++) assert.equal(await sha256(await restored.assets[i].blob.arrayBuffer()), await sha256(await project.assets[i].blob.arrayBuffer()))
})

test('main-file inference ignores commented declarations and does not let project notes override the engine', async () => {
  const bytes = await zip({
    'Template/resume.tex': '% !TeX program = pdflatex\n\\documentclass\n[10pt]\n{article}\n',
    'Template/parts.tex': '% \\documentclass{article}\r\n\\section{Partial}\r\n',
    'README.md': '% !TeX program = xelatex\nTemplate instructions.\n',
    'latexmkrc': '$pdf_mode = 5;\n',
  })
  const project = await readProjectZip(bytes.buffer as ArrayBuffer)
  assert.equal(project.mainFile, 'Template/resume.tex')
  assert.equal(project.engine, 'pdflatex')
  const standalone = readTexProject(new TextEncoder().encode('\uFEFF% Header\r% !TeX TS-program = xelatex\r' + source), 'resume.tex', 'Resume')
  assert.equal(standalone.engine, 'xelatex')
})

test('an explicit invalid manifest entry point never silently falls back or crashes engine detection', async () => {
  const manifest = { format: 'smilepdf-latex', version: 1, files: [{ id: 'source', path: 'main.tex' }], assets: [], mainFile: 'missing.tex', engine: 'lualatex' }
  for (const mainFile of ['missing.tex', '', null]) {
    await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify({ ...manifest, mainFile }) })).buffer as ArrayBuffer), /no valid main file/u)
  }
})

test('multi-tex ZIPs without one documentclass entry point are still refused, never guessed', async () => {
  await assert.rejects(readProjectZip((await zip({ 'sample.tex': 'no entry marker here', 'letter.tex': 'no marker either' })).buffer as ArrayBuffer), /multiple/u)
  await assert.rejects(readProjectZip((await zip({ 'first.tex': source, 'second.tex': source })).buffer as ArrayBuffer), /multiple/u)
})

test('ambiguous entry point and future/unsupported manifest metadata never silently choose or discard', async () => {
  const manifest = { format: 'smilepdf-latex', version: 1, files: [{ id: 'source', path: 'main.tex' }], assets: [], mainFile: 'main.tex', engine: 'lualatex', billing: 'unsupported' }
  await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify(manifest) })).buffer as ArrayBuffer), /unsupported fields/u)
  await assert.rejects(readProjectZip((await zip({ 'main.tex': source, 'smilepdf-project.json': JSON.stringify({ ...manifest, billing: undefined, version: 99 }) })).buffer as ArrayBuffer), /format or version/u)
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
