/**
 * The Regular document, outside any component: the section catalog, page
 * sizes, typefaces and accents, the editor's starting draft, and how a
 * template (optionally with its specimen and a chosen design) becomes a draft.
 *
 * The editor (MrResumeStudio.tsx) and the gallery's live preview both build
 * their page from these, so the preview shows exactly the document "Start"
 * will open. Pure data and functions; imports keep their `.ts` extensions so
 * node:test can load this file without a bundler.
 */
import { bengaliTypefaces, latinTypefaces } from './resumeFonts.ts'
import type { ResumeDraft } from './resumeDraft.ts'
import { DEFAULT_RESUME_LAYOUT, resumeLayoutIds, type ResumeLayoutId } from './resumeLayouts.ts'
import { resumeSpecimen } from './resumeSpecimens.ts'
import type { ResumeTemplate } from './resumeTemplates.ts'
import { paperFontStack } from './resumeTypography.ts'

export type Purpose = ResumeDraft['purpose']
export type Section = { id: string; title: string; detail: string; group: 'Core' | 'Additional' }

export const sections: Section[] = [
  { id: 'profile', title: 'Profile', detail: 'Name, role & contact', group: 'Core' },
  { id: 'summary', title: 'Professional summary', detail: 'A concise introduction', group: 'Core' },
  { id: 'experience', title: 'Experience', detail: 'Roles & achievements', group: 'Core' },
  { id: 'education', title: 'Education', detail: 'Degrees & institutions', group: 'Core' },
  { id: 'skills', title: 'Skills', detail: 'Tools & strengths', group: 'Core' },
  { id: 'projects', title: 'Selected projects', detail: 'Work worth highlighting', group: 'Additional' },
  { id: 'personal', title: 'Personal details', detail: 'Location & background', group: 'Additional' },
  { id: 'motivation', title: 'Motivation', detail: 'Purpose & direction', group: 'Additional' },
  { id: 'languages', title: 'Languages', detail: 'Languages & proficiency', group: 'Additional' },
  { id: 'awards', title: 'Awards & certifications', detail: 'Verified recognition', group: 'Additional' },
  { id: 'publications', title: 'Publications', detail: 'Research & published work', group: 'Additional' },
  { id: 'volunteer', title: 'Volunteering', detail: 'Community contributions', group: 'Additional' },
  { id: 'references', title: 'References', detail: 'Professional referees', group: 'Additional' },
]

export const bengaliSectionTitles: Record<string, string> = {
  profile: '\u09aa\u09b0\u09bf\u099a\u09bf\u09a4\u09bf', summary: '\u09b8\u0982\u0995\u09cd\u09b7\u09bf\u09aa\u09cd\u09a4 \u09aa\u09b0\u09bf\u099a\u09af\u09bc', experience: '\u0995\u09b0\u09cd\u09ae-\u0985\u09ad\u09bf\u099c\u09cd\u099e\u09a4\u09be', education: '\u09b6\u09bf\u0995\u09cd\u09b7\u09be',
  skills: '\u09a6\u0995\u09cd\u09b7\u09a4\u09be', projects: '\u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa', personal: '\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09a4\u09a5\u09cd\u09af', motivation: '\u0989\u09a6\u09cd\u09a6\u09c7\u09b6\u09cd\u09af \u0993 \u0986\u0997\u09cd\u09b0\u09b9',
  languages: '\u09ad\u09be\u09b7\u09be', awards: '\u09aa\u09c1\u09b0\u09b8\u09cd\u0995\u09be\u09b0 \u0993 \u09b8\u09a8\u09a6', publications: '\u09aa\u09cd\u09b0\u0995\u09be\u09b6\u09a8\u09be', volunteer: '\u09b8\u09cd\u09ac\u09c7\u099a\u09cd\u099b\u09be\u09b8\u09c7\u09ac\u09be', references: '\u09b0\u09c7\u09ab\u09be\u09b0\u09c7\u09a8\u09cd\u09b8',
}

export const paperSizes = {
  A4: { width: 210 * 96 / 25.4, height: 297 * 96 / 25.4, dimensions: '210 x 297 mm', tex: 'a4paper' },
  Letter: { width: 816, height: 1056, dimensions: '8.5 x 11 in', tex: 'letterpaper' },
}

export const typefaces = [
  { name: 'Inter', family: 'inherit' },
  { name: 'Noto Sans Bengali', family: '"Noto Sans Bengali", sans-serif' },
  ...bengaliTypefaces,
  { name: 'Aptos', family: 'Aptos, "Segoe UI", sans-serif' },
  { name: 'Calibri', family: 'Calibri, "Segoe UI", sans-serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Cambria', family: 'Cambria, Georgia, serif' },
  { name: 'Garamond', family: 'Garamond, "Times New Roman", serif' },
  { name: 'Helvetica', family: 'Helvetica, Arial, sans-serif' },
  { name: 'Palatino Linotype', family: '"Palatino Linotype", Palatino, serif' },
  // After the classic serifs: the true TeX family behind the LaTeX-look template.
  ...latinTypefaces,
  { name: 'Arial', family: 'Arial, sans-serif' },
  { name: 'Times New Roman', family: '"Times New Roman", Times, serif' },
]

