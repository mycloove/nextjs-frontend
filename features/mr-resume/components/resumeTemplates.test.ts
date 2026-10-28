import assert from 'node:assert/strict'
import test from 'node:test'
import { bengaliTypefaces } from './resumeFonts.ts'
import { resumeTemplates, type ResumeTemplate } from './resumeTemplates.ts'

const catalog = new Set(['profile', 'summary', 'experience', 'education', 'skills', 'projects', 'languages', 'awards', 'publications', 'volunteer', 'personal', 'motivation', 'references'])
const fonts = new Set<string>(['Noto Sans Bengali', 'Latin Modern', ...bengaliTypefaces.map((font) => font.name)])
const expected: Record<string, { purpose: ResumeTemplate['purpose']; sections: string[] }> = {
  'job-resume': { purpose: 'Resume', sections: ['summary', 'experience', 'skills'] },
  'government-biodata': { purpose: 'Biodata', sections: ['education', 'personal'] },
  'teacher-cv': { purpose: 'Academic CV', sections: ['education', 'experience', 'references'] },
  'engineering-cv': { purpose: 'Resume', sections: ['skills', 'projects'] },
  'fresh-graduate': { purpose: 'Resume', sections: ['education', 'projects', 'volunteer'] },
  'academic-research-cv': { purpose: 'Academic CV', sections: ['projects', 'publications', 'references'] },
  'personal-biodata': { purpose: 'Biodata', sections: ['personal', 'languages'] },
  'admission-sop': { purpose: 'Statement of purpose', sections: ['education', 'motivation'] },
  'latex-classic': { purpose: 'Resume', sections: ['experience', 'skills', 'projects', 'publications', 'references'] },
}

test('registry contains the nine distinct usable templates and no extra purposes', () => {
  assert.equal(resumeTemplates.length, 9)
  assert.equal(new Set(resumeTemplates.map((template) => template.id)).size, 9)
  assert.equal(new Set(resumeTemplates.map((template) => template.name)).size, 9)
  assert.deepEqual(resumeTemplates.map((template) => template.id).sort(), Object.keys(expected).sort())
  assert.ok(new Set(resumeTemplates.map((template) => JSON.stringify(template.content))).size === 9)
})

for (const template of resumeTemplates) {
  // The satisfies-checked union keeps only the keys each literal writes.
  const english = (template as { language?: 'English' }).language === 'English'
  test(`${template.id}: valid sections, real fonts and complete ${english ? 'English' : 'Bengali'} placeholders`, () => {
    assert.equal(template.purpose, expected[template.id].purpose)
    if (english) {
      assert.equal(template.fullName, '[Your full name]')
      assert.doesNotMatch(JSON.stringify(template.content), /[\u0980-\u09ff]/u, 'An English preset ships English placeholders, untranslated')
    } else {
      assert.equal(template.fullName, '[\u0986\u09aa\u09a8\u09be\u09b0 \u09aa\u09c2\u09b0\u09cd\u09a3 \u09a8\u09be\u09ae]')
    }
    assert.match(template.id, /^[a-z]+(?:-[a-z]+)*$/)
    assert.match(template.name, /^[A-Za-z ]+$/)
    assert.ok(template.detail.length > 30 && !/[\u0980-\u09ff]/u.test(template.detail))
    assert.ok(fonts.has(template.font), `Unloaded font ${template.font}`)
    assert.notEqual(template.font, 'Baloo Da 2', 'These templates are formal, not creative specimens')
    assert.equal(template.enabled[0], 'profile')
    assert.equal(new Set(template.enabled).size, template.enabled.length)
    assert.deepEqual(Object.keys(template.content).sort(), [...template.enabled].sort())
    for (const section of expected[template.id].sections) assert.ok((template.enabled as readonly string[]).includes(section))
    for (const section of template.enabled) {
      assert.ok(catalog.has(section), `Unknown section ${section}`)
      const body = (template.content as Readonly<Record<string, string>>)[section]
      assert.ok(body.trim().length > 30, `Incomplete section ${section}`)
      assert.ok(body.includes('\n'), `Unstructured section ${section}`)
      if (!english) {
        assert.doesNotMatch(body, /[A-Za-z@\p{N}]/u, 'No invented qualifications, contacts or numeric claims')
        for (const line of body.split('\n').filter((value) => value.trim())) assert.match(line, /[\u0980-\u09ff]/u)
      }
      const placeholders = [...body.matchAll(/\[([^\]\n]+)\]/g)]
      assert.ok(placeholders.length > 0, `Missing placeholders in ${section}`)
      if (!english) for (const placeholder of placeholders) assert.match(placeholder[1], /[\u0980-\u09ff]/u)
      assert.equal((body.match(/\[/g) ?? []).length, placeholders.length)
      assert.equal((body.match(/\]/g) ?? []).length, placeholders.length)
    }
    // Every bracket in an English preset either names what to replace or marks
    // that a sample URL exists only to demonstrate a link scheme.
    for (const sample of JSON.stringify(template.content).matchAll(/https:\/\/[a-z.]+\.test\//g)) {
      assert.doesNotMatch(sample[0], /example\.com/)
    }
  })
}

test('the latex-classic preset carries its template-only register', () => {
  const latex = resumeTemplates.find((template) => template.id === 'latex-classic')!
  assert.equal(latex.font, 'Latin Modern')
  assert.equal(latex.language, 'English')
  assert.equal(latex.accentColor, '#3159a8')
  assert.equal(latex.rulesUnderHeadings, true)
  assert.equal(latex.titles?.skills, 'Core Technical Skills')
  // Entry headers write the pipe convention the paper and LaTeX shapes off.
  assert.match(latex.content.experience, /\| /)
  assert.match(latex.content.projects, /\| /)
  // Contact lines demonstrate the schemes that earn glyphs; all four appear.
  for (const scheme of ['mailto:', 'tel:', 'https://www.linkedin.test/', 'https://github.test/']) {
    assert.ok(latex.content.profile.includes(`(${scheme}`), `profile must demonstrate ${scheme}`)
  }
  assert.doesNotMatch(JSON.stringify(latex.content), /fonts\.googleapis/u)
})

test('government guidance is not a fabricated list of mandatory sensitive fields', () => {
  const template = resumeTemplates.find((item) => item.id === 'government-biodata')!
  assert.match(template.detail, /not an official form/)
  assert.match(template.content.personal, /\u09ac\u09bf\u099c\u09cd\u099e\u09aa\u09cd\u09a4\u09bf/u)
  assert.doesNotMatch(Object.values(template.content).join('\n'), /\u09a7\u09b0\u09cd\u09ae|\u099c\u09be\u09a4\u09c0\u09af\u09bc \u09aa\u09b0\u09bf\u099a\u09af\u09bc\u09aa\u09a4\u09cd\u09b0|\u09ac\u09be\u09a7\u09cd\u09af\u09a4\u09be\u09ae\u09c2\u09b2\u0995/u)
})

test('research records publication status and SOP provides a real multi-paragraph scaffold', () => {
  const research = resumeTemplates.find((template) => template.id === 'academic-research-cv')!
  assert.match(research.content.publications, /\u0985\u09ac\u09b8\u09cd\u09a5\u09be:/u)
  assert.match(research.content.publications, /\u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09be\u09a7\u09c0\u09a8/u)
  const sop = resumeTemplates.find((template) => template.id === 'admission-sop')!
  assert.ok(sop.content.motivation.split('\n\n').length >= 4)
  assert.doesNotMatch(JSON.stringify(resumeTemplates), /example\.com|Northstar|Ayesha|28%|2022/u)
})
