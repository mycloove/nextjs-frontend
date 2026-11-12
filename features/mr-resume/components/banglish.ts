/** On-device Banglish: protected data -> learned spelling -> word banks -> known words -> phonetics.
 * A proposal is not a translation or an accuracy guarantee. Unknown glyphs survive.
 */
import { addressLexicon, careerLexicon, commonLexicon, educationLexicon, loanLexicon, nameLexicon, resumeLexicon } from './banglishLexicon.ts'
import { isValidSpellingChoice } from './banglishLearn.ts'
import { acceptableCost, createWordIndex, type BanglaWordIndex } from './banglishMatch.ts'
import { banglaWordLists } from './banglishWords.ts'
export { lexicon } from './banglishLexicon.ts'

export type BanglishContext = 'general' | 'name' | 'address' | 'education' | 'career'
export type BanglishOptions = {
  context?: BanglishContext
  learned?: Readonly<Record<string, string>>
  /** Explicit phonetics, bypassing vocabulary/English scoring, never contact guards. */
  force?: boolean
}

const HASANTA = '\u09cd'
const BENGALI = /[\u0980-\u09ff]/u
const ENGLISH_KEEP = new Set([
  'the', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'is',
  'are', 'as', 'an', 'or', 'be', 'it', 'my', 'we', 'team', 'work', 'tool', 'tools',
  'pdf', 'doc', 'docx', 'ms', 'excel', 'word', 'adobe', 'google', 'microsoft', 'office',
  'android', 'iphone', 'ios', 'web', 'app', 'site', 'blog', 'seo', 'html', 'css', 'sql',
  'php', 'python', 'java', 'javascript', 'typescript', 'react', 'node', 'nodejs', 'js',
  'figma', 'canva', 'linkedin', 'ats', 'hr', 'crm', 'aws', 'ui', 'ux', 'ai', 'ml',
  'saas', 'gpa', 'cgpa', 'ssc', 'hsc', 'bsc', 'bba', 'mba', 'phd', 'buet', 'du',
  'api', 'http', 'https', 'www', 'ftp', 'git', 'github', 'docker', 'linux', 'windows',
  'ruby', 'rails', 'swift', 'kotlin', 'rust', 'golang', 'flutter', 'mysql', 'postgresql',
  'mongodb', 'redis', 'nextjs', 'vue', 'angular', 'svelte', 'tailwind', 'bootstrap',
  'photoshop', 'illustrator', 'indesign', 'powerpoint', 'outlook', 'gmail', 'zoom',
  'slack', 'notion', 'jira', 'trello', 'autocad', 'solidworks', 'matlab', 'spss',
  'data', 'row', 'user', 'users', 'design', 'designer', 'product', 'project', 'manager',
  'senior', 'junior', 'lead', 'engineer', 'engineering', 'software', 'business',
  'research', 'experience', 'skills', 'education', 'summary', 'profile', 'present',
  'remote', 'hybrid', 'fulltime', 'parttime', 'intern', 'internship', 'freelance',
  'developed', 'improved', 'managed', 'created', 'built', 'led', 'delivered', 'supported',
  'responsible', 'successful', 'professional', 'digital', 'visual', 'communication',
  'strategy', 'systems', 'system', 'prototyping', 'accessibility', 'testing', 'test',
  'functional', 'technical', 'application', 'applications', 'platform', 'portfolio',
  'email', 'phone', 'contact', 'address', 'location', 'name', 'date', 'year', 'years',
  'month', 'months', 'day', 'days', 'current', 'previous', 'first', 'last', 'new',
])

function bankReading(word: string, options: BanglishOptions): string | undefined {
  const key = word.toLowerCase()
  const learned = options.learned && Object.hasOwn(options.learned, key) ? options.learned[key] : undefined
  if (isValidSpellingChoice(key, learned)) return learned
  const contextBank = options.context === 'name' ? nameLexicon : options.context === 'address' ? addressLexicon
    : options.context === 'education' ? educationLexicon : options.context === 'career' ? careerLexicon : commonLexicon
  // Vocabulary objects have prototypes. Only authored entries are readings, never
  // inherited properties such as "constructor" or "toString".
  for (const bank of [contextBank, nameLexicon, resumeLexicon, commonLexicon, loanLexicon]) {
    if (Object.hasOwn(bank, key) && typeof bank[key] === 'string') return bank[key]
  }
  return undefined
}

