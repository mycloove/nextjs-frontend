'use client'

import type { CSSProperties, ReactNode, Ref } from 'react'
import styles from './MrResumeStudio.module.css'
import { BanglishWords } from './BanglishCorrection'
import { validBanglishSources, type BanglishSource } from './banglishEditing'
import { editorText } from './editorLanguage'
import { Glyph } from './MrResumeStudioControls'
import { ResumeContactIcon } from './ResumeContactIcon'
import { ResumeHeadingIcon } from './ResumeHeadingIcon'
import { entryHasLink, parseContactLine, parseEntryLine, type EntryLine } from './resumeEntries'
import { contentBlocks, parseInline, type InlinePart } from './resumeInline'
import type { ResumeDraft } from './resumeDraft'
import { partitionSections } from './resumeLayouts'

/**
 * The Regular page: the one renderer behind the editor's canvas, the draft
 * PDF it prints, and the gallery's live preview. Whatever a template looks
 * like in the gallery is therefore exactly what the editor will show.
 *
 * Drawing lives here; editing does not. The editor passes `editing` with its
 * selection, drag, Banglish-correction and photo-resize affordances. Without
 * it the page is a picture: no controls, no correctable-word buttons, and no
 * `data-sort-id`, `data-flip-key` or `data-banglish-field` hooks, which the
 * editor looks up across the whole document. `data-paper-section` stays in
 * both modes because the page's own styles select on it (the Executive
 * layout frames its summary); the editor only reads it inside its own page.
 */
export type ResumePageEditing = {
  active: string
  /** Re-mounts the selection settle mark on every selection. */
  selectionPulse: number
  draggingId: string | null
  sources: Readonly<Record<string, readonly BanglishSource[]>>
  onSelect: (id: string, focus: boolean) => void
  onCorrect: (field: string, source: BanglishSource, trigger: HTMLButtonElement) => void
  dropMarker: (id: string) => ReactNode
  dragHandle: (id: string) => ReactNode
  /** The accessible name of a block's Edit button. */
  editLabel: (id: string) => string
  editText: string
  photoResizing: boolean
  photoControls: ReactNode
  /** Editor-chrome language, for correctable-word labels. */
  t: (value: string) => string
}

export type ResumePageProps = {
  draft: ResumeDraft
  title: (id: string) => string
  fontFamily: string
  accentColor: string
  width: number
  minHeight: number
  scale: number
  ariaLabel: string
  /** Shown in an empty section, in the document's own language. */
  emptyText: string
  nameFallback: string
  articleRef?: Ref<HTMLElement>
  editing?: ResumePageEditing
}

const noSources: readonly BanglishSource[] = []
const ignoreCorrection = () => {}
const plain = (value: string) => value
// A picture of a page is not a page of working links: a specimen's addresses
// are reserved hosts, and a preview must not open tabs or take Tab stops. The
// <a> stays, since its colour and underline are part of the layout; only the
// destination is withheld.
const linkTarget = (href: string, live: boolean) => live ? { href, target: '_blank', rel: 'noreferrer' } : {}

function SectionText({ value, sources, live, onCorrect, t }: { value: string; sources: readonly BanglishSource[]; live: boolean; onCorrect: (source: BanglishSource, trigger: HTMLButtonElement) => void; t: (value: string) => string }) {
  const renderParts = (parts: InlinePart[], keyPrefix: string, correctable = true): ReactNode[] => parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.kind === 'bold') return <strong key={key}>{renderParts(part.children, key, correctable)}</strong>
    if (part.kind === 'italic') return <em key={key}>{renderParts(part.children, key, correctable)}</em>
    if (part.kind === 'link') return <a key={key} {...linkTarget(part.href, live)}>{renderParts(part.children, key, false)}</a>
    return <span key={key}>{correctable ? <BanglishWords value={part.text} offset={part.start} sources={sources} onCorrect={onCorrect} t={t} /> : part.text}</span>
  })
  let cursor = 0
  const renderInline = (text: string, keyPrefix: string, prefixLength = 0) => {
    const start = value.indexOf(text, cursor)
    cursor = start + text.length
    return renderParts(parseInline(text.slice(prefixLength), Math.max(0, start) + prefixLength), keyPrefix)
  }

  // The entry register (resumeEntries.ts) shapes a paragraph line only when it
  // carries exactly one ` | ` separator: the lead keeps its inline shapes while
  // the right side reads as this template's italic edge-aligned metadata. Any
  // link inside the metadata stays a real link and earns the external mark; the
  // Banglish cursor stays aligned as it would for a plain rendered line.
  const renderEntry = (line: string, entry: EntryLine, keyPrefix: string) => {
    const start = value.indexOf(line, cursor)
    if (start < 0) return renderParts(parseInline(line, cursor), keyPrefix)
    cursor = line.length
    const leadStart = Math.max(0, entry.leadOffset)
    const metaStart = start + entry.metaOffset > leadStart ? start + entry.metaOffset : leadStart
    return (
      <span className={styles.entryHead}>
        <span className={styles.entryLead}>{renderParts(parseInline(entry.lead, leadStart), `${keyPrefix}-lead`)}</span>
        <span className={styles.entryMeta}>{renderParts(parseInline(entry.meta, metaStart), `${keyPrefix}-meta`)}
          {entryHasLink(entry.meta) && <ResumeContactIcon name="external" className={styles.entryExternalMark} />}
        </span>
      </span>
    )
  }

  return contentBlocks(value).map((block, index) => block.list === 'numbered'
    ? <ol key={index}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line, `list-${index}-${lineIndex}`, line.match(/^\d+\. /u)?.[0].length ?? 0)}</li>)}</ol>
    : block.list === 'bullet'
      ? <ul key={index}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line, `list-${index}-${lineIndex}`, 2)}</li>)}</ul>
      : <p key={index}>{block.lines.map((line, lineIndex) => {
        const entry = parseEntryLine(line)
        return entry
          ? <span key={lineIndex} className={styles.entryLine}>{renderEntry(line, entry, `entry-${index}-${lineIndex}`)}</span>
          : <span key={lineIndex}>{renderInline(line, `paragraph-${index}-${lineIndex}`)}{lineIndex < block.lines.length - 1 ? '\n' : null}</span>
      })}</p>)
}