/** The editor's Page settings palette. Its order is stored in drafts (an index), so append only. */
export const accents = [
  { name: 'Forest', color: '#405444' }, { name: 'Violet', color: '#6753b5' },
  { name: 'Ocean', color: '#456f77' }, { name: 'Walnut', color: '#765a48' }, { name: 'Sage', color: '#567a61' },
]
/** The index a draft stores for "a colour outside the palette" (its hex lives in customAccentColor). */
export const CUSTOM_ACCENT = accents.length

// The photo frame bounds, in real paper millimetres. 30mm is the passport-style
// default; the floor keeps a sliver of portrait from vanishing at small sizes
// and the ceiling leaves the nameplate room to breathe beside it.
export const profilePhotoBounds = { min: 18, max: 48, initial: 30 }

const initialContent: Record<string, string> = {
  profile: 'Product designer · Dhaka, Bangladesh\nhello@example.com  ·  +880 1700 000 000',
  summary: 'Product designer with 6 years of experience turning complex workflows into clear, useful digital products. I partner with research and engineering to ship thoughtful experiences at scale.',
  experience: 'Senior Product Designer  ·  Northstar Studio\n2022 — Present\nLed the redesign of a multi-market onboarding journey, improving completion by 28%. Established a shared component library across 4 product teams.\n\nProduct Designer  ·  Fieldwork Labs\n2019 — 2022\nShaped research-led experiences for early-stage teams, from first prototype through production.',
  education: 'BFA, Visual Communication\nUniversity of Dhaka  ·  2015 — 2019',
  skills: 'Product strategy  ·  Interaction design  ·  Prototyping  ·  Design systems  ·  Figma  ·  User research',
  projects: 'Open source accessibility audit toolkit\nDesigned a practical checklist and reporting flow adopted by 12 community teams.',
  personal: 'Age · Marital status · Nationality\nFamily background · Current location',
  motivation: 'I am drawn to teams that make essential services easier to understand and more humane to use.',
  languages: '', awards: '', publications: '', volunteer: '', references: '',
}

/** What a first visit opens, and what "Start fresh" returns to. */
export const defaultResumeDraft: Readonly<ResumeDraft> = Object.freeze({
  documentTitle: 'Untitled resume', fullName: 'Ayesha Rahman', purpose: 'Resume',
  enabled: ['profile', 'summary', 'experience', 'education', 'skills'], customSections: [],
  content: initialContent, titles: {}, sectionDividers: {}, headingIcons: {},
  headingIconSize: 'medium', headingIconCustomSize: 1, headingIconColor: 'accent',
  language: 'English', banglishMode: false, format: 'Visual', pageSize: 'A4', font: 'Inter',
  fontSize: 11, leading: 1.5, sectionGap: 24, margin: 18, accent: 0, customAccentColor: accents[0].color,
  profileAlign: 'left', profileImage: null, photoShape: 'circle', photoSize: profilePhotoBounds.initial,
  photoBackground: 'none', photoBlur: 50, photoCustomColor: accents[0].color, profileImageDisplay: null,
  templateId: null, layout: DEFAULT_RESUME_LAYOUT,
})

// ---------------------------------------------------------------------------
// Design: the page arrangement and accent colour, chosen apart from the
// template's writing. "Corporate Sidebar" is a profession's outline set in one
// design; the gallery lets any outline, Bangla included, be set in any design.

/**
 * The colours a guest can pick in the gallery. The editor's palette first
 * (stored by index), then the deeper inks the professional templates use
 * (stored as a custom accent). Every one reads at ≥4.5:1 on white paper,
 * because headings are set in it (resumeDocument.test.ts measures this).
 */
export const designAccents = [
  ...accents,
  { name: 'Navy', color: '#2f4a6d' }, { name: 'Slate', color: '#2f3b52' }, { name: 'Cobalt', color: '#3159a8' },
] as const

export type TemplateDesign = { readonly layout: ResumeLayoutId; readonly accent: string }