let wordIndex: BanglaWordIndex | undefined
/** Built on first use, so the index costs nothing until someone actually types Banglish. */
function knownWords(): BanglaWordIndex {
  return wordIndex ??= createWordIndex([
    { pool: 'core', words: banglaWordLists.core },
    { pool: 'general', words: [...banglaWordLists.formal, ...Object.values(commonLexicon), ...Object.values(careerLexicon), ...Object.values(educationLexicon), ...Object.values(loanLexicon)] },
    { pool: 'verb', words: banglaWordLists.verbs },
    { pool: 'place', words: Object.values(addressLexicon) },
    { pool: 'name', words: [...Object.values(nameLexicon), ...banglaWordLists.names] },
  ])
}

/**
 * Builds the word index ahead of the first keystroke. It takes a fraction of a
 * second once; a field calls this while idle so that cost never lands on a key.
 */
export function prepareBanglish(): void {
  knownWords()
}

/**
 * Real Bangla words these letters can be read as, closest first. The banks
 * above only know the exact romanizations someone listed; this reads any
 * casual spelling ("dhonnobad", "donnobad", "dhonyobad") against the word
 * itself. `slack` admits looser readings as alternatives, never as the answer.
 */
function knownReadings(word: string, options: BanglishOptions, slack = 0): string[] {
  const limit = acceptableCost(word.length) + slack
  return knownWords().find(word, options.context ?? 'general', 4).filter((match) => match.cost <= limit).map((match) => match.text)
}

/** In a name field a leading capital is name case, not a retroflex or long-vowel marker. */
function phoneticSource(word: string, options: BanglishOptions): string {
  if (options.context !== 'name' || options.force) return word
  return /^[A-Z][a-z]*$/u.test(word) ? word.toLowerCase() : word.replace(/^(Sh|[TDNR])/u, (first) => first.toLowerCase())
}

/** "icche", "hocche": in casual typing cch is always চ্ছ, never ক + চ. Explicit phonetic mode is left exact. */
function casualSource(word: string, options: BanglishOptions): string {
  return options.force ? word : word.replace(/cch(?!h)/gu, 'chchh')
}

/**
 * Two known words written as one: "jonmodin" is জন্ম + দিন, "nurjahan" নূর + জাহান.
 * Tried only when no single word fits, and only when both halves are close
 * readings on their own, so it cannot invent a compound out of loose guesses.
 */
function compoundReading(word: string, options: BanglishOptions): string | undefined {
  if (!/^[a-zA-Z]{6,40}$/u.test(word)) return undefined
  const context = options.context ?? 'general'
  let best: { text: string; cost: number } | undefined
  for (let split = 3; split <= word.length - 3; split++) {
    const head = knownWords().find(word.slice(0, split), context, 1)[0]
    if (!head || !head.whole || head.cost > 0.25) continue
    const tail = knownWords().find(word.slice(split), context, 1)[0]
    if (!tail || tail.cost > 0.25) continue
    const cost = head.cost + tail.cost + 0.3
    if (!best || cost < best.cost) best = { text: head.text + tail.text, cost }
  }
  return best && best.cost <= acceptableCost(word.length) ? best.text : undefined
}

function protectsData(word: string): boolean {
  return !word || word.length > 40 || /[\p{Nd}]/u.test(word) || BENGALI.test(word)
    || /[@/\\:]/u.test(word) || /[a-z0-9]\.[a-z]{2,}/iu.test(word)
    || /[\p{L}\p{M}]/u.test(word.replace(/[A-Za-z]/gu, ''))
}

export function isBanglishTransliterable(word: string, options: BanglishOptions = {}): boolean {
  if (protectsData(word) || !/[a-z]/iu.test(word)) return false
  if (options.force) return true
  const key = word.toLowerCase()
  if (ENGLISH_KEEP.has(key) && !(options.context === 'name' && Object.hasOwn(nameLexicon, key))) return false
  const latin = word.replace(/[^a-z]/giu, '')
  if (latin === latin.toUpperCase()) return false
  const capitals = latin.match(/[A-Z]/gu) ?? []
  if (capitals.length > 1 && !bankReading(word, options)) {
    if (/^[A-Z]/u.test(latin) || capitals.some((letter) => !'TDNRSAEIUOY'.includes(letter))) return false
  }
  // Only unlisted words use this conservative English heuristic. It is deliberately
  // not called a language detector: explicit phonetic choices remain available.
  if (!bankReading(word, options) && /(?:tion|sion|ment|ness|ing|ware|script|able|ible|ous|ness)$/iu.test(word)
      && !/(?:bh|kh|gh|dh|th|sh|chh|rri|Sh|Rh|[TDNR])/u.test(word)) return false
  return true
}

