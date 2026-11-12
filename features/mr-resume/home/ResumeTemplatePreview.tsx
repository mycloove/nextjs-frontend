'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { hasAtsStructure, templateBadges, templateCategories, type TemplateCard } from '../components/templateCatalog'
import { getResumeLayout } from '../components/resumeLayouts'
import { editorText } from '../components/editorLanguage'
import { resumeTemplates } from '../components/resumeTemplates'
import { thumbnailFor } from './galleryCards'
import { homeText, pick, type HomeLanguage } from './homeText'
import { HomeIcon } from './homeIcons'
import styles from './ResumeHome.module.css'

type Props = {
  card: TemplateCard
  /** Where the card's page sat, for the "proof pull" FLIP into the dialog. */
  origin: DOMRect | null
  list: readonly TemplateCard[]
  language: HomeLanguage
  latexFull: boolean
  onNavigate: (card: TemplateCard) => void
  onUse: (card: TemplateCard, sample?: boolean) => void
  onClose: () => void
}

const engineNames = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' } as const

export default function ResumeTemplatePreview({ card, origin, list, language, latexFull, onNavigate, onUse, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const page = useRef<HTMLImageElement>(null)
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)
  const thumb = thumbnailFor(card)
  const index = list.findIndex((item) => item.editor === card.editor && item.id === card.id)
  const regular = card.editor === 'regular' ? resumeTemplates.find((item) => item.id === card.id) : undefined
  const blocked = card.editor === 'latex' && latexFull

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  // Signature moment, "proof pull": the page lifts from its card into the
  // dialog (FLIP, transform only). Reduced motion gets the plain dialog fade.
  useLayoutEffect(() => {
    const target = page.current
    if (!origin || !target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const end = target.getBoundingClientRect()
    if (!end.width || !end.height) return
    const dx = origin.left - end.left, dy = origin.top - end.top, scale = origin.width / end.width
    const animation = target.animate([{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transformOrigin: 'top left', transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
    return () => animation.cancel()
  }, [origin])

  function step(direction: -1 | 1) {
    if (index < 0 || list.length < 2) return
    onNavigate(list[(index + direction + list.length) % list.length])
  }

  const categories = templateCategories[card.editor].filter((item) => card.categories.includes(item.id)).map((item) => t(item.name)).join(' · ')
  const sections = regular ? regular.enabled.filter((section) => section !== 'profile').length : null

  return <dialog ref={dialog} className={styles.preview} aria-labelledby="resume-preview-title" aria-describedby="resume-preview-summary"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === dialog.current) onClose() }}
    onKeyDown={(event) => {
      if ((event.target as HTMLElement).closest('select, input, textarea')) return
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
    }}>
    <div className={styles.previewPage}>
      {/* Pre-sized WebP renders of real output (render-thumbnails.mjs); next/image would only re-encode them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {thumb ? <img ref={page} key={`${card.editor}:${card.id}`} src={thumb.full} alt={`${t(homeText.firstPage)}: ${t(card.name)}`} width={thumb.width} height={thumb.height} /> : <p className={styles.noThumb}>{t(homeText.previewUnavailable)}</p>}
      {thumb && <p className={styles.previewCaption}>{t(homeText.firstPage)}{thumb.pages > 1 ? ` · ${language === 'bn' ? thumb.pages.toLocaleString('bn-BD') : thumb.pages} ${language === 'bn' ? 'পাতা' : 'pages'}` : ''}</p>}
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
      <ul className={styles.badges}>{templateBadges(card).map((badge) => <li key={badge.id} data-tone={badge.tone}>{t(badge.label)}</li>)}</ul>
      <dl className={styles.previewFacts}>
        <div><dt>{t(homeText.factsCategories)}</dt><dd>{categories}</dd></div>
        {regular && <div><dt>{t(homeText.factsLayout)}</dt><dd>{language === 'bn' ? editorText(getResumeLayout(regular.layout).name, 'Bangla') : getResumeLayout(regular.layout).name} · {regular.font}{sections ? ` · ${language === 'bn' ? sections.toLocaleString('bn-BD') : sections} ${language === 'bn' ? 'টি বিভাগ' : 'sections'}` : ''}</dd></div>}
        {card.engine && <div><dt>{t(homeText.factsEngine)}</dt><dd>{engineNames[card.engine]}</dd></div>}
        {card.runtime && <div><dt>{t(homeText.factsBuild)}</dt><dd>{card.runtime === 'browser' ? t(homeText.buildBrowser) : `${t(homeText.buildConsent)}: ${card.packageGroups?.join(', ')}.`}</dd></div>}
      </dl>
      {hasAtsStructure(card) && <p className={styles.helper}>{t(homeText.atsExplain)}</p>}
      {card.credit && <details className={styles.credit}>
        <summary>{t(homeText.credit)}: {card.credit.author} · {card.credit.license}</summary>
        <p><a href={card.credit.url} target="_blank" rel="noreferrer">{card.credit.url.replace('https://', '')}</a> · {card.credit.revision}</p>
        {card.credit.adapted && <><p><b>{t(homeText.adaptedChanges)}</b></p><ul>{card.credit.changes.map((change) => <li key={change}>{change}</li>)}</ul></>}
      </details>}
      <div className={styles.previewActions}>
        <p className={styles.helper} id="resume-preview-apply">{blocked ? t(homeText.latexLimitNote) : t(card.editor === 'regular' ? homeText.regularApplyNote : homeText.latexApplyNote)}</p>
        <button type="button" className={styles.primary} disabled={blocked} aria-describedby="resume-preview-apply" onClick={() => onUse(card)}><span>{t(card.editor === 'regular' ? homeText.useOutline : homeText.useInEditor)}</span><HomeIcon name="arrow" /></button>
        {/* The page pictured is the template with its sample text; this starts from exactly that. */}
        {card.editor === 'regular' && <button type="button" className={styles.secondary} aria-describedby="resume-preview-apply" onClick={() => onUse(card, true)}>{t(homeText.useSample)}</button>}
      </div>
    </div>
  </dialog>
}
