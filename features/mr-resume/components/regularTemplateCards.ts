import { editorText } from './editorLanguage.ts'
import { getResumeLayout } from './resumeLayouts.ts'
import { resumeTemplates } from './resumeTemplates.ts'
import type { TemplateCard } from './templateCatalog.ts'

// Gallery metadata for the Regular editor. Name, summary, language and columns
// are read from the real template and its layout, so a card cannot drift from
// what applying it produces. Only the gallery facts are authored here.
type RegularCardFacts = {
  readonly categories: readonly string[]
  /** The layout leaves room for, and the template asks for, a portrait. */
  readonly photo: boolean
  /** Headings are the conventional ones ATS parsers look for. */
  readonly standardHeadings: boolean
  readonly keywords: string
}

const facts: Readonly<Record<string, RegularCardFacts>> = {
  'job-resume': { categories: ['corporate'], photo: false, standardHeadings: true, keywords: 'job resume চাকরি রিজিউমে সিভি' },
  'government-biodata': { categories: ['government'], photo: true, standardHeadings: true, keywords: 'biodata government bcs সরকারি বায়োডাটা জীবনবৃত্তান্ত' },
  'teacher-cv': { categories: ['academic'], photo: false, standardHeadings: true, keywords: 'teacher school শিক্ষক শিক্ষকতা' },
  'engineering-cv': { categories: ['tech'], photo: false, standardHeadings: true, keywords: 'engineer প্রকৌশলী ইঞ্জিনিয়ার' },
  'fresh-graduate': { categories: ['fresher'], photo: false, standardHeadings: true, keywords: 'fresher graduate student ফ্রেশার স্নাতক ছাত্র' },
  'academic-research-cv': { categories: ['academic'], photo: false, standardHeadings: true, keywords: 'research phd publication গবেষণা প্রকাশনা' },
  'personal-biodata': { categories: ['personal'], photo: true, standardHeadings: true, keywords: 'biodata personal marriage ব্যক্তিগত বায়োডাটা' },
  'admission-sop': { categories: ['personal', 'academic'], photo: false, standardHeadings: true, keywords: 'sop statement admission scholarship ভর্তি উদ্দেশ্যপত্র' },
  'latex-classic': { categories: ['tech', 'academic'], photo: false, standardHeadings: true, keywords: 'latex classic tex ল্যাটেক্স' },
  'corporate-en': { categories: ['corporate'], photo: false, standardHeadings: true, keywords: 'corporate private office কর্পোরেট বেসরকারি' },
  'corporate-sidebar': { categories: ['corporate'], photo: false, standardHeadings: true, keywords: 'sidebar modern সাইডবার' },
  'bank-officer': { categories: ['government', 'corporate'], photo: true, standardHeadings: true, keywords: 'bank officer finance ব্যাংক অফিসার' },
  'bcs-biodata-en': { categories: ['government'], photo: true, standardHeadings: true, keywords: 'bcs government biodata psc সরকারি বিসিএস' },
  'fresher-en': { categories: ['fresher'], photo: false, standardHeadings: true, keywords: 'fresher internship graduate ইন্টার্নশিপ ফ্রেশার' },
  'software-engineer': { categories: ['tech', 'fresher'], photo: false, standardHeadings: true, keywords: 'software developer programmer it সফটওয়্যার ডেভেলপার' },
  'school-teacher-en': { categories: ['academic'], photo: false, standardHeadings: true, keywords: 'teacher school college শিক্ষক' },
  'creative-portfolio': { categories: ['creative'], photo: false, standardHeadings: false, keywords: 'designer portfolio writer media ডিজাইনার' },
  'marketing-sales': { categories: ['creative', 'corporate'], photo: false, standardHeadings: false, keywords: 'marketing sales মার্কেটিং সেলস' },
  'executive-leader': { categories: ['executive'], photo: false, standardHeadings: false, keywords: 'executive manager director ceo ব্যবস্থাপক' },
  'ngo-development': { categories: ['development'], photo: false, standardHeadings: true, keywords: 'ngo development programme donor এনজিও উন্নয়ন' },
  'healthcare-cv': { categories: ['healthcare'], photo: false, standardHeadings: true, keywords: 'doctor nurse medical hospital ডাক্তার নার্স চিকিৎসক' },
  'cover-letter-en': { categories: ['personal', 'corporate'], photo: false, standardHeadings: false, keywords: 'cover letter application কভার লেটার আবেদন' },
}

export const regularTemplateCards: readonly TemplateCard[] = resumeTemplates.map((template) => {
  const fact = facts[template.id]
  if (!fact) throw new Error(`Gallery facts are missing for Regular template ${template.id}`)
  const english = 'language' in template && template.language === 'English'
  return {
    id: template.id,
    editor: 'regular',
    name: { en: template.name, bn: editorText(template.name, 'Bangla') },
    summary: { en: template.detail, bn: editorText(template.detail, 'Bangla') },
    categories: fact.categories,
    language: english ? 'en' : 'bn',
    columns: getResumeLayout(template.layout).columns,
    photo: fact.photo,
    structure: { contactAsText: true, standardHeadings: fact.standardHeadings },
    keywords: `${fact.keywords} ${template.layout}`,
  }
})
