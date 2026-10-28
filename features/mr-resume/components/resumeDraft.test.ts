import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeResumeDraft, encodeResumeDraft, type ResumeDraft } from './resumeDraft.ts'

const defaults: ResumeDraft = { documentTitle: 'Untitled resume', fullName: 'Name', purpose: 'Resume', enabled: ['profile', 'summary'], customSections: [], content: { profile: '', summary: '', skills: '' }, titles: {}, sectionDividers: {}, headingIcons: {}, headingIconSize: 'medium', headingIconCustomSize: 1, headingIconColor: 'accent', language: 'English', banglishMode: false, format: 'Visual', pageSize: 'A4', font: 'Inter', fontSize: 11, leading: 1.5, sectionGap: 24, margin: 18, accent: 0, customAccentColor: '#405444', profileAlign: 'left', profileImage: null, photoShape: 'circle', photoSize: 30, photoBackground: 'none', photoBlur: 50, photoCustomColor: '#405444', profileImageDisplay: null, templateId: null }
const options = { sectionIDs: ['profile', 'summary', 'skills'], fonts: ['Inter', 'Hind Siliguri'], photoBackgrounds: ['none', 'accent'], headingIcons: ['briefcase'], templates: ['bangla-job'], accentCount: 5 }

test('current snapshots preserve writing, page settings, null photos and selected templates exactly', () => {
  const document: ResumeDraft = { ...defaults, language: 'Bangla', font: 'Hind Siliguri', leading: 1.65, banglishMode: true, templateId: 'bangla-job', fullName: 'রহমান', content: { ...defaults.content, summary: 'আমার লেখা' } }
  const restored = decodeResumeDraft(encodeResumeDraft(document, '2026-10-26T08:00:00Z'), defaults, options)!
  assert.deepEqual(restored.document, document)
  assert.equal(restored.timestamp, '2026-10-26T08:00:00Z')
})

test('all seven legacy schemas keep actual writing and add new defaults', () => {
  for (let schema = 1; schema <= 7; schema++) {
    const restored = decodeResumeDraft(JSON.stringify({ schema, document: { fullName: 'Real person', content: { summary: 'Keep my exact text' }, enabled: ['summary'] } }), defaults, options)!
    assert.equal(restored.document.fullName, 'Real person')
    assert.equal(restored.document.content.summary, 'Keep my exact text')
    assert.deepEqual(restored.document.enabled, ['profile', 'summary'])
    assert.equal(restored.document.banglishMode, false)
    assert.equal(restored.document.templateId, null)
  }
})

test('malformed and unknown-version originals are rejected rather than overwritten or partially applied', () => {
  for (const raw of ['{', 'null', '[]', JSON.stringify({ schema: 9, document: defaults }), JSON.stringify({ schema: 8, document: { content: { profile: 7 } } }), JSON.stringify({ schema: 8, document: { enabled: ['missing'] } }), JSON.stringify({ schema: 8, document: { customSections: [{ id: '__proto__', title: 'x', detail: '', group: 'Additional' }] } })]) {
    assert.equal(decodeResumeDraft(raw, defaults, options), null)
  }
})

test('custom sections roundtrip with valid fields, deduped outline and preserved raw Unicode', () => {
  const custom = { id: 'custom-123-ab', title: 'নিজের অংশ', detail: 'Custom section', group: 'Additional' as const }
  const document: ResumeDraft = { ...defaults, customSections: [custom], enabled: ['profile', custom.id, custom.id], content: { ...defaults.content, [custom.id]: 'লাইন ১\nলাইন ২' } }
  const restored = decodeResumeDraft(encodeResumeDraft(document), defaults, options)!
  assert.deepEqual(restored.document.enabled, ['profile', custom.id])
  assert.equal(restored.document.content[custom.id], 'লাইন ১\nলাইন ২')
})

test('unsafe styling and invalid numeric/timestamp data cannot break restored rendering', () => {
  const restored = decodeResumeDraft(JSON.stringify({ schema: 8, timestamp: 'not-a-date', document: { font: 'unknown', fontSize: 200, margin: -7, customAccentColor: 'url(evil)', profileImage: 'javascript:evil', headingIcons: { summary: 'missing' }, sectionDividers: { summary: { enabled: true, style: 'solid', color: 'url(evil)', thickness: 1 } } } }), defaults, options)!
  assert.equal(restored.document.font, 'Inter')
  assert.equal(restored.document.fontSize, 13)
  assert.equal(restored.document.margin, 12)
  assert.equal(restored.document.profileImage, null)
  assert.equal(restored.timestamp, null)
  assert.deepEqual(restored.document.sectionDividers, {})
})

test('the template-only under-heading divider roundtrips and stays off otherwise', () => {
  const withRule: ResumeDraft = { ...defaults, sectionDividers: { summary: { enabled: true, style: 'solid', color: '#1f1f1f', thickness: 0.6, underHeading: true } } }
  const restored = decodeResumeDraft(encodeResumeDraft(withRule), defaults, options)!
  assert.deepEqual(restored.document.sectionDividers, { summary: { enabled: true, style: 'solid', color: '#1f1f1f', thickness: 0.6, underHeading: true } })
  // Truthy junk and a non-boolean flag never become a rule beneath the heading.
  const junk = decodeResumeDraft(JSON.stringify({ schema: 8, document: { ...defaults, sectionDividers: { summary: { enabled: true, style: 'solid', color: '#1f1f1f', thickness: 1, underHeading: 'yes' } } } }), defaults, options)!
  assert.deepEqual(junk!.document.sectionDividers, {})
})

test('corrupt identity fields never become default names while restoring valid writing', () => {
  for (const key of ['documentTitle', 'fullName']) {
    for (const value of [null, 7, false, {}, []]) {
      const raw = JSON.stringify({ schema: 8, document: { ...defaults, [key]: value, content: { summary: 'Keep this original writing' } } })
      assert.equal(decodeResumeDraft(raw, defaults, options), null, `${key}: ${JSON.stringify(value)}`)
    }
  }
  const blank = decodeResumeDraft(encodeResumeDraft({ ...defaults, documentTitle: '', fullName: '' }), defaults, options)!
  assert.equal(blank.document.documentTitle, '')
  assert.equal(blank.document.fullName, '')
})
