import type { SectionDividerConfig, ResumeHeadingIconSize } from './ResumeInspectorPanel.tsx'
import type { ResumeHeadingIconId } from './ResumeHeadingIcon.tsx'
import type { PhotoBackgroundId } from './photoBackground.ts'

export const RESUME_DRAFT_SCHEMA = 8
export const TEMPLATE_BACKUP_KEY = 'mr-resume:template-backup:v1'
export type ResumeDraft = {
  documentTitle: string; fullName: string
  purpose: 'Resume' | 'Career profile' | 'Academic CV' | 'Biodata' | 'Statement of purpose'
  enabled: string[]
  customSections: { id: string; title: string; detail: string; group: 'Core' | 'Additional' }[]
  content: Record<string, string>; titles: Record<string, string>
  sectionDividers: Record<string, SectionDividerConfig>; headingIcons: Record<string, ResumeHeadingIconId>
  headingIconSize: ResumeHeadingIconSize; headingIconCustomSize: number; headingIconColor: string
  language: 'English' | 'Bangla'; banglishMode: boolean; format: 'Visual' | 'LaTeX'
  pageSize: 'A4' | 'Letter'; font: string; fontSize: number; leading: number; sectionGap: number; margin: number
  accent: number; customAccentColor: string; profileAlign: 'left' | 'center' | 'right'
  profileImage: string | null; photoShape: 'circle' | 'square'; photoSize: number
  photoBackground: PhotoBackgroundId; photoBlur: number; photoCustomColor: string; profileImageDisplay: string | null
  templateId: string | null
}
type DraftOptions = { sectionIDs: readonly string[]; fonts: readonly string[]; photoBackgrounds: readonly string[]; headingIcons: readonly string[]; templates: readonly string[]; accentCount: number }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const image = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/u.test(value) && value.length <= 2500000

export function encodeResumeDraft(document: ResumeDraft, timestamp = new Date().toISOString()): string {
  return JSON.stringify({ schema: RESUME_DRAFT_SCHEMA, timestamp, document })
}

