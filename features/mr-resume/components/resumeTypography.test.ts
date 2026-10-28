import assert from 'node:assert/strict'
import test from 'node:test'
import { bengaliTypefaces } from './resumeFonts.ts'
import { escapeLatex, latexLanguageSetup, paperFontStack } from './resumeTypography.ts'

test('Bengali fallback precedes generic/system families without corrupting English inherit', () => {
  assert.equal(paperFontStack('Inter', 'inherit', false), 'inherit')
  assert.equal(paperFontStack('Inter', 'inherit', true), '"Noto Sans Bengali", sans-serif')
  assert.equal(paperFontStack('Georgia', 'Georgia, serif', true), 'Georgia, "Noto Sans Bengali", serif')
  assert.equal(paperFontStack('Arial', 'Arial, sans-serif', true), 'Arial, "Noto Sans Bengali", sans-serif')
  for (const font of bengaliTypefaces) assert.equal(paperFontStack(font.name, font.family, true), font.family)
})

test('LaTeX selects genuine Bengali install families and supports mixed-script English documents', () => {
  for (const font of bengaliTypefaces) assert.ok(latexLanguageSetup(font.name, 'Bangla', true).includes(`{${font.texFamily}}`))
  assert.equal(latexLanguageSetup('Inter', 'English', false), '')
  const mixed = latexLanguageSetup('Inter', 'English', true)
  assert.ok(mixed.includes('\\setdefaultlanguage{english}'))
  assert.ok(mixed.includes('\\setotherlanguage{bengali}'))
  assert.ok(mixed.includes('Script=Bengali]{Noto Sans Bengali}'))
})

test('user content is escaped before script wrappers are generated', () => {
  assert.equal(escapeLatex('A&B 28% $50 #1 _ {} \\'), 'A\\&B 28\\% \\$50 \\#1 \\_ \\{\\} \\textbackslash{}')
  assert.equal(escapeLatex('Dhaka ঢাকা বিশ্ববিদ্যালয় 2024', true), 'Dhaka \\textbengali{ঢাকা বিশ্ববিদ্যালয়} 2024')
  assert.equal(escapeLatex('\\input{evil} বাংলা', true), '\\textbackslash{}input\\{evil\\} \\textbengali{বাংলা}')
  assert.equal(escapeLatex('বাংলা', false), 'বাংলা')
})
