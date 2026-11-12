/**
 * Reads casual Banglish against real Bangla spellings.
 *
 * The phonetic rules in banglish.ts can only spell what was typed: they cannot
 * know that "taka" is টাকা, "nodi" ends in a long ী, or that "dhonnobad" hides a
 * য-ফলা. This module answers a different question: "which real Bangla word
 * could a person have meant by these Latin letters?" Every Bangla spelling is
 * turned into a row of slots, each slot listing the Latin spellings people
 * actually type for that sound with a cost, and a typed word matches when it
 * can be read through the row. One grammar therefore covers bishwas, bisshash,
 * bissas and biswas without listing any of them.
 *
 * Pure and dependency-free. It proposes spellings; banglish.ts decides whether
 * a proposal is close enough to use, and unknown words still fall back to the
 * phonetic rules, so nothing here can block typing.
 */

type Alt = readonly [roman: string, cost: number]
/** `marks`: the explicit capitals (T D N R S, I U O) this sound satisfies. */
type Slot = { readonly alts: readonly Alt[]; readonly marks?: string }

const HASANTA = '\u09cd'
const alts = (spec: string): Alt[] => spec.split(' ').map((item) => {
  const [roman, cost] = item.split(':')
  return [roman === '-' ? '' : roman, cost ? Number(cost) : 0] as const
})

// What people type for each consonant. Retroflex and dental letters share the
// plain lowercase letter on purpose: casual typing does not mark them, and the
// word list is what tells টাকা from তাকা.
const CONSONANTS: Readonly<Record<string, Slot>> = {
  ক: { alts: alts('k c:0.5 q:0.5') }, খ: { alts: alts('kh k:1') }, গ: { alts: alts('g') }, ঘ: { alts: alts('gh g:1') },
  ঙ: { alts: alts('ng n:0.5') }, চ: { alts: alts('ch c:0.25') }, ছ: { alts: alts('chh ch s:1') },
  জ: { alts: alts('j z') }, ঝ: { alts: alts('jh z:1 j:1') }, ঞ: { alts: alts('n ny:0.5') },
  ট: { alts: alts('t'), marks: 'T' }, ঠ: { alts: alts('th t:1'), marks: 'T' },
  ড: { alts: alts('d'), marks: 'D' }, ঢ: { alts: alts('dh d:1'), marks: 'D' }, ণ: { alts: alts('n'), marks: 'N' },
  ত: { alts: alts('t') }, থ: { alts: alts('th t:1') }, দ: { alts: alts('d') }, ধ: { alts: alts('dh d:1') }, ন: { alts: alts('n') },
  প: { alts: alts('p') }, ফ: { alts: alts('f ph') }, ব: { alts: alts('b v:0.5 w:0.5') }, ভ: { alts: alts('bh v b:1') },
  ম: { alts: alts('m') }, য: { alts: alts('j z y') }, র: { alts: alts('r') }, ল: { alts: alts('l') },
  শ: { alts: alts('sh s') }, ষ: { alts: alts('sh s'), marks: 'S' }, স: { alts: alts('s sh') }, হ: { alts: alts('h') },
  'ড়': { alts: alts('r rh:0.5'), marks: 'R' }, 'ঢ়': { alts: alts('rh r'), marks: 'R' },
  'য়': { alts: alts('y -:0.25 i:0.5') }, ৎ: { alts: alts('t') },
}
const ROUNDED_GLIDE: Slot = { alts: alts('- w y:0.25 i:0.5') }

// Conjuncts whose sound is not the sum of their letters.
const SPECIAL_CONJUNCTS: readonly [string, Slot][] = [
  ['ক্ষ', { alts: alts('kkh kh ksh x:0.5 kk:1') }], ['জ্ঞ', { alts: alts('gg gy ggy jn gn:0.5 g:0.5') }],
  ['ঙ্গ', { alts: alts('ng ngg') }], ['ঙ্ক', { alts: alts('nk ngk') }], ['ঙ্খ', { alts: alts('nkh ngkh') }], ['ঙ্ঘ', { alts: alts('ngh nggh') }],
  ['চ্ছ', { alts: alts('cch chch chchh cchh chh:0.5 ch:1') }], ['ক্স', { alts: alts('x ks ksh:0.5') }],
  ['হ্ম', { alts: alts('hm mm m:0.5') }], ['হ্ন', { alts: alts('nh hn nn') }], ['হ্য', { alts: alts('jjh hy jh:0.5 jj:1') }], ['হ্ব', { alts: alts('hb hw wb') }],
]

