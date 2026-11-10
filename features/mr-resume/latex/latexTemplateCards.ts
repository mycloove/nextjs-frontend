import type { TemplateCard } from '../components/templateCatalog.ts'

// Gallery metadata for the LaTeX editor. Deliberately free of TeX source so the
// home page never loads it: ids, engines and fixtures are cross-checked against
// templates.ts / archiveTemplates.ts by latexTemplateCards.test.ts.
// Mirrors the substitutions listed in the jakes-resume source header.
export const jakesResumeChanges = [
  'fullpage was replaced by geometry with the same 0.5 in margins; the matching \\addtolength margin lines were removed.',
  'fancyhdr was replaced by \\pagestyle{empty}, which produces the same empty header and footer.',
  'latexsym and marvosym (neither symbol set is used by the document) and babel (English hyphenation is the default) were removed.',
] as const

export const latexTemplateCards: readonly TemplateCard[] = [
  {
    id: 'career-source', editor: 'latex', engine: 'xelatex', runtime: 'browser', qualification: 'career-template-as-is',
    name: { en: 'Career resume', bn: 'ক্যারিয়ার রিজিউম' },
    summary: { en: 'Single-column resume with an editable style file.', bn: 'সম্পাদনাযোগ্য স্টাইল ফাইলসহ এক কলামের রিজিউম।' },
    categories: ['ats-onecol'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'career resume xelatex',
  },
  {
    id: 'compact-source', editor: 'latex', engine: 'pdflatex', runtime: 'browser', qualification: 'compact-template-as-is',
    name: { en: 'Compact one-page', bn: 'কম্প্যাক্ট এক পাতা' },
    summary: { en: 'Dense single column with ruled small-caps headings.', bn: 'রুল-টানা স্মল-ক্যাপস শিরোনামের ঘন এক কলাম।' },
    categories: ['ats-onecol'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'compact one page pdflatex',
  },
  {
    id: 'jakes-resume', editor: 'latex', engine: 'pdflatex', runtime: 'browser', qualification: 'jakes-resume-as-is',
    name: { en: "Jake's Resume", bn: 'জেকস রিজিউম' },
    summary: { en: 'The widely used single-column software resume, MIT licensed.', bn: 'বহুল ব্যবহৃত এক কলামের সফটওয়্যার রিজিউম, MIT লাইসেন্স।' },
    categories: ['ats-onecol'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'jake software developer overleaf popular',
    credit: { title: "Jake's Resume", author: 'Jake Gutierrez', license: 'MIT', url: 'https://github.com/jakegut/resume', revision: '3e64a933141a7cda3a328f0743f73a201628a4ba', adapted: true, changes: jakesResumeChanges },
  },
  {
    id: 'modern-source', editor: 'latex', engine: 'xelatex', runtime: 'browser', qualification: 'modern-template-as-is',
    name: { en: 'Modern professional', bn: 'আধুনিক প্রফেশনাল' },
    summary: { en: 'Latin Modern Sans, one accent colour and ruled headings.', bn: 'Latin Modern Sans, একটি রঙ ও রুল-টানা শিরোনাম।' },
    categories: ['modern', 'ats-onecol'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'modern professional sans colour',
  },
  {
    id: 'sidebar-source', editor: 'latex', engine: 'xelatex', runtime: 'browser', qualification: 'sidebar-template-as-is',
    name: { en: 'Sidebar resume', bn: 'সাইডবার রিজিউম' },
    summary: { en: 'Tinted contact and skills rail beside the main column.', bn: 'মূল কলামের পাশে রঙিন যোগাযোগ ও দক্ষতার কলাম।' },
    categories: ['sidebar', 'modern'], language: 'en', columns: 'sidebar', photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'sidebar two column',
  },
  {
    id: 'altacv', editor: 'latex', engine: 'lualatex', runtime: 'browser-after-consent', packageGroups: ['cv-layout', 'cv-fonts', 'bibliography'], qualification: 'altacv-gallery-lualatex',
    name: { en: 'AltaCV', bn: 'AltaCV' },
    summary: { en: 'The popular two-column CV class with icons, photo and a publications list.', bn: 'আইকন, ছবি ও প্রকাশনাসহ জনপ্রিয় দুই কলামের CV।' },
    categories: ['sidebar', 'modern', 'academic'], language: 'en', columns: 'sidebar', photo: true,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'altacv overleaf two column icons biber',
    credit: { title: 'AltaCV v1.7.4', author: 'LianTze Lim', license: 'LPPL-1.3c', url: 'https://github.com/liantze/AltaCV', revision: 'v1.7.4 (2025-07-30)', adapted: true,
      changes: ['AltaCV sources are unchanged.', 'The three sample icons were replaced by placeholder images, because their icon-set licence does not allow redistribution here.'] },
  },
  {
    id: 'academic-source', editor: 'latex', engine: 'xelatex', runtime: 'browser', qualification: 'academic-template-as-is',
    name: { en: 'Academic CV', bn: 'একাডেমিক CV' },
    summary: { en: 'Research CV with a classic BibTeX bibliography.', bn: 'ক্লাসিক BibTeX গ্রন্থপঞ্জিসহ গবেষণা CV।' },
    categories: ['academic'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'academic research phd bibtex publications',
  },
  {
    id: 'international-source', editor: 'latex', engine: 'pdflatex', runtime: 'browser', qualification: 'international-template-as-is',
    name: { en: 'International CV', bn: 'আন্তর্জাতিক CV' },
    summary: { en: 'European-style CV with dates in a left column.', bn: 'বাম কলামে সালসহ ইউরোপিয়ান ধাঁচের CV।' },
    categories: ['international', 'academic'], language: 'en', columns: 2, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'international european europass moderncv',
  },
  {
    id: 'bangla-source', editor: 'latex', engine: 'lualatex', runtime: 'browser', qualification: 'bangla-template-as-is',
    name: { en: 'Bangla / mixed script', bn: 'বাংলা / মিশ্র লিপি' },
    summary: { en: 'Unicode Bangla with HarfBuzz shaping and English spans.', bn: 'HarfBuzz দিয়ে ইউনিকোড বাংলা, সাথে ইংরেজি অংশ।' },
    categories: ['bangla'], language: 'mixed', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'bangla bengali বাংলা',
  },
  {
    id: 'bd-biodata-source', editor: 'latex', engine: 'lualatex', runtime: 'browser', qualification: 'bd-biodata-template-as-is',
    name: { en: 'Bangla biodata', bn: 'বাংলা বায়োডাটা' },
    summary: { en: 'Biodata with a photo frame, personal table and education grid.', bn: 'ছবির ঘর, ব্যক্তিগত তথ্য ও শিক্ষাগত যোগ্যতার টেবিলসহ বায়োডাটা।' },
    categories: ['bangla'], language: 'bn', columns: 1, photo: true,
    structure: { contactAsText: true, standardHeadings: true }, keywords: 'biodata government বায়োডাটা জীবনবৃত্তান্ত সরকারি',
  },
  {
    id: 'letter-source', editor: 'latex', engine: 'xelatex', runtime: 'browser', qualification: 'letter-template-as-is',
    name: { en: 'Cover letter', bn: 'কভার লেটার' },
    summary: { en: 'One-page letter that pairs with the resume starters.', bn: 'রিজিউমের সাথে মানানসই এক পাতার চিঠি।' },
    categories: ['letters'], language: 'en', columns: 1, photo: false,
    structure: { contactAsText: true, standardHeadings: false }, keywords: 'cover letter application আবেদন',
  },
]
