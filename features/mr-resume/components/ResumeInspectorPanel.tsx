'use client'

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from 'react'
import styles from './MrResumeStudio.module.css'
import { Glyph, StudioDropdown, type GlyphName } from './MrResumeStudioControls'
import type { PhotoBackground, PhotoBackgroundId } from './photoBackground'
import { ResumeHeadingIcon, resumeHeadingIconOptions, type ResumeHeadingIconId } from './ResumeHeadingIcon'
import { convertTailForCaret, isBijoyLikely } from './banglish'

type InspectorMode = 'section' | 'page'
type MobilePanel = 'sections' | 'write' | 'preview' | 'settings'
type ProfileAlign = 'left' | 'center' | 'right'
type PhotoShape = 'circle' | 'square'
type BulletStyle = { prefix: string; label: string; example: string }
type PaperSize = { width: number; height: number; dimensions: string; tex: string }
type Accent = { name: string; color: string }
type SpacingPreset = { name: string; leading: number; gap: number }
export type SectionDividerConfig = { enabled: boolean; style: 'solid' | 'dashed' | 'dotted'; color: 'accent' | string; thickness: number }
export type ResumeHeadingIconSize = 'small' | 'medium' | 'large' | 'custom'

export type ResumeInspectorPanelProps = {
  inspector: InspectorMode
  setInspector: Dispatch<SetStateAction<InspectorMode>>
  setMobilePanel: Dispatch<SetStateAction<MobilePanel>>
  sectionTabRef: RefObject<HTMLButtonElement | null>
  pageTabRef: RefObject<HTMLButtonElement | null>
  openPageSettings: () => void
  active: string
  activeIndex: number
  enabled: string[]
  title: (id: string) => string
  resumeTitle: (id: string) => string
  t: (value: string) => string
  sectionDetail: string
  moveSection: (id: string, direction: -1 | 1) => void
  sectionDivider: SectionDividerConfig
  canAddDivider: boolean
  updateSectionDivider: (patch: Partial<SectionDividerConfig>) => void
  dividerAccentColor: string
  activeHeadingIcon: ResumeHeadingIconId
  onHeadingIconChange: (icon: ResumeHeadingIconId) => void
  headingIconSize: ResumeHeadingIconSize
  setHeadingIconSize: Dispatch<SetStateAction<ResumeHeadingIconSize>>
  headingIconCustomSize: number
  headingIconCustomSizeDraft: string
  onHeadingIconCustomSizeChange: (value: number) => void
  onHeadingIconCustomSizeDraftChange: (value: string) => void
  commitHeadingIconCustomSize: (value: string) => void
  headingIconColor: 'accent' | string
  setHeadingIconColor: Dispatch<SetStateAction<'accent' | string>>
  headingAccentColor: string
  titleRef: RefObject<HTMLInputElement | null>
  fullName: string
  setFullName: Dispatch<SetStateAction<string>>
  setTitles: Dispatch<SetStateAction<Record<string, string>>>
  contentRef: RefObject<HTMLTextAreaElement | null>
  contentValue: string
  updateContent: (value: string, kind?: 'typing' | 'action') => void
  wrapSelection: (prefix: string, suffix: string) => void
  insertLink: () => void
  insertNumberedList: () => void
  clearFormatting: () => void
  undoAvailable: boolean
  redoAvailable: boolean
  moveHistory: (direction: 'undo' | 'redo') => void
  bulletStyle: BulletStyle
  setBulletStyle: Dispatch<SetStateAction<BulletStyle>>
  bulletMenuOpen: boolean
  setBulletMenuOpen: Dispatch<SetStateAction<boolean>>
  bulletStyles: BulletStyle[]
  insertBullet: (style?: BulletStyle) => void
  profileAligns: ProfileAlign[]
  profileAlign: ProfileAlign
  setProfileAlign: Dispatch<SetStateAction<ProfileAlign>>
  alignGlyph: Record<ProfileAlign, GlyphName>
  photoInputRef: RefObject<HTMLInputElement | null>
  chooseProfilePhoto: (event: ChangeEvent<HTMLInputElement>) => void
  photoSrc: string | null
  photoTriggerRef: RefObject<HTMLButtonElement | null>
  openProfilePhotoPicker: (event: ReactMouseEvent<HTMLButtonElement>) => void
  removeProfilePhoto: () => void
  photoShape: PhotoShape
  setPhotoShape: Dispatch<SetStateAction<PhotoShape>>
  photoBackground: PhotoBackgroundId
  choosePhotoBackground: (preset: PhotoBackground) => void
  photoBackgrounds: PhotoBackground[]
  photoCustomColor: string
  setPhotoCustomColor: Dispatch<SetStateAction<string>>
  photoBlur: number
  setPhotoBlur: Dispatch<SetStateAction<number>>
  accent: number
  setAccent: Dispatch<SetStateAction<number>>
  accents: Accent[]
  customAccentColor: string
  setCustomAccentColor: Dispatch<SetStateAction<string>>
  customAccentIndex: number
  removeSection: (id: string) => void
  documentTitle: string
  setDocumentTitle: Dispatch<SetStateAction<string>>
  pageSize: 'A4' | 'Letter'
  setPageSize: Dispatch<SetStateAction<'A4' | 'Letter'>>
  paperSizes: Record<'A4' | 'Letter', PaperSize>
  font: string
  setFont: Dispatch<SetStateAction<string>>
  typefaces: { name: string; family: string }[]
  fontFamily: string
  fontSize: number
  setFontSize: Dispatch<SetStateAction<number>>
  leading: number
  setLeading: Dispatch<SetStateAction<number>>
  leadingDraft: string
  setLeadingDraft: Dispatch<SetStateAction<string>>
  sectionGap: number
  setSectionGap: Dispatch<SetStateAction<number>>
  sectionGapDraft: string
  setSectionGapDraft: Dispatch<SetStateAction<string>>
  margin: number
  setMargin: Dispatch<SetStateAction<number>>
  marginDraft: string
  setMarginDraft: Dispatch<SetStateAction<string>>
  spacingPresets: SpacingPreset[]
  resetPageSettings: () => void
  banglishMode: boolean
  setBanglishMode: Dispatch<SetStateAction<boolean>>
}

