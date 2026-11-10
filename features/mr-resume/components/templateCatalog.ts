// The Mr. Resume template gallery contract. Pure data and functions only: the
// home page, both editors' deep links and the tests read this one shape, so a
// card can never claim something its template does not do. Badges are DERIVED
// from structure here — no card carries a hand-written "ATS" or "ready" flag.

export type GalleryEditor = 'regular' | 'latex'
export type Localized = { readonly en: string; readonly bn: string }
export type TemplateLanguage = 'bn' | 'en' | 'mixed'
export type TemplateColumns = 1 | 2 | 'sidebar'
export type LatexTemplateRuntime = 'browser' | 'browser-after-consent'

export type TemplateCredit = {
  readonly title: string
  readonly author: string
  readonly license: 'MIT' | 'LPPL-1.3c'
  readonly url: string
  /** The exact upstream revision the bundled copy was taken from. */
  readonly revision: string
  /** True when the bundled source differs from upstream; the changes are listed. */
  readonly adapted: boolean
  readonly changes: readonly string[]
}

export type TemplateCard = {
  readonly id: string
  readonly editor: GalleryEditor
  readonly name: Localized
  readonly summary: Localized
  /** First entry is the primary category. */
  readonly categories: readonly string[]
  readonly language: TemplateLanguage
  readonly columns: TemplateColumns
  readonly photo: boolean
  /** Measured from the real rendered output by the thumbnail script; absent until measured. */
  readonly pages?: number
  /** Facts about the produced page that ATS guidance cares about. */
  readonly structure: { readonly contactAsText: boolean; readonly standardHeadings: boolean }
  /** Extra search words, both scripts. */
  readonly keywords: string
  readonly engine?: 'pdflatex' | 'xelatex' | 'lualatex'
  readonly runtime?: LatexTemplateRuntime
  readonly packageGroups?: readonly string[]
  /** LaTeX only: the real compiler fixture that proves this starter builds as-is. */
  readonly qualification?: string
  readonly credit?: TemplateCredit
}

export type TemplateCategory = { readonly id: string; readonly name: Localized; readonly description: Localized }

// Regular is chosen by what you are writing FOR; LaTeX by layout tradition.
// The two drawers deliberately do not share a taxonomy.
export const templateCategories: Readonly<Record<GalleryEditor, readonly TemplateCategory[]>> = {
  regular: [
    { id: 'corporate', name: { en: 'Corporate & private jobs', bn: 'পেশাদার চাকরি' }, description: { en: 'Private sector, corporate and bank roles.', bn: 'বেসরকারি, কর্পোরেট ও ব্যাংকের চাকরি।' } },
    { id: 'fresher', name: { en: 'Fresh graduate & internship', bn: 'ফ্রেশার ও ইন্টার্নশিপ' }, description: { en: 'Coursework, projects and activities first.', bn: 'কোর্স, প্রকল্প ও সহশিক্ষা আগে।' } },
    { id: 'government', name: { en: 'Government, BCS & bank', bn: 'সরকারি চাকরি ও ব্যাংক' }, description: { en: 'Formal biodata outlines. Follow the vacancy notice.', bn: 'ফরমাল বায়োডাটা কাঠামো। বিজ্ঞপ্তির নিয়ম মানুন।' } },
    { id: 'tech', name: { en: 'Tech & engineering', bn: 'টেক ও ইঞ্জিনিয়ারিং' }, description: { en: 'Projects, skills and verifiable work.', bn: 'প্রকল্প, দক্ষতা ও যাচাইযোগ্য কাজ।' } },
    { id: 'academic', name: { en: 'Teaching & research', bn: 'শিক্ষা ও গবেষণা' }, description: { en: 'Teachers, researchers and publications.', bn: 'শিক্ষক, গবেষক ও প্রকাশনা।' } },
    { id: 'creative', name: { en: 'Creative & marketing', bn: 'ক্রিয়েটিভ ও মার্কেটিং' }, description: { en: 'Design, media and sales roles.', bn: 'ডিজাইন, মিডিয়া ও সেলস।' } },
    { id: 'executive', name: { en: 'Senior & executive', bn: 'সিনিয়র ও এক্সিকিউটিভ' }, description: { en: 'Leadership evidence across two pages.', bn: 'দুই পাতায় নেতৃত্বের প্রমাণ।' } },
    { id: 'development', name: { en: 'NGO & development', bn: 'এনজিও ও উন্নয়ন খাত' }, description: { en: 'Programmes, field work and reporting.', bn: 'প্রকল্প, মাঠের কাজ ও রিপোর্টিং।' } },
    { id: 'healthcare', name: { en: 'Healthcare', bn: 'স্বাস্থ্যসেবা' }, description: { en: 'Doctors, nurses and clinical roles.', bn: 'চিকিৎসক, নার্স ও ক্লিনিক্যাল কাজ।' } },
    { id: 'personal', name: { en: 'Biodata, SOP & letters', bn: 'বায়োডাটা, SOP ও চিঠি' }, description: { en: 'Personal biodata, statements and cover letters.', bn: 'ব্যক্তিগত বায়োডাটা, SOP ও কভার লেটার।' } },
  ],
  latex: [
    { id: 'ats-onecol', name: { en: 'ATS-friendly single column', bn: 'ATS-বান্ধব এক কলাম' }, description: { en: 'Plain reading order, text contacts.', bn: 'সরল পাঠক্রম, টেক্সটে যোগাযোগ।' } },
    { id: 'modern', name: { en: 'Modern professional', bn: 'আধুনিক প্রফেশনাল' }, description: { en: 'Colour accents and a confident header.', bn: 'রঙের ছোঁয়া আর স্পষ্ট শিরোনাম।' } },
    { id: 'sidebar', name: { en: 'Sidebar & two-column', bn: 'সাইডবার ও দুই কলাম' }, description: { en: 'Skills and contacts in a side rail.', bn: 'পাশের কলামে দক্ষতা ও যোগাযোগ।' } },
    { id: 'academic', name: { en: 'Academic CV & publications', bn: 'একাডেমিক CV ও প্রকাশনা' }, description: { en: 'Research, teaching and bibliography.', bn: 'গবেষণা, পাঠদান ও গ্রন্থপঞ্জি।' } },
    { id: 'international', name: { en: 'International & European', bn: 'আন্তর্জাতিক / ইউরোপিয়ান' }, description: { en: 'Dates in a left column, classic CV order.', bn: 'বাম কলামে সাল, প্রচলিত CV ক্রম।' } },
    { id: 'bangla', name: { en: 'Bangla & mixed script', bn: 'বাংলা ও মিশ্র লিপি' }, description: { en: 'LuaLaTeX with HarfBuzz Bangla shaping.', bn: 'LuaLaTeX ও HarfBuzz দিয়ে বাংলা।' } },
    { id: 'letters', name: { en: 'Cover letters', bn: 'কভার লেটার' }, description: { en: 'A letter that matches your CV.', bn: 'সিভির সাথে মানানসই চিঠি।' } },
  ],
}

