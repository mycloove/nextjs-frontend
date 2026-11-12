'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { editorText } from '../components/editorLanguage'
import { accentColorOf, defaultResumeDraft, designAccents, paperFontFamily, paperSizes, sectionTitle, templateDesign, templateDocument, type TemplateDesign } from '../components/resumeDocument'
import { getResumeLayout, resumeLayouts, type ResumeLayoutId } from '../components/resumeLayouts'
import ResumePage from '../components/ResumePage'
import { resumeTemplates } from '../components/resumeTemplates'
import { hasAtsStructure, templateBadges, templateCategories, type TemplateCard } from '../components/templateCatalog'
import { thumbnailFor } from './galleryCards'
import { homeText, pick, type HomeLanguage } from './homeText'
import { HomeIcon } from './homeIcons'
import styles from './ResumeHome.module.css'

type Props = {
  card: TemplateCard
  /** Where the card's page sat, for the "proof pull" into the dialog. */
  origin: DOMRect | null
  list: readonly TemplateCard[]
  language: HomeLanguage
  latexFull: boolean
  onNavigate: (card: TemplateCard) => void
  /** Regular only: `sample` and `design` are what the live page is showing. */
  onUse: (card: TemplateCard, sample?: boolean, design?: Partial<TemplateDesign>) => void
  onClose: () => void
}

const engineNames = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' } as const
const ZOOM = { min: 0.3, max: 1.5, step: 0.1 }
const numerals = (value: number, language: HomeLanguage) => language === 'bn' ? value.toLocaleString('bn-BD') : String(value)

/**
 * The gallery's proof: a Regular template is set live, by the editor's own
 * page renderer (ResumePage) from the draft the editor would open
 * (templateDocument), in the text, layout and accent chosen here. So the
 * whole document is on show, the page count is measured rather than quoted,
 * and "Start" opens exactly this sheet. A LaTeX template cannot be compiled
 * for a glance, so it keeps the pictured first page of its real output.
 */
