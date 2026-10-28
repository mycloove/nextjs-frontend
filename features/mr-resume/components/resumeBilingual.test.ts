import assert from 'node:assert/strict'
import test from 'node:test'
import { suggestBilingualText } from './resumeBilingual.ts'

// Independent literal expectations, not a read-back of the production lexicon.
const career = '\u0995\u09cd\u09af\u09be\u09b0\u09bf\u09af\u09bc\u09be\u09b0 \u0989\u09a6\u09cd\u09a6\u09c7\u09b6\u09cd\u09af'
const science = '\u09ac\u09bf\u099c\u09cd\u099e\u09be\u09a8 \u09b8\u09cd\u09a8\u09be\u09a4\u0995'
const dhaka = '\u09a2\u09be\u0995\u09be \u09ac\u09bf\u09b6\u09cd\u09ac\u09ac\u09bf\u09a6\u09cd\u09af\u09be\u09b2\u09af\u09bc'
const ayesha = '\u0986\u09af\u09bc\u09c7\u09b6\u09be'
const rahman = '\u09b0\u09b9\u09ae\u09be\u09a8'
const jishan = '\u099c\u09bf\u09b6\u09be\u09a8'
const ssc = '\u098f\u09b8\u098f\u09b8\u09b8\u09bf'

test('canonical headings, degrees and institution phrases roundtrip without translating surrounding prose', () => {
  const english = `**Career Objective**\n- Bachelor of Science, University of Dhaka.\nSSC / B.Sc.\nThis writing stays exactly as authored.`
  const bangla = `**${career}**\n- ${science}, ${dhaka}.\n${ssc} / \u09ac\u09bf\u098f\u09b8\u09b8\u09bf\nThis writing stays exactly as authored.`
  assert.deepEqual(suggestBilingualText(english, 'Bangla'), { value: bangla, replacements: 5, supportedOnly: true })
  assert.deepEqual(suggestBilingualText(bangla, 'English'), { value: english, replacements: 5, supportedOnly: true })
})

test('longest phrases win over contained phrases and Bengali prefixes', () => {
  assert.deepEqual(suggestBilingualText('Senior Product Designer / Product Designer', 'Bangla'), {
    value: '\u09b8\u09bf\u09a8\u09bf\u09af\u09bc\u09b0 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09a1\u09bf\u099c\u09be\u0987\u09a8\u09be\u09b0 / \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09a1\u09bf\u099c\u09be\u0987\u09a8\u09be\u09b0', replacements: 2, supportedOnly: true,
  })
  assert.equal(suggestBilingualText('\u09ac\u09bf\u099c\u09cd\u099e\u09be\u09a8 \u09b8\u09cd\u09a8\u09be\u09a4\u0995\u09cb\u09a4\u09cd\u09a4\u09b0', 'English').value, 'Master of Science')
})

test('curated name words require the name option and reverse to readable canonical names', () => {
  assert.deepEqual(suggestBilingualText('Ayesha Rahman; Aisha Rehman', 'Bangla'), { value: 'Ayesha Rahman; Aisha Rehman', replacements: 0, supportedOnly: true })
  assert.deepEqual(suggestBilingualText('Ayesha Rahman; Aisha Rehman', 'Bangla', { name: true }), { value: `${ayesha} ${rahman}; ${ayesha} ${rahman}`, replacements: 4, supportedOnly: true })
  assert.deepEqual(suggestBilingualText(`${ayesha} ${rahman}`, 'English', { name: true }), { value: 'Ayesha Rahman', replacements: 2, supportedOnly: true })
  assert.equal(suggestBilingualText('_Ayesha_ **Rahman**', 'Bangla', { name: true }).value, `_${ayesha}_ **${rahman}**`)
})

