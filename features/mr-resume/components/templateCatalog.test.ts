import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { activeFilterCount, cardBadges, categoryCounts, defaultGalleryQuery, filterTemplates, hasAtsStructure, parseGalleryQuery, resolveTemplateRequest, serializeGalleryQuery, templateBadges, templateCategories, templateHref, wantsSample, type TemplateCard } from './templateCatalog.ts'
import { regularTemplateCards } from './regularTemplateCards.ts'
import { resumeSpecimen } from './resumeSpecimens.ts'
import { resumeTemplates } from './resumeTemplates.ts'
import { getResumeLayout, partitionSections, resumeLayouts } from './resumeLayouts.ts'
import { latexTemplateCards } from '../latex/latexTemplateCards.ts'
import { latexSourceTemplates } from '../latex/templates.ts'
import { latexArchiveTemplates } from '../latex/archiveTemplates.ts'
import { templateThumbnails } from '../home/templateThumbnails.ts'
import { latexTemplateFingerprint, regularTemplateFingerprint } from '../home/thumbnailFingerprints.ts'

const cards: readonly TemplateCard[] = [...regularTemplateCards, ...latexTemplateCards]
const card = (patch: Partial<TemplateCard>): TemplateCard => ({ id: 'x', editor: 'regular', name: { en: 'X', bn: 'X' }, summary: { en: 'S', bn: 'S' }, categories: ['corporate'], language: 'en', columns: 1, photo: false, structure: { contactAsText: true, standardHeadings: true }, keywords: '', ...patch })

test('the URL query round-trips and refuses hostile or cross-editor values', () => {
  const query = { ...defaultGalleryQuery, editor: 'latex' as const, category: 'sidebar', text: 'altacv', language: 'en' as const, columns: 'sidebar' as const, photo: 'yes' as const, ats: true, onePage: true, browserReady: true }
  assert.deepEqual(parseGalleryQuery(new URLSearchParams(serializeGalleryQuery(query))), query)
  assert.equal(serializeGalleryQuery(defaultGalleryQuery), '')
  const hostile = parseGalleryQuery(new URLSearchParams('editor=<script>&category=../../x&lang=fr&cols=9&photo=maybe&ready=1&q=' + 'a'.repeat(200)))
  assert.equal(hostile.editor, 'regular'); assert.equal(hostile.category, 'all'); assert.equal(hostile.language, null); assert.equal(hostile.columns, null); assert.equal(hostile.photo, null)
  assert.equal(hostile.browserReady, false, 'The browser-ready filter exists only in the LaTeX drawer')
  assert.equal(hostile.text.length, 80)
  assert.equal(parseGalleryQuery(new URLSearchParams('editor=regular&category=sidebar')).category, 'all', 'A LaTeX category never leaks into the Regular drawer')
})

test('filters, Bangla/English search and category counts agree with each other', () => {
  const regular = { ...defaultGalleryQuery }
  assert.equal(filterTemplates(cards, regular).length, regularTemplateCards.length)
  assert.equal(categoryCounts(cards, regular).all, regularTemplateCards.length)
  for (const category of templateCategories.regular) assert.equal(categoryCounts(cards, regular)[category.id], filterTemplates(cards, { ...regular, category: category.id }).length)
  assert.ok(filterTemplates(cards, { ...regular, text: 'বায়োডাটা' }).length >= 2, 'Bangla search words find biodata templates')
  assert.ok(filterTemplates(cards, { ...regular, text: 'BANK' }).some((item) => item.id === 'bank-officer'))
  assert.ok(filterTemplates(cards, { ...regular, ats: true }).every(hasAtsStructure))
  assert.ok(filterTemplates(cards, { ...regular, photo: 'yes' }).every((item) => item.photo))
  assert.equal(activeFilterCount({ ...regular, language: 'bn', ats: true }), 2)
  const latex = { ...defaultGalleryQuery, editor: 'latex' as const, browserReady: true }
  assert.ok(filterTemplates(cards, latex).every((item) => item.runtime === 'browser'))
  assert.ok(!filterTemplates(cards, latex).some((item) => item.id === 'altacv'), 'Consent-only builds are not "no package download"')
})