export default function ResumeTemplatePreview({ card, origin, list, language, latexFull, onNavigate, onUse, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLElement>(null)
  const ghost = useRef<HTMLImageElement>(null)
  const pull = useRef<{ started: boolean; animations: Animation[] }>({ started: false, animations: [] })
  const id = useId()
  const [sample, setSample] = useState(true)
  const [choice, setChoice] = useState<Partial<TemplateDesign>>({})
  const [zoom, setZoom] = useState<number | null>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const [paperHeight, setPaperHeight] = useState(0)
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)
  const count = (text: string, value: number) => text.replace('{n}', numerals(value, language))
  const name = (value: string) => language === 'bn' ? editorText(value, 'Bangla') : value
  const thumb = thumbnailFor(card)
  const index = list.findIndex((item) => item.editor === card.editor && item.id === card.id)
  const template = card.editor === 'regular' ? resumeTemplates.find((item) => item.id === card.id) : undefined
  const blocked = card.editor === 'latex' && latexFull

  // A design is chosen for one template; stepping to the next shows that one as it was made.
  const cardKey = `${card.editor}:${card.id}`
  const [shownKey, setShownKey] = useState(cardKey)
  if (shownKey !== cardKey) { setShownKey(cardKey); setChoice({}) }

  const own = template ? templateDesign(template) : null
  const design: TemplateDesign | null = own ? { layout: choice.layout ?? own.layout, accent: choice.accent ?? own.accent } : null
  // Only what differs from the template travels to the editor, so an untouched preview is a plain template link.
  const changed: Partial<TemplateDesign> = own && design ? { ...(design.layout !== own.layout ? { layout: design.layout } : {}), ...(design.accent !== own.accent ? { accent: design.accent } : {}) } : {}
  const draft = template ? templateDocument(template, defaultResumeDraft, { sample, design: changed }) : null
  const size = paperSizes[draft?.pageSize ?? 'A4']
  const fit = stageWidth ? Math.max(ZOOM.min, Math.min(1, Math.floor(stageWidth / size.width * 100) / 100)) : 0
  const scale = zoom ?? (fit || 0.5)
  // The editor's own measure: text taller than one sheet runs onto the next.
  const pages = draft ? (paperHeight ? Math.max(1, Math.ceil((paperHeight - 2) / size.height)) : thumb?.pages ?? 1) : thumb?.pages ?? 1
  // Facts follow the page on show: another layout can add a column, and with it end the ATS-friendly structure.
  const shown: TemplateCard = design ? { ...card, columns: getResumeLayout(design.layout).columns, pages } : card

  useLayoutEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  // The stage's width decides "Fit"; the page's own height says how many sheets the text fills.
  const live = Boolean(draft)
  useEffect(() => {
    const stageElement = stage.current
    if (!stageElement) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === stageElement) setStageWidth(entry.contentRect.width)
        else setPaperHeight((entry.target as HTMLElement).offsetHeight)
      }
    })
    observer.observe(stageElement)
    if (paper.current) observer.observe(paper.current)
    return () => observer.disconnect()
  }, [live])

  // Signature moment, "proof pull": the card's own picture lifts off the
  // gallery and lands on the sheet, where the live page develops under it.
  // The picture flies as a fixed copy because the sheet sits inside two
  // scrolling boxes that would clip it; it is trimmed to the stage as it
  // lands. Runs once, after the sheet has its size. Reduced motion gets the
  // plain dialog fade.
  useLayoutEffect(() => {
    const state = pull.current
    if (state.started || !origin || !stageWidth) return
    state.started = true
    const sheetElement = sheet.current, ghostElement = ghost.current, stageElement = stage.current
    if (!sheetElement || !ghostElement || !stageElement || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const end = sheetElement.getBoundingClientRect()
    if (!end.width || !origin.width) return
    const height = end.width * origin.height / origin.width
    const overhang = Math.max(0, end.top + height - stageElement.getBoundingClientRect().bottom)
    Object.assign(ghostElement.style, { left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${height}px` })
    ghostElement.hidden = false
    const timing = { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    const flight = ghostElement.animate([
      { transform: `translate(${origin.left - end.left}px, ${origin.top - end.top}px) scale(${origin.width / end.width})`, clipPath: 'inset(0)', opacity: 1 },
      { opacity: 1, offset: 0.7 },
      { transform: 'none', clipPath: `inset(0 0 ${overhang}px 0)`, opacity: 0 },
    ], timing)
    const develop = sheetElement.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], timing)
    flight.onfinish = flight.oncancel = () => { ghostElement.hidden = true }
    state.animations = [flight, develop]
  }, [origin, stageWidth])

  useEffect(() => {
    const state = pull.current
    return () => state.animations.forEach((animation) => animation.cancel())
  }, [])

  function step(direction: -1 | 1) {
    if (index < 0 || list.length < 2) return
    onNavigate(list[(index + direction + list.length) % list.length])
  }

  const categories = templateCategories[card.editor].filter((item) => card.categories.includes(item.id)).map((item) => t(item.name)).join(' · ')
  const sections = template ? template.enabled.filter((section) => section !== 'profile').length : 0
  const ink = design ? designAccents.find((item) => item.color === design.accent) : undefined
  const pageCaption = draft
    ? count(t(pages === 1 ? homeText.onePageWithText : homeText.pagesWithText), pages)
    : thumb ? `${t(homeText.firstPage)}${thumb.pages > 1 ? ` · ${count(t(homeText.pagesInOutput), thumb.pages)}` : ''}` : ''

  return <dialog ref={dialog} className={styles.preview} aria-labelledby="resume-preview-title" aria-describedby="resume-preview-summary"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === dialog.current) onClose() }}
    onKeyDown={(event) => {
      // Arrow keys belong to a field or to the scrolling page before they step through templates.
      if ((event.target as HTMLElement).closest('select, input, textarea, [data-proof-stage]')) return
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
    }}>
    <div className={styles.previewPage}>
      <div className={styles.previewBar}>
        <p className={styles.previewCaption} aria-live="polite">{pageCaption}</p>
        {draft && <div className={styles.zoom} role="group" aria-label={t(homeText.zoom)}>
          <button type="button" className={styles.iconButton} aria-label={t(homeText.zoomOut)} disabled={scale <= ZOOM.min} onClick={() => setZoom(Math.max(ZOOM.min, Math.round((scale - ZOOM.step) * 10) / 10))}><HomeIcon name="minus" /></button>
          <span className={styles.zoomValue}>{numerals(Math.round(scale * 100), language)}%</span>
          <button type="button" className={styles.iconButton} aria-label={t(homeText.zoomIn)} disabled={scale >= ZOOM.max} onClick={() => setZoom(Math.min(ZOOM.max, Math.round((scale + ZOOM.step) * 10) / 10))}><HomeIcon name="plus" /></button>
          <button type="button" className={styles.zoomFit} aria-label={t(homeText.zoomFitLabel)} aria-pressed={zoom === null} onClick={() => setZoom(null)}>{t(homeText.zoomFit)}</button>
        </div>}
      </div>
      <div ref={stage} className={styles.previewStage} data-proof-stage tabIndex={0} role="region" aria-label={t(homeText.pageRegion)}>
        {draft
          ? <div ref={sheet} className={styles.previewSheet} data-ready={stageWidth > 0} style={{ width: size.width * scale, height: Math.max(size.height, paperHeight) * scale }}>
            <ResumePage articleRef={paper} draft={draft} title={(section) => sectionTitle(draft, section)} fontFamily={paperFontFamily(draft)} accentColor={accentColorOf(draft)} width={size.width} minHeight={size.height} scale={scale}
              ariaLabel={`${t(card.name)}: ${t(homeText.livePage)}`} emptyText={editorText('Select this section to start writing.', draft.language)} nameFallback={editorText('Your name', draft.language)} />
            {/* Where one sheet ends is the editor's own estimate; the draft PDF breaks between lines near it. */}
            {Array.from({ length: pages - 1 }, (_, sheetIndex) => <div key={sheetIndex} className={styles.pageEnd} style={{ top: (sheetIndex + 1) * size.height * scale }}><span>{count(t(homeText.pageMark), sheetIndex + 2)}</span></div>)}
          </div>
          : thumb
            /* Pre-sized WebP renders of real output (render-thumbnails.mjs); next/image would only re-encode them. */
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <div ref={sheet} className={`${styles.previewSheet} ${styles.previewPicture}`} data-ready="true"><img key={cardKey} src={thumb.full} alt={`${t(homeText.firstPage)}: ${t(card.name)}`} width={thumb.width} height={thumb.height} /></div>
            : <p className={styles.noThumb}>{t(homeText.previewUnavailable)}</p>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {thumb && <img ref={ghost} className={styles.pull} src={thumb.card} alt="" aria-hidden="true" hidden />}
    </div>
    <div className={styles.previewInfo}>
      <div className={styles.previewTop}>
        <p className={styles.eyebrow}>{t(card.editor === 'regular' ? homeText.regularTitle : homeText.latexTitle)}</p>
        <div className={styles.previewNav}>
          <button type="button" className={styles.iconButton} aria-label={t(homeText.previous)} disabled={list.length < 2} onClick={() => step(-1)}><HomeIcon name="prev" /></button>
          <button type="button" className={styles.iconButton} aria-label={t(homeText.next)} disabled={list.length < 2} onClick={() => step(1)}><HomeIcon name="next" /></button>
          <button type="button" className={styles.iconButton} aria-label={t(homeText.close)} onClick={onClose}><HomeIcon name="close" /></button>
        </div>
      </div>
      <h2 id="resume-preview-title">{t(card.name)}</h2>
      <p id="resume-preview-summary" className={styles.previewSummary}>{t(card.summary)}</p>
      <ul className={styles.badges}>{templateBadges(shown).map((badge) => <li key={badge.id} data-tone={badge.tone}>{t(badge.label)}</li>)}</ul>
      {template && design && own && <fieldset className={styles.proof}>
        <legend>{t(homeText.proofTitle)}</legend>
        <div className={styles.proofField}>
          <span id={`${id}-text`}>{t(homeText.proofText)}</span>
          <div className={styles.segmented} role="group" aria-labelledby={`${id}-text`}>
            <button type="button" aria-pressed={sample} onClick={() => setSample(true)}>{t(homeText.textSample)}</button>
            <button type="button" aria-pressed={!sample} onClick={() => setSample(false)}>{t(homeText.textOutline)}</button>
          </div>
        </div>
        <label className={styles.proofField}><span>{t(homeText.factsLayout)}</span>
          <select value={design.layout} onChange={(event) => setChoice({ ...choice, layout: event.target.value as ResumeLayoutId })}>
            {resumeLayouts.map((layout) => <option key={layout.id} value={layout.id}>{name(layout.name)}{layout.id === own.layout ? ` · ${t(homeText.templateOwn)}` : ''}</option>)}
          </select></label>
        <div className={styles.proofField} role="radiogroup" aria-labelledby={`${id}-ink`}>
          <span id={`${id}-ink`}>{t(homeText.proofInk)}{ink ? <b>{name(ink.name)}</b> : null}</span>
          <div className={styles.inks}>
            {designAccents.map((item) => <label key={item.color} className={styles.ink} style={{ '--ink': item.color } as CSSProperties} title={name(item.name)}>
              <input type="radio" name={`${id}-ink`} checked={design.accent === item.color} onChange={() => setChoice({ ...choice, accent: item.color })} />
              <span className={styles.srOnly}>{name(item.name)}{item.color === own.accent ? ` · ${t(homeText.templateOwn)}` : ''}</span>
              {design.accent === item.color && <HomeIcon name="check" />}
            </label>)}
          </div>
        </div>
        {(changed.layout || changed.accent) && <button type="button" className={styles.textButton} onClick={() => setChoice({})}>{t(homeText.proofReset)}</button>}
      </fieldset>}
      <dl className={styles.previewFacts}>
        <div><dt>{t(homeText.factsCategories)}</dt><dd>{categories}</dd></div>
        {template && <div><dt>{t(homeText.factsTypeface)}</dt><dd>{template.font}{sections ? ` · ${count(t(homeText.sectionCount), sections)}` : ''}</dd></div>}
        {card.engine && <div><dt>{t(homeText.factsEngine)}</dt><dd>{engineNames[card.engine]}</dd></div>}
        {card.runtime && <div><dt>{t(homeText.factsBuild)}</dt><dd>{card.runtime === 'browser' ? t(homeText.buildBrowser) : `${t(homeText.buildConsent)}: ${card.packageGroups?.join(', ')}.`}</dd></div>}
      </dl>
      {hasAtsStructure(shown) && <p className={styles.helper}>{t(homeText.atsExplain)}</p>}
      {card.credit && <details className={styles.credit}>
        <summary>{t(homeText.credit)}: {card.credit.author} · {card.credit.license}</summary>
        <p><a href={card.credit.url} target="_blank" rel="noreferrer">{card.credit.url.replace('https://', '')}</a> · {card.credit.revision}</p>
        {card.credit.adapted && <><p><b>{t(homeText.adaptedChanges)}</b></p><ul>{card.credit.changes.map((change) => <li key={change}>{change}</li>)}</ul></>}
      </details>}
      <p className={`${styles.helper} ${styles.applyNote}`} id="resume-preview-apply">{blocked ? t(homeText.latexLimitNote) : t(card.editor === 'latex' ? homeText.latexApplyNote : sample ? homeText.applyNoteSample : homeText.applyNoteOutline)}</p>
      <div className={styles.previewActions}>
        {/* One way in: the button names the text on the sheet, and the editor opens on that sheet. */}
        <button type="button" className={styles.primary} disabled={blocked} aria-describedby="resume-preview-apply" onClick={() => onUse(card, card.editor === 'regular' && sample, changed)}><span>{t(card.editor === 'latex' ? homeText.useInEditor : sample ? homeText.useSample : homeText.useOutline)}</span><HomeIcon name="arrow" /></button>
      </div>
    </div>
  </dialog>
}