// ATS guidance converges on: one column, contacts as plain text, conventional
// headings, no photo. Bangla text extraction is not reliably faithful, so only
// English templates can earn the structure badge. This is a structure claim,
// never a score; LaTeX additionally needs a real compiler fixture behind it.
export function hasAtsStructure(card: TemplateCard) {
  return card.columns === 1 && card.language === 'en' && !card.photo
    && card.structure.contactAsText && card.structure.standardHeadings
    && (card.editor === 'regular' || Boolean(card.qualification))
}

export type TemplateBadge = { readonly id: 'ats' | 'language' | 'photo' | 'pages' | 'browser' | 'consent' | 'adapted'; readonly label: Localized; readonly tone: 'neutral' | 'notice' }

const languageLabels: Record<TemplateLanguage, Localized> = {
  bn: { en: 'Bangla', bn: 'বাংলা' },
  en: { en: 'English', bn: 'English' },
  mixed: { en: 'Bangla + English', bn: 'বাংলা + English' },
}

export function templateBadges(card: TemplateCard): TemplateBadge[] {
  const badges: TemplateBadge[] = []
  if (hasAtsStructure(card)) badges.push({ id: 'ats', label: { en: 'ATS-friendly structure', bn: 'ATS-বান্ধব কাঠামো' }, tone: 'neutral' })
  badges.push({ id: 'language', label: languageLabels[card.language], tone: 'neutral' })
  if (card.photo) badges.push({ id: 'photo', label: { en: 'Photo slot', bn: 'ছবির জায়গা' }, tone: 'neutral' })
  if (card.pages === 1) badges.push({ id: 'pages', label: { en: 'One page', bn: 'এক পাতা' }, tone: 'neutral' })
  else if (card.pages && card.pages > 1) badges.push({ id: 'pages', label: { en: `${card.pages} pages`, bn: `${card.pages.toLocaleString('bn-BD')} পাতা` }, tone: 'neutral' })
  if (card.editor === 'latex' && card.runtime === 'browser') badges.push({ id: 'browser', label: { en: 'Compiles in browser', bn: 'ব্রাউজারে compile হয়' }, tone: 'neutral' })
  if (card.editor === 'latex' && card.runtime === 'browser-after-consent') badges.push({ id: 'consent', label: { en: 'Package download needed', bn: 'প্যাকেজ ডাউনলোড লাগবে' }, tone: 'notice' })
  if (card.credit?.adapted) badges.push({ id: 'adapted', label: { en: 'Adapted', bn: 'অভিযোজিত' }, tone: 'notice' })
  return badges
}

// ---------------------------------------------------------------------------
// Gallery query: the URL is the state (shareable, Back-button friendly).