const VOWEL_SIGNS: Readonly<Record<string, Slot>> = {
  'া': { alts: alts('a aa:0.25') }, 'ি': { alts: alts('i ee:0.5 y:1') }, 'ী': { alts: alts('i ee y:0.5'), marks: 'I' },
  'ু': { alts: alts('u oo:0.5 o:1.5') }, 'ূ': { alts: alts('u oo'), marks: 'U' }, 'ৃ': { alts: alts('ri rri r:1 ru:1') },
  'ে': { alts: alts('e ey:0.5 ei:1 a:1.5') }, 'ো': { alts: alts('o u:1.5'), marks: 'O' },
  'ৈ': { alts: alts('oi oy:0.25 ai:0.5') }, 'ৌ': { alts: alts('ou ow:0.25 au:0.5 o:1') },
}
const VOWELS: Readonly<Record<string, Slot>> = {
  অ: { alts: alts('o a:0.5') }, আ: { alts: alts('a aa:0.25') }, ই: { alts: alts('i y:0.5 e:1') }, ঈ: { alts: alts('i ee ei:0.5 e:1'), marks: 'I' },
  উ: { alts: alts('u oo:0.5 w:0.5 o:1') }, ঊ: { alts: alts('u oo'), marks: 'U' }, ঋ: { alts: alts('ri rri r:1') },
  এ: { alts: alts('e a:0.75') }, ঐ: { alts: alts('oi oy:0.25 ai:0.5') }, ও: { alts: alts('o w:0.5 u:1.5'), marks: 'O' }, ঔ: { alts: alts('ou ow:0.25 au:0.5') },
}
const ASPIRATE_BASE: Readonly<Record<string, string>> = { খ: 'ক', ঘ: 'গ', ছ: 'চ', ঝ: 'জ', ঠ: 'ট', ঢ: 'ড', থ: 'ত', ধ: 'দ', ফ: 'প', ভ: 'ব' }
const baseOf = (letter: string) => ASPIRATE_BASE[letter] ?? letter
const doubled = (roman: string) => roman ? [`${roman[0]}${roman}`, ...(roman.length > 1 ? [`${roman}${roman}`] : [])] : []

function yaPhala(slot: Slot, initial: boolean, silent: boolean): Slot {
  // অন্য is "onno", বিদ্যা "bidda", মধ্যে "moddhe": the ফলা doubles the consonant
  // inside a word and is silent at its start (ব্যাংক "bank", ন্যায় "nay") and
  // after a conjunct that is already doubled (লক্ষ্য "lokkho").
  return { alts: slot.alts.flatMap(([roman, cost]): Alt[] => [[`${roman}y`, cost], ...doubled(roman).map((value): Alt => [value, cost + (initial || silent ? 1 : 0)]), [roman, cost + (initial || silent ? 0 : 0.5)]]) }
}
function baPhala(slot: Slot, initial: boolean, letter: string): Slot {
  // স্বপ্ন is "shopno", বিশ্বাস "bisshash/bishwas"; after দ the ব is often real (উদ্বেগ).
  return { alts: slot.alts.flatMap(([roman, cost]): Alt[] => [
    [`${roman}w`, cost], [`${roman}b`, cost + (letter === 'দ' ? 0 : 0.5)], [roman, cost + (initial ? 0 : 0.5)],
    ...(initial ? [] : doubled(roman).map((value): Alt => [value, cost])),
  ]) }
}
function maPhala(slot: Slot, initial: boolean): Slot {
  // আত্মা is "atta", পদ্ম "poddo", স্মৃতি "sriti" — and all of them are also typed with the m.
  return { alts: slot.alts.flatMap(([roman, cost]): Alt[] => [[`${roman}m`, cost], [roman, cost + (initial ? 0.5 : 1)], ...(initial ? [] : doubled(roman).map((value): Alt => [value, cost + 0.5]))]) }
}

