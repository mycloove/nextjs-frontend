'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode } from 'react'
import Link from 'next/link'
import styles from './MrResumeStudio.module.css'
import { Glyph, StudioDropdown, type GlyphName } from './MrResumeStudioControls'
import ResumeSectionPanel from './ResumeSectionPanel'
import ResumeInspectorPanel, { type ResumeInspectorPanelProps, type ResumeHeadingIconSize, type SectionDividerConfig } from './ResumeInspectorPanel'
import { ResumeHeadingIcon, resumeHeadingIconOptions, type ResumeHeadingIconId } from './ResumeHeadingIcon'
import { editorText, type EditorLanguage } from './editorLanguage'
import { applyPhotoBackground, blurPhotoBackground, isHexColor, photoBackgroundPlate, photoBackgrounds, type PhotoBackground, type PhotoBackgroundId } from './photoBackground'

type Purpose = 'Resume' | 'Career profile' | 'Academic CV' | 'Biodata' | 'Statement of purpose'
type ProfileAlign = 'left' | 'center' | 'right'
type PhotoShape = 'circle' | 'square'
type Section = { id: string; title: string; detail: string; group: 'Core' | 'Additional' }
type Panel = 'sections' | 'write' | 'preview' | 'settings'
type Drag = { id: string; pointerId: number; owner: HTMLButtonElement; startX: number; startY: number; x: number; y: number; target: string | null; placement: 'before' | 'after'; started: boolean; scroll: HTMLElement | null; frame: number | null }

const sections: Section[] = [
  { id: 'profile', title: 'Profile', detail: 'Name, role & contact', group: 'Core' },
  { id: 'summary', title: 'Professional summary', detail: 'A concise introduction', group: 'Core' },
  { id: 'experience', title: 'Experience', detail: 'Roles & achievements', group: 'Core' },
  { id: 'education', title: 'Education', detail: 'Degrees & institutions', group: 'Core' },
  { id: 'skills', title: 'Skills', detail: 'Tools & strengths', group: 'Core' },
  { id: 'projects', title: 'Selected projects', detail: 'Work worth highlighting', group: 'Additional' },
  { id: 'personal', title: 'Personal details', detail: 'Location & background', group: 'Additional' },
  { id: 'motivation', title: 'Motivation', detail: 'Purpose & direction', group: 'Additional' },
]

const initialContent: Record<string, string> = {
  profile: 'Product designer · Dhaka, Bangladesh\nhello@example.com  ·  +880 1700 000 000',
  summary: 'Product designer with 6 years of experience turning complex workflows into clear, useful digital products. I partner with research and engineering to ship thoughtful experiences at scale.',
  experience: 'Senior Product Designer  ·  Northstar Studio\n2022 — Present\nLed the redesign of a multi-market onboarding journey, improving completion by 28%. Established a shared component library across 4 product teams.\n\nProduct Designer  ·  Fieldwork Labs\n2019 — 2022\nShaped research-led experiences for early-stage teams, from first prototype through production.',
  education: 'BFA, Visual Communication\nUniversity of Dhaka  ·  2015 — 2019',
  skills: 'Product strategy  ·  Interaction design  ·  Prototyping  ·  Design systems  ·  Figma  ·  User research',
  projects: 'Open source accessibility audit toolkit\nDesigned a practical checklist and reporting flow adopted by 12 community teams.',
  personal: 'Age · Marital status · Nationality\nFamily background · Current location',
  motivation: 'I am drawn to teams that make essential services easier to understand and more humane to use.',
}

const purposes: Purpose[] = ['Resume', 'Career profile', 'Academic CV', 'Biodata', 'Statement of purpose']
const profileAligns: ProfileAlign[] = ['left', 'center', 'right']
// The glyph IS the setting: each button previews its own arrangement, so no
// wording has to teach what "left" applies to.
const alignGlyph: Record<ProfileAlign, GlyphName> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }
const paperSizes = {
  A4: { width: 210 * 96 / 25.4, height: 297 * 96 / 25.4, dimensions: '210 x 297 mm', tex: 'a4paper' },
  Letter: { width: 816, height: 1056, dimensions: '8.5 x 11 in', tex: 'letterpaper' },
}
const typefaces = [
  { name: 'Inter', family: 'inherit' },
  { name: 'Noto Sans Bengali', family: '"Noto Sans Bengali", sans-serif' },
  { name: 'Aptos', family: 'Aptos, "Segoe UI", sans-serif' },
  { name: 'Calibri', family: 'Calibri, "Segoe UI", sans-serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Cambria', family: 'Cambria, Georgia, serif' },
  { name: 'Garamond', family: 'Garamond, "Times New Roman", serif' },
  { name: 'Helvetica', family: 'Helvetica, Arial, sans-serif' },
  { name: 'Palatino Linotype', family: '"Palatino Linotype", Palatino, serif' },
  { name: 'Arial', family: 'Arial, sans-serif' },
  { name: 'Times New Roman', family: '"Times New Roman", Times, serif' },
]
const accents = [
  { name: 'Forest', color: '#405444' }, { name: 'Violet', color: '#6753b5' },
  { name: 'Ocean', color: '#456f77' }, { name: 'Walnut', color: '#765a48' }, { name: 'Sage', color: '#567a61' },
]
const spacingPresets = [
  { name: 'Compact', leading: 1.35, gap: 16 },
  { name: 'Balanced', leading: 1.5, gap: 24 },
  { name: 'Airy', leading: 1.7, gap: 28 },
]
type BulletStyle = { prefix: string; label: string; example: string }
const bulletStyles: BulletStyle[] = [
  { prefix: '- ', label: 'Dash', example: '- Bullet point' },
  { prefix: '• ', label: 'Dot', example: '• Bullet point' },
  { prefix: '→ ', label: 'Arrow', example: '→ Bullet point' },
  { prefix: '* ', label: 'Star', example: '* Bullet point' },
]
const bengaliSectionTitles: Record<string, string> = {
  profile: '\u09aa\u09b0\u09bf\u099a\u09bf\u09a4\u09bf', summary: '\u09b8\u0982\u0995\u09cd\u09b7\u09bf\u09aa\u09cd\u09a4 \u09aa\u09b0\u09bf\u099a\u09af\u09bc', experience: '\u0995\u09b0\u09cd\u09ae-\u0985\u09ad\u09bf\u099c\u09cd\u099e\u09a4\u09be', education: '\u09b6\u09bf\u0995\u09cd\u09b7\u09be',
  skills: '\u09a6\u0995\u09cd\u09b7\u09a4\u09be', projects: '\u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa', personal: '\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09a4\u09a5\u09cd\u09af', motivation: '\u0989\u09a6\u09cd\u09a6\u09c7\u09b6\u09cd\u09af \u0993 \u0986\u0997\u09cd\u09b0\u09b9',
}

// The photo frame bounds, in real paper millimetres. 30mm is the passport-style
// default; the floor keeps a sliver of portrait from vanishing at small sizes
// and the ceiling leaves the nameplate room to breathe beside it.
const profilePhotoBounds = { min: 18, max: 48, initial: 30 }
const initialSectionDivider: SectionDividerConfig = { enabled: false, style: 'solid', color: 'accent', thickness: 0.75 }

// Guest autosave. Module-owned key, never read or written by another module.
// Schema version bumps invalidate older blobs instead of guessing their shape.
const draftKey = 'mr-resume:draft:v1'
const editorLanguageKey = 'mr-resume:editor-language:v1'

// Exported files must describe themselves: a title like "Untitled resume" becomes
// `Untitled-resume` — and never an empty or mangled filename.
function slugFileBase(value: string) {
  return value.trim().replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
}

// A photo enters the draft only after it is re-encoded small enough to live in
// localStorage beside everything else: the source file is drawn through a
// canvas capped at 480px and saved as a JPEG (~tens of KB), never the raw
// upload. Everything stays on this device, like the rest of the draft.
function readProfilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new window.Image()
      image.onload = () => {
        const ratio = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
        const context = canvas.getContext('2d')
        if (!context) return reject(new Error('canvas unavailable'))
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      image.onerror = () => reject(new Error('unreadable image'))
      image.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('unreadable file'))
    reader.readAsDataURL(file)
  })
}

function escapeLatex(value: string) {
  return [...value].map((character) => {
    switch (character) {
      case '\\': return '\\textbackslash{}'
      case '&': return '\\&'
      case '%': return '\\%'
      case '$': return '\\$'
      case '#': return '\\#'
      case '_': return '\\_'
      case '{': return '\\{'
      case '}': return '\\}'
      case '~': return '\\textasciitilde{}'
      case '^': return '\\textasciicircum{}'
      default: return character
    }
  }).join('')
}

type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlinePart[] }
  | { kind: 'italic'; children: InlinePart[] }
  | { kind: 'link'; children: InlinePart[]; href: string }

function safeResumeHref(value: string) {
  const href = value.trim()
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href
  if (/^www\./i.test(href)) return `https://${href}`
  return null
}

function parseInline(value: string): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern = /\*\*([^*\n]+)\*\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^()\s]+)\)/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ kind: 'text', text: value.slice(cursor, index) })
    if (match[1] !== undefined) parts.push({ kind: 'bold', children: parseInline(match[1]) })
    else if (match[2] !== undefined) parts.push({ kind: 'italic', children: parseInline(match[2]) })
    else {
      const href = safeResumeHref(match[4])
      parts.push(href ? { kind: 'link', children: parseInline(match[3]), href } : { kind: 'text', text: match[0] })
    }
    cursor = index + match[0].length
  }
  if (cursor < value.length) parts.push({ kind: 'text', text: value.slice(cursor) })
  return parts
}