const sameColour = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Unknown or hostile values fall back to the template's own design; they never reach a draft. */
export function parseTemplateDesign(params: URLSearchParams): Partial<TemplateDesign> {
  const layout = params.get('layout')
  const accent = params.get('accent')
  const colour = accent ? designAccents.find((item) => sameColour(item.color.slice(1), accent.replace(/^#/u, ''))) : undefined
  return {
    ...(layout && (resumeLayoutIds as readonly string[]).includes(layout) ? { layout: layout as ResumeLayoutId } : {}),
    ...(colour ? { accent: colour.color } : {}),
  }
}

export function serializeTemplateDesign(design: Partial<TemplateDesign>): string {
  const params = new URLSearchParams()
  if (design.layout) params.set('layout', design.layout)
  if (design.accent) params.set('accent', design.accent.replace(/^#/u, '').toLowerCase())
  return params.toString()
}

/** The design a template opens with when the guest has not chosen one. */
export function templateDesign(template: ResumeTemplate): TemplateDesign {
  return { layout: template.layout, accent: template.accentColor ?? accents[0].color }
}

/**
 * The draft a template opens as. `base` supplies what a template does not set
 * (heading-icon and photo preferences); `sample` swaps the bracketed prompts
 * for the template's specimen; `design` overrides only layout and accent.
 * The editor's Apply and the gallery preview both call this, so what the
 * preview shows is, field for field, what Apply writes.
 */
export function templateDocument(template: ResumeTemplate, base: ResumeDraft, options: { sample?: boolean; design?: Partial<TemplateDesign> } = {}): ResumeDraft {
  const specimen = options.sample ? resumeSpecimen(template.id) : undefined
  // Template-only register: an English preset writes English placeholders, sets
  // its own heading titles and accent, and asks for the thin under-heading
  // rules. Every field is optional — the existing presets fall back unchanged.
  const english = template.language === 'English'
  const accentColor = options.design?.accent ?? template.accentColor
  const accentIndex = accents.findIndex((item) => item.color === accentColor)
  return {
    ...base, documentTitle: template.name, fullName: specimen?.fullName ?? template.fullName, purpose: template.purpose,
    enabled: [...template.enabled], customSections: [],
    content: { ...Object.fromEntries(sections.map((section) => [section.id, ''])), ...(specimen?.content ?? template.content) },
    titles: template.titles ? { ...template.titles } : {},
    sectionDividers: template.rulesUnderHeadings ? Object.fromEntries(template.enabled.filter((id) => id !== 'profile').map((id) => [id, { enabled: true, style: 'solid' as const, color: '#1f1f1f', thickness: 0.6, underHeading: true }])) : {},
    headingIcons: {}, language: english ? 'English' : 'Bangla', banglishMode: !english, format: 'Visual', pageSize: 'A4', font: template.font,
    fontSize: template.settings?.fontSize ?? 11, leading: template.settings?.leading ?? 1.65, sectionGap: template.settings?.sectionGap ?? 24, margin: template.settings?.margin ?? 18,
    accent: accentColor ? (accentIndex >= 0 ? accentIndex : CUSTOM_ACCENT) : 0, customAccentColor: accentColor ?? base.customAccentColor,
    profileAlign: template.profileAlign ?? 'left', layout: options.design?.layout ?? template.layout,
    profileImage: null, profileImageDisplay: null, photoShape: 'square', photoSize: profilePhotoBounds.initial, photoBackground: 'none', templateId: template.id,
  }
}

// ---------------------------------------------------------------------------
// Reading a draft the way the page sets it.

export function accentColorOf(draft: Pick<ResumeDraft, 'accent' | 'customAccentColor'>): string {
  return draft.accent < accents.length ? accents[draft.accent].color : draft.customAccentColor
}

/** A section's heading: the guest's own title, then the language's, then the catalog's. */
export function sectionTitle(draft: Pick<ResumeDraft, 'titles' | 'language' | 'customSections'>, id: string): string {
  return draft.titles[id] ?? (draft.language === 'Bangla' ? bengaliSectionTitles[id] : undefined)
    ?? [...sections, ...draft.customSections].find((section) => section.id === id)?.title ?? 'Untitled section'
}

export function documentHasBangla(draft: Pick<ResumeDraft, 'fullName' | 'enabled' | 'content' | 'titles' | 'language' | 'customSections'>): boolean {
  return /[\u0980-\u09ff]/u.test([draft.fullName, ...draft.enabled.map((id) => `${sectionTitle(draft, id)} ${draft.content[id] ?? ''}`)].join('\n'))
}

export function fontFamilyOf(font: string): string {
  return typefaces.find((item) => item.name === font)?.family ?? 'inherit'
}

/** The stack the page is set in: Bangla always gets a real Bangla face behind the chosen Latin one. */
export function paperFontFamily(draft: Pick<ResumeDraft, 'font' | 'fullName' | 'enabled' | 'content' | 'titles' | 'language' | 'customSections'>): string {
  return paperFontStack(draft.font, fontFamilyOf(draft.font), draft.language === 'Bangla' || documentHasBangla(draft))
}