test('unsupported prose, unknown names and target-language text remain byte-for-byte unchanged', () => {
  for (const value of ['I built a custom workflow that made colleagues happier.', 'ami amar nijer golpo likhi', 'Unlistedname Qwerty', '\u0986\u09ae\u09bf \u09a8\u09bf\u099c\u09c7\u09b0 \u0997\u09b2\u09cd\u09aa \u09b2\u09bf\u0996\u09c7\u099b\u09bf\u0964', '', '123 \u09e7\u09e8\u09e9 \u2460 1.25 +880-1700-000000']) {
    for (const target of ['English', 'Bangla'] as const) assert.deepEqual(suggestBilingualText(value, target, { name: true }), { value, replacements: 0, supportedOnly: true })
  }
  assert.deepEqual(suggestBilingualText(career, 'Bangla'), { value: career, replacements: 0, supportedOnly: true })
  assert.deepEqual(suggestBilingualText('Career Objective', 'English'), { value: 'Career Objective', replacements: 0, supportedOnly: true })
})

test('emails, URLs, domains, paths, numbers and numeric/compound IDs are protected in both directions', () => {
  const value = `Ayesha@example.com https://host.example/Ayesha/SSC?q=Rahman www.Rahman.com\nmailto:Ayesha@example.com tel:+8801700000000\nSSC2024 SSC_ID ID-SSC Ayesha-42 @Rahman #SSC C:\\Ayesha\\cv.txt /SSC/Rahman\n${jishan}@example.com https://host.example/${jishan} ${jishan}_42`
  for (const target of ['English', 'Bangla'] as const) assert.deepEqual(suggestBilingualText(value, target, { name: true }), { value, replacements: 0, supportedOnly: true })
})

test('known address labels can change but physical address and contact values stay exact', () => {
  const value = 'Current Address: Rahman Road, House 12, Dhaka-1216\nPhone Number: Ayesha +8801700000000\nEmail: Ayesha@example.com'
  assert.deepEqual(suggestBilingualText(value, 'Bangla', { name: true }), {
    value: '\u09ac\u09b0\u09cd\u09a4\u09ae\u09be\u09a8 \u09a0\u09bf\u0995\u09be\u09a8\u09be: Rahman Road, House 12, Dhaka-1216\n\u09ab\u09cb\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0: Ayesha +8801700000000\nEmail: Ayesha@example.com', replacements: 2, supportedOnly: true,
  })
})

test('visible markdown labels change without touching destinations, reference IDs or reference definitions', () => {
  const value = '[Career Objective](#SSC/Rahman(foo))\n[SSC](../Ayesha)\n[SSC][Rahman]\n[Rahman]: #SSC "Career Objective"'
  const next = `[${career}](#SSC/Rahman(foo))\n[${ssc}](../Ayesha)\n[${ssc}][Rahman]\n[Rahman]: #SSC "Career Objective"`
  assert.deepEqual(suggestBilingualText(value, 'Bangla', { name: true }), { value: next, replacements: 3, supportedOnly: true })
  assert.equal(suggestBilingualText('[SSC](#Career Objective "Ayesha")', 'Bangla', { name: true }).value, `[${ssc}](#Career Objective "Ayesha")`)
  assert.equal(suggestBilingualText('[SSC](https://example.com/a\\)b(Ayesha))', 'Bangla', { name: true }).value, `[${ssc}](https://example.com/a\\)b(Ayesha))`)
})

test('inline, indented, fenced and unfinished fenced code remain untouched', () => {
  const code = '`SSC Ayesha`\n``Rahman `SSC` Ayesha``\n    Career Objective\n~~~text\nCareer Objective Ayesha\n~~~\n```js\nSSC\n```\n```unfinished\nRahman SSC'
  assert.deepEqual(suggestBilingualText(code, 'Bangla', { name: true }), { value: code, replacements: 0, supportedOnly: true })
  assert.equal(suggestBilingualText('````text\nSSC\n`````\nCareer Objective', 'Bangla').value, `\`\`\`\`text\nSSC\n\`\`\`\`\`\n${career}`)
})

test('genuine session ranges restore original alias/case, including unknown original Latin words', () => {
  const value = `${ayesha} ${rahman}\n\u09b0\u09be\u0996\u09ac`
  const sources = [
    { start: 0, end: ayesha.length, source: 'Aisha', reading: ayesha },
    { start: ayesha.length + 1, end: ayesha.length + 1 + rahman.length, source: 'REHMAN', reading: rahman },
    { start: value.lastIndexOf('\n') + 1, end: value.length, source: 'rakhbo', reading: '\u09b0\u09be\u0996\u09ac' },
  ]
  assert.deepEqual(suggestBilingualText(value, 'English', { name: true, sources }), { value: 'Aisha REHMAN\nrakhbo', replacements: 3, supportedOnly: true })
  assert.equal(suggestBilingualText(value, 'English', { sources }).value, 'Aisha REHMAN\nrakhbo')
})