function inlinePartsLatex(parts: InlinePart[]): string {
  return parts.map((part) => {
    if (part.kind === 'text') return escapeLatex(part.text)
    const children = inlinePartsLatex(part.children)
    if (part.kind === 'bold') return `\\textbf{${children}}`
    if (part.kind === 'italic') return `\\emph{${children}}`
    return `\\href{${escapeLatex(part.href)}}{${children}}`
  }).join('')
}

function inlineLatex(value: string) {
  return inlinePartsLatex(parseInline(value))
}

function contentBlocks(value: string) {
  return value.split(/\n\s*\n/).flatMap((paragraph) => {
    const blocks: { list: 'bullet' | 'numbered' | null; lines: string[] }[] = []
    for (const line of paragraph.split('\n')) {
      const list = /^\d+\. /u.test(line) ? 'numbered' : /^[-•→*] /u.test(line) ? 'bullet' : null
      const previous = blocks[blocks.length - 1]
      if (previous?.list === list) previous.lines.push(line)
      else blocks.push({ list, lines: [line] })
    }
    return blocks
  })
}

function SectionText({ value }: { value: string }) {
  const renderParts = (parts: InlinePart[], keyPrefix: string): ReactNode[] => parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.kind === 'bold') return <strong key={key}>{renderParts(part.children, key)}</strong>
    if (part.kind === 'italic') return <em key={key}>{renderParts(part.children, key)}</em>
    if (part.kind === 'link') return <a key={key} href={part.href} target="_blank" rel="noreferrer">{renderParts(part.children, key)}</a>
    return <span key={key}>{part.text}</span>
  })
  const renderInline = (text: string, keyPrefix: string) => renderParts(parseInline(text), keyPrefix)

  return contentBlocks(value).map((block, index) => block.list === 'numbered'
    ? <ol key={index}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^\d+\. /u, ''), `list-${index}-${lineIndex}`)}</li>)}</ol>
    : block.list === 'bullet'
      ? <ul key={index}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.slice(2), `list-${index}-${lineIndex}`)}</li>)}</ul>
      : <p key={index}>{renderInline(block.lines.join('\n'), `paragraph-${index}`)}</p>)
}