test('badges are derived: ATS needs one English column without photo, and LaTeX also needs a real fixture', () => {
  assert.equal(hasAtsStructure(card({})), true)
  for (const patch of [{ language: 'bn' as const }, { language: 'mixed' as const }, { columns: 2 as const }, { columns: 'sidebar' as const }, { photo: true }, { structure: { contactAsText: true, standardHeadings: false } }]) assert.equal(hasAtsStructure(card(patch)), false, JSON.stringify(patch))
  assert.equal(hasAtsStructure(card({ editor: 'latex' })), false, 'No compiler evidence, no claim')
  assert.equal(hasAtsStructure(card({ editor: 'latex', qualification: 'fixture' })), true)
  assert.deepEqual(templateBadges(card({ pages: undefined })).map((badge) => badge.id), ['ats', 'language'], 'Page counts appear only when measured')
  assert.ok(templateBadges(card({ editor: 'latex', runtime: 'browser-after-consent' })).some((badge) => badge.id === 'consent' && badge.tone === 'notice'))
  for (const item of cards) for (const badge of templateBadges(item)) assert.match(badge.label.bn, /[\u0980-\u09ff]|English|ATS/u)
})

test('a gallery card never cuts a notice for space, and shows at most three badges', () => {
  const altacv = latexTemplateCards.find((item) => item.id === 'altacv')!
  assert.deepEqual(cardBadges(altacv).map((badge) => badge.id), ['language', 'consent', 'adapted'], 'The download and the adaptation are what a guest must see first')
  for (const item of cards) {
    const shown = cardBadges(item)
    assert.ok(shown.length <= 3, item.id)
    const notices = templateBadges(item).filter((badge) => badge.tone === 'notice')
    for (const notice of notices) assert.ok(shown.some((badge) => badge.id === notice.id), `${item.id} hides ${notice.id}`)
    assert.ok(!shown.some((badge) => badge.id === 'browser'), 'Only the exception to in-browser compiling is card-level news')
  }
  assert.ok(templateBadges(latexTemplateCards.find((item) => item.id === 'career-source')!).some((badge) => badge.id === 'browser'), 'The preview keeps the full list')
})

test('deep-link ids are an allowlist per editor', () => {
  assert.equal(resolveTemplateRequest('regular', null, cards), null)
  assert.equal(resolveTemplateRequest('regular', '', cards), null)
  assert.deepEqual(resolveTemplateRequest('regular', 'job-resume', cards), { kind: 'template', card: regularTemplateCards.find((item) => item.id === 'job-resume') })
  assert.deepEqual(resolveTemplateRequest('latex', 'job-resume', cards), { kind: 'unknown' }, 'A Regular id never reaches the LaTeX editor')
  assert.deepEqual(resolveTemplateRequest('regular', 'altacv', cards), { kind: 'unknown' })
  assert.equal(templateHref('latex', 'a b'), '/mr-resume/latex?template=a%20b')
  // The sample start is a Regular-only choice and must be asked for exactly.
  assert.equal(templateHref('regular', 'job-resume'), '/mr-resume/regular-editor?template=job-resume')
  assert.equal(templateHref('regular', 'job-resume', true), '/mr-resume/regular-editor?template=job-resume&sample=1')
  assert.equal(templateHref('latex', 'altacv', true), '/mr-resume/latex?template=altacv')
  // A design chosen in the preview rides the same link; an untouched preview adds nothing to it.
  assert.equal(templateHref('regular', 'job-resume', true, { layout: 'sidebar', accent: '#2f4a6d' }), '/mr-resume/regular-editor?template=job-resume&sample=1&layout=sidebar&accent=2f4a6d')
  assert.equal(templateHref('regular', 'job-resume', false, { accent: '#2f4a6d' }), '/mr-resume/regular-editor?template=job-resume&accent=2f4a6d')
  assert.equal(templateHref('regular', 'job-resume', false, {}), '/mr-resume/regular-editor?template=job-resume')
  assert.equal(templateHref('latex', 'altacv', true, { layout: 'sidebar', accent: '#2f4a6d' }), '/mr-resume/latex?template=altacv', 'A LaTeX starter is its own design')
  assert.equal(wantsSample('regular', new URLSearchParams('template=job-resume&sample=1')), true)
  for (const query of ['template=job-resume', 'template=job-resume&sample=0', 'template=job-resume&sample=true', 'template=job-resume&sample=']) assert.equal(wantsSample('regular', new URLSearchParams(query)), false, query)
  assert.equal(wantsSample('latex', new URLSearchParams('template=altacv&sample=1')), false)
})

