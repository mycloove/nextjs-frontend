/**
 * Banglish → Bangla transliteration — module-owned, zero dependencies.
 *
 * Job: a guest writes Banglish because no Bangla keyboard is at hand, and the
 * finished word lands on the canvas as real Unicode Bangla. Everything runs
 * on-device, like the rest of the draft.
 *
 * Pipeline per word:
 *   1. Protection — digits, emails, URLs, all-caps acronyms, already-Bangla
 *      text and common resume-domain English words pass through untouched.
 *      The input method never rewrites information the guest did not mean
 *      as Bangla.
 *   2. Lexicon — resume-domain and high-frequency words whose rules alone
 *      cannot resolve (স্বপ্ন, জন্য, দক্ষতা…).
 *   3. Rules — a deterministic phonetic walk: consonant runs become Bengali
 *      conjuncts (ক্র, ন্দ, ত্ত…), vowels place their signs, and an
 *      implicit-'o' rule mirrors how Banglish is actually written
 *      (dorkar → দরকার, hobe → হবে, koro → করো, shobdo → শব্দ).
 *   4. Suggestions — the most probable reading converts immediately; the
 *      ambiguous letters offer up to three candidate readings under the
 *      input, one click to swap back.
 */

const HASANTA = '\u09CD'
const BENGALI_SHAPE = /[\u0980-\u09FF]/

/** English words a mixed resume keeps as Latin, even while Banglish typing is on. */
const ENGLISH_KEEP = new Set([
  'the', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'is',
  'are', 'as', 'an', 'or', 'be', 'it', 'my', 'we', 'team', 'work', 'tool',
  'pdf', 'doc', 'docx', 'ms', 'excel', 'word', 'adobe', 'google', 'android',
  'iphone', 'ios', 'web', 'app', 'site', 'blog', 'seo', 'html', 'css', 'sql',
  'php', 'python', 'java', 'javascript', 'typescript', 'react', 'node',
  'figma', 'canva', 'linkedin', 'ats', 'hr', 'crm', 'aws', 'ui', 'ux', 'ai',
  'ml', 'saas', 'gpa', 'cgpa',
])

/** A word the engine may touch. */
export function isBanglishTransliterable(word: string): boolean {
  if (word.length === 0 || word.length > 40) return false
  if (/[\p{Nd}]/u.test(word)) return false
  if (BENGALI_SHAPE.test(word)) return false
  if (word.includes('@') || word.includes('/') || word.toLowerCase().startsWith('www.')) return false
  if (ENGLISH_KEEP.has(word.toLowerCase())) return false
  const latin = word.replace(/[^\p{L}]/gu, '')
  if (latin.length === 0 || latin === latin.toUpperCase()) return false
  return true
}

// Legacy Bijoy documents print Bangla through Latin-1 punctuation glyphs
// (‡Kv¤új-style paths). Two signatories with no Bengali codepoint anywhere is
// enough to raise the offer; ordinary Latin prose never carries these.
const BIJOY_SIGNS = /[\u2021\u00A4\u00AB\u00BB\u00AC\u00B5\u00B7\u00CD\u00CE\u00CF\u00D1\u00D2\u00D3\u00D4\u00D5\u00F0\u00F1]/g

export function isBijoyLikely(text: string): boolean {
  if (BENGALI_SHAPE.test(text)) return false
  return (text.match(BIJOY_SIGNS) ?? []).length >= 2
}