export default function ResumeInspectorPanel(props: ResumeInspectorPanelProps) {
  const {
    inspector, setInspector, setMobilePanel, sectionTabRef, pageTabRef, openPageSettings,
    active, activeIndex, enabled, title, resumeTitle, t, sectionDetail, moveSection, sectionDivider, canAddDivider, updateSectionDivider, dividerAccentColor,
    activeHeadingIcon, onHeadingIconChange, headingIconSize, setHeadingIconSize, headingIconCustomSize, headingIconCustomSizeDraft, onHeadingIconCustomSizeChange, onHeadingIconCustomSizeDraftChange, commitHeadingIconCustomSize, headingIconColor, setHeadingIconColor, headingAccentColor, titleRef, fullName,
    setFullName, setTitles, contentRef, contentValue, updateContent,
    wrapSelection, insertLink, insertNumberedList, clearFormatting, undoAvailable, redoAvailable,
    moveHistory, bulletStyle, setBulletStyle, bulletMenuOpen, setBulletMenuOpen, bulletStyles,
    insertBullet, profileAligns, profileAlign, setProfileAlign, alignGlyph, photoInputRef,
    chooseProfilePhoto, photoSrc, photoTriggerRef, openProfilePhotoPicker, removeProfilePhoto,
    photoShape, setPhotoShape, photoBackground, choosePhotoBackground, photoBackgrounds,
    photoCustomColor, setPhotoCustomColor, photoBlur, setPhotoBlur, accent, setAccent, accents,
    customAccentColor, setCustomAccentColor, customAccentIndex, removeSection, documentTitle,
    setDocumentTitle, pageSize, setPageSize, paperSizes, font, setFont, typefaces, fontFamily,
    fontSize, setFontSize, leading, setLeading, leadingDraft, setLeadingDraft, sectionGap,
    setSectionGap, sectionGapDraft, setSectionGapDraft, margin, setMargin, marginDraft,
    setMarginDraft, spacingPresets, resetPageSettings, banglishMode, setBanglishMode,
  } = props

  // Banglish typing state — the আ toggle lives in the writing-heading row.
  const [lastSuggest, setLastSuggest] = useState<{ start: number; end: number; options: string[] } | null>(null)
  const [bijoyOffer, setBijoyOffer] = useState<{ start: number; end: number } | null>(null)
  const [bijoyState, setBijoyState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const pendingCaret = useRef<number | null>(null)

  // Switching sections invalidates every range the chips point at.
  useEffect(() => {
    setLastSuggest(null)
    setBijoyOffer(null)
    setBijoyState('idle')
  }, [active])

  // After an in-place replacement the caret is rebuilt where the word landed.
  useEffect(() => {
    const caret = pendingCaret.current
    if (caret === null) return
    pendingCaret.current = null
    const input = contentRef.current
    if (!input) return
    requestAnimationFrame(() => {
      input.focus()
      const at = Math.min(caret, input.value.length)
      input.setSelectionRange(at, at)
    })
  }, [contentValue, contentRef])

  function handleType(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    if (banglishMode) {
      const caret = event.target.selectionStart ?? value.length
      const conversion = convertTailForCaret(value, caret)
      if (conversion) {
        updateContent(conversion.next, 'typing')
        pendingCaret.current = conversion.start + (caret - conversion.end)
        setLastSuggest({ start: conversion.start, end: conversion.end, options: conversion.candidates })
        return
      }
      setLastSuggest(null)
    }
    updateContent(value, 'typing')
  }

  // Paste lands raw first — the canvas and the input always match; the Bijoy
  // offer, when the paste reeks of legacy encoding, is explicitly ours to take.
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData('text')
    if (!pasted) return
    event.preventDefault()
    const input = contentRef.current
    const start = input?.selectionStart ?? contentValue.length
    const end = input?.selectionEnd ?? start
    updateContent(contentValue.slice(0, start) + pasted + contentValue.slice(end), 'typing')
    if (isBijoyLikely(pasted)) {
      pendingCaret.current = null
      setBijoyState('idle')
      setBijoyOffer({ start, end: start + pasted.length })
    } else {
      pendingCaret.current = start + pasted.length
    }
  }

  async function convertBijoy() {
    const offer = bijoyOffer
    if (!offer || bijoyState === 'busy') return
    setBijoyState('busy')
    try {
      const source = contentValue.slice(offer.start, offer.end)
      const response = await fetch('/api/bijoy-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      })
      const body: unknown = await response.json()
      const converted = (body as { text?: unknown }).text
      if (!response.ok || typeof converted !== 'string') throw new Error('bijoy-convert failed')
      // Re-splice against the live value so edits made after pasting survive.
      const current = contentRef.current?.value ?? contentValue
      updateContent(current.slice(0, offer.start) + converted + current.slice(offer.end), 'action')
      setBijoyOffer(null)
      setBijoyState('idle')
    } catch {
      setBijoyState('failed')
    }
  }

  function keepPastedText() {
    setBijoyOffer(null)
    setBijoyState('idle')
  }

  function applyReading(option: string) {
    if (!lastSuggest) return
    updateContent(contentValue.slice(0, lastSuggest.start) + option + contentValue.slice(lastSuggest.end), 'action')
    pendingCaret.current = lastSuggest.start + option.length
    setLastSuggest(null)
  }


  return (
        <aside className={styles.rightPanel} aria-label={t('Document inspector')}>
          <div className={styles.inspectorTabs} role="tablist" aria-label={t('Inspector mode')} onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const next = event.key === 'Home' ? 'section' : event.key === 'End' ? 'page' : inspector === 'section' ? 'page' : 'section'
              if (next === 'page') openPageSettings(); else { setInspector('section'); setMobilePanel('write') }
              ;(next === 'page' ? pageTabRef : sectionTabRef).current?.focus()
            }
          }}><button ref={sectionTabRef} type="button" role="tab" id="section-tab" aria-selected={inspector === 'section'} aria-controls="section-inspector" tabIndex={inspector === 'section' ? 0 : -1} onClick={() => { setInspector('section'); setMobilePanel('write') }}><Glyph name="edit" />{t('Section')}</button><button ref={pageTabRef} type="button" role="tab" id="page-tab" aria-selected={inspector === 'page'} aria-controls="page-inspector" tabIndex={inspector === 'page' ? 0 : -1} onClick={openPageSettings}><Glyph name="settings" />{t('Page')}</button></div>
          <div className={styles.inspectorScroll}>
            {inspector === 'section' ? <div id="section-inspector" role="tabpanel" aria-labelledby="section-tab">
              <div className={`${styles.editHeading} ${styles.sectionEditHeading}`}><span className={styles.eyebrow}>{active === 'profile' ? t('DOCUMENT HEADER') : `${t('SECTION')} ${String(activeIndex).padStart(2, '0')}`}</span><h2>{title(active) || t('Untitled section')}</h2><p>{t(sectionDetail)}</p></div>
              {active !== 'profile' && <div className={styles.sectionPosition}><h3>{t('Section position')}</h3><div className={styles.sectionMoveControls}><button type="button" aria-label={t('Move section up')} title={t('Move section up')} disabled={activeIndex <= 1} onClick={() => moveSection(active, -1)}><Glyph name="up" /><span>{t('Move up')}</span></button><button type="button" aria-label={t('Move section down')} title={t('Move section down')} disabled={activeIndex === enabled.length - 1} onClick={() => moveSection(active, 1)}><Glyph name="down" /><span>{t('Move down')}</span></button></div></div>}
              <section className={styles.dividerSettings} aria-labelledby="section-divider-title">
                <div className={styles.dividerSettingsHeading}>
                  <div><h3 id="section-divider-title">{t('Section divider')}</h3><p>{canAddDivider ? `${t('Add a visual break after this section.')} ${title(active)}` : t('The final section has no section after it.')}</p></div>
                  <button type="button" className={`${styles.dividerToggle} ${sectionDivider.enabled && canAddDivider ? styles.dividerToggleOn : ''}`} role="switch" aria-checked={sectionDivider.enabled && canAddDivider} aria-label={t('Show divider after this section')} disabled={!canAddDivider} onClick={() => updateSectionDivider({ enabled: !sectionDivider.enabled })}><span /></button>
                </div>
                {sectionDivider.enabled && canAddDivider && <div className={styles.dividerOptions}>
                  <div className={styles.dividerOptionRow}><span className={styles.settingLabel}>{t('Style')}</span><div className={`${styles.segmented} ${styles.dividerStyles}`} role="group" aria-label={t('Divider style')}>
                    {(['solid', 'dashed', 'dotted'] as const).map((style) => <button key={style} type="button" className={sectionDivider.style === style ? styles.segmentActive : ''} aria-pressed={sectionDivider.style === style} onClick={() => updateSectionDivider({ style })}><span className={`${styles.dividerStyleSample} ${styles[`dividerSample_${style}`]}`} aria-hidden="true" /><span>{t(style.charAt(0).toUpperCase() + style.slice(1))}</span></button>)}
                  </div></div>
                  <div className={styles.dividerOptionRow}><label className={styles.settingLabel} htmlFor="section-divider-thickness">{t('Thickness')}</label><div className={styles.dividerRange}><input id="section-divider-thickness" type="range" min="0.5" max="2" step="0.25" value={sectionDivider.thickness} onChange={(event) => updateSectionDivider({ thickness: Number(event.target.value) })} /><output htmlFor="section-divider-thickness">{sectionDivider.thickness.toFixed(2).replace(/0$/u, '')} pt</output></div></div>
                  <div className={styles.dividerOptionRow}><span className={styles.settingLabel}>{t('Color')}</span><div className={styles.dividerColorOptions}>
                    <button type="button" className={`${styles.dividerColorChoice} ${sectionDivider.color === 'accent' ? styles.dividerColorSelected : ''}`} aria-pressed={sectionDivider.color === 'accent'} onClick={() => updateSectionDivider({ color: 'accent' })}><span style={{ backgroundColor: dividerAccentColor }} />{t('Accent')}</button>
                    <label className={`${styles.dividerColorChoice} ${sectionDivider.color !== 'accent' ? styles.dividerColorSelected : ''}`}><input aria-label={t('Custom divider color')} type="color" value={sectionDivider.color === 'accent' ? dividerAccentColor : sectionDivider.color} onChange={(event) => updateSectionDivider({ color: event.target.value.toLowerCase() })} /><span>{t('Custom')}</span></label>
                  </div></div>
                  <div className={styles.dividerPreview} aria-hidden="true"><span className={`${styles.dividerPreviewLine} ${styles[`dividerSample_${sectionDivider.style}`]}`} style={{ '--divider-color': sectionDivider.color === 'accent' ? dividerAccentColor : sectionDivider.color, '--divider-thickness': `${sectionDivider.thickness}px` } as CSSProperties} /></div>
                </div>}
              </section>
              <label className={styles.contentLabel} htmlFor="section-title">{active === 'profile' ? t('Full name') : t('Section heading')}</label>
              <input ref={titleRef} id="section-title" className={styles.textInput} value={active === 'profile' ? fullName : resumeTitle(active)} onChange={(event) => active === 'profile' ? setFullName(event.target.value) : setTitles((current) => ({ ...current, [active]: event.target.value }))} placeholder={active === 'profile' ? t('Your full name') : t('e.g. Certifications')} />
              {active !== 'profile' && <details className={styles.headingIconSettings}>
                <summary><span className={styles.headingIconSummaryTitle}><b>{t('Heading icon')}</b><small>{t('Optional')}</small></span><span className={styles.headingIconSummaryValue}>{activeHeadingIcon !== 'none' && <ResumeHeadingIcon name={activeHeadingIcon} />}<span>{activeHeadingIcon === 'none' ? t('None') : t(resumeHeadingIconOptions.find((item) => item.id === activeHeadingIcon)?.label ?? '')}</span><Glyph name="chevron" /></span></summary>
                <p className={styles.headingIconHint}>{t('Choose a restrained mark for this section. Size and color apply to all section icons.')}</p>
                <div className={styles.headingIconCatalog}>
                  <button type="button" className={`${styles.headingIconChoice} ${activeHeadingIcon === 'none' ? styles.headingIconChoiceActive : ''}`} aria-pressed={activeHeadingIcon === 'none'} onClick={() => onHeadingIconChange('none')}><span className={styles.headingIconNone}>—</span><span>{t('None')}</span></button>
                  {(['Career', 'Profile'] as const).map((group) => <div className={styles.headingIconGroup} key={group}>
                    <span className={styles.headingIconGroupLabel}>{t(group)}</span>
                    <div className={styles.headingIconGrid} role="group" aria-label={`${t(group)} ${t('icons')}`}>
                      {resumeHeadingIconOptions.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" className={`${styles.headingIconChoice} ${activeHeadingIcon === item.id ? styles.headingIconChoiceActive : ''}`} aria-pressed={activeHeadingIcon === item.id} onClick={() => onHeadingIconChange(item.id)}><ResumeHeadingIcon name={item.id} /><span>{t(item.label)}</span></button>)}
                    </div>
                  </div>)}
                </div>
                <div className={styles.headingIconGlobal}>
                  <div className={styles.headingIconSettingRow}><span className={styles.settingLabel}>{t('Size')}</span><div className={`${styles.segmented} ${styles.headingIconSizes}`} role="group" aria-label={t('Section icon size')}>
                    {(['small', 'medium', 'large', 'custom'] as const).map((size) => <button key={size} type="button" className={headingIconSize === size ? styles.segmentActive : ''} aria-pressed={headingIconSize === size} onClick={() => setHeadingIconSize(size)}>{t(size === 'medium' ? 'Default' : size.charAt(0).toUpperCase() + size.slice(1))}</button>)}
                  </div></div>
                  {headingIconSize === 'custom' && <div className={styles.headingIconCustomScale}><label htmlFor="section-icon-custom-size">{t('Custom scale')}</label><div><input id="section-icon-custom-size" type="range" min="0.6" max="1.8" step="0.05" value={headingIconCustomSize} onChange={(event) => onHeadingIconCustomSizeChange(Number(event.target.value))} /><output htmlFor="section-icon-custom-size">{headingIconCustomSize.toFixed(2)}×</output><input className={styles.headingIconNumber} type="number" min="0.6" max="1.8" step="0.05" value={headingIconCustomSizeDraft} aria-label={t('Custom section icon scale')} onChange={(event) => onHeadingIconCustomSizeDraftChange(event.target.value)} onBlur={() => commitHeadingIconCustomSize(headingIconCustomSizeDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></div><small>{t('Relative to the heading text size')}</small></div>}
                  <div className={styles.headingIconSettingRow}><span className={styles.settingLabel}>{t('Color')}</span><div className={styles.dividerColorOptions}>
                    <button type="button" className={`${styles.dividerColorChoice} ${headingIconColor === 'accent' ? styles.dividerColorSelected : ''}`} aria-pressed={headingIconColor === 'accent'} onClick={() => setHeadingIconColor('accent')}><span style={{ backgroundColor: headingAccentColor }} />{t('Accent')}</button>
                    <label className={`${styles.dividerColorChoice} ${headingIconColor !== 'accent' ? styles.dividerColorSelected : ''}`}><input aria-label={t('Custom section icon color')} type="color" value={headingIconColor === 'accent' ? headingAccentColor : headingIconColor} onChange={(event) => setHeadingIconColor(event.target.value.toLowerCase())} /><span>{t('Custom')}</span></label>
                  </div></div>
                </div>
              </details>}
              <div className={styles.writingHeading}><label className={styles.contentLabel} htmlFor="section-content">{active === 'profile' ? t('Role and contact details') : t('Section content')}</label><button type="button" className={`${styles.banglishToggle} ${banglishMode ? styles.banglishToggleOn : ''}`} aria-pressed={banglishMode} title={t(banglishMode ? 'Bangla typing: on' : 'Bangla typing: off')} aria-label={t(banglishMode ? 'Bangla typing: on' : 'Bangla typing: off')} onClick={() => setBanglishMode((current) => !current)}>আ</button></div>
              {active !== 'profile' && <div className={styles.formatPanel} role="group" aria-label={t('Section formatting tools')}>
                <span className={styles.formatPanelLabel} aria-hidden="true"><span className={styles.formatPanelDot}></span>{t('FORMAT')}</span>
                <div className={styles.formatToolbar}>
                  <div className={styles.formatActions} role="group" aria-label={t('Text formatting')} onMouseDown={(event) => event.preventDefault()}>
                    <button type="button" className={styles.formatButton} onClick={() => wrapSelection('**', '**')} aria-label={t('Bold')} title={t('Bold')}><strong>B</strong></button>
                    <button type="button" className={styles.formatButton} onClick={() => wrapSelection('_', '_')} aria-label={t('Italic')} title={t('Italic')}><i>I</i></button>
                    <button type="button" className={styles.formatButton} onClick={insertLink} aria-label={t('Add or remove link')} title={t('Add or remove link')}><Glyph name="globe" /></button>
                  </div>
                  <div className={styles.formatUtilityActions} role="group" aria-label={t('More text formatting')} onMouseDown={(event) => event.preventDefault()}>
                    <button type="button" className={styles.formatButton} onClick={insertNumberedList} aria-label={t('Toggle numbered list')} title={t('Toggle numbered list')}><Glyph name="numbered" /></button>
                    <button type="button" className={styles.formatButton} onClick={clearFormatting} aria-label={t('Clear formatting')} title={t('Clear formatting')}><Glyph name="clear" /></button>
                    <button type="button" className={styles.formatButton} onClick={() => moveHistory('undo')} disabled={!undoAvailable} aria-label={t('Undo (Ctrl+Z)')} title={t('Undo (Ctrl+Z)')}><Glyph name="undo" /></button>
                    <button type="button" className={styles.formatButton} onClick={() => moveHistory('redo')} disabled={!redoAvailable} aria-label={t('Redo (Ctrl+Y)')} title={t('Redo (Ctrl+Y)')}><Glyph name="redo" /></button>
                  </div>
                  <span className={styles.formatDivider} aria-hidden="true"></span>
                  <div className={styles.bulletGroup}>
                    <button type="button" className={styles.bulletTypeButton} onClick={() => setBulletMenuOpen((open) => !open)} aria-label={t('Bullet style')} aria-expanded={bulletMenuOpen}><span>{t(bulletStyle.label)}</span><Glyph name="chevron" /></button>
                    {bulletMenuOpen && <div className={styles.bulletMenu} role="menu">{bulletStyles.map((style) => <button type="button" key={style.prefix} role="menuitem" className={bulletStyle.prefix === style.prefix ? styles.bulletActive : ''} onClick={() => { setBulletStyle(style); setBulletMenuOpen(false); insertBullet(style) }}><code>{style.prefix.trim() || '\u2022'}</code><span>{t(style.label)}</span><small>{t(style.example)}</small></button>)}</div>}
                    <button type="button" className={styles.bulletAddButton} onClick={() => insertBullet()} aria-label={t('Add bullet')}><Glyph name="list" /><span>{t('Add')}</span></button>
                  </div>
                </div>
              </div>}
              <textarea ref={contentRef} id="section-content" className={styles.contentInput} value={contentValue} onChange={handleType} onPaste={handlePaste} onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey)) return
                const key = event.key.toLowerCase()
                if (key === 'z') { event.preventDefault(); moveHistory(event.shiftKey ? 'redo' : 'undo') }
                else if (key === 'y') { event.preventDefault(); moveHistory('redo') }
              }} rows={active === 'profile' ? 7 : 13} placeholder={t('Write your content here...')} />
              {lastSuggest && <div className={styles.typeSuggest} role="group" aria-label={t('Other readings')}>
                {(() => {
                  const current = contentValue.slice(lastSuggest.start, lastSuggest.end)
                  const readings = lastSuggest.options.filter((option) => option !== current)
                  if (readings.length === 0) return null
                  return <><span className={styles.typeSuggestLabel}>{t('Other readings')}</span>{readings.map((option) => <button key={option} type="button" className={styles.typeSuggestButton} onClick={() => applyReading(option)}>{option}</button>)}</>
                })()}
              </div>}
              {bijoyOffer && <div className={styles.bijoyOffer} role="status">
                {bijoyState === 'failed'
                  ? <>
                    <p>{t('Bijoy conversion failed. The text is unchanged.')}</p>
                    <button type="button" className={styles.bijoyKeep} onClick={keepPastedText}><Glyph name="close" />{t('Dismiss notification')}</button>
                  </>
                  : <>
                    <p>{t('This looks like legacy Bijoy text. Convert to Unicode Bangla?')}</p>
                    <button type="button" className={styles.bijoyConvert} disabled={bijoyState === 'busy'} onClick={convertBijoy}><Glyph name={bijoyState === 'busy' ? 'check' : 'globe'} />{bijoyState === 'busy' ? t('Converting…') : t('Convert to Unicode')}</button>
                    <button type="button" className={styles.bijoyKeep} onClick={keepPastedText}>{t('Keep as is')}</button>
                  </>}
              </div>}
              <p className={styles.helperText}>{banglishMode ? t('Banglish typing is on. Write Banglish — the finished word becomes Bangla as soon as you space it. English words like Excel stay as typed.') : active === 'profile' ? t('Add your role, location, email, phone and links on separate lines.') : t('Blank lines separate entries. Select text for formatting, or choose a bullet style and add an item.')}</p>
              <div className={styles.writingMeta}><span>{t('Live on the canvas')}</span><span>{contentValue.length} {t('characters')}</span></div>
              {active === 'profile' && <div className={styles.identityFields}>
                <section className={`${styles.identityCard} ${styles.alignField}`} aria-labelledby="header-align-label">
                  <div className={styles.identityHeading}>
                    <h3 id="header-align-label">{t('Name alignment')}</h3>
                    <p>{t('Choose where your name and contact details sit.')}</p>
                  </div>
                  <div className={`${styles.segmented} ${styles.alignOptions}`} role="group" aria-labelledby="header-align-label">
                    {profileAligns.map((item) => <button type="button" key={item} className={profileAlign === item ? styles.segmentActive : ''} aria-pressed={profileAlign === item} onClick={() => setProfileAlign(item)}><Glyph name={alignGlyph[item]} /><span>{t(item.charAt(0).toUpperCase() + item.slice(1))}</span></button>)}
                  </div>
                </section>
                <section className={`${styles.identityCard} ${styles.photoField}`} aria-labelledby="profile-photo-label">
                  <input ref={photoInputRef} className={styles.photoInput} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" aria-label={t('Choose a profile photo file')} onChange={chooseProfilePhoto} />
                  <div className={styles.identityHeading}>
                    <h3 id="profile-photo-label">{t('Profile photo')} <span>{t('Optional')}</span></h3>
                    <p>{t('A portrait adds a personal touch to your document.')}</p>
                  </div>
                  {photoSrc ? <>
                    <div className={styles.photoControls}>
                      {/* Data-URI re-encoded at ingest; next/image adds nothing for it. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className={styles.photoThumb} src={photoSrc} data-shape={photoShape} alt={t('Profile photo preview')} />
                      <div className={styles.photoActions}>
                        <button ref={photoTriggerRef} type="button" className={styles.photoAction} onClick={openProfilePhotoPicker}><Glyph name="plus" /><span>{t('Replace')}</span></button>
                        <button type="button" className={styles.photoAction} onClick={removeProfilePhoto}><Glyph name="close" /><span>{t('Remove')}</span></button>
                      </div>
                    </div>
                    <div className={styles.photoSettings}>
                      <span className={styles.settingLabel}>{t('Shape')}</span>
                      <div className={`${styles.segmented} ${styles.shapeOptions}`} role="group" aria-label={t('Photo shape')}>
                        {(['circle', 'square'] as PhotoShape[]).map((item) => <button type="button" key={item} className={photoShape === item ? styles.segmentActive : ''} aria-pressed={photoShape === item} onClick={() => setPhotoShape(item)}><Glyph name={item === 'circle' ? 'shapeCircle' : 'shapeSquare'} /><span>{t(item === 'circle' ? 'Circle' : 'Square')}</span></button>)}
                      </div>
                      <span className={styles.settingLabel}>{t('Background')}</span>
                      <div className={styles.swatches} role="group" aria-label={t('Photo background')}>
                        <button type="button" className={styles.photoOriginal} onClick={() => choosePhotoBackground(photoBackgrounds[0])} aria-pressed={photoBackground === 'none'}>
                          <span><b>{t('Use original photo')}</b><small>{t('Keep its current background')}</small></span>
                          {photoBackground === 'none' && <Glyph name="check" />}
                        </button>
                        {photoBackgrounds.filter((preset) => preset.id !== 'none').map((preset) => <button type="button" key={preset.id} style={{ '--swatch': preset.id === 'blur' ? undefined : preset.id === 'custom' ? photoCustomColor : preset.color ?? (accent < accents.length ? accents[accent].color : customAccentColor) } as CSSProperties} className={`${styles.swatch} ${preset.id === 'blur' ? styles.swatchBlur : ''} ${preset.id === 'custom' ? styles.swatchCustom : ''} ${photoBackground === preset.id ? styles.swatchSelected : ''}`} onClick={() => choosePhotoBackground(preset)} aria-label={`${t(preset.name)} ${t('photo background')}`} aria-pressed={photoBackground === preset.id} />)}
                      </div>
                      {photoBackground === 'blur' && <>
                        {/* The blur dial shares the page-settings range idiom; a change re-bakes from the original. */}
                        <div className={styles.rangeHeading}><label htmlFor="photo-blur">{t('Blur amount')}</label><output htmlFor="photo-blur">{photoBlur}%</output></div>
                        <input id="photo-blur" className={styles.range} type="range" min="20" max="100" step="5" value={photoBlur} onChange={(event) => setPhotoBlur(Number(event.target.value))} />
                      </>}
                      {photoBackground === 'custom' && <div className={styles.photoTint}>
                        <label className={styles.settingLabel} htmlFor="photo-tint">{t('Custom color')}</label>
                        {/* Native picker: valid #rrggbb out of the box, no extra palette wheel to build. */}
                        <input id="photo-tint" className={styles.colorField} type="color" value={photoCustomColor} onChange={(event) => setPhotoCustomColor(event.target.value.toLowerCase())} />
                        <code aria-hidden="true">{photoCustomColor.toUpperCase()}</code>
                      </div>}
                      <p className={styles.photoSettingCopy}>{t('Resizes with its corner handle on the page. Backdrop presets repaint the selected photo backdrop with paper-matched color, Blur softens only that backdrop, and Custom picks any tint.')}</p>
                    </div>
                  </> : <button ref={photoTriggerRef} type="button" className={styles.photoAdd} onClick={openProfilePhotoPicker}><Glyph name="plus" /><span>{t('Add a photo…')}</span></button>}
                  <p className={styles.helperText}>{t('Kept on this device. Included in the draft PDF.')}</p>
                </section>
              </div>}
              {active !== 'profile' && <div className={styles.sectionActions}><button type="button" className={styles.removeSection} onClick={() => removeSection(active)}>{t('Remove from document')}</button><p>{t('Content is kept in the section library, so you can add it back.')}</p></div>}
              <div className={styles.editorNote}><Glyph name="page" /><p>{t('Your words and layout are separate. Typography lives in')} <button type="button" onClick={openPageSettings}>{t('Page settings')}</button>.</p></div>
            </div> : <div id="page-inspector" role="tabpanel" aria-labelledby="page-tab">
              <div className={styles.pageSettingsHeading}><h2>{t('Page settings')}</h2><span className={styles.eyebrow}>{t('DOCUMENT-WIDE')}</span><p>{t('Set the rhythm. Give your words room.')}</p></div>
              <div className={styles.mobileDocumentName}>
                <label className={styles.contentLabel} htmlFor="mobile-document-name">{t('Document name')}</label>
                <input id="mobile-document-name" className={styles.textInput} value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} />
                <p className={styles.helperText}>{t('Used as the name of your exported file.')}</p>
              </div>
              {/* ── P1: Canvas ── */}
              <div className={styles.settingsDivider}><span className={styles.dividerStep}>{t('PRIORITY 1')}</span><span>{t('Canvas')}</span></div>
              <fieldset className={`${styles.settingsGroup} ${styles.pageFormatGroup}`}>
                <legend><Glyph name="page" />{t('Page format')}</legend>
                <div className={styles.paperChoices} role="group" aria-label={t('Page size')}>{(Object.keys(paperSizes) as (keyof typeof paperSizes)[]).map((item) => <button type="button" key={item} className={pageSize === item ? styles.paperChoiceActive : ''} onClick={() => setPageSize(item)} aria-pressed={pageSize === item}><span className={styles.miniPaper} style={{ aspectRatio: paperSizes[item].width / paperSizes[item].height }} /><b>{t(item === 'Letter' ? 'US Letter' : item)}</b><small>{paperSizes[item].dimensions}</small></button>)}</div>
              </fieldset>
              {/* ── P2: Voice ── */}
              <div className={styles.settingsDivider}><span className={styles.dividerStep}>{t('PRIORITY 2')}</span><span>{t('Voice')}</span></div>
              <fieldset className={`${styles.settingsGroup} ${styles.typographyGroup}`}>
                <legend><Glyph name="type" />{t('Typography')}</legend>
                <div className={styles.typefaceRow}>
                  <div className={styles.typefaceControl}><span className={styles.contentLabel}>{t('Typeface')}</span><StudioDropdown value={font} options={typefaces.map((item) => item.name)} onChange={setFont} label={t('Typeface')} /></div>
                  <div className={styles.fontPreview} style={{ fontFamily }} role="img" aria-label={`${font} ${t('type specimen')}: Aa. ${t('Your story, clearly set.')}`}><span>Aa</span><p>{t('Your story, clearly set.')}</p></div>
                </div>
                <div className={styles.numberSetting}>
                  <label htmlFor="body-size"><b>{t('Body text size')}</b><small>{t('Enter to apply. Not canvas zoom.')}</small></label>
                  <span><input key={fontSize} id="body-size" type="number" inputMode="decimal" min="10" max="13" step="0.5" defaultValue={fontSize}
                    onBlur={(event) => {
                      const value = event.currentTarget.valueAsNumber
                      const next = Number.isFinite(value) ? Math.max(10, Math.min(13, value)) : fontSize
                      event.currentTarget.value = String(next)
                      setFontSize(next)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') event.currentTarget.value = String(fontSize)
                      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur() }
                    }} />pt</span>
                </div>
              </fieldset>
              {/* ── P3: Rhythm ── */}
              <div className={styles.settingsDivider}><span className={styles.dividerStep}>{t('PRIORITY 3')}</span><span>{t('Rhythm')}</span></div>
              <fieldset className={styles.settingsGroup}>
                <legend><Glyph name="space" />{t('Spacing & margins')}</legend>
                <div className={styles.spacingPresets} role="group" aria-label={t('Spacing preset')}>{spacingPresets.map((preset) => <button type="button" key={preset.name} onClick={() => { setLeading(preset.leading); setLeadingDraft(preset.leading.toFixed(2)); setSectionGap(preset.gap); setSectionGapDraft(String(preset.gap)) }} aria-pressed={leading === preset.leading && sectionGap === preset.gap}>{t(preset.name)}</button>)}</div>
                <div className={styles.rangeHeading}><label htmlFor="line-spacing-value">{t('Line spacing')}</label><span className={styles.rangeValueControl}><input id="line-spacing-value" type="number" min="1.25" max="1.9" step="0.05" value={leadingDraft} onChange={(event) => setLeadingDraft(event.target.value)} onBlur={() => { const parsed = Number(leadingDraft); const value = leadingDraft.trim() !== '' && Number.isFinite(parsed) ? Math.max(1.25, Math.min(1.9, Math.round(parsed * 20) / 20)) : leading; setLeading(value); setLeadingDraft(value.toFixed(2)) }} aria-label={`${t('Line spacing')} ${t('value')}`} /><span aria-hidden="true">x</span></span></div>
                <input id="line-spacing" className={styles.range} type="range" min="1.25" max="1.9" step="0.05" value={leading} onChange={(event) => { const value = Number(event.target.value); setLeading(value); setLeadingDraft(value.toFixed(2)) }} aria-label={t('Line spacing')} />
                <div className={styles.rangeHeading}><label htmlFor="section-spacing-value">{t('Between sections')}</label><span className={styles.rangeValueControl}><input id="section-spacing-value" type="number" min="12" max="32" step="1" value={sectionGapDraft} onChange={(event) => setSectionGapDraft(event.target.value)} onBlur={() => { const parsed = Number(sectionGapDraft); const value = sectionGapDraft.trim() !== '' && Number.isFinite(parsed) ? Math.max(12, Math.min(32, Math.round(parsed))) : sectionGap; setSectionGap(value); setSectionGapDraft(String(value)) }} aria-label={t('Between sections value')} /><span aria-hidden="true">px</span></span></div>
                <input id="section-spacing" className={styles.range} type="range" min="12" max="32" step="1" value={sectionGap} onChange={(event) => { const value = Number(event.target.value); setSectionGap(value); setSectionGapDraft(String(value)) }} aria-label={t('Between sections')} />
                <div className={styles.rangeHeading}><label htmlFor="page-margins-value">{t('Page margins')}</label><span className={styles.rangeValueControl}><input id="page-margins-value" type="number" min="12" max="26" step="1" value={marginDraft} onChange={(event) => setMarginDraft(event.target.value)} onBlur={() => { const parsed = Number(marginDraft); const value = marginDraft.trim() !== '' && Number.isFinite(parsed) ? Math.max(12, Math.min(26, Math.round(parsed))) : margin; setMargin(value); setMarginDraft(String(value)) }} aria-label={`${t('Page margins')} ${t('value')}`} /><span aria-hidden="true">mm</span></span></div>
                <input id="page-margins" className={styles.range} type="range" min="12" max="26" step="1" value={margin} onChange={(event) => { const value = Number(event.target.value); setMargin(value); setMarginDraft(String(value)) }} aria-label={t('Page margins')} />
              </fieldset>
              {/* ── P4: Personality ── */}
              <div className={styles.settingsDivider}><span className={styles.dividerStep}>{t('PRIORITY 4')}</span><span>{t('Personality')}</span></div>
              <fieldset className={styles.settingsGroup}>
                <legend>{t('Document accent')}</legend>
                <div className={styles.swatches} role="group" aria-label={t('Document accent color')}>
                  {accents.map((item, index) => <button type="button" key={item.name} style={{ '--swatch': item.color } as CSSProperties} className={`${styles.swatch} ${accent === index ? styles.swatchSelected : ''}`} onClick={() => setAccent(index)} aria-label={`${t(item.name)} ${t('accent')}`} aria-pressed={accent === index}>{accent === index && <Glyph name="check" />}</button>)}
                  <button type="button" style={{ '--swatch': customAccentColor } as CSSProperties} className={`${styles.swatch} ${styles.accentCustomSwatch} ${accent === customAccentIndex ? styles.swatchSelected : ''}`} onClick={() => setAccent(customAccentIndex)} aria-label={t('Custom accent color')} aria-pressed={accent === customAccentIndex}>
                    {accent === customAccentIndex && <Glyph name="check" />}
                  </button>
                  <span className={styles.swatchName}>{accent < accents.length ? accents[accent].name : customAccentColor}</span>
                </div>
                {accent === customAccentIndex && <>
                  <p className={styles.customAccentHelp}>{t('Applied to section headings and key details.')}</p>
                  <div className={styles.photoTint}>
                    <label className={styles.settingLabel} htmlFor="custom-accent">{t('Custom color')}</label>
                    <span className={`${styles.accentPickerRing} ${styles.accentCustomSwatch}`}>
                      <input id="custom-accent" className={styles.accentColorInput} type="color" value={customAccentColor} onChange={(event) => setCustomAccentColor(event.target.value.toLowerCase())} />
                    </span>
                    <code aria-hidden="true">{customAccentColor.toUpperCase()}</code>
                  </div>
                </>}
              </fieldset>
              <div className={styles.settingsActions}>
                <button type="button" className={styles.resetSettings} onClick={resetPageSettings}><Glyph name="back" />{t('Reset to defaults')}</button>
              </div>
              <p className={styles.helperText}>{t('Language changes default headings, not your writing. Unsupported Bangla glyphs use an available browser font fallback.')}</p>
            </div>}
          </div>
        </aside>
  )
}