/** Legacy schemas add defaults; unknown schemas never overwrite the stored original. */
export function decodeResumeDraft(raw: string | null, defaults: ResumeDraft, options: DraftOptions): { document: ResumeDraft; timestamp: string | null } | null {
  if (!raw || raw.length > 6500000) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!object(saved) || !Number.isInteger(saved.schema) || (saved.schema as number) < 1 || (saved.schema as number) > RESUME_DRAFT_SCHEMA || !object(saved.document)) return null
    const data = saved.document
    const draft: ResumeDraft = { ...defaults, content: { ...defaults.content }, titles: {}, sectionDividers: {}, headingIcons: {}, customSections: [] }
    if (data.customSections !== undefined) {
      if (!Array.isArray(data.customSections) || data.customSections.length > 100) return null
      const ids = new Set(options.sectionIDs)
      for (const item of data.customSections) {
        if (!object(item) || typeof item.id !== 'string' || !/^custom-[a-z\d-]+$/iu.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || typeof item.detail !== 'string' || (item.group !== 'Core' && item.group !== 'Additional')) return null
        ids.add(item.id)
        draft.customSections.push({ id: item.id, title: item.title, detail: item.detail, group: item.group })
        draft.content[item.id] = ''
      }
    }
    const allowed = new Set([...options.sectionIDs, ...draft.customSections.map((item) => item.id)])
    if (data.enabled !== undefined) {
      if (!Array.isArray(data.enabled) || data.enabled.some((id) => typeof id !== 'string' || !allowed.has(id))) return null
      draft.enabled = ['profile', ...new Set(data.enabled.filter((id) => id !== 'profile'))]
    }
    for (const key of ['content', 'titles'] as const) {
      if (data[key] === undefined) continue
      if (!object(data[key]) || Object.values(data[key]).some((value) => typeof value !== 'string')) return null
      const entries = Object.entries(data[key]).filter(([id]) => allowed.has(id)) as [string, string][]
      draft[key] = { ...(key === 'content' ? draft.content : {}), ...Object.fromEntries(entries) }
    }
    for (const key of ['documentTitle', 'fullName'] as const) {
      if (data[key] === undefined) continue
      if (typeof data[key] !== 'string') return null
      draft[key] = data[key]
    }
    if (['Resume', 'Career profile', 'Academic CV', 'Biodata', 'Statement of purpose'].includes(String(data.purpose))) draft.purpose = data.purpose as ResumeDraft['purpose']
    if (data.language === 'Bangla' || data.language === 'English') draft.language = data.language
    if (typeof data.banglishMode === 'boolean') draft.banglishMode = data.banglishMode
    if (data.format === 'Visual' || data.format === 'LaTeX') draft.format = data.format
    if (data.pageSize === 'A4' || data.pageSize === 'Letter') draft.pageSize = data.pageSize
    if (typeof data.font === 'string' && options.fonts.includes(data.font)) draft.font = data.font
    const bounds = { fontSize: [10, 13], leading: [1.25, 1.9], sectionGap: [12, 32], margin: [12, 26], photoSize: [18, 48], photoBlur: [20, 100], headingIconCustomSize: [0.6, 1.8] } as const
    for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
      const value = data[key]
      if (finite(value)) draft[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], value))
    }
    if (finite(data.accent) && Number.isInteger(data.accent) && data.accent >= 0 && data.accent <= options.accentCount) draft.accent = data.accent
    if (hex(data.customAccentColor)) draft.customAccentColor = data.customAccentColor
    if (data.profileAlign === 'left' || data.profileAlign === 'center' || data.profileAlign === 'right') draft.profileAlign = data.profileAlign
    if (data.photoShape === 'circle' || data.photoShape === 'square') draft.photoShape = data.photoShape
    if (typeof data.photoBackground === 'string' && options.photoBackgrounds.includes(data.photoBackground)) draft.photoBackground = data.photoBackground as PhotoBackgroundId
    if (hex(data.photoCustomColor)) draft.photoCustomColor = data.photoCustomColor
    for (const key of ['profileImage', 'profileImageDisplay'] as const) if (data[key] === null || image(data[key])) draft[key] = data[key] as string | null
    if (['small', 'medium', 'large', 'custom'].includes(String(data.headingIconSize))) draft.headingIconSize = data.headingIconSize as ResumeHeadingIconSize
    if (data.headingIconColor === 'accent' || hex(data.headingIconColor)) draft.headingIconColor = data.headingIconColor
    if (object(data.headingIcons)) {
      draft.headingIcons = Object.fromEntries(Object.entries(data.headingIcons).filter(([id, value]) => allowed.has(id) && (value === 'none' || typeof value === 'string' && options.headingIcons.includes(value)))) as Record<string, ResumeHeadingIconId>
    }
    if (object(data.sectionDividers)) {
      for (const [id, item] of Object.entries(data.sectionDividers)) {
            if (!allowed.has(id) || !object(item) || typeof item.enabled !== 'boolean' || !['solid', 'dashed', 'dotted'].includes(String(item.style)) || (item.color !== 'accent' && !hex(item.color)) || !finite(item.thickness) || !(item.underHeading === undefined || typeof item.underHeading === 'boolean')) continue
        draft.sectionDividers[id] = { enabled: item.enabled, style: item.style as SectionDividerConfig['style'], color: item.color as string, thickness: Math.max(0.5, Math.min(2, item.thickness)), ...(item.underHeading ? { underHeading: true } : {}) }
      }
    }
    draft.templateId = typeof data.templateId === 'string' && options.templates.includes(data.templateId) ? data.templateId : null
    const timestamp = typeof saved.timestamp === 'string' && Number.isFinite(Date.parse(saved.timestamp)) ? saved.timestamp : null
    return { document: draft, timestamp }
  } catch { return null }
}