/** Keys are lowercase; the input method is case-protective, never case-training. */
const lexicon: Record<string, string> = {
  // Function words & connectors
  ami: 'আমি', amar: 'আমার', amader: 'আমাদের', apni: 'আপনি', apnar: 'আপনার',
  tumi: 'তুমি', tomar: 'তোমার', tara: 'তারা', tarpor: 'তারপর',
  ebang: 'এবং', ebong: 'এবং', othoba: 'অথবা', jehetu: 'যেহেতু', tai: 'তাই',
  tobe: 'তবে', jemon: 'যেমন', temon: 'তেমন', mane: 'মানে', ar: 'আর',
  na: 'না', abar: 'আবার', pore: 'পরে', ekhane: 'এখানে', eta: 'এটা', eti: 'এটি',
  ei: 'এই', sei: 'সেই', je: 'যে', ja: 'যা', jar: 'যার', se: 'সে', she: 'সে',
  theke: 'থেকে', hote: 'হতে', shesh: 'শেষ', sathe: 'সাথে', shathe: 'সাথে',
  jonne: 'জন্য', jonno: 'জন্য', sejonne: 'সেজন্য', diye: 'দিয়ে',
  moddhe: 'মধ্যে', maddhome: 'মাধ্যমে', nam: 'নাম', eto: 'এত',
  obosshoi: 'অবশ্যই', onek: 'অনেক', thik: 'ঠিক', thikana: 'ঠিকানা',
  kotha: 'কথা', somoy: 'সময়', shomoy: 'সময়', kono: 'কোন',
  // Verbs & everyday states
  hoy: 'হয়', hobe: 'হবে', holo: 'হলো', hole: 'হলে', hochche: 'হচ্ছে',
  hoyeche: 'হয়েছে', kori: 'করি', kore: 'করে', korchi: 'করছি',
  koreche: 'করেছে', korbo: 'করব', korte: 'করতে', korar: 'করার',
  korechi: 'করেছি', kora: 'করা', kaj: 'কাজ', ache: 'আছে', thaki: 'থাকি',
  thake: 'থাকে', thakbo: 'থাকব', chhilo: 'ছিল', bhalo: 'ভালো', valo: 'ভালো',
  chai: 'চাই', pari: 'পারি', parbo: 'পারব', dekha: 'দেখা', lekha: 'লেখা',
  pora: 'পড়া', bola: 'বলা', jani: 'জানি', purano: 'পুরনো', notun: 'নতুন',
  dorkar: 'দরকার', shombob: 'সম্ভব', sombob: 'সম্ভব', subidha: 'সুবিধা',
  shahajjo: 'সাহায্য', shohoj: 'সহজ', shuru: 'শুরু', dewa: 'দেওয়া',
  // Numbers, time & place
  ek: 'এক', dui: 'দুই', tin: 'তিন', prothom: 'প্রথম', sokol: 'সকল',
  sobai: 'সবাই', bochor: 'বছর', bachor: 'বছর', din: 'দিন', rat: 'রাত',
  mash: 'মাস', shokal: 'সকাল',
  // Education & career vocabulary
  obhiggota: 'অভিজ্ঞতা', obhiggoto: 'অভিজ্ঞতা', dokkhota: 'দক্ষতা',
  dokkho: 'দক্ষ', chakri: 'চাকরি', chakrir: 'চাকরির', pesha: 'পেশা',
  protisthan: 'প্রতিষ্ঠান', protisthito: 'প্রতিষ্ঠিত',
  bishwabidyaloy: 'বিশ্ববিদ্যালয়', bishshobiddaloy: 'বিশ্ববিদ্যালয়',
  bissobiddaloy: 'বিশ্ববিদ্যালয়', kolejo: 'কলেজ', koleje: 'কলেজে',
  shikkha: 'শিক্ষা', shikkhito: 'শিক্ষিত', shikkhok: 'শিক্ষক',
  shikkharthi: 'শিক্ষার্থী', chhatro: 'ছাত্র', chhatri: 'ছাত্রী',
  porikkha: 'পরীক্ষা', porikhha: 'পরীক্ষা', britti: 'বৃত্তি',
  folafol: 'ফলাফল', folaphol: 'ফলাফল', sreni: 'শ্রেণি',
  proshikkhon: 'প্রশিক্ষণ', prodhikkhon: 'প্রশিক্ষণ',
  proshikkhito: 'প্রশিক্ষিত', purushkar: 'পুরস্কার', poroshkar: 'পুরস্কার',
  dayitto: 'দায়িত্ব', byabosthapona: 'ব্যবস্থাপনা', byobosthapona: 'ব্যবস্থাপনা',
  niponno: 'নিপুণ', niyog: 'নিয়োগ', niyogito: 'নিয়োগিত', niyoker: 'নিয়োগের',
  shongosto: 'সংস্থা', songosto: 'সংস্থা', udjesso: 'উদ্দেশ্য',
  uddesso: 'উদ্দেশ্য', onuprerona: 'অনুপ্রেরণা', shafolota: 'সাফল্য',
  shofolota: 'সাফল্য', otirikto: 'অতিরিক্ত', shomosshya: 'সমস্যা',
  somosshya: 'সমস্যা', shomadhan: 'সমাধান', somadhan: 'সমাধান',
  bhasha: 'ভাষা', joggo: 'যোগ্য', joggyota: 'যোগ্যতা', taththo: 'তথ্য',
  bishleshon: 'বিশ্লেষণ', bishleson: 'বিশ্লেষণ', bishleshok: 'বিশ্লেষক',
  projukti: 'প্রযুক্তি', unnoyon: 'উন্নয়ন', unnayan: 'উন্নয়ন',
  gobeshona: 'গবেষণা', bhabishot: 'ভবিষ্যৎ', ongsho: 'অংশ', jonmo: 'জন্ম',
  proshno: 'প্রশ্ন', uttor: 'উত্তর', bishoy: 'বিষয়', kormo: 'কর্ম',
  kormi: 'কর্মী', shomporko: 'সম্পর্ক', shohojogita: 'সহযোগিতা',
  // Words whose rules alone misread an inherent vowel or a rare conjunct
  ekhon: 'এখন', ekhono: 'এখনো', ekhoni: 'এখনি', sorkar: 'সরকার',
  hridoy: 'হৃদয়', shopno: 'স্বপ্ন', shongi: 'সঙ্গী', shonge: 'সঙ্গে',
  shongho: 'সংঘ', borsha: 'বর্ষা', ghora: 'ঘোড়া', ghori: 'ঘড়ি',
  sohag: 'সোহাগ', shohag: 'সোহাগ', prottoy: 'প্রত্তয়', shikkhokta: 'শিক্ষকতা',
  yoggo: 'যোগ্য', bachchor: 'বছর', poriyksha: 'পরীক্ষা',
  // ঋ-words rules cannot reach without breaking names like "Rida".
  rishi: 'ঋষি', ritu: 'ঋতু', riddhi: 'ঋদ্ধি', riju: 'ঋজু',
  // Avro-style dictionary: frequent words whose mid-word 'o' is a real
  // ও-kar — the implicit-o rule alone cannot tell হবে from তোমাকে.
  tomake: 'তোমাকে', apnake: 'আপনাকে', amake: 'আমাকে', amay: 'আমায়',
  tomay: 'তোমায়', kothay: 'কোথায়', kothao: 'কোথাও', shudhu: 'শুধু',
  khujchi: 'খুঁজছি', khujchhi: 'খুঁজছি', khujbo: 'খুঁজব', dekhchi: 'দেখছি',
  dekche: 'দেখছে', dite: 'দিতে', dibe: 'দিবে', nite: 'নিতে', rakhbo: 'রাখব',
  rakhchi: 'রাখছি', rakhche: 'রাখছে', keu: 'কেউ',
}

