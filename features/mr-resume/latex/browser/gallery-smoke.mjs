// Real-compiler fixtures for the Mr. Resume gallery starters.
//
// browser/smoke.mjs is a recorded provisioning input of the immutable
// busytex-v2 release (source-offer.json pins its bytes), so it is never edited
// for new templates. This runner reuses smoke.mjs's harness VERBATIM — the
// exact worker adapter, supplied-asset verification and PDF semantics checks —
// by loading every definition that precedes its case list, then runs the
// gallery cases below with the same `successful()` gate.
//
// Run with Node >= 22.12:
//   node --experimental-strip-types features/mr-resume/latex/browser/gallery-smoke.mjs [--case=<fixture>] [--output-dir=<absolute>]
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const harnessSource = await readFile(path.join(here, 'smoke.mjs'), 'utf8')
const marker = 'console.log(`REAL NODE/WASM SMOKE:'
const cut = harnessSource.indexOf(marker)
if (cut < 0) throw new Error('smoke.mjs changed shape: its harness/case boundary marker is missing.')

const galleryCases = String.raw`
const gallery = (id) => latexSourceTemplates.find((template) => template.id === id)
await checkAssets()
// The three original starters on TODAY's pin (their qualification records stay bound to the older build).
await successful('career-template-current-pin', 'xelatex', gallery('career-source').files, { text: ['Ayesha Rahman', 'Profile', 'Education', 'Skills'], pages: 1, font: /LMRoman10/i }, 'main.tex', { supplied: true })
await successful('academic-template-current-pin', 'xelatex', gallery('academic-source').files, { text: ['Samira Ahmed', 'Research interests', 'Fictional Journal'], bibliography: true, font: /LMRoman10/i }, 'main.tex', { supplied: true })
await successful('bangla-template-current-pin', 'lualatex', gallery('bangla-source').files, { text: ['Northstar Studio', 'English'], bengaliGlyphs: ['আয়েশা রহমান'], pages: 1, font: /NotoSansBengali/i }, 'main.tex', { supplied: true })
// Gallery starters (galleryTemplates.ts): unchanged sources, core + profile groups only, no package consent.
await successful('compact-template-as-is', 'pdflatex', gallery('compact-source').files, { text: ['Nadia Karim', 'Experience', 'Projects', 'Education', 'Skills'], pages: 1, font: /LMRoman10/i }, 'main.tex', { supplied: true })
await successful('modern-template-as-is', 'xelatex', gallery('modern-source').files, { text: ['Farhan Chowdhury', 'Summary', 'Experience', 'Education', 'Skills'], pages: 1, font: /LMSans10/i }, 'main.tex', { supplied: true })
await successful('sidebar-template-as-is', 'xelatex', gallery('sidebar-source').files, { text: ['Rina Das', 'CONTACT', 'SKILLS', 'Profile', 'Experience'], pages: 1, font: /LMSans10/i }, 'main.tex', { supplied: true })
await successful('international-template-as-is', 'pdflatex', gallery('international-source').files, { text: ['Tanvir Hossain', 'Experience', 'Education', 'Languages'], pages: 1, font: /LMRoman10/i }, 'main.tex', { supplied: true })
await successful('bd-biodata-template-as-is', 'lualatex', gallery('bd-biodata-source').files, { text: ['rakib@example.com', 'GPA 5.00'], bengaliGlyphs: ['জীবনবৃত্তান্ত', 'রাকিব হাসান'], pages: 1, font: /NotoSansBengali/i }, 'main.tex', { supplied: true })
await successful('letter-template-as-is', 'xelatex', gallery('letter-source').files, { text: ['Sadia Islam', 'Dear Hiring Manager', 'Sincerely'], pages: 1, font: /LMRoman10/i }, 'main.tex', { supplied: true })
await successful('jakes-resume-as-is', 'pdflatex', gallery('jakes-resume').files, { text: ['Jake Ryan', 'Education', 'Experience', 'Projects', 'Technical Skills'], pages: 1 }, 'main.tex', { supplied: true })
// The gallery AltaCV archive (archiveTemplates.ts) through the same import path a user gets.
if (!only || only === 'altacv-gallery-lualatex') {
  const { createArchiveTemplateProject, latexArchiveTemplates } = await import('../archiveTemplates.ts')
  const entry = latexArchiveTemplates.find((item) => item.id === 'altacv')
  const bytes = await readFile(path.join(staticDirectory, '..', '..', 'templates', 'latex', path.basename(entry.path)))
  const project = await createArchiveTemplateProject('altacv', async () => new Response(bytes))
  assert.equal(project.mainFile, 'sample.tex'); assert.equal(project.engine, 'lualatex')
  const files = [...project.files.map(({ path: name, content }) => ({ path: name, content })), ...await Promise.all(project.assets.map(async (asset) => ({ path: asset.path, content: new Uint8Array(await asset.blob.arrayBuffer()) })))]
  await successful('altacv-gallery-lualatex', 'lualatex', files, {
    text: ['YOUR NAME HERE', 'Your Position or Tagline Here', 'Job Title 1', 'Project 1', 'Statistical Analysis', 'German'],
    absent: ['??'], images: 1, pages: 2, biber: true, fonts: [/RobotoSlab/i, /Lato/i, /FontAwesome/i],
  }, project.mainFile, { supplied: true, approvedGroups: [...entry.packageGroups] })
}
if (only) assert.ok(selectedCases.has(only), 'Unknown gallery smoke case: ' + only + '. No compilation was exercised.')
console.log('GALLERY SMOKE PASS: ' + results.length + ' real PDF compilation(s) of Mr. Resume gallery starters on the current pin.')
`

// Written beside smoke.mjs so its relative imports resolve unchanged; removed afterwards.
const runner = path.join(here, `.gallery-smoke-${process.pid}.mjs`)
await writeFile(runner, harnessSource.slice(0, cut) + galleryCases)
try { await import(pathToFileURL(runner).href) } finally { await rm(runner, { force: true }) }
