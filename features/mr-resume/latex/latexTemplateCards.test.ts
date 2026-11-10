import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import JSZip from 'jszip'
import { latexTemplateCards } from './latexTemplateCards.ts'
import { latexSourceTemplates, latexTemplateQualifications } from './templates.ts'
import { createArchiveTemplateProject, latexArchiveTemplates } from './archiveTemplates.ts'

const smoke = readFileSync(new URL('./browser/smoke.mjs', import.meta.url), 'utf8') + readFileSync(new URL('./browser/gallery-smoke.mjs', import.meta.url), 'utf8')
const archiveBytes = (path: string) => readFileSync(new URL(`../../../public${path}`, import.meta.url))

test('every LaTeX gallery card is a real bundled starter with a real compiler fixture', () => {
  const ids = [...latexSourceTemplates.map((item) => item.id), ...latexArchiveTemplates.map((item) => item.id)].sort()
  assert.deepEqual(latexTemplateCards.map((card) => card.id).sort(), ids)
  for (const card of latexTemplateCards) {
    const source = latexSourceTemplates.find((item) => item.id === card.id)
    const archive = latexArchiveTemplates.find((item) => item.id === card.id)
    assert.equal(card.editor, 'latex')
    assert.equal(card.engine, source?.engine ?? archive?.engine, card.id)
    assert.ok(card.qualification && smoke.includes(`successful('${card.qualification}'`), `${card.id}: fixture ${card.qualification} must exist`)
    if (source) assert.equal(latexTemplateQualifications.find((item) => item.id === card.id)?.fixture, card.qualification, `${card.id}: card and qualification name the same fixture`)
    if (archive) { assert.equal(card.runtime, 'browser-after-consent'); assert.deepEqual(card.packageGroups, archive.packageGroups); assert.equal(card.qualification, archive.fixture) }
    else assert.equal(card.runtime, 'browser')
    assert.match(card.name.bn, /[\u0980-\u09ff]|AltaCV/u)
    assert.match(card.summary.bn, /[\u0980-\u09ff]/u)
  }
})

test('third-party credits name the license, the pinned revision and every change', () => {
  const jakes = latexTemplateCards.find((card) => card.id === 'jakes-resume')!
  assert.equal(jakes.credit?.license, 'MIT')
  const main = latexSourceTemplates.find((item) => item.id === 'jakes-resume')!.files.find((file) => file.path === 'main.tex')!.content
  assert.ok(main.includes(jakes.credit!.revision))
  for (const removed of ['fullpage', 'fancyhdr', 'marvosym', 'latexsym']) assert.doesNotMatch(main, new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${removed}\\}`, 'u'), removed)
  for (const change of jakes.credit!.changes) assert.ok(change.length > 20)
  const alta = latexTemplateCards.find((card) => card.id === 'altacv')!
  assert.equal(alta.credit?.license, 'LPPL-1.3c')
})

test('the AltaCV archive is pinned, keeps upstream sources byte-identical and does not redistribute the icon set', async () => {
  const entry = latexArchiveTemplates.find((item) => item.id === 'altacv')!
  const bytes = archiveBytes(entry.path)
  assert.equal(bytes.length, entry.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
  const ours = await JSZip.loadAsync(bytes)
  const upstream = await JSZip.loadAsync(readFileSync(new URL('../../../../Mr.Resume/AltaCV_Template.zip', import.meta.url)))
  for (const name of ['altacv.cls', 'sample.tex', 'sample.bib', 'pubs-num.tex', 'pubs-authoryear.tex', 'LICENSE.md', 'README.md']) {
    assert.equal(await ours.file(name)!.async('string'), await upstream.file(name)!.async('string'), `${name} must be unchanged (LPPL)`)
  }
  for (const icon of ['Globe_High.png', 'Suitcase_High.png', 'Yacht_High.png']) {
    assert.notDeepEqual(await ours.file(icon)!.async('uint8array'), await upstream.file(icon)!.async('uint8array'), `${icon} must be our placeholder, not the Smashing icon`)
  }
  assert.match(await ours.file('NOTICE-SmilePDF.txt')!.async('string'), /LaTeX Project Public License[\s\S]*replaced by SmilePDF placeholder images/u)
})

test('archive templates open through the import path and refuse bytes that do not match the pin', async () => {
  const entry = latexArchiveTemplates[0]
  const bytes = archiveBytes(entry.path)
  const project = await createArchiveTemplateProject(entry.id, async () => new Response(bytes))
  assert.equal(project.mainFile, entry.mainFile); assert.equal(project.engine, entry.engine)
  assert.ok(project.assets.length >= 3 && project.files.some((file) => file.path === 'altacv.cls'))
  const tampered = new Uint8Array(bytes); tampered[100] ^= 1
  await assert.rejects(createArchiveTemplateProject(entry.id, async () => new Response(tampered)), /did not match its pinned bytes/u)
  await assert.rejects(createArchiveTemplateProject(entry.id, async () => new Response('missing', { status: 404 })), /could not be downloaded/u)
  await assert.rejects(createArchiveTemplateProject(entry.id, async () => { throw new TypeError('offline') }), /could not be downloaded/u)
  await assert.rejects(createArchiveTemplateProject('nope', async () => new Response(bytes)), /no longer available/u)
})

test('gallery fixtures never edit the release-pinned smoke harness', () => {
  const release = readFileSync(new URL('./browser/smoke.mjs', import.meta.url), 'utf8')
  for (const card of latexTemplateCards.filter((item) => !['career-source', 'academic-source', 'bangla-source'].includes(item.id))) assert.ok(!release.includes(`successful('${card.qualification}'`), `${card.qualification} belongs in gallery-smoke.mjs`)
  assert.match(readFileSync(new URL('./browser/gallery-smoke.mjs', import.meta.url), 'utf8'), /harnessSource\.slice\(0, cut\)/u)
})