const INHERENT_FINAL_SINGLE: Slot = { alts: alts('- o:0.1 a:1.5') }
const INHERENT_FINAL_HEAVY: Slot = { alts: alts('o -:0.25 a:1') }
const INHERENT_MEDIAL: Slot = { alts: alts('o - a:1') }
// ব্যবহার is "bebohar" or "babohar": after a word-initial য-ফলা the vowel is /æ/.
const INHERENT_AFTER_INITIAL_YA: Slot = { alts: alts('e a o:0.5') }
const AA_AFTER_YA: Slot = { alts: alts('a e ae:0.5') }
const ANUSVARA: Slot = { alts: alts('ng n:0.5 m:1') }
const CHANDRABINDU: Slot = { alts: alts('- n:0.5') }
const VISARGA_FINAL: Slot = { alts: alts('- h') }

/** The slot row for one Bangla spelling, or null when it holds something this grammar does not read. */
export function banglaSlots(word: string): Slot[] | null {
  const text = word.normalize('NFC').replace(/[\u200c\u200d]/gu, '')
  const slots: Slot[] = []
  let index = 0
  while (index < text.length) {
    const start = index
    const two = text.slice(index, index + 2)
    const letter = CONSONANTS[two] ? two : text[index]
    if (CONSONANTS[letter]) {
      // Collect the whole conjunct: letters joined by hasanta.
      const cluster: string[] = [letter]
      index += letter.length
      while (text[index] === HASANTA && index + 1 < text.length) {
        const nextTwo = text.slice(index + 1, index + 3)
        const next = CONSONANTS[nextTwo] ? nextTwo : text[index + 1]
        if (!CONSONANTS[next]) break
        cluster.push(next)
        index += 1 + next.length
      }
      const explicitHasanta = text[index] === HASANTA
      if (explicitHasanta) index++
      const initial = start === 0
      let heavy = cluster.length > 1
      let afterYa = false
      for (let position = 0; position < cluster.length; position++) {
        const current = cluster[position]
        const previous = position ? cluster[position - 1] : ''
        const special = SPECIAL_CONJUNCTS.find(([pair]) => pair === `${current}${HASANTA}${cluster[position + 1] ?? ''}`)
        if (special) { slots.push(special[1]); position++; continue }
        const last = slots.length - 1
        // র্য is reph + য ("surjo"), never a ফলা.
        if (position && current === 'য' && !(previous === 'র' && position === 1)) { slots[last] = yaPhala(slots[last], initial, position > 1); afterYa = true; continue }
        if (position && current === 'ব' && !'মবল'.includes(previous)) { slots[last] = baPhala(slots[last], initial, previous); continue }
        if (position && current === 'ম' && 'তদসশষ'.includes(previous)) { slots[last] = maPhala(slots[last], initial); continue }
        // চট্টগ্রাম typed "chotogram", বুদ্ধি typed "budhi": a doubled sound is often typed once.
        if (position && baseOf(previous) === baseOf(current) && slots[last] === CONSONANTS[previous]) slots[last] = { ...slots[last], alts: [...slots[last].alts, ['', 1]] }
        // After a rounded vowel the glide is typed w or not at all (দোয়া "doa/dua", খাওয়া "khaoa/khawa");
        // "doya" is দয়া.
        slots.push(current === 'য়' && 'োওুউূঊ'.includes(text[start - 1] ?? ' ') ? ROUNDED_GLIDE : CONSONANTS[current])
      }
      const sign = text[index]
      if (VOWEL_SIGNS[sign]) {
        index++
        // আনোয়ার is typed "anwar", দেলোয়ার "delwar": before য়া the ো is carried by the w.
        if (sign === 'ো' && text.startsWith('য়া', index)) slots.push({ ...VOWEL_SIGNS[sign], alts: [...VOWEL_SIGNS[sign].alts, ['', 1]] })
        else slots.push(afterYa && sign === 'া' ? AA_AFTER_YA : VOWEL_SIGNS[sign])
      }
      else if (!explicitHasanta && letter !== 'ৎ') {
        const tail = text[index]
        const final = index >= text.length
        const last = cluster.at(-1)!
        if (last === 'য়') heavy = false
        // ং and ঃ close the syllable, so the vowel before them is always sounded.
        if (afterYa && initial && !final) slots.push(INHERENT_AFTER_INITIAL_YA)
        else if (final) slots.push(heavy || last === 'হ' ? INHERENT_FINAL_HEAVY : INHERENT_FINAL_SINGLE)
        else slots.push(tail === 'ং' || tail === 'ঃ' ? { alts: alts('o a:1') } : INHERENT_MEDIAL)
      }
      continue
    }
    const sign = text[index]
    if (VOWELS[sign]) {
      // অ্যা / এ্যা: the borrowed /æ/ of অ্যাকাউন্ট.
      if ((sign === 'অ' || sign === 'এ') && text.slice(index + 1, index + 4) === `${HASANTA}যা`) { slots.push({ alts: alts('a e ae:0.5') }); index += 4; continue }
      slots.push(VOWELS[sign]); index++; continue
    }
    // A suffix such as ের begins with a sign that belongs to the stem's last consonant.
    if (VOWEL_SIGNS[sign] && start === 0) { slots.push(VOWEL_SIGNS[sign]); index++; continue }
    if (sign === 'ং') { slots.push(ANUSVARA); index++; continue }
    if (sign === 'ঁ') { slots.push(CHANDRABINDU); index++; continue }
    if (sign === 'ঃ') {
      // দুঃখ is "dukkho": the visarga doubles the consonant that follows it.
      const nextTwo = text.slice(index + 1, index + 3)
      const next = CONSONANTS[nextTwo] ? nextTwo : text[index + 1]
      if (next && CONSONANTS[next]) slots.push({ alts: [['', 0.5], ['h', 0.5], ...CONSONANTS[next].alts.map(([roman, cost]): Alt => [roman[0], cost])] })
      else slots.push(VISARGA_FINAL)
      index++; continue
    }
    return null
  }
  return slots.length ? slots : null
}