const BIJOY_SIGNS = /[\u2021\u00a4\u00ab\u00bb\u00ac\u00b5\u00b7\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00f0\u00f1]/gu
export function isBijoyLikely(text: string): boolean {
  return !BENGALI.test(text) && (text.match(BIJOY_SIGNS) ?? []).length >= 2
}

type Unit = { key: string; letter: string; length: number }
const UNITS: readonly [string, string][] = [
  ['shth', 'ষ্ঠ'], ['ksh', 'ক্ষ'], ['chh', 'ছ'], ['jn', 'জ্ঞ'], ['nj', 'ঞ্জ'],
  ['ss', 'ষ'], ['kh', 'খ'], ['gh', 'ঘ'], ['bh', 'ভ'], ['dh', 'ধ'], ['th', 'থ'],
  ['ph', 'ফ'], ['sh', 'শ'], ['ch', 'চ'], ['jh', 'ঝ'],
  ['k', 'ক'], ['g', 'গ'], ['j', 'জ'], ['t', 'ত'], ['d', 'দ'], ['n', 'ন'],
  ['p', 'প'], ['b', 'ব'], ['m', 'ম'], ['y', 'য'], ['r', 'র'], ['l', 'ল'],
  ['s', 'স'], ['h', 'হ'], ['f', 'ফ'], ['v', 'ভ'], ['w', 'ব'], ['z', 'জ'],
  ['x', 'ক্স'], ['q', 'ক'], ['c', 'ক'],
]
const CONJUNCTS: Readonly<Record<string, string>> = {
  ক: 'কখটতথবমযরলষস', খ: 'যরল', গ: 'গধনবমযরল', ঘ: 'নযর', ঙ: 'কখগঘম',
  চ: 'চছয', ছ: 'য', জ: 'জঝঞযর', ঝ: 'য', ঞ: 'চছজঝ',
  ট: 'টঠবমযর', ঠ: 'যর', ড: 'ডঢবমযর', ঢ: 'যর', ণ: 'টঠডঢণনময',
  ত: 'তথনবমযরলস', থ: 'বযর', দ: 'কগঘদধনবমযর', ধ: 'নবমযর',
  ন: 'টঠডঢতথদধনবমসযর', প: 'টতনপলসযর', ফ: 'লযর', ব: 'জদধনবলযর',
  ভ: 'যরল', ম: 'নপফবভমলযর', য: 'য', ল: 'কগটডপবমলয',
  শ: 'চছনবমযরল', ষ: 'কটঠণপময', স: 'কখটতথনপফবমলযর', হ: 'নমলযর',
}
const VOWELS: Readonly<Record<string, [string, string]>> = {
  a: ['আ', 'া'], e: ['এ', 'ে'], i: ['ই', 'ি'], o: ['অ', 'ো'], u: ['উ', 'ু'],
  aa: ['আ', 'া'], ee: ['ঈ', 'ী'], ii: ['ঈ', 'ী'], oo: ['ঊ', 'ূ'], uu: ['ঊ', 'ূ'],
  oi: ['ঐ', 'ৈ'], ou: ['ঔ', 'ৌ'],
}
const isVowel = (value: string) => /^[aeiou]$/iu.test(value)

function consonant(word: string, index: number): Unit | null {
  if (word.slice(index, index + 2) === 'Rh') return { key: 'rh', letter: 'ঢ়', length: 2 }
  for (const [key, original] of UNITS) {
    if (word.slice(index, index + key.length).toLowerCase() !== key) continue
    let letter = original
    const upper = word[index] !== word[index].toLowerCase()
    if (upper) {
      if (key === 'sh' || key === 's') letter = 'ষ'
      else if (key === 'th') letter = 'ঠ'
      else if (key === 'dh') letter = 'ঢ'
      else if (key === 't') letter = 'ট'
      else if (key === 'd') letter = 'ড'
      else if (key === 'n') letter = 'ণ'
      else if (key === 'r') letter = 'ড়'
    }
    return { key, letter, length: key.length }
  }
  return null
}