// ── Rule walk ────────────────────────────────────────────────────────────

type Unit = { letter: string; key: string; upper: boolean; length: number }

// Longest units first, so chh/sh/ss/kh never split mid-way.
const CONSONANT_UNITS: [string, string][] = [
  ['chh', 'ছ'], ['ss', 'ষ'], ['kh', 'খ'], ['gh', 'ঘ'], ['bh', 'ভ'], ['dh', 'ধ'],
  ['th', 'থ'], ['ph', 'ফ'], ['sh', 'শ'], ['ch', 'চ'], ['jh', 'ঝ'],
  ['k', 'ক'], ['g', 'গ'], ['j', 'জ'], ['t', 'ত'], ['d', 'দ'], ['n', 'ন'],
  ['p', 'প'], ['b', 'ব'], ['m', 'ম'], ['y', 'য়'], ['r', 'র'], ['l', 'ল'],
  ['s', 'স'], ['h', 'হ'], ['f', 'ফ'], ['v', 'ভ'], ['w', 'ব'], ['z', 'জ'],
  ['x', 'ক্স'], ['q', 'ক'], ['c', 'ক'],
]

const VOWEL_SIGN: Record<string, string> = { a: 'া', e: 'ে', i: 'ি', o: 'ো', u: 'ু' }
const DIGRAPH_SIGN: Record<string, string> = {
  aa: 'া', ee: 'ী', ii: 'ী', oo: 'ূ', uu: 'ূ',
  oi: 'ৈ', ai: 'ৈ', ei: 'ৈ', ou: 'ৌ', au: 'ৌ',
}
const FULL_VOWEL: Record<string, string> = {
  a: 'আ', e: 'এ', i: 'ই', o: 'ও', u: 'উ',
  aa: 'আ', ee: 'ঈ', ii: 'ঈ', oo: 'ঊ', uu: 'ঊ',
  oi: 'ঐ', ai: 'ঐ', ei: 'ঐ', ou: 'ঔ', au: 'ঔ',
}