export type GalleryQuery = {
  readonly editor: GalleryEditor
  readonly category: string
  readonly text: string
  readonly language: TemplateLanguage | null
  readonly columns: '1' | '2' | 'sidebar' | null
  readonly photo: 'yes' | 'no' | null
  readonly ats: boolean
  readonly onePage: boolean
  readonly browserReady: boolean
}

export const defaultGalleryQuery: GalleryQuery = { editor: 'regular', category: 'all', text: '', language: null, columns: null, photo: null, ats: false, onePage: false, browserReady: false }

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (value !== null && (allowed as readonly string[]).includes(value) ? value as T : null)

/** Unknown or hostile values fall back to defaults; they never reach the UI. */
export function parseGalleryQuery(params: URLSearchParams): GalleryQuery {
  const editor = pick(params.get('editor'), ['regular', 'latex'] as const) ?? 'regular'
  const category = params.get('category') ?? 'all'
  return {
    editor,
    category: category === 'all' || templateCategories[editor].some((item) => item.id === category) ? category : 'all',
    text: (params.get('q') ?? '').slice(0, 80),
    language: pick(params.get('lang'), ['bn', 'en', 'mixed'] as const),
    columns: pick(params.get('cols'), ['1', '2', 'sidebar'] as const),
    photo: pick(params.get('photo'), ['yes', 'no'] as const),
    ats: params.get('ats') === '1',
    onePage: params.get('pages') === '1',
    browserReady: editor === 'latex' && params.get('ready') === '1',
  }
}

export function serializeGalleryQuery(query: GalleryQuery): string {
  const params = new URLSearchParams()
  if (query.editor !== 'regular') params.set('editor', query.editor)
  if (query.category !== 'all') params.set('category', query.category)
  if (query.text.trim()) params.set('q', query.text.trim())
  if (query.language) params.set('lang', query.language)
  if (query.columns) params.set('cols', query.columns)
  if (query.photo) params.set('photo', query.photo)
  if (query.ats) params.set('ats', '1')
  if (query.onePage) params.set('pages', '1')
  if (query.browserReady && query.editor === 'latex') params.set('ready', '1')
  return params.toString()
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()

function matchesFilters(card: TemplateCard, query: GalleryQuery) {
  if (card.editor !== query.editor) return false
  if (query.language && card.language !== query.language) return false
  if (query.columns && String(card.columns) !== query.columns) return false
  if (query.photo && card.photo !== (query.photo === 'yes')) return false
  if (query.ats && !hasAtsStructure(card)) return false
  if (query.onePage && card.pages !== 1) return false
  if (query.browserReady && card.runtime !== 'browser') return false
  const terms = normalize(query.text).split(/\s+/u).filter(Boolean)
  if (!terms.length) return true
  const categories = templateCategories[card.editor].filter((item) => card.categories.includes(item.id)).map((item) => `${item.name.en} ${item.name.bn}`)
  const haystack = normalize([card.id, card.name.en, card.name.bn, card.summary.en, card.summary.bn, card.keywords, ...categories].join(' '))
  return terms.every((term) => haystack.includes(term))
}

export function filterTemplates(cards: readonly TemplateCard[], query: GalleryQuery) {
  return cards.filter((card) => matchesFilters(card, query) && (query.category === 'all' || card.categories.includes(query.category)))
}

/** Counts per category under the other active filters, so a chip never promises results it cannot show. */
export function categoryCounts(cards: readonly TemplateCard[], query: GalleryQuery): Record<string, number> {
  const base = cards.filter((card) => matchesFilters(card, query))
  const counts: Record<string, number> = { all: base.length }
  for (const category of templateCategories[query.editor]) counts[category.id] = base.filter((card) => card.categories.includes(category.id)).length
  return counts
}

export function activeFilterCount(query: GalleryQuery) {
  return [query.language, query.columns, query.photo].filter(Boolean).length + [query.ats, query.onePage, query.browserReady].filter(Boolean).length
}

// ---------------------------------------------------------------------------
// Deep links: /mr-resume/regular-editor?template=<id> and /mr-resume/latex?template=<id>

export type TemplateRequest = { readonly editor: GalleryEditor; readonly id: string; readonly sequence: number }
/** An allowlist per editor: a Regular id never reaches the LaTeX editor, and arbitrary text never reaches either. */
export function resolveTemplateRequest(editor: GalleryEditor, value: string | null, cards: readonly TemplateCard[]): { kind: 'template'; card: TemplateCard } | { kind: 'unknown' } | null {
  if (value === null || value === '') return null
  const card = cards.find((item) => item.editor === editor && item.id === value)
  return card ? { kind: 'template', card } : { kind: 'unknown' }
}

export function templateHref(editor: GalleryEditor, id: string) {
  return `${editor === 'regular' ? '/mr-resume/regular-editor' : '/mr-resume/latex'}?template=${encodeURIComponent(id)}`
}