function ruleConvert(word: string, casual = false): string {
  let out = ''
  let cluster: Unit[] = []
  const flush = () => { out += cluster.map((unit, index) => `${index && cluster[index - 1].letter !== 'ৎ' ? HASANTA : ''}${unit.letter}`).join(''); cluster = [] }
  for (let index = 0; index < word.length;) {
    const ch = String.fromCodePoint(word.codePointAt(index)!)
    const lower = ch.toLowerCase()
    if (word.slice(index, index + 2) === ',,') { flush(); out += HASANTA; index += 2; continue }
    if (ch === '^') { flush(); out += 'ঁ'; index++; continue }
    if (word.slice(index, index + 3).toLowerCase() === 'rri') {
      const attached = cluster.length > 0
      flush(); out += attached ? 'ৃ' : 'ঋ'; index += 3; continue
    }
    if (word.slice(index, index + 2).toLowerCase() === 'ng') {
      flush()
      if (isVowel(word[index + 2] ?? '')) cluster = [{ key: 'ng', letter: 'ঙ', length: 1 }, { key: 'g', letter: 'গ', length: 1 }]
      else out += 'ং'
      index += 2; continue
    }
    const unit = consonant(word, index)
    if (unit) {
      if (unit.key === 'y' && !cluster.length && index > 0 && isVowel(word[index - 1])) unit.letter = 'য়'
      const previous = cluster.at(-1)
      const allowed = previous && (previous.letter === 'র' || unit.letter === 'য'
        || (CONJUNCTS[previous.letter]?.includes(unit.letter) ?? false))
      if (!allowed) flush()
      // The conventional ত্+স spelling uses khanda-ta (উৎস), not an extra virama.
      if (allowed && previous.letter === 'ত' && unit.letter === 'স') previous.letter = 'ৎ'
      cluster.push(unit)
      index += unit.length; continue
    }
    if (isVowel(ch)) {
      const digraph = word.slice(index, index + 2).toLowerCase()
      const key = VOWELS[digraph] ? digraph : lower
      const vowel = ch === 'I' && key === 'i' ? ['ঈ', 'ী'] : ch === 'U' && key === 'u' ? ['ঊ', 'ূ'] : ch === 'O' && key === 'o' ? ['ও', 'ো'] : VOWELS[key]
      if (!cluster.length) {
        // Casual typing leaves the glide out: "mia" is মিয়া, "manie" মানিয়ে, "khaoa" খাওয়া.
        // Bangla does not write আ or এ straight after another vowel, so nothing real is lost.
        // Explicit phonetic mode keeps the letters exactly as typed.
        const afterVowel = casual && /[\u0985-\u0994\u09be-\u09cc]$/u.test(out)
        if (afterVowel && (ch === 'a' || ch === 'e') && key === lower) out += `য়${vowel[1]}`
        else if (afterVowel && ch === 'o' && key === 'o') out += 'ও'
        else out += vowel[0]
      } else {
        const joined = cluster.length > 1 || cluster.some((item) => item.letter.includes(HASANTA))
        const next = word[index + 1] ?? ''
        const implicit = ch === 'o' && key === 'o' && ((/^[b-df-hj-np-tv-z]$/iu.test(next) && (cluster.length === 1 || cluster.at(-1)?.key === 'r')) || (!next && joined))
        flush()
        if (!implicit) out += vowel[1]
      }
      index += key.length; continue
    }
    flush(); out += ch; index += ch.length
  }
  flush()
  return out
}

/** One word, or null when the guest's Latin/data must remain untouched. */
export function convertWord(word: string, options: BanglishOptions = {}): string | null {
  if (!isBanglishTransliterable(word, options)) return null
  if (!options.force) {
    // "dhonnobad," in pasted or practice text: the sentence mark is not part of
    // the word, and an English word keeps its Latin letters with or without it.
    const marked = /^([a-zA-Z]+)([.!?;,]+)$/u.exec(word)
    if (marked && !marked[2].includes(',,')) {
      const inner = convertWord(marked[1], options)
      return inner === null ? null : inner + marked[2]
    }
    const exact = bankReading(word, options)
    if (exact) return exact
    const known = knownReadings(word, options)[0] ?? compoundReading(word, options)
    if (known) return known
  }
  return ruleConvert(casualSource(phoneticSource(word, options), options), !options.force)
}