// Where a hasanta is proven safe. r/y/l join any consonant (reph, ্য, ্ল);
// b closes the common mb/nb/lb/sb/gb/kb sets; the pair table covers kt/nt/st/pt/nd.
const PAIRS = new Set(['kt', 'nt', 'st', 'pt', 'nd', 'bd', 'sk', 'sp'])

function pairAllowed(prev: Unit, unit: Unit): boolean {
  if (prev.upper) return unit.key === 'r' || unit.key === 'y' || unit.key === 'l'
  if (prev.key === unit.key && prev.key.length === 1) return true
  if (unit.key === 'r' || unit.key === 'y' || unit.key === 'l') return true
  if (unit.key === 'b' || unit.key === 'w' ? ['m', 'n', 'l', 's', 'g', 'k'].includes(prev.key) : false) return true
  return PAIRS.has(prev.key + unit.key)
}

function matchConsonant(value: string, index: number): Unit | null {
  const ch = value[index]
  const lower = ch.toLowerCase()
  for (const [match, letter] of CONSONANT_UNITS) {
    if (value.slice(index, index + match.length).toLowerCase() !== match) continue
    const upper = ch !== lower
    let resolved = letter
    // A mid-word capital T/D/N picks the retroflex row; word-initial capitals
    // keep the dental letter so ordinary names and sentences lose nothing.
    if (match === 'th') resolved = upper ? 'ঠ' : 'থ'
    else if (match === 'dh') resolved = upper ? 'ঢ' : 'ধ'
    else if (match === 't' && upper && index > 0) resolved = 'ট'
    else if (match === 'd' && upper && index > 0) resolved = 'ড'
    else if (match === 'n' && upper && index > 0) resolved = 'ণ'
    return { letter: resolved, key: match, upper, length: match.length }
  }
  return null
}

const isVowelChar = (ch: string) => 'aeiou'.includes(ch.toLowerCase())

const isConsonantChar = (ch: string | undefined) => {
  if (!ch) return false
  const lower = ch.toLowerCase()
  return /[a-z]/.test(lower) && !isVowelChar(lower)
}