const MARKERS = 'TDNRSIUO'

/**
 * The cheapest way to read every prefix of `roman` through `slots`.
 * `costs[n]` is the cost of the first n letters spelling the whole word
 * (Infinity when they cannot), which is what lets a suffix be read after it.
 */
export function readCosts(roman: string, slots: readonly Slot[]): Float64Array {
  const lower = roman.toLowerCase()
  const length = lower.length
  // A lone leading capital is sentence or name case, not a retroflex marker.
  const capitals = roman.replace(/[^A-Z]/gu, '').length
  const strictFrom = capitals > 1 ? 0 : 1
  let current = new Float64Array(length + 1).fill(Infinity)
  current[0] = 0
  for (const slot of slots) {
    const next = new Float64Array(length + 1).fill(Infinity)
    for (let at = 0; at <= length; at++) {
      const base = current[at]
      if (base === Infinity) continue
      for (const [text, cost] of slot.alts) {
        if (!text) { if (base + cost < next[at]) next[at] = base + cost; continue }
        if (!lower.startsWith(text, at)) continue
        const typed = roman[at]
        if (at >= strictFrom && typed !== lower[at] && MARKERS.includes(typed) && !slot.marks?.includes(typed)) continue
        const end = at + text.length
        if (base + cost < next[end]) next[end] = base + cost
      }
    }
    current = next
  }
  return current
}

/**
 * `core` is the few hundred most frequent words: between two equally good
 * readings the everyday one wins. `verb` holds conjugated forms, which take a
 * negative or an emphatic ending but never a case ending.
 */
export type WordPool = 'core' | 'general' | 'verb' | 'name' | 'place'
export type MatchContext = 'general' | 'name' | 'address' | 'education' | 'career'
/** `whole` is false when the reading is a listed word plus an inflection. */
export type WordMatch = { readonly text: string; readonly cost: number; readonly whole: boolean }
const CORE_PREFERENCE = 0.15