test('source offsets use exact UTF16 units, not codepoint positions or approximate searches', () => {
  const value = `\u{1f600}${jishan}`
  const source = { start: 2, end: 2 + jishan.length, source: 'Zeeshan', reading: jishan }
  assert.deepEqual(suggestBilingualText(value, 'English', { sources: [source] }), { value: '\u{1f600}Zeeshan', replacements: 1, supportedOnly: true })
  assert.deepEqual(suggestBilingualText(value, 'English', { sources: [{ ...source, start: 1 }] }), { value, replacements: 0, supportedOnly: true })
})

test('stale, malformed, partial-word and protected source ranges cannot overwrite text', () => {
  const source = { start: 0, end: jishan.length, source: 'Zeeshan', reading: jishan }
  for (const stale of [{ ...source, reading: rahman }, { ...source, start: -1 }, { ...source, start: 0.5 }, { ...source, end: 999 }, { ...source, end: 0 }, { ...source, source: 'SSC42' }, { ...source, source: 'a@example.com' }]) {
    assert.deepEqual(suggestBilingualText(jishan, 'English', { sources: [stale] }), { value: jishan, replacements: 0, supportedOnly: true })
  }
  assert.equal(suggestBilingualText(`${jishan}\u09aa\u09c1\u09b0`, 'English', { name: true, sources: [source] }).replacements, 0)
  const email = `${jishan}@example.com`
  assert.equal(suggestBilingualText(email, 'English', { name: true, sources: [source] }).value, email)
  assert.equal(suggestBilingualText(`\`${jishan}\``, 'English', { name: true, sources: [{ ...source, start: 1, end: jishan.length + 1 }] }).replacements, 0)
})

test('duplicates count once and conflicting sources are ignored rather than guessed', () => {
  const source = { start: 0, end: rahman.length, source: 'Rehman', reading: rahman }
  assert.deepEqual(suggestBilingualText(rahman, 'English', { sources: [source, source] }), { value: 'Rehman', replacements: 1, supportedOnly: true })
  assert.deepEqual(suggestBilingualText(rahman, 'English', { sources: [source, { ...source, source: 'Rahman' }] }), { value: rahman, replacements: 0, supportedOnly: true })
})

test('partial words and identifiers are not mistaken for whole supported phrases', () => {
  const value = `XSSC SSCs PrefixAyesha Rahman's career_objective _SSC SSC_ ${rahman}\u09c7\u09b0 \u099c\u09be\u09a4\u09c0\u09af\u09bc\u09a4\u09be\u09ac\u09be\u09a6`
  for (const target of ['English', 'Bangla'] as const) assert.equal(suggestBilingualText(value, target, { name: true }).value, value)
})

test('outer quotes and punctuation survive supported suggestions without matching possessives', () => {
  const value = `'Career Objective', "Bachelor of Science".\n'Ayesha' \u2018Rahman\u2019`
  assert.deepEqual(suggestBilingualText(value, 'Bangla', { name: true }), {
    value: `'${career}', "${science}".\n'${ayesha}' \u2018${rahman}\u2019`, replacements: 4, supportedOnly: true,
  })
})

test('repeated requests are deterministic and inserted text is never scanned or counted again', () => {
  const options = Object.freeze({ name: true, sources: Object.freeze([]) })
  const english = 'Career Objective / Career Objective / Ayesha'
  const first = suggestBilingualText(english, 'Bangla', options)
  assert.equal(first.replacements, 3)
  assert.deepEqual(suggestBilingualText(english, 'Bangla', options), first)
  assert.deepEqual(suggestBilingualText(first.value, 'Bangla', options), { value: first.value, replacements: 0, supportedOnly: true })
  const restored = suggestBilingualText(first.value, 'English', options)
  assert.equal(restored.value, english)
  assert.deepEqual(suggestBilingualText(restored.value, 'English', options), { value: english, replacements: 0, supportedOnly: true })
})