export default function MrResumeStudio() {
  const [documentTitle, setDocumentTitle] = useState('Untitled resume')
  const [fullName, setFullName] = useState('Ayesha Rahman')
  const [purpose, setPurpose] = useState<Purpose>('Resume')
  const [enabled, setEnabled] = useState<string[]>(['profile', 'summary', 'experience', 'education', 'skills'])
  const [customSections, setCustomSections] = useState<Section[]>([])
  const [active, setActive] = useState('profile')
  const [content, setContent] = useState(initialContent)
  const [sectionDividers, setSectionDividers] = useState<Record<string, SectionDividerConfig>>({})
  const [headingIcons, setHeadingIcons] = useState<Record<string, ResumeHeadingIconId>>({})
  const [headingIconSize, setHeadingIconSize] = useState<ResumeHeadingIconSize>('medium')
  const [headingIconCustomSize, setHeadingIconCustomSize] = useState(1)
  const [headingIconCustomSizeDraft, setHeadingIconCustomSizeDraft] = useState('1.00')
  const [headingIconColor, setHeadingIconColor] = useState<'accent' | string>('accent')
  const textHistoryRef = useRef(new Map<string, { undo: string[]; redo: string[]; current: string; lastEditAt: number }>())
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState<'English' | 'Bangla'>('English')
  const [editorLanguage, setEditorLanguage] = useState<EditorLanguage>('English')
  // Banglish typing (আ toggle) — additive document state, schema 7. Leaving it
  // off keeps every letter exactly as typed, so English-only guests lose nothing.
  const [banglishMode, setBanglishMode] = useState(false)
  const [format, setFormat] = useState<'Visual' | 'LaTeX'>('Visual')
  const [inspector, setInspector] = useState<'section' | 'page'>('section')
  const [mobilePanel, setMobilePanel] = useState<Panel>('write')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [pageSize, setPageSize] = useState<keyof typeof paperSizes>('A4')
  const [font, setFont] = useState('Inter')
  const [fontSize, setFontSize] = useState(11)
  const [leading, setLeading] = useState(1.5)
  const [leadingDraft, setLeadingDraft] = useState('1.50')
  const [sectionGap, setSectionGap] = useState(24)
  const [sectionGapDraft, setSectionGapDraft] = useState('24')
  const [margin, setMargin] = useState(18)
  const [marginDraft, setMarginDraft] = useState('18')
  const [zoom, setZoom] = useState<number | null>(null)
  const [stageWidth, setStageWidth] = useState(680)
  const [paperHeight, setPaperHeight] = useState(paperSizes.A4.height)
  const [accent, setAccent] = useState(0)
  const [customAccentColor, setCustomAccentColor] = useState(accents[0].color)
  const CUSTOM_ACCENT = accents.length
  // Document header identity: authored composition. Alignment drives the whole
  // nameplate layout (text edge, photo side); the photo is an optional portrait.
  const [profileAlign, setProfileAlign] = useState<ProfileAlign>('left')
  const [profileImage, setProfileImage] = useState<string | null>(null)
  // Photo studio: the frame answers three questions — shape, size (paper mm),
  // and which palette plate replaces the photo's own backdrop. `profileImage`
  // stays the untouched ingest capture; `profileImageDisplay` is the treated
  // photo the canvas and inspector show, and it is persisted so a restored
  // session paints the finished result at once.
  const [photoShape, setPhotoShape] = useState<PhotoShape>('circle')
  const [photoSize, setPhotoSize] = useState(profilePhotoBounds.initial)
  const [photoBackground, setPhotoBackground] = useState<PhotoBackgroundId>('none')
  // Blur and custom carry their own dials: blur softness (percent of the 480px
  // bake scale) and the picked hex tint. Both start on the document accent so a
  // freshly picked tint sits on the sheet without touching Page settings.
  const [photoBlur, setPhotoBlur] = useState(50)
  const [photoCustomColor, setPhotoCustomColor] = useState(accents[0].color)
  const [profileImageDisplay, setProfileImageDisplay] = useState<string | null>(null)
  const [photoResizing, setPhotoResizing] = useState(false)
  const [notice, setNotice] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const [dragging, setDragging] = useState<Pick<Drag, 'id' | 'x' | 'y' | 'target' | 'placement'> | null>(null)
  const [bulletStyle, setBulletStyle] = useState<BulletStyle>(bulletStyles[0])
  const [bulletMenuOpen, setBulletMenuOpen] = useState(false)
  // Draft autosave state: `fresh` until the first write, `saved` with a timestamp
  // after it, `unavailable` when this browser refuses localStorage writes.
  const [saveState, setSaveState] = useState<'fresh' | 'saved' | 'unavailable'>('fresh')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [confirmFresh, setConfirmFresh] = useState(false)
  // Registration feel: a counter that re-mounts the settle element so the
  // bracket visibly draws in on every section selection (see RegistrationSettle).
  const [selectionPulse, setSelectionPulse] = useState(0)
  // FLIP reorder continuity: capture positions before an order change, then
  // animate from the previous slot after React commits the new order.
  const [flipTick, setFlipTick] = useState(0)
  const flipBeforeRef = useRef<Map<string, DOMRect> | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTriggerRef = useRef<HTMLButtonElement>(null)
  const photoScrollRef = useRef<{ windowY: number; inspectorTop: number } | null>(null)
  const sectionTabRef = useRef<HTMLButtonElement>(null)
  const pageTabRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<Drag | null>(null)
  // Photo corner-handle drag: pointer id, start position/size and the display
  // scale so screen pixels convert back to paper millimetres while it runs.
  const photoResizeRef = useRef<{ pointerId: number; startX: number; startY: number; startSize: number; scale: number } | null>(null)
  const printStyleRef = useRef<HTMLStyleElement | null>(null)
  const titleBeforePrint = useRef('')
  const catalog = [...sections, ...customSections]
  const currentSection = catalog.find((section) => section.id === active) || sections[0]
  const activeIndex = enabled.indexOf(active)
  const size = paperSizes[pageSize]
  const fitZoom = Math.max(20, Math.min(100, Math.floor(stageWidth / size.width * 100)))
  const displayZoom = zoom ?? fitZoom
  const scale = displayZoom / 100
  const fontFamily = typefaces.find((item) => item.name === font)!.family
  const title = (id: string) => titles[id] ?? (language === 'Bangla' ? bengaliSectionTitles[id] : undefined) ?? catalog.find((section) => section.id === id)!.title
  const tx = (value: string) => editorText(value, editorLanguage)
  // Document-resident strings (kicker, empty-state notes) follow the RESUME
  // language, not the editor chrome language — the paper speaks what the
  // paper is written in.
  const cx = (value: string) => editorText(value, language)
  const editorTitle = (id: string) => titles[id] ?? tx(catalog.find((section) => section.id === id)?.title ?? 'Untitled section')

  useEffect(() => {
    try {
      const savedLanguage = window.localStorage.getItem(editorLanguageKey)
      if (savedLanguage === 'English' || savedLanguage === 'Bangla') setEditorLanguage(savedLanguage)
    } catch { /* Language preference is optional; the editor remains usable. */ }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem(editorLanguageKey, editorLanguage) }
    catch { /* A blocked preference store does not affect resume drafts. */ }
  }, [editorLanguage])
  // The canvas shows the treated photo once a bake lands, the original otherwise.
  const photoSrc = profileImageDisplay ?? profileImage

  // Fit responds to the actual stage, while zoom never changes document typography.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setStageWidth(entry.contentRect.width)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const paper = paperRef.current
    if (!paper) return
    const observer = new ResizeObserver(() => {
      if (paper.offsetHeight > 0) setPaperHeight(paper.offsetHeight)
    })
    observer.observe(paper)
    return () => observer.disconnect()
  }, [format])

  useEffect(() => {
    if (focusRequest) titleRef.current?.focus()
  }, [focusRequest])

  // Reveal the actual selected block inside the stage, not the whole browser page.
  useEffect(() => {
    if (format !== 'Visual') return
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current
      const block = paperRef.current?.querySelector<HTMLElement>(`[data-paper-section="${active}"]`)
      if (!stage?.clientHeight || !block) return
      const viewport = stage.getBoundingClientRect()
      const bounds = block.getBoundingClientRect()
      if (bounds.top < viewport.top + 32 || bounds.bottom > viewport.bottom - 32) {
        stage.scrollTop += bounds.top - viewport.top - 32
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, enabled, format, mobilePanel])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Bake the chosen background preset into the displayed photo. Always re-bakes
  // from the stored original (never the previous bake), so switching presets or
  // nudging the blur slider never compounds quality loss, and re-bakes when the
  // document accent changes under the accent preset. A failing mask keeps the
  // original pixels and says so, instead of quietly showing a half-replaced
  // photograph. Blur and custom resolve their plate at bake time: blur carries
  // its percentage, custom the picked hex (validated before the pipeline runs).
  useEffect(() => {
    if (!profileImage) {
      setProfileImageDisplay(null)
      return
    }
    if (photoBackground === 'none') {
      setProfileImageDisplay(profileImage)
      return
    }
    if (photoBackground === 'custom' && !isHexColor(photoCustomColor)) {
      setProfileImageDisplay(profileImage)
      return
    }
    let cancelled = false
    const bake = photoBackground === 'blur'
      ? blurPhotoBackground(profileImage, photoBlur)
      : applyPhotoBackground(profileImage, photoBackground === 'custom' ? photoCustomColor : photoBackgroundPlate(photoBackground, accent < accents.length ? accents[accent].color : customAccentColor))
    bake
      .then((image) => { if (!cancelled) setProfileImageDisplay(image) })
      .catch(() => {
        if (cancelled) return
        setProfileImageDisplay(profileImage)
        setNotice("That photo's backdrop is too busy to separate cleanly — the original was kept. Try a plainer backdrop.")
      })
    return () => { cancelled = true }
  }, [profileImage, photoBackground, accent, photoBlur, photoCustomColor])

  useEffect(() => () => {
    if (dragRef.current?.frame != null) cancelAnimationFrame(dragRef.current.frame)
  }, [])

  // Restore the saved draft exactly once, before any write-back can happen.
  // A wrong-shaped blob is ignored, never partially applied. `restored`
  // becomes true on every path — a first-run guest must still autosave.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftKey) || 'null')
      // Schema 2 added the header identity fields; schema 3 adds the photo
      // studio (shape, size, background preset, blur/custom dials, baked
      // display photo); schema 4 adds per-section divider styling; schema 5
      // adds heading icon choices and their shared size/color; schema 6 adds
      // the precise custom heading icon scale; schema 7 adds the additive
      // Banglish-typing (আ) flag.
      // Older documents restore unchanged and keep the new defaults.
      if (saved && typeof saved === 'object' && [1, 2, 3, 4, 5, 6, 7].includes(saved.schema) && typeof saved.document === 'object' && saved.document) {
        const draft = saved.document
        const clock = typeof saved.timestamp === 'string' ? saved.timestamp : null
        if (typeof draft.documentTitle === 'string') setDocumentTitle(draft.documentTitle)
        if (typeof draft.fullName === 'string') setFullName(draft.fullName)
        if (typeof draft.purpose === 'string' && (purposes as string[]).includes(draft.purpose)) setPurpose(draft.purpose as Purpose)
        if (Array.isArray(draft.enabled) && draft.enabled.every((item: unknown) => typeof item === 'string')) {
          const ids = draft.enabled as string[]
          setEnabled(ids.includes('profile') ? ids : ['profile', ...ids])
        }
        if (Array.isArray(draft.customSections) && draft.customSections.every((item: unknown) => typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string')) setCustomSections(draft.customSections as Section[])
        if (typeof draft.content === 'object' && draft.content !== null) {
          const savedContent = Object.fromEntries(Object.entries(draft.content as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>
          setContent((current) => ({ ...current, ...savedContent }))
        }
        if (typeof draft.sectionDividers === 'object' && draft.sectionDividers !== null) {
          const validDividers = Object.fromEntries(Object.entries(draft.sectionDividers as Record<string, unknown>).flatMap(([id, value]) => {
            if (!value || typeof value !== 'object') return []
            const divider = value as Partial<SectionDividerConfig>
            if (typeof divider.enabled !== 'boolean' || !['solid', 'dashed', 'dotted'].includes(divider.style ?? '') || (divider.color !== 'accent' && !(typeof divider.color === 'string' && isHexColor(divider.color))) || typeof divider.thickness !== 'number' || !Number.isFinite(divider.thickness)) return []
            return [[id, { enabled: divider.enabled, style: divider.style!, color: divider.color!, thickness: Math.max(0.5, Math.min(2, divider.thickness)) }]]
          })) as Record<string, SectionDividerConfig>
          setSectionDividers(validDividers)
        }
        if (typeof draft.headingIcons === 'object' && draft.headingIcons !== null) {
          const validIds = new Set(resumeHeadingIconOptions.map((item) => item.id))
          setHeadingIcons(Object.fromEntries(Object.entries(draft.headingIcons as Record<string, unknown>).filter(([, value]) => value === 'none' || (typeof value === 'string' && validIds.has(value as Exclude<ResumeHeadingIconId, 'none'>))) as [string, ResumeHeadingIconId][]))
        }
        if (draft.headingIconSize === 'small' || draft.headingIconSize === 'medium' || draft.headingIconSize === 'large' || draft.headingIconSize === 'custom') setHeadingIconSize(draft.headingIconSize)
        if (typeof draft.headingIconCustomSize === 'number' && Number.isFinite(draft.headingIconCustomSize)) {
          const size = Math.round(Math.max(0.6, Math.min(1.8, draft.headingIconCustomSize)) * 100) / 100
          setHeadingIconCustomSize(size)
          setHeadingIconCustomSizeDraft(size.toFixed(2))
        }
        if (draft.headingIconColor === 'accent' || (typeof draft.headingIconColor === 'string' && isHexColor(draft.headingIconColor))) setHeadingIconColor(draft.headingIconColor)
        if (typeof draft.titles === 'object' && draft.titles !== null) {
          setTitles(Object.fromEntries(Object.entries(draft.titles as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>)
        }
        if (draft.language === 'Bangla' || draft.language === 'English') setLanguage(draft.language)
        if (draft.banglishMode === true) setBanglishMode(true)
        if (draft.format === 'Visual' || draft.format === 'LaTeX') setFormat(draft.format)
        if (typeof draft.pageSize === 'string' && draft.pageSize in paperSizes) setPageSize(draft.pageSize as keyof typeof paperSizes)
        if (typeof draft.font === 'string' && typefaces.some((item) => item.name === draft.font)) setFont(draft.font)
        if (typeof draft.fontSize === 'number' && Number.isFinite(draft.fontSize)) setFontSize(Math.max(10, Math.min(13, draft.fontSize)))
        if (typeof draft.leading === 'number' && Number.isFinite(draft.leading)) { const value = Math.max(1.25, Math.min(1.9, draft.leading)); setLeading(value); setLeadingDraft(value.toFixed(2)) }
        if (typeof draft.sectionGap === 'number' && Number.isFinite(draft.sectionGap)) { const value = Math.max(12, Math.min(32, draft.sectionGap)); setSectionGap(value); setSectionGapDraft(String(value)) }
        if (typeof draft.margin === 'number' && Number.isFinite(draft.margin)) { const value = Math.max(12, Math.min(26, draft.margin)); setMargin(value); setMarginDraft(String(value)) }
        if (typeof draft.accent === 'number' && Number.isInteger(draft.accent) && draft.accent >= 0 && draft.accent <= accents.length) setAccent(draft.accent)
        if (typeof draft.customAccentColor === 'string' && isHexColor(draft.customAccentColor)) setCustomAccentColor(draft.customAccentColor)
        if (typeof draft.profileAlign === 'string' && (profileAligns as string[]).includes(draft.profileAlign)) setProfileAlign(draft.profileAlign as ProfileAlign)
        if (typeof draft.profileImage === 'string' && draft.profileImage.startsWith('data:image/') && draft.profileImage.length <= 2500000) setProfileImage(draft.profileImage)
        if (draft.photoShape === 'circle' || draft.photoShape === 'square') setPhotoShape(draft.photoShape)
        if (typeof draft.photoSize === 'number' && Number.isFinite(draft.photoSize)) setPhotoSize(Math.max(profilePhotoBounds.min, Math.min(profilePhotoBounds.max, draft.photoSize)))
        if (typeof draft.photoBackground === 'string' && photoBackgrounds.some((preset) => preset.id === draft.photoBackground)) setPhotoBackground(draft.photoBackground as PhotoBackgroundId)
        if (typeof draft.photoBlur === 'number' && Number.isFinite(draft.photoBlur)) setPhotoBlur(Math.max(20, Math.min(100, draft.photoBlur)))
        if (typeof draft.photoCustomColor === 'string' && isHexColor(draft.photoCustomColor)) setPhotoCustomColor(draft.photoCustomColor)
        if (typeof draft.profileImageDisplay === 'string' && draft.profileImageDisplay.startsWith('data:image/') && draft.profileImageDisplay.length <= 2500000) setProfileImageDisplay(draft.profileImageDisplay)
        setSaveState('saved')
        setSavedAt(clock)
        setNotice('Draft restored — it was saved on this device.')
      }
    } catch {
      setSaveState('unavailable')
    } finally {
      setRestored(true)
    }
  }, [])

  // Persist the draft (debounced). Uses only module state; storage errors flip
  // the save chip to `unavailable` instead of retrying forever or throwing.
  useEffect(() => {
    if (!restored || saveState === 'unavailable') return
    const handle = window.setTimeout(() => {
      const payload = {
        schema: 7,
        timestamp: new Date().toISOString(),
        document: {
          documentTitle, fullName, purpose, enabled, customSections, content, titles, sectionDividers,
          headingIcons, headingIconSize, headingIconCustomSize, headingIconColor,
          language, banglishMode, format, pageSize, font, fontSize, leading, sectionGap, margin, accent, customAccentColor,
          profileAlign, profileImage, photoShape, photoSize, photoBackground, photoBlur, photoCustomColor, profileImageDisplay,
        },
      }
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(payload))
        setSaveState('saved')
        setSavedAt(payload.timestamp)
      } catch {
        setSaveState('unavailable')
      }
    }, 700)
    return () => window.clearTimeout(handle)
  }, [restored, saveState, documentTitle, fullName, purpose, enabled, customSections, content, titles, sectionDividers, headingIcons, headingIconSize, headingIconCustomSize, headingIconColor, language, banglishMode, format, pageSize, font, fontSize, leading, sectionGap, margin, accent, customAccentColor, profileAlign, profileImage, photoShape, photoSize, photoBackground, photoBlur, photoCustomColor, profileImageDisplay])

  // "Start fresh" asks once, then stands down if left unanswered.
  useEffect(() => {
    if (!confirmFresh) return
    const timer = window.setTimeout(() => setConfirmFresh(false), 5000)
    return () => window.clearTimeout(timer)
  }, [confirmFresh])

  // Print teardown owns the injected @page rule and the temporary document
  // title (the browser uses it as the suggested "Save as PDF" filename).
  // window.print() blocks, so the finally-path also covers engines without
  // a usable `afterprint` event.
  function revertPrintSetup() {
    if (printStyleRef.current) {
      printStyleRef.current.remove()
      printStyleRef.current = null
    }
    if (titleBeforePrint.current) {
      document.title = titleBeforePrint.current
      titleBeforePrint.current = ''
    }
  }

  // Suspend any in-flight FLIP animation. New user intent (a drag, a reorder)
  // always wins: rows snap to their settled slot so hit-testing uses real
  // geometry instead of mid-flight positions.
  function stopFlip() {
    document.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()))
  }

  // Capture the current slots of every flip-tracked element. Runs synchronously
  // inside the event handler, before the reorder state commits to the DOM.
  function beginFlip() {
    if (typeof Element.prototype.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    stopFlip()
    const map = new Map<string, DOMRect>()
    document.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => {
      if (element.dataset.flipKey) map.set(element.dataset.flipKey, element.getBoundingClientRect())
    })
    flipBeforeRef.current = map
  }

  // FLIP continuity: the outlined rows and their paper twins slide from their
  // previous slot to the new one on the same 260ms house curve — two synced
  // rails, so outline and document visibly stay one document. Fully static
  // under reduced motion (beginFlip captures nothing in that case).
  useEffect(() => {
    const before = flipBeforeRef.current
    if (!before) return
    flipBeforeRef.current = null
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => {
        const key = element.dataset.flipKey
        if (!key) return
        const previous = before.get(key)
        if (!previous) {
          element.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
          return
        }
        const current = element.getBoundingClientRect()
        const dx = previous.left - current.left
        const dy = previous.top - current.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [flipTick])

  useEffect(() => {
    window.addEventListener('afterprint', revertPrintSetup)
    return () => {
      window.removeEventListener('afterprint', revertPrintSetup)
      revertPrintSetup()
    }
  }, [])

  const latex = useMemo(() => {
    const headingIconLatex = (id: string) => {
      const iconId = headingIcons[id]
      if (!iconId || iconId === 'none') return ''
      const icon = resumeHeadingIconOptions.find((item) => item.id === iconId)
      if (!icon) return ''
      const color = headingIconColor === 'accent' ? (accent < accents.length ? accents[accent].color : customAccentColor) : headingIconColor
      const sizeFactor = headingIconSize === 'small' ? 0.82 : headingIconSize === 'large' ? 1.18 : headingIconSize === 'custom' ? headingIconCustomSize : 1
      const iconSize = (fontSize * 0.82 * sizeFactor).toFixed(2)
      return `{\\textcolor[HTML]{${color.slice(1).toUpperCase()}}{\\fontsize{${iconSize}pt}{${iconSize}pt}\\selectfont${icon.latex}}\\hspace{.58em}}`
    }
    const dividerLatex = (id: string) => {
      const divider = sectionDividers[id]
      if (!divider?.enabled) return ''
      const color = divider.color === 'accent' ? (accent < accents.length ? accents[accent].color : customAccentColor) : divider.color
      const pattern = divider.style === 'dashed' ? '3pt 2pt' : '0.65pt 1.7pt'
      const rule = divider.style === 'solid'
        ? `\\rule{\\linewidth}{${divider.thickness}pt}`
        : `\\hdashrule{\\linewidth}{${divider.thickness}pt}{${pattern}}`
      return `\\par\\vspace{4pt}{\\color[HTML]{${color.slice(1).toUpperCase()}}${rule}}\\par\\vspace{4pt}`
    }
    const serialize = (value: string) => contentBlocks(value).map((block) => {
      return block.list
        ? `\\begin{${block.list === 'numbered' ? 'enumerate' : 'itemize'}}[leftmargin=*,nosep]\n${block.lines.map((line) => `\\item ${inlineLatex(block.list === 'numbered' ? line.replace(/^\d+\. /u, '') : line.slice(2))}`).join('\n')}\n\\end{${block.list === 'numbered' ? 'enumerate' : 'itemize'}}`
        : block.lines.map(inlineLatex).join('\\\\\n')
    }).join('\n\n')
    const allSections = [...sections, ...customSections]
    const lines = enabled.filter((id) => id !== 'profile').map((id) => {
      const heading = titles[id] ?? (language === 'Bangla' ? bengaliSectionTitles[id] : undefined) ?? allSections.find((item) => item.id === id)!.title
      return `\\section*{${headingIconLatex(id)}${escapeLatex(heading)}}\n${serialize(content[id])}${dividerLatex(id) ? `\n\n${dividerLatex(id)}` : ''}`
    })
    const hasHeadingIcons = enabled.some((id) => id !== 'profile' && headingIcons[id] && headingIcons[id] !== 'none')
    const languageSetup = language === 'Bangla'
      ? '\\usepackage{polyglossia}\n\\setdefaultlanguage{bengali}\n\\newfontfamily\\bengalifont[Script=Bengali]{Noto Sans Bengali}'
      : ''
    // The nameplate mirrors the visual draft: the chosen alignment edge carries
    // the text and a photo (when set) always balances the opposite edge — center
    // stacks the photo above. The frame follows the studio's shape/size
    // settings in real mm, so the compiled final agrees with the preview. A
    // .tex file cannot know the source photo's aspect, so the picture is placed
    // oversized (twice the frame width) inside a shape-clipped tikz node
    // (path picture) — the same centered cover-crop the preview shows. The
    // photo is referenced as profile-photo.jpg beside the source, guarded by
    // IfFileExists: the source compiles either way, with an honest named
    // placeholder when the file is absent.
    const alignCommand: Record<ProfileAlign, string> = { left: '\\raggedright', center: '\\centering', right: '\\raggedleft' }
    const nameLine = `{\\LARGE\\bfseries ${escapeLatex(fullName)}}\\par`
    const profileBody = serialize(content.profile)
    const photoMM = Math.round(photoSize)
    const photoPlaceholder = `\\fbox{\\parbox[c][${photoMM}mm][c]{${photoMM - 4}mm}{\\centering\\footnotesize\\color{gray}profile-photo.jpg\\endgraf\\vspace{2pt}place beside the .tex}}`
    const photoBox = `\\IfFileExists{profile-photo.jpg}{\\begin{tikzpicture}\n\\node[${photoShape === 'circle' ? 'circle' : 'rectangle'},inner sep=0pt,${photoShape === 'circle' ? `minimum size=${photoMM}mm` : `minimum width=${photoMM}mm, minimum height=${photoMM}mm`},path picture={\\node at (path picture bounding box.center){\\includegraphics[width=${Math.round(photoMM * 2)}mm]{profile-photo.jpg}};}]\n{};\n\\end{tikzpicture}}{${photoPlaceholder}}`
    const nameplate = profileImage
      ? (profileAlign === 'center'
        ? `\\begin{center}\n${photoBox}\n\\end{center}\n\\noindent{${alignCommand.center}\n${nameLine}\n${profileBody}\\par}`
        : (profileAlign === 'left'
          ? `\\noindent\\begin{minipage}[c]{\\dimexpr\\linewidth-${photoMM}mm-8mm\\relax}\n${alignCommand.left}\n${nameLine}\n${profileBody}\\par\n\\end{minipage}\\hfill\\begin{minipage}[c]{${photoMM}mm}\n${photoBox}\n\\end{minipage}`
          : `\\noindent\\begin{minipage}[c]{${photoMM}mm}\\raggedleft\n${photoBox}\n\\end{minipage}\\hfill\\begin{minipage}[c]{\\dimexpr\\linewidth-${photoMM}mm-8mm\\relax}\n${alignCommand.right}\n${nameLine}\n${profileBody}\\par\n\\end{minipage}`))
      : `\\noindent{${alignCommand[profileAlign]}\n${nameLine}\n${profileBody}\\par}`
    // The photo sidecar is only a requirement when a photo was actually set;
    // otherwise the source has no reference to it at all.
    const photoNote = profileImage ? `% The nameplate clips profile-photo.jpg into a ${photoShape} ${photoMM}mm frame, the\n% same cover-crop the preview shows. Supply the photograph you used here; a\n% background preset chosen in the studio is already baked into that preview\n% photo, so this sidecar reference wants the original file. Without the file,\n% the nameplate compiles with the placeholder seen in the preview text.\n` : ''
    const profileDivider = dividerLatex('profile')
    return `% Generated draft source. Compile with LuaLaTeX or XeLaTeX.\n% The selected fonts must be installed; no PDF has been generated here.\n${photoNote}\\documentclass[11pt]{article}\n\\usepackage[${paperSizes[pageSize].tex},margin=${margin}mm]{geometry}\n\\usepackage{graphicx}\n${profileImage ? '\\usepackage{tikz}\n' : ''}\\usepackage{fontspec}\n\\setmainfont{${font}}\n${languageSetup}\n\\usepackage{xcolor,enumitem,titlesec,hyperref,dashrule}\n${hasHeadingIcons ? '\\usepackage{fontawesome5}\n' : ''}\\definecolor{accent}{HTML}{${(accent < accents.length ? accents[accent].color : customAccentColor).slice(1)}}\n\\titleformat{\\section}{\\normalsize\\bfseries\\color{accent}}{}{0em}{}\n\\titlespacing*{\\section}{0pt}{${sectionGap * .75}pt}{6pt}\n\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{6pt}\n\\begin{document}\n\\fontsize{${fontSize}}{${(fontSize * leading).toFixed(2)}}\\selectfont\n${nameplate}${profileDivider ? `\n\n${profileDivider}` : ''}\n\n${lines.join('\n\n')}\n\\end{document}\n`
  }, [content, enabled, customSections, titles, language, fullName, pageSize, margin, font, fontSize, leading, sectionGap, accent, customAccentColor, profileAlign, profileImage, photoShape, photoSize, sectionDividers, headingIcons, headingIconSize, headingIconCustomSize, headingIconColor])

  function selectSection(id: string, focus = false) {
    setActive(id)
    setSelectionPulse((value) => value + 1)
    setInspector('section')
    setMobilePanel('write')
    if (focus) setFocusRequest((value) => value + 1)
  }

  function openPageSettings() {
    setInspector('page')
    setMobilePanel('settings')
  }

  function addSection(id: string) {
    setEnabled((current) => current.includes(id) ? current : [...current, id])
    setLibraryOpen(false)
    selectSection(id, true)
    setNotice(`${title(id) || 'Untitled section'} added. Edit its heading and content.`)
  }

  function addCustomSection() {
    const id = `custom-${crypto.randomUUID()}`
    setCustomSections((current) => [...current, { id, title: 'Custom section', detail: 'Your own heading & content', group: 'Additional' }])
    setContent((current) => ({ ...current, [id]: '' }))
    setEnabled((current) => [...current, id])
    setLibraryOpen(false)
    selectSection(id, true)
    setNotice('Custom section added. Give it a heading and start writing.')
  }

  function removeSection(id: string) {
    if (id === 'profile') return
    beginFlip()
    const next = enabled.filter((item) => item !== id)
    setEnabled(next)
    setFlipTick((value) => value + 1)
    selectSection(next[Math.min(activeIndex, next.length - 1)] || 'profile', true)
    setNotice(`${title(id) || 'Untitled section'} removed from the page. Its content is kept in Add section.`)
  }

  function moveSection(id: string, direction: -1 | 1) {
    const index = enabled.indexOf(id)
    const destination = index + direction
    if (index < 1 || destination < 1 || destination >= enabled.length) return
    beginFlip()
    const next = [...enabled]
    ;[next[index], next[destination]] = [next[destination], next[index]]
    setEnabled(next)
    setFlipTick((value) => value + 1)
    setActive(id)
    setNotice(`${title(id) || 'Untitled section'} moved to position ${destination} of ${enabled.length - 1}.`)
  }

  function reorderSection(id: string, target: string, placement: 'before' | 'after') {
    if (id === 'profile' || id === target || !enabled.includes(id) || !enabled.includes(target)) return
    beginFlip()
    const remaining = enabled.filter((item) => item !== id)
    const destination = Math.max(1, remaining.indexOf(target) + (placement === 'after' ? 1 : 0))
    const next = [...remaining.slice(0, destination), id, ...remaining.slice(destination)]
    setEnabled(next)
    setFlipTick((value) => value + 1)
    setActive(id)
    setNotice(`${title(id) || 'Untitled section'} moved to position ${destination} of ${enabled.length - 1}.`)
  }

  function updateDropTarget(drag: Drag) {
    const elements = document.elementsFromPoint(drag.x, drag.y)
    const row = elements.map((element) => element.closest<HTMLElement>('[data-sort-id]')).find((element) => element && element.dataset.sortId !== drag.id)
    const bounds = row?.getBoundingClientRect()
    drag.target = row?.dataset.sortId || null
    drag.placement = bounds && drag.y > bounds.top + bounds.height / 2 ? 'after' : 'before'
    setDragging({ id: drag.id, x: drag.x, y: drag.y, target: drag.target, placement: drag.placement })
  }

  // Pointer capture supports mouse, pen and touch without making editable text draggable.
  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || id === 'profile' || dragRef.current) return
    stopFlip()
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id, pointerId: event.pointerId, owner: event.currentTarget, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, target: null, placement: 'before', started: false, scroll: event.currentTarget.closest<HTMLElement>('[data-sort-scroll]'), frame: null }
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return
      drag.started = true
      const scrollAtEdge = () => {
        if (dragRef.current !== drag) return
        const scroll = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-sort-scroll]') || drag.scroll
        const bounds = scroll?.getBoundingClientRect()
        if (scroll && bounds && drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
          const distance = drag.y < bounds.top + 48 ? -12 : drag.y > bounds.bottom - 48 ? 12 : 0
          if (distance) {
            scroll.scrollTop += distance
            updateDropTarget(drag)
          }
        }
        drag.frame = requestAnimationFrame(scrollAtEdge)
      }
      drag.frame = requestAnimationFrame(scrollAtEdge)
    }
    updateDropTarget(drag)
  }

  function finishDrag(event?: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    if (drag.frame != null) cancelAnimationFrame(drag.frame)
    dragRef.current = null
    setDragging(null)
    if (drag.owner.hasPointerCapture(drag.pointerId)) drag.owner.releasePointerCapture(drag.pointerId)
    if (!cancelled && drag.started && drag.target) reorderSection(drag.id, drag.target, drag.placement)
    if (cancelled && drag.started) setNotice('Reordering cancelled. Section order is unchanged.')
  }

  function dragHandle(id: string, onCanvas = false) {
    return <button type="button" className={onCanvas ? styles.canvasHandle : styles.dragHandle} aria-label={`Reorder ${title(id) || 'Untitled section'}`} aria-describedby="reorder-instructions" onPointerDown={(event) => startDrag(event, id)} onPointerMove={continueDrag} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)} onKeyDown={(event) => {
      if (event.key === 'Escape') finishDrag(undefined, true)
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        if (dragRef.current) finishDrag(undefined, true)
        moveSection(id, event.key === 'ArrowUp' ? -1 : 1)
      }
    }}><Glyph name="grip" /></button>
  }

  function dropMarker(id: string) {
    return dragging?.target === id ? <span className={`${styles.dropMarker} ${dragging.placement === 'after' ? styles.dropAfter : ''}`} aria-hidden="true" /> : null
  }

  function updateContent(nextValue: string, kind: 'typing' | 'action' = 'action') {
    const value = content[active] ?? ''
    if (nextValue === value) return
    let history = textHistoryRef.current.get(active)
    if (!history || history.current !== value) {
      history = { undo: [], redo: [], current: value, lastEditAt: 0 }
      textHistoryRef.current.set(active, history)
    }
    const now = Date.now()
    if (kind === 'action' || now - history.lastEditAt > 600) {
      history.undo.push(value)
      if (history.undo.length > 100) history.undo.shift()
    }
    history.redo = []
    history.current = nextValue
    history.lastEditAt = kind === 'typing' ? now : 0
    setContent((current) => ({ ...current, [active]: nextValue }))
  }

  function moveHistory(direction: 'undo' | 'redo') {
    const value = content[active] ?? ''
    let history = textHistoryRef.current.get(active)
    if (!history || history.current !== value) {
      history = { undo: [], redo: [], current: value, lastEditAt: 0 }
      textHistoryRef.current.set(active, history)
    }
    const source = direction === 'undo' ? history.undo : history.redo
    const destination = direction === 'undo' ? history.redo : history.undo
    const previous = source.pop()
    if (previous === undefined) return
    destination.push(value)
    history.current = previous
    history.lastEditAt = 0
    setContent((current) => ({ ...current, [active]: previous }))
    requestAnimationFrame(() => {
      const input = contentRef.current
      input?.focus()
      input?.setSelectionRange(previous.length, previous.length)
    })
  }

  function insertBullet(style?: BulletStyle) {
    const input = contentRef.current
    if (!input) return
    const prefix = (style ?? bulletStyle).prefix
    const value = content[active]
    const start = input.selectionStart === 0 ? 0 : value.lastIndexOf('\n', input.selectionStart - 1) + 1
    const end = value.indexOf('\n', input.selectionEnd)
    const lineEnd = end === -1 ? value.length : end
    const selected = value.slice(start, lineEnd)
    const replacement = selected.split('\n').map((line) => /^[-•→*] /u.test(line) ? line : `${prefix}${line}`).join('\n')
    updateContent(value.slice(0, start) + replacement + value.slice(lineEnd))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + replacement.length, start + replacement.length)
    })
  }

  function wrapSelection(prefix: string, suffix: string) {
    const input = contentRef.current
    if (!input) return
    const value = content[active]
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = value.slice(start, end)
    const before = value.slice(0, start)
    const after = value.slice(end)
    const formatLines = (text: string) => text.split('\n').map((line) => {
      if (!line.trim()) return line
      const isWrapped = line.length >= prefix.length + suffix.length && line.startsWith(prefix) && line.endsWith(suffix)
      return isWrapped ? line.slice(prefix.length, -suffix.length) : `${prefix}${line}${suffix}`
    }).join('\n')
    const hasSelection = Boolean(selected)
    const formatted = hasSelection ? formatLines(selected) : `${prefix}text${suffix}`
    const nextValue = `${before}${formatted}${after}`
    const selectionStart = hasSelection ? start : start + prefix.length
    const selectionEnd = hasSelection ? start + formatted.length : selectionStart + 'text'.length
    updateContent(nextValue)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  function insertLink() {
    const input = contentRef.current
    if (!input) return
    const value = content[active]
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = value.slice(start, end)
    const existingLink = [...value.matchAll(/\[([^\]\n]+)\]\(([^()\s]+)\)/g)].find((match) => {
      const linkStart = match.index ?? 0
      const innerStart = linkStart + 1
      const innerEnd = linkStart + match[0].length - 1
      return start >= innerStart && end <= innerEnd
    })
    if (existingLink) {
      const linkStart = existingLink.index ?? 0
      const labelStart = linkStart + 1
      const label = existingLink[1]
      const nextValue = `${value.slice(0, linkStart)}${label}${value.slice(linkStart + existingLink[0].length)}`
      updateContent(nextValue)
      requestAnimationFrame(() => {
        input.focus()
        input.setSelectionRange(labelStart, labelStart + label.length)
      })
      return
    }
    const linkText = selected || 'link text'
    const replacement = `[${linkText}](https://example.com)`
    updateContent(value.slice(0, start) + replacement + value.slice(end))
    const urlStart = start + linkText.length + 3
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(urlStart, urlStart + 'https://example.com'.length)
    })
  }

  function insertNumberedList() {
    const input = contentRef.current
    if (!input) return
    const value = content[active] ?? ''
    const start = input.selectionStart === 0 ? 0 : value.lastIndexOf('\n', input.selectionStart - 1) + 1
    const end = value.indexOf('\n', input.selectionEnd)
    const lineEnd = end === -1 ? value.length : end
    const lines = value.slice(start, lineEnd).split('\n')
    const nonEmptyLines = lines.filter((line) => line.trim())
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => /^\d+\. /u.test(line))
    let itemNumber = 0
    const replacement = lines.map((line) => {
      if (!line.trim()) { itemNumber = 0; return line }
      const text = line.replace(/^\d+\. /u, '').replace(/^[-•→*] /u, '')
      return remove ? text : `${++itemNumber}. ${text}`
    }).join('\n')
    updateContent(value.slice(0, start) + replacement + value.slice(lineEnd))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start, start + replacement.length)
    })
  }

  function clearFormatting() {
    const input = contentRef.current
    if (!input) return
    const value = content[active] ?? ''
    const selectionStart = input.selectionStart
    const selectionEnd = input.selectionEnd
    const start = selectionStart === selectionEnd
      ? (selectionStart === 0 ? 0 : value.lastIndexOf('\n', selectionStart - 1) + 1)
      : selectionStart
    const lineEnd = selectionStart === selectionEnd
      ? (value.indexOf('\n', selectionEnd) === -1 ? value.length : value.indexOf('\n', selectionEnd))
      : selectionEnd
    const selected = value.slice(start, lineEnd)
    const cleared = selected.replace(/\[([^\]\n]+)\]\([^()\s]+\)/gu, '$1').replace(/\*\*(.*?)\*\*/gu, '$1').replace(/(^|[^\\])_([^_\n]+)_/gu, '$1$2')
    if (cleared === selected) return
    updateContent(value.slice(0, start) + cleared + value.slice(lineEnd))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start, start + cleared.length)
    })
  }

  // Header portrait: always re-encoded through readProfilePhoto so the draft
  // stays small enough for localStorage; the raw upload never touches state.
  // The input is cleared first, so selecting the same file again still fires.
  async function chooseProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const image = await readProfilePhoto(file)
      setProfileImage(image)
      setNotice('Profile photo added. It stays on this device with the rest of the draft.')
    } catch {
      setNotice('That image could not be read. Try a JPG or PNG picture.')
    }
  }

  function openProfilePhotoPicker(event: ReactMouseEvent<HTMLButtonElement>) {
    photoTriggerRef.current = event.currentTarget
    const inspector = event.currentTarget.closest<HTMLElement>(`.${styles.inspectorScroll}`)
    photoScrollRef.current = { windowY: window.scrollY, inspectorTop: inspector?.scrollTop ?? 0 }
    const restoreAfterPicker = () => {
      requestAnimationFrame(() => {
        const snapshot = photoScrollRef.current
        photoTriggerRef.current?.focus({ preventScroll: true })
        if (snapshot) {
          window.scrollTo({ top: snapshot.windowY })
          const currentInspector = photoTriggerRef.current?.closest<HTMLElement>(`.${styles.inspectorScroll}`)
          if (currentInspector) currentInspector.scrollTop = snapshot.inspectorTop
        }
      })
    }
    window.addEventListener('focus', restoreAfterPicker, { once: true })
    const input = photoInputRef.current
    if (!input) return
    try {
      if (typeof input.showPicker === 'function') input.showPicker()
      else input.click()
    } catch {
      input.click()
    }
  }

  function removeProfilePhoto() {
    setProfileImage(null)
    setNotice('Profile photo removed.')
  }

  // Background presets are picked here but baked by the effect below; the toast
  // announces the intent, the pixels follow within the same beat. Blur and
  // custom speak their own control in the notice so the dial's first position
  // is never a surprise.
  function choosePhotoBackground(preset: PhotoBackground) {
    if (!profileImage || preset.id === photoBackground) return
    setPhotoBackground(preset.id)
    setNotice(
      preset.id === 'none' ? 'Photo background reset to the original.'
        : preset.id === 'blur' ? `Backdrop blurred at ${photoBlur}% — the portrait stays sharp.`
        : preset.id === 'custom' ? `Custom backdrop tint ${photoCustomColor.toUpperCase()} applied.`
        : `Photo background set to ${preset.name.toLowerCase()} — matched to this document.`,
    )
  }

  // Frame resize: one corner handle, diagonal drag. The paper nests inside a
  // CSS transform at the display zoom, so one screen pixel is 1/scale paper
  // pixels, i.e. 25.4/96 paper millimetres — that ratio is the whole calibration.
  function startPhotoResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || photoResizeRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    photoResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startSize: photoSize, scale }
    setPhotoResizing(true)
  }

  function continuePhotoResize(event: PointerEvent<HTMLButtonElement>) {
    const drag = photoResizeRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const screenPixels = (event.clientX - drag.startX + event.clientY - drag.startY) / 2
    const millimetres = drag.startSize + screenPixels * (25.4 / 96) / drag.scale
    setPhotoSize(Math.max(profilePhotoBounds.min, Math.min(profilePhotoBounds.max, Math.round(millimetres))))
  }

  function finishPhotoResize(event: PointerEvent<HTMLButtonElement>) {
    const drag = photoResizeRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    photoResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId)
    setPhotoResizing(false)
  }

  function stepPhotoSize(direction: -1 | 1) {
    setPhotoSize((current) => Math.max(profilePhotoBounds.min, Math.min(profilePhotoBounds.max, current + direction)))
  }

  function exportBaseName() {
    return (slugFileBase(documentTitle) || slugFileBase(fullName) || 'resume').slice(0, 80)
  }

  function downloadLatex() {
    const blob = new Blob([latex], { type: 'application/x-tex;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${exportBaseName()}.tex`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('LaTeX source saved. Compile it with LuaLaTeX or XeLaTeX, with the selected fonts installed, for the typeset final.')
  }

  // Draft PDF export. There is no TeX engine in this studio, so the honest
  // output is the same visual draft through the browser print pipeline:
  // real paper size and margins via @page, true scale, white paper. The
  // temporary document title gives the dialog a filename that says "draft".
  function printDraft() {
    if (format !== 'Visual') {
      setNotice('The draft PDF prints from the Visual preview. Switch back to Visual, then try again.')
      return
    }
    if (printStyleRef.current) return
    const style = document.createElement('style')
    style.id = 'mr-resume-print-setup'
    style.textContent = `@page { size: ${pageSize === 'A4' ? '210mm 297mm' : '8.5in 11in'}; margin: ${margin}mm; }`
    document.head.appendChild(style)
    printStyleRef.current = style
    titleBeforePrint.current = document.title
    document.title = `${exportBaseName()}-draft-pdf`
    setNotice('Print dialog opened. Choose "Save as PDF" to keep a draft PDF that matches this preview.')
    window.setTimeout(() => {
      try {
        window.print()
      } finally {
        revertPrintSetup()
      }
    }, 250)
  }

  // Clears the on-device draft and returns to the example document. Two-step:
  // the first press asks, the second commits.
  function startFresh() {
    if (!confirmFresh) {
      setConfirmFresh(true)
      return
    }
    setConfirmFresh(false)
    try {
      window.localStorage.removeItem(draftKey)
    } catch { /* unreadable storage; the debounced writer will rebuild it */ }
    setDocumentTitle('Untitled resume')
    setFullName('Ayesha Rahman')
    setPurpose('Resume')
    setLanguage('English')
    setBanglishMode(false)
    setFormat('Visual')
    setEnabled(['profile', 'summary', 'experience', 'education', 'skills'])
    setCustomSections([])
    setTitles({})
    setContent(initialContent)
    setSectionDividers({})
    setHeadingIcons({})
    setHeadingIconSize('medium')
    setHeadingIconCustomSize(1)
    setHeadingIconCustomSizeDraft('1.00')
    setHeadingIconColor('accent')
    setPageSize('A4')
    setFont('Inter')
    setFontSize(11)
    setLeading(1.5)
    setLeadingDraft('1.50')
    setSectionGap(24)
    setSectionGapDraft('24')
    setMargin(18)
    setMarginDraft('18')
    setAccent(0)
    setProfileAlign('left')
    setProfileImage(null)
    setPhotoShape('circle')
    setPhotoSize(profilePhotoBounds.initial)
    setPhotoBackground('none')
    setPhotoBlur(50)
    setCustomAccentColor(accents[0].color)
    setPhotoCustomColor(accents[0].color)
    setSaveState('fresh')
    setSavedAt(null)
    selectSection('profile')
    setNotice('Fresh draft started. Your saved draft was cleared from this device.')
  }

  function setDocPurpose(value: Purpose) {
    beginFlip()
    setPurpose(value)
    if (value === 'Biodata') {
      setEnabled(['profile', 'education', 'personal'])
      selectSection('personal')
    } else if (value === 'Statement of purpose') {
      setEnabled(['profile', 'education', 'motivation', 'projects'])
      selectSection('motivation')
    } else {
      setEnabled(['profile', 'summary', 'experience', 'education', 'skills'])
      selectSection('profile')
    }
    setFlipTick((tick) => tick + 1)
    setNotice(`${value} outline applied. Your writing is kept in the section library.`)
  }

  function setResumeLanguage(value: 'English' | 'Bangla') {
    if (value === language) return
    setLanguage(value)
    // The one honest caveat about switching to Bangla: letters hang from a
    // matra line, so the paragraph rhythm usually wants a touch more room.
    if (value === 'Bangla') setNotice('Now writing Bangla: default headings show in Bangla. Line spacing 1.65–1.7 suits Bangla matra.')
  }

  function resetPageSettings() {
    setPageSize('A4')
    setFont('Inter')
    setFontSize(11)
    setLeading(1.5)
    setLeadingDraft('1.50')
    setSectionGap(24)
    setSectionGapDraft('24')
    setMargin(18)
    setMarginDraft('18')
    setCustomAccentColor(accents[0].color)
    setAccent(0)
    setNotice('Page settings reset. Your writing and section order are unchanged.')
  }

  const inspectorPanelProps: ResumeInspectorPanelProps = {
    inspector, setInspector, setMobilePanel, sectionTabRef, pageTabRef, openPageSettings,
    active, activeIndex, enabled, title: editorTitle, resumeTitle: title, t: tx, sectionDetail: currentSection.detail, moveSection,
    activeHeadingIcon: headingIcons[active] ?? 'none',
    onHeadingIconChange: (icon) => setHeadingIcons((current) => ({ ...current, [active]: icon })),
    headingIconSize, setHeadingIconSize, headingIconCustomSize, headingIconCustomSizeDraft,
    onHeadingIconCustomSizeChange: (value) => {
      const size = Math.round(Math.max(0.6, Math.min(1.8, value)) * 100) / 100
      setHeadingIconCustomSize(size)
      setHeadingIconCustomSizeDraft(size.toFixed(2))
    },
    onHeadingIconCustomSizeDraftChange: (value) => {
      setHeadingIconCustomSizeDraft(value)
      const parsed = Number(value)
      if (value.trim() && Number.isFinite(parsed) && parsed >= 0.6 && parsed <= 1.8) setHeadingIconCustomSize(parsed)
    },
    commitHeadingIconCustomSize: (value) => {
      const parsed = Number(value)
      const requested = value.trim() && Number.isFinite(parsed) ? parsed : headingIconCustomSize
      const size = Math.round(Math.max(0.6, Math.min(1.8, requested)) * 100) / 100
      setHeadingIconCustomSize(size)
      setHeadingIconCustomSizeDraft(size.toFixed(2))
    },
    headingIconColor, setHeadingIconColor,
    headingAccentColor: accent < accents.length ? accents[accent].color : customAccentColor,
    sectionDivider: { ...initialSectionDivider, ...sectionDividers[active] },
    canAddDivider: activeIndex >= 0 && activeIndex < enabled.length - 1,
    updateSectionDivider: (patch) => setSectionDividers((current) => {
      const next = { ...initialSectionDivider, ...current[active], ...patch }
      next.thickness = Math.max(0.5, Math.min(2, next.thickness))
      return { ...current, [active]: next }
    }),
    dividerAccentColor: accent < accents.length ? accents[accent].color : customAccentColor,
    titleRef, fullName, setFullName, setTitles, contentRef, contentValue: content[active], updateContent,
    wrapSelection, insertLink, insertNumberedList, clearFormatting,
    undoAvailable: Boolean(textHistoryRef.current.get(active)?.undo.length),
    redoAvailable: Boolean(textHistoryRef.current.get(active)?.redo.length), moveHistory,
    bulletStyle, setBulletStyle, bulletMenuOpen, setBulletMenuOpen, bulletStyles, insertBullet,
    profileAligns, profileAlign, setProfileAlign, alignGlyph, photoInputRef, chooseProfilePhoto,
    photoSrc, photoTriggerRef, openProfilePhotoPicker, removeProfilePhoto, photoShape, setPhotoShape,
    photoBackground, choosePhotoBackground, photoBackgrounds, photoCustomColor, setPhotoCustomColor,
    photoBlur, setPhotoBlur, accent, setAccent, accents, customAccentColor, setCustomAccentColor,
    customAccentIndex: CUSTOM_ACCENT, removeSection, documentTitle, setDocumentTitle, pageSize,
    setPageSize, paperSizes, font, setFont, typefaces, fontFamily, fontSize, setFontSize,
    leading, setLeading, leadingDraft, setLeadingDraft, sectionGap, setSectionGap,
    sectionGapDraft, setSectionGapDraft, margin, setMargin, marginDraft, setMarginDraft,
    spacingPresets, resetPageSettings, banglishMode, setBanglishMode,
  }

  // On the paper itself the document follows the resume language: Bangla text
  // always carries the Noto Sans Bengali fallback after the chosen Latin face,
  // and Inter — a Latin-only face — steps aside entirely so no glyph is painted
  // from two systems.
  const banglaFontFamily = font === 'Inter'
    ? '"Noto Sans Bengali", sans-serif'
    : `${fontFamily}, "Noto Sans Bengali"`

  const paperStyle = {
    width: size.width, minHeight: size.height, padding: `${margin}mm`, transform: `scale(${scale})`,
    '--resume-accent': accent < accents.length ? accents[accent].color : customAccentColor,
    '--resume-font': language === 'Bangla' ? banglaFontFamily : fontFamily,
    '--resume-font-size': `${fontSize}pt`, '--resume-leading': leading, '--resume-section-gap': `${sectionGap}px`,
  } as CSSProperties

  return (
    <div className={styles.studio} lang={editorLanguage === 'Bangla' ? 'bn' : 'en'} data-editor-language={editorLanguage} data-mobile-panel={mobilePanel} data-dragging={!!dragging}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label={tx('Back to workspace')}><Glyph name="back" /></Link>
        <div className={styles.brand}><span className={styles.brandMark}><Glyph name="page" /></span><span>Mr.<b>Resume</b><small>Studio</small></span></div>
        <div className={styles.docIdentity}><input aria-label={tx('Document title')} value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} /><span className={`${styles.saveStatus} ${saveState === 'unavailable' ? styles.saveUnavailable : ''}`} title={tx(saveState === 'unavailable' ? 'This browser is blocking local autosave. Download your work regularly.' : 'Your draft is autosaved on this device. Nothing is uploaded.')}><span key={savedAt ?? saveState} className={styles.savePulse}>{saveState === 'saved' && savedAt ? `${tx('Autosaved')} ${new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : tx(saveState === 'unavailable' ? 'Autosave unavailable' : 'Autosave on')}</span></span></div>
        <div className={styles.topActions}><button type="button" className={styles.texButton} aria-label={tx('Export .tex')} title={tx('Editable LaTeX source')} onClick={downloadLatex}><Glyph name="download" /><span>.tex</span></button><div className={styles.editorLanguageControl}><StudioDropdown value={tx(editorLanguage)} options={(['English', 'Bangla'] as EditorLanguage[]).map(tx)} onChange={(value) => setEditorLanguage(value === tx('Bangla') ? 'Bangla' : 'English')} label={tx('Editor language')} icon="globe" /></div><button type="button" className={styles.exportButton} aria-label={tx('Download draft PDF')} title={tx('A draft PDF, printed from this preview')} onClick={printDraft}><Glyph name="download" /><span>{tx('Draft PDF')}</span></button></div>
      </header>

      <section className={styles.toolbar} aria-label={tx('Document setup')}>
        <div className={styles.setupControls}>
          <div className={`${styles.selectLabel} ${styles.purposeSelect}`}><span>{tx('Purpose')}</span><StudioDropdown value={tx(purpose)} options={purposes.map(tx)} onChange={(value) => setDocPurpose(purposes[purposes.map(tx).indexOf(value)] as Purpose)} label={tx('Document purpose')} /></div>
          <span className={styles.toolbarDivider} />
          <div className={styles.selectLabel}><span>{tx('Resume language')}</span><StudioDropdown value={tx(language)} options={['English', 'Bangla'].map(tx)} onChange={(value) => setResumeLanguage(value === tx('Bangla') ? 'Bangla' : 'English')} label={tx('Resume language')} icon="globe" /></div>
          <span className={styles.toolbarDivider} />
          <div className={styles.previewControls} aria-label={tx('Preview controls')}>
            <div className={styles.previewMeta}><b>{format === 'Visual' ? tx('Draft preview') : tx('LaTeX source')}</b><span>{pageSize}<i />{tx('Portrait')}</span></div>
            <div className={styles.canvasTools}><button type="button" onClick={() => setZoom((value) => Math.max(25, (value ?? fitZoom) - 10))} aria-label={tx('Zoom out')} disabled={format === 'LaTeX' || displayZoom <= 25}>−</button><span className={styles.zoomValue}>{displayZoom}%</span><button type="button" onClick={() => setZoom((value) => Math.min(125, (value ?? fitZoom) + 10))} aria-label={tx('Zoom in')} disabled={format === 'LaTeX' || displayZoom >= 125}>+</button><button type="button" className={zoom === null ? styles.fitActive : ''} onClick={() => setZoom(null)} disabled={format === 'LaTeX'} aria-label={tx('Fit document to screen')} aria-pressed={zoom === null}>{tx('Fit')}</button></div>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <div className={styles.segmented} role="group" aria-label={tx('Document view')}>{(['Visual', 'LaTeX'] as const).map((item) => <button type="button" key={item} className={format === item ? styles.segmentActive : ''} onClick={() => { setFormat(item); setMobilePanel('preview') }} aria-pressed={format === item}>{item === 'LaTeX' ? <code>TeX</code> : <Glyph name="page" />}<span>{tx(item === 'Visual' ? 'Visual' : 'Source')}</span></button>)}</div>
          <button type="button" className={`${styles.pageSettingsButton} ${inspector === 'page' ? styles.pageSettingsActive : ''}`} onClick={openPageSettings}><Glyph name="settings" /><span>{tx('Page settings')}</span></button>
        </div>
      </section>

      <section className={styles.workspace} aria-label="Resume editor">
        <ResumeSectionPanel active={active} enabled={enabled} dragging={dragging} content={content} title={editorTitle} t={tx} selectSection={selectSection} dropMarker={dropMarker} dragHandle={dragHandle} addRef={addRef} libraryOpen={libraryOpen} setLibraryOpen={setLibraryOpen} catalog={catalog} addSection={addSection} addCustomSection={addCustomSection} startFresh={startFresh} confirmFresh={confirmFresh} />

        <section className={styles.canvasPanel} aria-label="Live document preview">
          <div ref={stageRef} className={styles.paperStage} data-sort-scroll="canvas">
          {format === 'LaTeX' ? <div className={styles.sourceView}><p>{tx('Generated from your writing and page settings. Edit a section to update this read-only source.')}</p><pre className={styles.texCanvas} aria-label={tx('Generated LaTeX source')}><code>{latex}</code></pre><p>{tx('Requires LuaLaTeX or XeLaTeX and the selected fonts. Bangla source also requires Noto Sans Bengali.')}</p></div> : <div className={styles.pageStack}>
              <div className={styles.pageCaption}><span>{tx('YOUR DOCUMENT')}</span><span>{size.dimensions}</span></div>
              <div className={styles.paperFrame} style={{ width: size.width * scale, height: Math.max(size.height, paperHeight) * scale }}>
                <article ref={paperRef} className={styles.paper} lang={language === 'Bangla' ? 'bn' : 'en'} style={paperStyle} aria-label="Resume draft">
                  <header className={`${styles.paperHeader} ${profileImage ? styles.headerHasPhoto : ''} ${active === 'profile' ? styles.paperSelected : ''}`} data-align={profileAlign} data-paper-section="profile" onClick={() => selectSection('profile', true)}>
                    <div className={styles.blockControls}><button type="button" className={styles.blockEdit} onClick={(event) => { event.stopPropagation(); selectSection('profile', true) }} aria-label={`${tx('Edit')} ${editorTitle('profile')}`}><Glyph name="edit" />{tx('Edit')}</button></div>
                    {active === 'profile' && <span key={selectionPulse} className={styles.registrationSettle} aria-hidden="true" />}
                    <div className={styles.headerText}><span className={styles.paperKicker}>{language === 'Bangla' ? editorText(purpose, 'Bangla') : purpose}</span><h2>{fullName || cx('Your name')}</h2><p>{content.profile}</p></div>
                    {photoSrc && (
                      /* Data-URI already re-encoded and size-capped at ingest (readProfilePhoto);
                         there is no remote source for next/image's loader to optimize or resize. */
                      <span className={styles.photoWrap} data-resizing={photoResizing} style={{ width: `${Math.round(photoSize)}mm`, height: `${Math.round(photoSize)}mm` }}>
                        <span className={styles.photoFrame} data-shape={photoShape}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className={styles.headerPhoto} src={photoSrc} alt="" />
                        </span>
                        <button type="button" role="slider" className={styles.photoResize} aria-label="Resize profile photo" aria-valuemin={profilePhotoBounds.min} aria-valuemax={profilePhotoBounds.max} aria-valuenow={Math.round(photoSize)} aria-valuetext={`${Math.round(photoSize)} mm`} onPointerDown={startPhotoResize} onPointerMove={continuePhotoResize} onPointerUp={finishPhotoResize} onPointerCancel={finishPhotoResize} onLostPointerCapture={finishPhotoResize} onKeyDown={(event) => {
                          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); stepPhotoSize(1) }
                          else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); stepPhotoSize(-1) }
                          else if (event.key === 'Home') { event.preventDefault(); setPhotoSize(profilePhotoBounds.min) }
                          else if (event.key === 'End') { event.preventDefault(); setPhotoSize(profilePhotoBounds.max) }
                        }}><Glyph name="resize" /></button>
                        {photoResizing && <span className={styles.photoResizeTag} aria-hidden="true">{Math.round(photoSize)} mm</span>}
                      </span>
                    )}
                  </header>
                  {sectionDividers.profile?.enabled && enabled.length > 1 && <hr className={`${styles.paperDivider} ${styles[`paperDivider_${sectionDividers.profile.style}`]}`} style={{ '--divider-color': sectionDividers.profile.color === 'accent' ? (accent < accents.length ? accents[accent].color : customAccentColor) : sectionDividers.profile.color, '--divider-thickness': `${sectionDividers.profile.thickness}px` } as CSSProperties} />}
                  <div className={styles.paperBody}>{enabled.filter((id) => id !== 'profile').map((id) => <section key={id} className={`${styles.paperSection} ${active === id ? styles.paperSelected : ''} ${dragging?.id === id ? styles.dragOrigin : ''}`} data-sort-id={id} data-paper-section={id} data-flip-key={`canvas:${id}`} onClick={() => selectSection(id, true)}>
                    {dropMarker(id)}{active === id && <span key={selectionPulse} className={styles.registrationSettle} aria-hidden="true" />}<div className={styles.blockControls} onClick={(event) => event.stopPropagation()}>{dragHandle(id, true)}<button type="button" className={styles.blockEdit} onClick={() => selectSection(id, true)} aria-label={`${tx('Edit')} ${editorTitle(id) || tx('Untitled section')}`}><Glyph name="edit" />{tx('Edit')}</button></div>
                    <h3 style={{ '--heading-icon-size': headingIconSize === 'small' ? '.82em' : headingIconSize === 'large' ? '1.18em' : headingIconSize === 'custom' ? `${headingIconCustomSize}em` : '1em', '--heading-icon-color': headingIconColor === 'accent' ? (accent < accents.length ? accents[accent].color : customAccentColor) : headingIconColor } as CSSProperties}>{headingIcons[id] && headingIcons[id] !== 'none' && <span className={styles.paperHeadingIcon}><ResumeHeadingIcon name={headingIcons[id]} /></span>}<span>{title(id)}</span></h3><div className={styles.sectionText}>{content[id].trim() ? <SectionText value={content[id]} /> : <p className={styles.emptySection}>{cx('Select this section to start writing.')}</p>}</div>
                    {sectionDividers[id]?.enabled && enabled.indexOf(id) < enabled.length - 1 && <hr className={`${styles.paperDivider} ${styles[`paperDivider_${sectionDividers[id].style}`]}`} style={{ '--divider-color': sectionDividers[id].color === 'accent' ? (accent < accents.length ? accents[accent].color : customAccentColor) : sectionDividers[id].color, '--divider-thickness': `${sectionDividers[id].thickness}px` } as CSSProperties} />}
                  </section>)}</div>
                </article>
              </div>
              <p className={styles.draftCaption}>{tx('Click a section to edit. Drag its handle to move it.')}</p>
            </div>}
          </div>
          <div className={styles.canvasStatus}><span><Glyph name="check" />{format === 'Visual' && paperHeight > size.height + 2 ? tx('Content exceeds one page. The draft PDF splits it approximately.') : tx('Draft preview. The draft PDF is a preview render, not the typeset final.')}</span><span>{enabled.length - 1} {tx('sections')}</span></div>
        </section>

        <ResumeInspectorPanel {...inspectorPanelProps} />
      </section>
      <nav className={styles.mobileNav} aria-label={tx('Studio panels')}>{([{ id: 'sections', label: 'Sections', icon: 'list' }, { id: 'write', label: 'Write', icon: 'edit' }, { id: 'preview', label: 'Preview', icon: 'preview' }, { id: 'settings', label: 'Page', icon: 'settings' }] as { id: Panel; label: string; icon: GlyphName }[]).map((panel) => <button type="button" key={panel.id} aria-pressed={mobilePanel === panel.id} onClick={() => { setMobilePanel(panel.id); if (panel.id === 'write') setInspector('section'); if (panel.id === 'settings') setInspector('page') }}><Glyph name={panel.icon} /><span>{tx(panel.label === 'Sections' ? 'Section' : panel.label)}</span></button>)}</nav>
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{notice}</div>
      {notice && <div className={styles.notice}><Glyph name="check" /><span>{tx(notice)}</span><button type="button" className={styles.iconButton} aria-label={tx('Dismiss notification')} onClick={() => setNotice('')}><Glyph name="close" /></button></div>}
      {dragging && <div className={styles.dragPreview} style={{ left: Math.max(12, Math.min(dragging.x + 16, window.innerWidth - 280)), top: Math.min(dragging.y + 12, window.innerHeight - 64) }} aria-hidden="true"><Glyph name="grip" /><span>{title(dragging.id) || 'Untitled section'}</span></div>}
    </div>
  )
}