/** How a spelling ends decides which inflections it can take. */
type Ending = 'consonant' | 'sign' | 'vowel'
type Entry = { text: string; slots: Slot[]; min: number; max: number; pool: WordPool; rank: number; ending: Ending; open: boolean }

// Inflections, and the stems each one is really written after: কাজ+ের but
// বন্ধু+র and বই+য়ের; দেশ+ে but ঢাকা+য়. Refusing the impossible joins is what
// keeps an unknown word from being read as a short word plus stray endings.
type SuffixRule = { text: string; after: (entry: Entry) => boolean; cost: number; verbal?: boolean }
const afterConsonant = (entry: Entry) => entry.ending === 'consonant'
const afterSign = (entry: Entry) => entry.ending === 'sign'
const afterOpenVowel = (entry: Entry) => entry.open
const afterVowel = (entry: Entry) => entry.ending !== 'consonant'
const afterAny = () => true
const CASE = 0.1
// "matar" is মাতা+র, not মা+টার: an article is a rarer ending than a case.
const ARTICLE = 0.15
const SUFFIXES: readonly SuffixRule[] = [
  ...['ের', 'ে', 'েরা', 'েই', 'েও', 'েরই', 'েরও'].map((text) => ({ text, after: afterConsonant, cost: CASE })),
  ...['র', 'রই', 'রও'].map((text) => ({ text, after: afterSign, cost: CASE })),
  { text: 'য়', after: afterOpenVowel, cost: CASE }, { text: 'য়ের', after: afterVowel, cost: CASE },
  // হাতে but বাড়িতে: the locative তে follows a vowel, so "hatte" is হাঁটতে and never হাত+তে.
  ...['তে', 'তেই', 'তেও'].map((text) => ({ text, after: afterVowel, cost: CASE })),
  ...['রা', 'কে', 'দের', 'কেই', 'কেও', 'দেরও'].map((text) => ({ text, after: afterAny, cost: CASE })),
  ...['টা', 'টি', 'টার', 'টির', 'টাই', 'টাও', 'গুলো', 'গুলি', 'গুলোর'].map((text) => ({ text, after: afterAny, cost: ARTICLE })),
  // করিনি, আসেনি; and the emphatic ই / ও, which can follow almost anything and so need more evidence.
  { text: 'নি', after: afterAny, cost: CASE, verbal: true },
  { text: 'ও', after: afterAny, cost: 0.3, verbal: true }, { text: 'ই', after: afterAny, cost: 0.3, verbal: true },
]
// A suffix that ends in a consonant ends the word: the র of বন্ধুর carries no vowel to type.
const suffixSlots = SUFFIXES.map((suffix) => {
  const slots = banglaSlots(suffix.text)!
  return { ...suffix, slots: /[\u0995-\u09b9\u09bc]$/u.test(suffix.text) ? slots.slice(0, -1) : slots }
})
const LONGEST_SUFFIX = 6
/** An inflection needs a stem of at least this many typed letters ("ma"+"yer"), or anything could be one. */
const SHORTEST_STEM = 2

export type BanglaWordIndex = { readonly size: number; find(roman: string, context?: MatchContext, limit?: number): WordMatch[] }

