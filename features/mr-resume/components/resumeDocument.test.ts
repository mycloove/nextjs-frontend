import assert from 'node:assert/strict'
import test from 'node:test'
import { accentColorOf, accents, CUSTOM_ACCENT, defaultResumeDraft, designAccents, documentHasBangla, paperFontFamily, parseTemplateDesign, sectionTitle, sections, serializeTemplateDesign, templateDesign, templateDocument } from './resumeDocument.ts'
import type { ResumeDraft } from './resumeDraft.ts'
import { resumeLayoutIds } from './resumeLayouts.ts'
import { resumeSpecimen } from './resumeSpecimens.ts'
import { resumeTemplates as authoredTemplates, type ResumeTemplate } from './resumeTemplates.ts'

// Read through the declared shape: the authored list is narrower than the contract the document is built from.
const resumeTemplates: readonly ResumeTemplate[] = authoredTemplates

const luminance = (hex: string) => hex.match(/[a-f\d]{2}/giu)!.map((value) => parseInt(value, 16) / 255)
  .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
const without = (draft: ResumeDraft, keys: readonly (keyof ResumeDraft)[]) => Object.fromEntries(Object.entries(draft).filter(([key]) => !keys.includes(key as keyof ResumeDraft)))

test('the gallery inks keep the editor palette first and read on white paper', () => {
  // A draft stores a palette colour by its index, so the editor's five never move.
  assert.deepEqual(designAccents.slice(0, accents.length), accents)
  assert.equal(new Set(designAccents.map((item) => item.color)).size, designAccents.length)
  for (const item of designAccents) {
    assert.match(item.color, /^#[\da-f]{6}$/u, `${item.name}: lower-case hex, the form a URL carries`)
    // Headings are set in the ink on white, and the Banner layout sets white on the ink.
    assert.ok(contrast(item.color, '#ffffff') >= 4.5, `${item.name}: ${contrast(item.color, '#ffffff').toFixed(2)}:1`)
  }
})

test('every template opens in a design the gallery can show as chosen', () => {
  for (const template of resumeTemplates) {
    const own = templateDesign(template)
    assert.ok(resumeLayoutIds.includes(own.layout), template.id)
    assert.ok(designAccents.some((item) => item.color === own.accent), `${template.id}: ${own.accent} is not one of the gallery inks`)
  }
})

test('a design in the URL is an allowlist and round-trips', () => {
  for (const layout of resumeLayoutIds) for (const { color } of designAccents) {
    assert.deepEqual(parseTemplateDesign(new URLSearchParams(serializeTemplateDesign({ layout, accent: color }))), { layout, accent: color })
  }
  assert.equal(serializeTemplateDesign({}), '')
  assert.equal(serializeTemplateDesign({ layout: 'sidebar', accent: '#2F4A6D' }), 'layout=sidebar&accent=2f4a6d')
  assert.deepEqual(parseTemplateDesign(new URLSearchParams('layout=sidebar')), { layout: 'sidebar' })
  assert.deepEqual(parseTemplateDesign(new URLSearchParams('accent=%232F4A6D')), { accent: '#2f4a6d' }, 'Case and a leading # are tolerated; the stored colour is the palette one')
  for (const query of ['', 'layout=<script>', 'layout=Sidebar', 'layout=__proto__', 'accent=ff0000', 'accent=red', 'accent=2f4a6', 'accent=url(x)', 'layout=&accent=']) {
    assert.deepEqual(parseTemplateDesign(new URLSearchParams(query)), {}, query)
  }
})

test('a template becomes the same draft for the preview and for Apply', () => {
  for (const template of resumeTemplates) {
    const outline = templateDocument(template, defaultResumeDraft)
    assert.equal(outline.templateId, template.id)
    assert.equal(outline.layout, template.layout)
    assert.equal(outline.fullName, template.fullName)
    assert.deepEqual(outline.enabled, template.enabled)
    assert.equal(accentColorOf(outline), templateDesign(template).accent, template.id)
    for (const section of sections) assert.equal(outline.content[section.id], template.content[section.id] ?? '', `${template.id}/${section.id}`)
    assert.deepEqual(templateDocument(template, defaultResumeDraft, { sample: false, design: {} }), outline)

    const specimen = resumeSpecimen(template.id)!
    const sample = templateDocument(template, defaultResumeDraft, { sample: true })
    assert.equal(sample.fullName, specimen.fullName)
    for (const section of template.enabled) assert.equal(sample.content[section], specimen.content[section], `${template.id}/${section}`)
    assert.deepEqual(without(sample, ['fullName', 'content']), without(outline, ['fullName', 'content']), `${template.id}: sample text changes the words only`)
  }
})

test('a chosen design changes the layout and the accent, and nothing else', () => {
  const template = resumeTemplates.find((item) => item.id === 'job-resume')!
  const plain = templateDocument(template, defaultResumeDraft, { sample: true })
  for (const layout of resumeLayoutIds) for (const { color } of designAccents) {
    const designed = templateDocument(template, defaultResumeDraft, { sample: true, design: { layout, accent: color } })
    assert.equal(designed.layout, layout)
    assert.equal(accentColorOf(designed), color)
    // The editor's own palette is stored by index; a deeper ink is a custom accent.
    const palette = accents.findIndex((item) => item.color === color)
    assert.equal(designed.accent, palette >= 0 ? palette : CUSTOM_ACCENT)
    assert.deepEqual(without(designed, ['layout', 'accent', 'customAccentColor']), without(plain, ['layout', 'accent', 'customAccentColor']))
  }
  assert.equal(templateDocument(template, defaultResumeDraft, { design: { layout: 'banner' } }).accent, plain.accent, 'A layout alone keeps the template accent')
})

test('applying over a draft keeps its preferences and none of its writing', () => {
  const base: ResumeDraft = {
    ...defaultResumeDraft, fullName: 'Someone Else', customSections: [{ id: 'custom-1', title: 'Hobbies', detail: '', group: 'Additional' }],
    content: { ...defaultResumeDraft.content, 'custom-1': 'Chess' }, titles: { summary: 'About' }, headingIcons: { summary: 'career' },
    headingIconSize: 'large', photoBlur: 80, profileImage: 'data:image/png;base64,AAAA', profileImageDisplay: 'data:image/png;base64,AAAA',
  }
  const applied = templateDocument(resumeTemplates.find((item) => item.id === 'job-resume')!, base)
  assert.deepEqual([applied.headingIconSize, applied.photoBlur], ['large', 80])
  assert.deepEqual(applied.customSections, [])
  assert.deepEqual(applied.headingIcons, {})
  assert.equal(applied.content['custom-1'], undefined)
  assert.equal(applied.titles.summary, undefined)
  assert.deepEqual([applied.profileImage, applied.profileImageDisplay], [null, null])
  assert.notEqual(applied.fullName, 'Someone Else')
})

test('headings, Bangla detection and the font stack read the document itself', () => {
  assert.equal(sectionTitle(defaultResumeDraft, 'summary'), 'Professional summary')
  assert.match(sectionTitle({ ...defaultResumeDraft, language: 'Bangla' }, 'summary'), /[\u0980-\u09ff]/u)
  assert.equal(sectionTitle({ ...defaultResumeDraft, language: 'Bangla', titles: { summary: 'About me' } }, 'summary'), 'About me', 'The guest\'s own heading wins')
  assert.equal(sectionTitle({ ...defaultResumeDraft, customSections: [{ id: 'custom-1', title: 'Hobbies', detail: '', group: 'Additional' }] }, 'custom-1'), 'Hobbies')
  assert.equal(sectionTitle(defaultResumeDraft, 'nope'), 'Untitled section')
  assert.equal(documentHasBangla(defaultResumeDraft), false)
  assert.equal(paperFontFamily(defaultResumeDraft), 'inherit')
  const bangla = templateDocument(resumeTemplates.find((item) => item.language !== 'English')!, defaultResumeDraft, { sample: true })
  assert.equal(documentHasBangla(bangla), true)
  assert.notEqual(paperFontFamily(bangla), 'inherit', 'Bangla is never left to a Latin-only face')
  // English writing with one Bangla word still gets a Bangla face behind the Latin one.
  assert.match(paperFontFamily({ ...defaultResumeDraft, font: 'Georgia', fullName: 'আয়েশা Rahman' }), /^Georgia, "Noto Sans Bengali", serif$/u)
})

test('the starting draft is a complete, frozen document', () => {
  assert.ok(Object.isFrozen(defaultResumeDraft))
  for (const id of defaultResumeDraft.enabled) assert.ok(sections.some((section) => section.id === id), id)
  for (const section of sections) assert.equal(typeof defaultResumeDraft.content[section.id], 'string', section.id)
  assert.equal(accentColorOf(defaultResumeDraft), accents[0].color)
  assert.equal(accentColorOf({ accent: CUSTOM_ACCENT, customAccentColor: '#123456' }), '#123456')
})