export default function ResumePage({ draft, title, fontFamily, accentColor, width, minHeight, scale, ariaLabel, emptyText, nameFallback, articleRef, editing }: ResumePageProps) {
  const { fullName, purpose, enabled, content, language, font, layout, profileAlign, profileImage, photoShape, photoSize, sectionDividers, headingIcons, headingIconSize, headingIconCustomSize, headingIconColor } = draft
  const photoSrc = draft.profileImageDisplay ?? profileImage
  const active = editing?.active
  const live = Boolean(editing)
  const t = editing?.t ?? plain
  const sourcesFor = (field: string) => editing?.sources[field] ?? noSources
  const correct = (field: string) => editing ? (source: BanglishSource, trigger: HTMLButtonElement) => editing.onCorrect(field, source, trigger) : ignoreCorrection

  // On the paper itself the document follows the resume language: Bangla text
  // always carries the Noto Sans Bengali fallback after the chosen Latin face,
  // and Inter — a Latin-only face — steps aside entirely so no glyph is painted
  // from two systems.
  const paperStyle = {
    width, minHeight, padding: `${draft.margin}mm`, transform: `scale(${scale})`,
    fontFamily,
    '--resume-accent': accentColor,
    '--resume-font': fontFamily,
    '--resume-font-size': `${draft.fontSize}pt`, '--resume-leading': draft.leading, '--resume-section-gap': `${draft.sectionGap}px`,
    '--resume-margin': `${draft.margin}mm`,
  } as CSSProperties

  // Profile contact lines keep [label](href) as a real link with its label, the
  // same shape the LaTeX export compiles (\href), instead of raw markup.
  const contactParts = (parts: InlinePart[], key: string, sources: readonly BanglishSource[]): ReactNode[] => parts.map((part, index) => {
    const partKey = `${key}-${index}`
    if (part.kind === 'bold') return <strong key={partKey}>{contactParts(part.children, partKey, sources)}</strong>
    if (part.kind === 'italic') return <em key={partKey}>{contactParts(part.children, partKey, sources)}</em>
    if (part.kind === 'link') return <a key={partKey} {...linkTarget(part.href, live)} onClick={live ? (event) => event.stopPropagation() : undefined}>{contactParts(part.children, partKey, [])}</a>
    return <BanglishWords key={partKey} value={part.text} offset={part.start} sources={sources} onCorrect={correct('content:profile')} t={t} />
  })

  const dividerColor = (color: string) => color === 'accent' ? accentColor : color

  // Each contact line with where it starts in the whole field, so a Banglish
  // correction stays anchored to the line it was made on.
  const contactLines = content.profile.split('\n').reduce<{ line: string; start: number }[]>((lines, line) => {
    const previous = lines[lines.length - 1]
    return [...lines, { line, start: previous ? previous.start + previous.line.length + 1 : 0 }]
  }, [])

  // One section block, shared by every layout; a layout only decides which column holds it.
  const paperColumns = partitionSections(layout, enabled)
  const paperSection = (id: string) => <section key={id} className={`${styles.paperSection} ${active === id ? styles.paperSelected : ''} ${editing?.draggingId === id ? styles.dragOrigin : ''}`} data-sort-id={editing ? id : undefined} data-paper-section={id} data-flip-key={editing ? `canvas:${id}` : undefined} onClick={editing ? () => editing.onSelect(id, true) : undefined}>
      {editing?.dropMarker(id)}{editing && active === id && <span key={editing.selectionPulse} className={styles.registrationSettle} aria-hidden="true" />}{editing && <div className={styles.blockControls} onClick={(event) => event.stopPropagation()}>{editing.dragHandle(id)}<button type="button" className={styles.blockEdit} onClick={() => editing.onSelect(id, true)} aria-label={editing.editLabel(id)}><Glyph name="edit" />{editing.editText}</button></div>}
      <h3 style={{ '--heading-icon-size': headingIconSize === 'small' ? '.82em' : headingIconSize === 'large' ? '1.18em' : headingIconSize === 'custom' ? `${headingIconCustomSize}em` : '1em', '--heading-icon-color': headingIconColor === 'accent' ? accentColor : headingIconColor } as CSSProperties}>{headingIcons[id] && headingIcons[id] !== 'none' && <span className={styles.paperHeadingIcon}><ResumeHeadingIcon name={headingIcons[id]} /></span>}<span data-banglish-field={editing ? `title:${id}` : undefined}><BanglishWords value={title(id)} sources={validBanglishSources(title(id), sourcesFor(`title:${id}`))} onCorrect={correct(`title:${id}`)} t={t} /></span></h3>{sectionDividers[id]?.enabled && sectionDividers[id].underHeading && <hr className={styles.paperDivider + ' ' + styles.paperDivider_underHeading} style={{ '--divider-color': dividerColor(sectionDividers[id].color), '--divider-thickness': `${sectionDividers[id].thickness}px` } as CSSProperties} />}<div className={styles.sectionText} data-banglish-field={editing ? `content:${id}` : undefined}>{(content[id] ?? '').trim() ? <SectionText value={content[id]} sources={validBanglishSources(content[id], sourcesFor(`content:${id}`))} live={live} onCorrect={correct(`content:${id}`)} t={t} /> : <p className={styles.emptySection}>{emptyText}</p>}</div>
      {sectionDividers[id]?.enabled && !sectionDividers[id].underHeading && enabled.indexOf(id) < enabled.length - 1 && <hr className={`${styles.paperDivider} ${styles[`paperDivider_${sectionDividers[id].style}`]}`} style={{ '--divider-color': dividerColor(sectionDividers[id].color), '--divider-thickness': `${sectionDividers[id].thickness}px` } as CSSProperties} />}
                  </section>

  return <article ref={articleRef} className={styles.paper} lang={language === 'Bangla' ? 'bn' : 'en'} data-font={font} data-layout={layout} style={paperStyle} aria-label={ariaLabel}>
    <header className={`${styles.paperHeader} ${profileImage ? styles.headerHasPhoto : ''} ${active === 'profile' ? styles.paperSelected : ''}`} data-align={profileAlign} data-paper-section="profile" onClick={editing ? () => editing.onSelect('profile', true) : undefined}>
      {editing && <div className={styles.blockControls}><button type="button" className={styles.blockEdit} onClick={(event) => { event.stopPropagation(); editing.onSelect('profile', true) }} aria-label={editing.editLabel('profile')}><Glyph name="edit" />{editing.editText}</button></div>}
      {editing && active === 'profile' && <span key={editing.selectionPulse} className={styles.registrationSettle} aria-hidden="true" />}
      <div className={styles.headerText}><span className={styles.paperKicker}>{language === 'Bangla' ? editorText(purpose, 'Bangla') : purpose}</span><h2 data-banglish-field={editing ? 'title:profile' : undefined}><BanglishWords value={fullName || nameFallback} sources={validBanglishSources(fullName, sourcesFor('title:profile'))} onCorrect={correct('title:profile')} t={t} /></h2><p data-banglish-field={editing ? 'content:profile' : undefined}>{contactLines.map(({ line, start }, lineIndex) => {
        // The contact row: a line carrying a link earns the scheme-matched
        // glyph ahead of it; untouched lines keep writing exactly as typed.
        const contact = parseContactLine(line)
        return <span key={`contact-${lineIndex}`} className={styles.paperContactLine}>{contact.icon && <ResumeContactIcon name={contact.icon} className={styles.paperContactIcon} />}{contactParts(parseInline(line, start), `contact-${lineIndex}`, validBanglishSources(line, sourcesFor('content:profile')))}</span>
      })}</p></div>
      {photoSrc && (
        /* Data-URI already re-encoded and size-capped at ingest (readProfilePhoto);
           there is no remote source for next/image's loader to optimize or resize. */
        <span className={styles.photoWrap} data-resizing={editing ? editing.photoResizing : undefined} style={{ width: `${Math.round(photoSize)}mm`, height: `${Math.round(photoSize)}mm` }}>
          <span className={styles.photoFrame} data-shape={photoShape}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.headerPhoto} src={photoSrc} alt="" />
          </span>
          {editing?.photoControls}
        </span>
      )}
    </header>
    {sectionDividers.profile?.enabled && enabled.length > 1 && (sectionDividers.profile.underHeading ? <div className={styles.paperDivider + ' ' + styles.paperDivider_underHeading} /> : <hr className={`${styles.paperDivider} ${styles[`paperDivider_${sectionDividers.profile.style}`]}`} style={{ '--divider-color': dividerColor(sectionDividers.profile.color), '--divider-thickness': `${sectionDividers.profile.thickness}px` } as CSSProperties} />)}
    <div className={styles.paperBody} data-has-rail={paperColumns.rail.length > 0 || undefined}>{paperColumns.rail.length ? <><div className={styles.paperMain}>{paperColumns.main.map(paperSection)}</div><div className={styles.paperRail}>{paperColumns.rail.map(paperSection)}</div></> : paperColumns.main.map(paperSection)}</div>
  </article>
}
