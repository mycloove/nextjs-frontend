'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { activeFilterCount, categoryCounts, defaultGalleryQuery, filterTemplates, templateBadges, templateCategories, type GalleryEditor, type GalleryQuery, type TemplateCard } from '../components/templateCatalog'
import { galleryCards, thumbnailFor } from './galleryCards'
import { homeText, pick, type HomeLanguage } from './homeText'
import { HomeIcon } from './homeIcons'
import ResumeTemplatePreview from './ResumeTemplatePreview'
import styles from './ResumeHome.module.css'

type Props = {
  language: HomeLanguage
  query: GalleryQuery
  onQuery: (query: GalleryQuery) => void
  onUse: (editor: GalleryEditor, id: string) => void
  /** The template the stored Regular draft was started from, if any. */
  regularTemplateId: string | null
  latexFull: boolean
}

const numerals = (value: number, language: HomeLanguage) => language === 'bn' ? value.toLocaleString('bn-BD') : String(value)

export default function ResumeTemplateGallery({ language, query, onQuery, onUse, regularTemplateId, latexFull }: Props) {
  const [preview, setPreview] = useState<{ card: TemplateCard; origin: DOMRect | null; trigger: HTMLElement | null } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)
  const results = useMemo(() => filterTemplates(galleryCards, query), [query])
  const counts = useMemo(() => categoryCounts(galleryCards, query), [query])
  const otherEditor: GalleryEditor = query.editor === 'regular' ? 'latex' : 'regular'
  const otherMatches = useMemo(() => results.length ? 0 : filterTemplates(galleryCards, { ...query, editor: otherEditor, category: 'all', browserReady: false }).length, [results.length, query, otherEditor])
  const drawerTotal = galleryCards.filter((card) => card.editor === query.editor).length
  const filters = activeFilterCount(query)

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 2) % 2
    tabs.current[next]?.focus()
    onQuery({ ...defaultGalleryQuery, editor: next === 0 ? 'regular' : 'latex', text: query.text })
  }

  function open(card: TemplateCard, trigger: HTMLElement) {
    const image = trigger.querySelector('img')
    setPreview({ card, origin: image?.getBoundingClientRect() ?? null, trigger })
  }

  const filterControls = <div className={styles.filterGrid}>
    <label className={styles.selectField}><span>{t(homeText.filterLanguage)}</span>
      <select value={query.language ?? ''} onChange={(event) => onQuery({ ...query, language: (event.target.value || null) as GalleryQuery['language'] })}>
        <option value="">{t(homeText.any)}</option><option value="bn">{t(homeText.langBn)}</option><option value="en">{t(homeText.langEn)}</option><option value="mixed">{t(homeText.langMixed)}</option>
      </select></label>
    <label className={styles.selectField}><span>{t(homeText.filterColumns)}</span>
      <select value={query.columns ?? ''} onChange={(event) => onQuery({ ...query, columns: (event.target.value || null) as GalleryQuery['columns'] })}>
        <option value="">{t(homeText.any)}</option><option value="1">{t(homeText.colsOne)}</option><option value="2">{t(homeText.colsTwo)}</option><option value="sidebar">{t(homeText.colsSidebar)}</option>
      </select></label>
    <label className={styles.selectField}><span>{t(homeText.filterPhoto)}</span>
      <select value={query.photo ?? ''} onChange={(event) => onQuery({ ...query, photo: (event.target.value || null) as GalleryQuery['photo'] })}>
        <option value="">{t(homeText.any)}</option><option value="yes">{t(homeText.photoYes)}</option><option value="no">{t(homeText.photoNo)}</option>
      </select></label>
    <label className={styles.toggle}><input type="checkbox" checked={query.ats} onChange={(event) => onQuery({ ...query, ats: event.target.checked })} /><span>{t(homeText.filterAts)}</span></label>
    <label className={styles.toggle}><input type="checkbox" checked={query.onePage} onChange={(event) => onQuery({ ...query, onePage: event.target.checked })} /><span>{t(homeText.filterOnePage)}</span></label>
    {query.editor === 'latex' && <label className={styles.toggle}><input type="checkbox" checked={query.browserReady} onChange={(event) => onQuery({ ...query, browserReady: event.target.checked })} /><span>{t(homeText.filterReady)}</span></label>}
    {filters > 0 && <button type="button" className={styles.textButton} onClick={() => onQuery({ ...query, language: null, columns: null, photo: null, ats: false, onePage: false, browserReady: false })}>{t(homeText.clearFilters)}</button>}
  </div>

  return <section id="templates" className={styles.gallery} aria-labelledby={`${id}-title`}>
    <header className={styles.galleryHead}>
      <p className={styles.eyebrow}>{t(homeText.galleryEyebrow)}</p>
      <h2 id={`${id}-title`}>{t(homeText.galleryTitle)}</h2>
      <p className={styles.galleryLead}>{t(homeText.galleryLead)}</p>
    </header>

    <div className={styles.galleryBar}>
      <div className={styles.drawerTabs} role="tablist" aria-label={t(homeText.drawer)}>
        {(['regular', 'latex'] as const).map((editor, index) => <button key={editor} ref={(element) => { tabs.current[index] = element }} type="button" role="tab" id={`${id}-tab-${editor}`} aria-selected={query.editor === editor} aria-controls={`${id}-panel`} tabIndex={query.editor === editor ? 0 : -1} onKeyDown={(event) => onTabKey(event, index)} onClick={() => query.editor !== editor && onQuery({ ...defaultGalleryQuery, editor, text: query.text })}>
          <HomeIcon name={editor === 'regular' ? 'page' : 'source'} />{t(editor === 'regular' ? homeText.regularTitle : homeText.latexTitle)}<small>{numerals(galleryCards.filter((card) => card.editor === editor).length, language)}</small>
        </button>)}
      </div>
      <label className={styles.search}><span className={styles.srOnly}>{t(homeText.search)}</span><HomeIcon name="search" /><input type="search" value={query.text} placeholder={t(homeText.searchPlaceholder)} maxLength={80} onChange={(event) => onQuery({ ...query, text: event.target.value })} /></label>
    </div>

    <div className={styles.galleryBody} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${query.editor}`}>
      <nav className={styles.categoryRail} aria-label={t(homeText.categories)}>
        <ul>
          {[{ id: 'all', name: homeText.all }, ...templateCategories[query.editor]].map((category) => {
            const count = counts[category.id] ?? 0
            return <li key={category.id}><button type="button" aria-current={query.category === category.id ? 'true' : undefined} disabled={category.id !== 'all' && count === 0 && query.category !== category.id} onClick={() => onQuery({ ...query, category: category.id })}><span>{t(category.name)}</span><small>{numerals(count, language)}</small></button></li>
          })}
        </ul>
      </nav>

      <div className={styles.galleryMain}>
        <div className={styles.filterBar}>
          <button type="button" className={styles.filterButton} aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen((open) => !open)}><HomeIcon name="filter" />{t(homeText.filters)}{filters > 0 && <small>{numerals(filters, language)}</small>}</button>
          <p className={styles.resultCount} aria-live="polite">{t(homeText.showing)} {numerals(results.length, language)} {t(homeText.of)} {numerals(drawerTotal, language)}</p>
        </div>
        <div id={`${id}-filters`} className={styles.filters} data-open={filtersOpen || undefined}>{filterControls}</div>

        {results.length ? <ul className={styles.cardGrid}>
          {results.map((card) => {
            const thumb = thumbnailFor(card)
            const badges = templateBadges(card).slice(0, 3)
            const current = card.editor === 'regular' && card.id === regularTemplateId
            return <li key={`${card.editor}:${card.id}`} className={styles.card}>
              <button type="button" className={styles.cardPreview} aria-haspopup="dialog" aria-label={`${t(homeText.preview)}: ${t(card.name)}`} onClick={(event) => open(card, event.currentTarget)}>
                {/* Pre-sized WebP renders of real output (render-thumbnails.mjs); next/image would only re-encode them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span className={styles.cardPaper}>{thumb ? <img src={thumb.card} alt="" width={thumb.width} height={thumb.height} loading="lazy" decoding="async" /> : <span className={styles.noThumb}>{t(homeText.previewUnavailable)}</span>}</span>
                {current && <span className={styles.inDraft}><HomeIcon name="check" />{t(homeText.inDraft)}</span>}
              </button>
              <div className={styles.cardBody}>
                <h3 lang={language === 'bn' ? 'bn' : 'en'}>{t(card.name)}</h3>
                <p>{t(card.summary)}</p>
                <ul className={styles.badges} aria-label={t(homeText.factsList)}>{badges.map((badge) => <li key={badge.id} data-tone={badge.tone}>{t(badge.label)}</li>)}</ul>
                <button type="button" className={styles.cardUse} disabled={card.editor === 'latex' && latexFull} aria-describedby={card.editor === 'latex' && latexFull ? `${id}-limit` : undefined} onClick={() => onUse(card.editor, card.id)}>{t(homeText.useTemplate)}<HomeIcon name="arrow" /></button>
              </div>
            </li>
          })}
        </ul> : <div className={styles.empty}>
          <p>{t(homeText.noResults)}</p>
          <div>
            <button type="button" className={styles.secondary} onClick={() => onQuery({ ...defaultGalleryQuery, editor: query.editor })}>{t(homeText.clearFilters)}</button>
            {otherMatches > 0 && <button type="button" className={styles.textButton} onClick={() => onQuery({ ...query, editor: otherEditor, category: 'all', browserReady: false })}>{numerals(otherMatches, language)} {t(homeText.otherDrawerMatches)} · {t(homeText.showThem)}</button>}
          </div>
        </div>}
        {query.editor === 'latex' && latexFull && <p id={`${id}-limit`} className={styles.limitNote}>{t(homeText.latexLimitNote)}</p>}
      </div>
    </div>

    {preview && <ResumeTemplatePreview card={preview.card} origin={preview.origin} list={results} language={language} latexFull={latexFull} onNavigate={(card) => setPreview({ card, origin: null, trigger: preview.trigger })} onUse={(card) => onUse(card.editor, card.id)} onClose={() => { const trigger = preview.trigger; setPreview(null); requestAnimationFrame(() => trigger?.focus({ preventScroll: true })) }} />}
  </section>
}