/** Builds the searchable index once. Earlier words win ties, so pools are listed most-frequent first. */
export function createWordIndex(pools: readonly { pool: WordPool; words: readonly string[] }[]): BanglaWordIndex {
  const byFirstLetter = new Map<string, Entry[]>()
  const seen = new Set<string>()
  let rank = 0
  for (const { pool, words } of pools) {
    for (const raw of words) {
      const text = raw.normalize('NFC')
      // শেখ is both a verb stem and a surname: a word keeps its place in each kind of list.
      const identity = `${pool === 'name' || pool === 'place' ? pool : 'word'}\u0000${text}`
      if (!text || seen.has(identity)) continue
      const slots = banglaSlots(text)
      if (!slots) continue
      seen.add(identity)
      const entry: Entry = {
        text, slots, pool, rank: rank++,
        min: slots.reduce((sum, slot) => sum + Math.min(...slot.alts.map(([roman]) => roman.length)), 0),
        max: slots.reduce((sum, slot) => sum + Math.max(...slot.alts.map(([roman]) => roman.length)), 0),
        ending: /[\u09be-\u09cc]$/u.test(text) ? 'sign' : /[\u0985-\u0994]$/u.test(text) ? 'vowel' : 'consonant',
        open: /[\u09be\u09cb]$/u.test(text),
      }
      // A word can only be meant by letters that start the way its first sound does.
      const firsts = new Set<string>()
      for (let at = 0, open = true; at < slots.length && open; at++) {
        open = false
        for (const [roman] of slots[at].alts) { if (roman) firsts.add(roman[0]); else open = true }
      }
      for (const first of firsts) {
        const bucket = byFirstLetter.get(first)
        if (bucket) bucket.push(entry)
        else byFirstLetter.set(first, [entry])
      }
    }
  }
  const cache = new Map<string, WordMatch[]>()

  function find(roman: string, context: MatchContext = 'general', limit = 4): WordMatch[] {
    if (!/^[a-zA-Z]{1,40}$/u.test(roman)) return []
    const key = `${context}\u0000${limit}\u0000${roman}`
    const cached = cache.get(key)
    if (cached) return cached
    const length = roman.length
    // Each possible ending is read once per call, not once per dictionary word.
    const endings: { split: number; rule: SuffixRule; cost: number }[] = []
    for (let split = Math.max(SHORTEST_STEM, length - LONGEST_SUFFIX); split < length; split++) {
      const tail = roman.slice(split)
      for (const suffix of suffixSlots) {
        const cost = readCosts(tail, suffix.slots)[tail.length]
        if (cost !== Infinity) endings.push({ split, rule: suffix, cost: cost + suffix.cost })
      }
    }
    const found: { text: string; cost: number; order: number; rank: number; whole: boolean }[] = []
    for (const entry of byFirstLetter.get(roman[0].toLowerCase()) ?? []) {
      if (length < entry.min || length > entry.max + LONGEST_SUFFIX) continue
      const costs = readCosts(roman, entry.slots)
      // In a name field a real name outranks a common word, and the reverse elsewhere.
      const poolCost = context === 'name' ? (entry.pool === 'name' ? 0 : 0.6)
        : context === 'address' ? (entry.pool === 'place' ? 0 : 0.3) : entry.pool === 'name' ? 0.15 : 0
      // "keno" is কেন (why) before কেনো (you buy): frequency settles near-ties, it never rescues a bad reading.
      const preference = entry.pool === 'core' && context !== 'name' ? CORE_PREFERENCE : 0
      if (costs[length] !== Infinity) found.push({ text: entry.text, cost: costs[length] + poolCost, order: costs[length] + poolCost - preference, rank: entry.rank, whole: true })
      if (entry.pool === 'name') continue
      for (const ending of endings) {
        if (costs[ending.split] === Infinity || !ending.rule.after(entry) || (entry.pool === 'verb' && !ending.rule.verbal)) continue
        const cost = costs[ending.split] + ending.cost + poolCost
        // ভবিষ্যৎ + ে is written ভবিষ্যতে: khanda-ta cannot carry a vowel sign.
        const stem = entry.text.endsWith('ৎ') && /^[\u09be-\u09cc]/u.test(ending.rule.text) ? `${entry.text.slice(0, -1)}ত` : entry.text
        found.push({ text: stem + ending.rule.text, cost, order: cost - preference, rank: entry.rank, whole: false })
      }
    }
    found.sort((a, b) => a.order - b.order || a.rank - b.rank)
    const unique: WordMatch[] = []
    for (const item of found) {
      if (unique.some((match) => match.text === item.text)) continue
      unique.push({ text: item.text, cost: item.cost, whole: item.whole })
      if (unique.length >= limit) break
    }
    if (cache.size > 400) cache.clear()
    cache.set(key, unique)
    return unique
  }

  return { size: seen.size, find }
}
/** How loose a reading may be before the phonetic rules are trusted instead. Short words leave less evidence. */
export function acceptableCost(romanLength: number): number {
  return romanLength <= 3 ? 0.5 : romanLength === 4 ? 0.75 : 1.25
}