test('Regular cards mirror the real templates and every category has something in it', () => {
  assert.deepEqual(regularTemplateCards.map((item) => item.id), resumeTemplates.map((template) => template.id))
  for (const item of regularTemplateCards) {
    const template = resumeTemplates.find((entry) => entry.id === item.id)!
    assert.equal(item.columns, getResumeLayout(template.layout).columns, item.id)
    assert.equal(item.language, 'language' in template && template.language === 'English' ? 'en' : 'bn')
    assert.match(item.name.bn, /[\u0980-\u09ff]/u, `${item.id}: Bangla name`)
    assert.match(item.summary.bn, /[\u0980-\u09ff]/u, `${item.id}: Bangla summary`)
    for (const category of item.categories) assert.ok(templateCategories.regular.some((entry) => entry.id === category), `${item.id}: ${category}`)
  }
  for (const editor of ['regular', 'latex'] as const) for (const category of templateCategories[editor]) assert.ok(cards.some((item) => item.editor === editor && item.categories.includes(category.id)), `${editor}/${category.id} is empty`)
})

test('layouts partition sections without losing or reordering any', () => {
  const ids = ['profile', 'summary', 'skills', 'experience', 'languages', 'custom-1']
  for (const layout of resumeLayouts) {
    const { main, rail } = partitionSections(layout.id, ids)
    assert.deepEqual([...main, ...rail].sort(), ids.filter((id) => id !== 'profile').sort(), layout.id)
    assert.deepEqual(main, ids.filter((id) => main.includes(id)), `${layout.id}: main keeps the user order`)
    if (!layout.rail.length) assert.deepEqual(rail, [])
  }
  assert.deepEqual(partitionSections('sidebar', ['profile', 'skills', 'languages']), { main: ['skills', 'languages'], rail: [] }, 'A rail-only page stays one flow')
  assert.equal(getResumeLayout('nope').id, 'classic')
  const css = readFileSync(new URL('./MrResumeStudio.module.css', import.meta.url), 'utf8')
  for (const layout of resumeLayouts.filter((item) => item.id !== 'classic')) assert.match(css, new RegExp(`\\.paper\\[data-layout="${layout.id}"\\]`, 'u'), `${layout.id} has page styles`)
  assert.doesNotMatch(css, /\.paper\[data-layout="classic"\]/u, 'Classic is the untouched original page')
  assert.match(css, /\.paper\[data-layout="biodata"\]:not\(\[lang='bn'\]\) \.paperKicker \{ letter-spacing/u, 'Bangla is never letter-spaced')
})

test('every gallery card has a real-output thumbnail bound to the exact template source', () => {
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  for (const item of cards) {
    const thumbnail = templateThumbnails[`${item.editor}:${item.id}`]
    assert.ok(thumbnail, `${item.editor}:${item.id} needs a thumbnail (run home/render-thumbnails.mjs)`)
    for (const path of [thumbnail.card, thumbnail.full]) assert.ok(existsSync(new URL(`../../../public${path}`, import.meta.url)), path)
    assert.equal(sha(readFileSync(new URL(`../../../public${thumbnail.card}`, import.meta.url))), thumbnail.sha256, `${item.id}: card image changed without the manifest`)
    assert.ok(Number.isInteger(thumbnail.pages) && thumbnail.pages >= 1)
    assert.ok(thumbnail.width === 480 && thumbnail.height > 600, `${item.id}: portrait card image`)
    const expected = item.editor === 'regular'
      ? regularTemplateFingerprint(resumeTemplates.find((template) => template.id === item.id)!, resumeSpecimen(item.id))
      : latexArchiveTemplates.find((archive) => archive.id === item.id)?.sha256 ?? latexTemplateFingerprint(latexSourceTemplates.find((template) => template.id === item.id))
    assert.equal(thumbnail.sourceSha256, expected, `${item.editor}:${item.id}: the template changed; re-render its thumbnail`)
  }
  assert.equal(Object.keys(templateThumbnails).length, cards.length, 'No orphan thumbnails')
})