/** The rule-based reading. Returns null when nothing maps to Bengali. */
function ruleConvert(word: string): string | null {
  let out = ''
  let cluster: Unit[] = []
  let hasCluster = false

  const flush = () => {
    if (!hasCluster) return
    out += cluster.map((unit) => unit.letter).join(HASANTA)
    cluster = []
    hasCluster = false
  }

  let i = 0
  while (i < word.length) {
    const ch = word[i]
    const lower = ch.toLowerCase()

    // 'n'+'g' assimilates: a following vowel reads ঙ্‌গ, a following
    // consonant or the word end reads ং — bangla → বাংলা, shongi → শঙ্গী.
    if (lower === 'n' && word[i + 1]?.toLowerCase() === 'g') {
      const conjunct = isVowelChar(word[i + 2] ?? '')
      if (conjunct) {
        cluster = [
          { letter: 'ঙ', key: 'ng', upper: false, length: 1 },
          { letter: 'গ', key: 'g', upper: false, length: 1 },
        ]
        hasCluster = true
      } else {
        flush()
        out += 'ং'
      }
      i += 2
      continue
    }

    const unit = matchConsonant(word, i)
    if (unit) {
      if (hasCluster && pairAllowed(cluster[cluster.length - 1], unit)) {
        cluster.push(unit)
      } else {
        flush()
        cluster = [unit]
        hasCluster = true
      }
      i += unit.length
      continue
    }

    if (!isVowelChar(lower)) {
      flush()
      i += 1
      continue
    }

    const two = word.slice(i, i + 2).toLowerCase()
    const digraph = DIGRAPH_SIGN[two]

    if (!hasCluster) {
      // Standalone vowel, word-initial or after a finished syllable.
      out += FULL_VOWEL[digraph !== undefined ? two : lower] ?? ch
      i += digraph !== undefined ? 2 : 1
      continue
    }

    if (lower === 'o' && !digraph) {
      // Implicit-o rule: an unvoiced o silently closes the syllable
      // (dorkar → দরকার, tokhon → তখন, hobe → হবে, shobdo → শব্দ);
      // a pronounced o signs the last consonant (koro → করো, bhalo → ভালো).
      const lastKey = cluster[cluster.length - 1].key
      const nextConsonant = isConsonantChar(word[i + 1])
      const implicit = nextConsonant && (cluster.length === 1 || lastKey === 'r')
        || (word[i + 1] === undefined && cluster.length >= 2)
      if (implicit) {
        flush()
        i += 1
        continue
      }
      flush()
      out += 'ো'
      i += 1
      continue
    }

    flush()
    out += digraph ?? VOWEL_SIGN[lower] ?? ''
    i += digraph !== undefined ? 2 : 1
  }
  flush()
  return out.length > 0 ? out : null
}

// ── Public surface ───────────────────────────────────────────────────────

/** Bangla for one word, or null when the word must stay as typed. */
export function convertWord(word: string): string | null {
  if (!isBanglishTransliterable(word)) return null
  const exact = lexicon[word.toLowerCase()]
  if (exact) return exact
  return ruleConvert(word)
}

/** Alternative readings for the suggestion chips, most likely first. */
export function suggestReadings(word: string): string[] {
  const candidates: string[] = []
  const add = (candidate: string | null) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
  }
  add(convertWord(word))
  // Retroflex tilt: raise non-initial t/d/n one row (kotha → কথা vs কটা).
  const retro = word.slice(0, 1) + word.slice(1).replace(/[tdn]/g, (m) => m.toUpperCase())
  if (retro !== word) add(convertWord(retro))
  // Dental reply for input that already carries a capital (tKhon → তখন).
  const dental = word.replace(/[TN]/g, (m) => m.toLowerCase())
  if (dental !== word) add(convertWord(dental))
  // Affricate swap: chh ↔ ch (porichoy vs porikkhoy-style misreads).
  const affricate = word.replace(/chh/g, '@').replace(/ch/g, 'chh').replace(/@/g, 'ch')
  if (affricate !== word) add(convertWord(affricate))
  return candidates.slice(0, 3)
}

const WORD_BREAK = /[\s.,!?;:()"'\[\]{}•→*–—·\/\\|%-]/

/**
 * Panel-facing step: when the character just before the caret is a word
 * breaker, the finished word before it is converted in-place. Returns the
 * rewritten value, the replaced range, and the alternative readings.
 * Protected words (English, digits, URLs, caps, already-Bangla) → null.
 */
export function convertTailForCaret(
  value: string,
  caret: number,
): { next: string; start: number; end: number; candidates: string[] } | null {
  if (caret <= 0 || caret > value.length) return null
  const breakIndex = caret - 1
  if (!WORD_BREAK.test(value[breakIndex])) return null
  let start = breakIndex
  while (start > 0 && !WORD_BREAK.test(value[start - 1])) start--
  const word = value.slice(start, breakIndex)
  const converted = convertWord(word)
  if (!converted) return null
  return {
    next: value.slice(0, start) + converted + value.slice(breakIndex),
    start,
    end: breakIndex,
    candidates: suggestReadings(word),
  }
}
