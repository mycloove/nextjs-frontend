import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createTemplateProject, latexSourceTemplates, latexTemplateQualifications } from './templates.ts'
import { BROWSER_LATEX_MANIFEST_PIN } from './browserManifestPin.ts'

test('starter qualifications name actual fixtures and invalidate on source, main, engine or version changes', () => {
  const smoke = readFileSync(new URL('./browser/smoke.mjs', import.meta.url), 'utf8')
  for (const qualification of latexTemplateQualifications) {
    const template = latexSourceTemplates.find((item) => item.id === qualification.id)!
    const project = createTemplateProject(template.id)
    const fingerprint = createHash('sha256').update(JSON.stringify([template.id, template.version, project.engine, project.mainFile,
      [...project.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((file) => [file.path, file.content])])).digest('hex')
    assert.equal(fingerprint, qualification.sourceSha256, `${template.id}: requalify changed source instead of inheriting an old result`)
    assert.equal(project.engine, qualification.engine)
    assert.equal(project.templateVersion, qualification.templateVersion)
    assert.ok(smoke.includes(`successful('${qualification.fixture}'`), 'The stated qualification has an actual direct compiler case')
    assert.ok(qualification.checks.length && qualification.limitation.length)
    assert.equal(Object.hasOwn(project, 'qualification'), false, 'No qualification or new schema fields enter portable/stored v1 projects')
  }
  assert.equal(new Set(latexTemplateQualifications.map((item) => item.id)).size, latexSourceTemplates.length)
})

test('recorded starter checks bind their exact browser build, not an untested future native or browser profile', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../public/mr-resume/latex/busytex-v2/manifest.json', import.meta.url), 'utf8'))
  const worker = manifest.assets.find((asset: { path: string }) => asset.path === 'compiler-worker.js')
  const recordedBuild = {
    profileVersion: 'browser-busytex-v2-tl2023-4499aa69-altacv-r1',
    manifestSha256: '4a0cca5dcea6b297df5cc6caf0bbfa932267502e68f3c19d0dc9b44a55634196',
    workerSha256: 'a8ac2cece2aa5c4ab93a69fcb4cdfa9fcb77e12344b0b55abaf1e93813e2c8b5',
  }
  for (const qualification of latexTemplateQualifications) {
    assert.equal(qualification.runtime, 'browser')
    assert.equal(qualification.profileVersion, recordedBuild.profileVersion)
    assert.equal(qualification.manifestSha256, recordedBuild.manifestSha256, 'Preserve the historically tested release; do not relabel it as a new qualification')
    assert.equal(qualification.workerSha256, recordedBuild.workerSha256)
    assert.notEqual(qualification.profileVersion, manifest.profileVersion, 'The new SyncTeX release must not inherit a starter qualification')
    assert.notEqual(qualification.manifestSha256, BROWSER_LATEX_MANIFEST_PIN.sha256)
    assert.notEqual(qualification.workerSha256, worker.sha256)
  }
  assert.match(latexTemplateQualifications.find((item) => item.id === 'bangla-source')!.limitation, /not fully faithful.*not certified/u)
})