export function suggestReadings(word: string, options: BanglishOptions = {}): string[] {
  if (!isBanglishTransliterable(word, options)) return []
  const candidates: string[] = []
  const add = (reading: string | null | undefined) => { if (reading && !candidates.includes(reading)) candidates.push(reading) }
  add(convertWord(word, options))
  if (!options.force && options.learned) add(bankReading(word, { context: options.context }) ?? null)
  // The nearest other real word, then the plain phonetic spelling, so a guest
  // can always reach exactly what the letters say.
  const known = options.force ? [] : knownReadings(word, options, 0.75)
  add(known.find((reading) => reading !== candidates[0]))
  add(ruleConvert(casualSource(phoneticSource(word, options), options), !options.force))
  for (const reading of known) add(reading)
  add(ruleConvert(word))
  const retro = word.replace(/[tdn]/gu, (letter) => letter.toUpperCase())
  if (retro !== word) add(ruleConvert(retro))
  const dental = word.replace(/Rh/gu, 'rh').replace(/Sh/gu, 'sh').replace(/[TDNRS]/gu, (letter) => letter.toLowerCase())
  if (dental !== word) add(ruleConvert(dental))
  const affricate = word.replace(/chh|ch/gu, (value) => value === 'chh' ? 'ch' : 'chh')
  if (affricate !== word) add(ruleConvert(affricate))
  return candidates.slice(0, 3)
}

const WORD_BREAK = /[\s.,!?;:()"'\[\]{}•→*–—·।॥/\\|%_\-]/u
// These can still become part of an email local-part or an identifier. Show a
// preview, but wait for a definitive separator before changing the field.
const DEFERRED_DELIMITER = /[.!?'*%_{}|\-]/u
function boundary(value: string, index: number): boolean {
  return WORD_BREAK.test(value[index]) && !(value[index] === ',' && (value[index - 1] === ',' || value[index + 1] === ','))
}
function protectedContext(value: string, start: number, end: number): boolean {
  let left = start
  let right = end
  while (left > 0 && !/\s/u.test(value[left - 1])) left--
  while (right < value.length && !/\s/u.test(value[right])) right++
  const token = value.slice(left, right)
  return /[@/\\`\p{N}]/u.test(token) || /(?:[a-z][a-z+.-]*:|www\.)/iu.test(token)
    || /[a-z0-9]\.[a-z]{2,}/iu.test(token) || /[\p{L}\p{M}\p{N}]_[\p{L}\p{M}\p{N}]/u.test(token)
}

export function previewForCaret(value: string, caret: number, options: BanglishOptions = {}): { source: string; start: number; end: number; candidates: string[] } | null {
  if (!Number.isInteger(caret) || caret <= 0 || caret > value.length) return null
  // An interior caret must not turn half an existing identifier/word into Bangla.
  if (caret < value.length && !boundary(value, caret)) return null
  let end = caret
  while (end > 0 && (DEFERRED_DELIMITER.test(value[end - 1]) || value[end - 1] === ',' && value[end - 2] !== ',')) end--
  let start = end
  while (start > 0 && !boundary(value, start - 1)) start--
  if (start === end || protectedContext(value, start, end)) return null
  const source = value.slice(start, end)
  const candidates = suggestReadings(source, options)
  return candidates.length ? { source, start, end, candidates } : null
}

export function convertTailForCaret(value: string, caret: number, options: BanglishOptions = {}): {
  next: string; start: number; end: number; candidates: string[]; source: string; converted: string; newEnd: number; caret: number
} | null {
  if (!Number.isInteger(caret) || caret <= 0 || caret > value.length) return null
  let separator = caret - 1
  if (value[separator] === ',' || DEFERRED_DELIMITER.test(value[separator])) return null
  if (!boundary(value, separator)) {
    if (value[separator - 1] !== ',' || value[separator - 2] === ',') return null
    separator--
  }
  let end = separator
  while (end > 0 && (DEFERRED_DELIMITER.test(value[end - 1]) || value[end - 1] === ',' && value[end - 2] !== ',')) end--
  const preview = previewForCaret(value, end, options)
  if (!preview) return null
  if (value[separator] === '_' && value[preview.start - 1] !== '_') return null
  const converted = preview.candidates[0]
  const next = value.slice(0, preview.start) + converted + value.slice(preview.end)
  return { ...preview, next, converted, newEnd: preview.start + converted.length, caret: caret + converted.length - (preview.end - preview.start) }
}
