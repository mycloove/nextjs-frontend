import assert from 'node:assert/strict'
import test from 'node:test'
import { resumeSpecimen, resumeSpecimens } from './resumeSpecimens.ts'
import { resumeTemplates } from './resumeTemplates.ts'

const BENGALI = /[\u0980-\u09ff]/u
const withoutLinks = (text: string) => text.replace(/\[[^\]\n]*\]\([^)\n]*\)/gu, '')

test('every Regular template has a specimen with exactly its own sections', () => {
  assert.equal(Object.keys(resumeSpecimens).length, resumeTemplates.length, 'No orphan specimens')
  for (const template of resumeTemplates) {
    const specimen = resumeSpecimen(template.id)
    assert.ok(specimen, `${template.id} has no specimen`)
    assert.deepEqual(Object.keys(specimen.content).sort(), [...template.enabled].sort(), template.id)
    for (const [section, text] of Object.entries(specimen.content)) assert.ok(text.trim().length > 0, `${template.id}.${section} is empty`)
    assert.notEqual(specimen.fullName, template.fullName, `${template.id} still shows the prompt as a name`)
  }
})

test('a specimen is filled in: no bracketed prompt is left on the page', () => {
  for (const [id, specimen] of Object.entries(resumeSpecimens)) {
    assert.ok(!/[[\]]/u.test(specimen.fullName), id)
    for (const [section, text] of Object.entries(specimen.content)) assert.ok(!/[[\]]/u.test(withoutLinks(text)), `${id}.${section} still has a bracket prompt`)
  }
})

test('a specimen can reach nobody: reserved hosts, the placeholder phone, no named referee', () => {
  for (const [id, specimen] of Object.entries(resumeSpecimens)) {
    const text = Object.values(specimen.content).join('\n')
    for (const [, address] of text.matchAll(/[\w.+-]+@([\w.-]+)/gu)) assert.equal(address, 'example.com', `${id}: email on ${address}`)
    for (const [, host] of text.matchAll(/https?:\/\/([^/\s)]+)/gu)) assert.ok(host.endsWith('.test'), `${id}: link to ${host}`)
    for (const [, host] of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|bd|edu))\b/giu)) assert.equal(host.toLowerCase(), 'example.com', `${id}: bare host ${host}`)
    for (const [number] of text.matchAll(/tel:[+\d]+/gu)) assert.equal(number, 'tel:+8801700000000', id)
    for (const [number] of text.matchAll(/(?<!tel:)\+880[\d -]{8,}/gu)) assert.equal(number.trim(), '+880 1700 000 000', id)
    const references = specimen.content.references
    if (references !== undefined) assert.ok(!references.includes('\n') && !/\d/u.test(references), `${id}: a referee must not be named`)
  }
})

test('a specimen is written in its template language', () => {
  for (const template of resumeTemplates) {
    const specimen = resumeSpecimen(template.id)!
    const english = 'language' in template && template.language === 'English'
    assert.equal(BENGALI.test(specimen.fullName), !english, `${template.id} name`)
    for (const [section, text] of Object.entries(specimen.content)) {
      if (english) assert.ok(!BENGALI.test(text), `${template.id}.${section} mixes Bangla into an English template`)
      else assert.ok(BENGALI.test(text), `${template.id}.${section} has no Bangla`)
    }
  }
})

test('a specimen follows the entry conventions its template renders', () => {
  for (const template of resumeTemplates) {
    if (!('language' in template) || template.language !== 'English') continue
    const specimen = resumeSpecimen(template.id)!
    // English layouts set "**Title** place | date" entries; a specimen without them would not show the layout at work.
    for (const section of ['experience', 'education'] as const) {
      const text = specimen.content[section]
      if (text !== undefined) assert.match(text, /^\*\*[^*]+\*\* .+ \| .+$/mu, `${template.id}.${section}`)
    }
  }
})

test('unknown and inherited keys are not specimens', () => {
  for (const id of ['', 'nope', 'constructor', 'toString', '__proto__']) assert.equal(resumeSpecimen(id), undefined, id)
})
