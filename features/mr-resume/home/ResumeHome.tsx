'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { EDITOR_LANGUAGE_KEY } from '../components/editorLanguage'
import { REGULAR_DRAFT_KEY, summarizeStoredDraft, type StoredDraftSummary } from '../components/resumeDraft'
import { defaultGalleryQuery, parseGalleryQuery, serializeGalleryQuery, type GalleryEditor, type GalleryQuery } from '../components/templateCatalog'
import { LATEX_DATABASE } from '../latex/types'
import { galleryCards } from './galleryCards'
import { compareRows, homeText, pick, type HomeLanguage } from './homeText'
import { HomeIcon } from './homeIcons'
import ResumeHomeNavbar from './ResumeHomeNavbar'
import ResumeTemplateGallery from './ResumeTemplateGallery'
import styles from './ResumeHome.module.css'

type LatexSummary = { status: 'loading' | 'none' | 'unreadable' } | { status: 'ready'; count: number; latest: string | null }

const LATEX_PROJECT_LIMIT = 8

// Reads the LaTeX project list only when this browser already has the store,
// so visiting the home page never creates an empty database as a side effect.
async function readLatexSummary(): Promise<LatexSummary> {
  if (typeof indexedDB === 'undefined') return { status: 'none' }
  try {
    if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some((item) => item.name === LATEX_DATABASE)) return { status: 'none' }
    const { openLatexProjectStore } = await import('../latex/projectStore')
    const store = await openLatexProjectStore()
    const workspace = await store.readWorkspace()
    if (!workspace.projects.length) return { status: 'none' }
    const latest = [...workspace.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return { status: 'ready', count: workspace.projects.length, latest: latest?.title || null }
  } catch { return { status: 'unreadable' } }
}

// Browser-only state (URL query, stored preferences, stored draft) is read as
// an external store: the server renders the defaults, the client the real
// values, with no setState-in-effect cascade. Same-tab writes announce
// themselves through one module event; other tabs through 'storage'.
const HOME_STATE_EVENT = 'mr-resume:home-state'
function subscribeHomeState(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener('storage', onChange)
  window.addEventListener(HOME_STATE_EVENT, onChange)
  return () => { window.removeEventListener('popstate', onChange); window.removeEventListener('storage', onChange); window.removeEventListener(HOME_STATE_EVENT, onChange) }
}
const announceHomeState = () => window.dispatchEvent(new Event(HOME_STATE_EVENT))
const readStorage = (key: string) => { try { return window.localStorage.getItem(key) } catch { return '\u0000unreadable' } }

function relativeTime(iso: string, language: HomeLanguage) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat(language === 'bn' ? 'bn-BD' : 'en', { numeric: 'auto' })
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  return format.format(Math.round(seconds), 'second')
}

export default function ResumeHome({ onOpenEditor, onOpenTemplate }: { onOpenEditor: (editor: GalleryEditor) => void; onOpenTemplate: (editor: GalleryEditor, id: string, sample?: boolean) => void }) {
  const search = useSyncExternalStore(subscribeHomeState, () => window.location.search, () => '')
  const storedLanguage = useSyncExternalStore(subscribeHomeState, () => readStorage(EDITOR_LANGUAGE_KEY), () => null)
  const storedDraft = useSyncExternalStore(subscribeHomeState, () => readStorage(REGULAR_DRAFT_KEY), () => null)
  const language: HomeLanguage = storedLanguage === 'Bangla' ? 'bn' : 'en'
  const query = useMemo<GalleryQuery>(() => search ? parseGalleryQuery(new URLSearchParams(search)) : defaultGalleryQuery, [search])
  const draft = useMemo<StoredDraftSummary>(() => storedDraft === '\u0000unreadable' ? { status: 'unreadable' } : summarizeStoredDraft(storedDraft), [storedDraft])
  const [latex, setLatex] = useState<LatexSummary>({ status: 'loading' })
  const scroller = useRef<HTMLDivElement>(null)
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)

  useEffect(() => {
    let alive = true
    void readLatexSummary().then((summary) => { if (alive) setLatex(summary) })
    return () => { alive = false }
  }, [])

  function changeLanguage(next: HomeLanguage) {
    try { window.localStorage.setItem(EDITOR_LANGUAGE_KEY, next === 'bn' ? 'Bangla' : 'English') } catch { /* Storage blocked: the page keeps its current language. */ }
    announceHomeState()
  }

  // The gallery query lives in the URL: filters replace the entry, switching
  // the editor drawer adds one, so Back returns to the previous drawer.
  function changeQuery(next: GalleryQuery) {
    const push = next.editor !== query.editor
    const nextSearch = serializeGalleryQuery(next)
    const url = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    if (push) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    announceHomeState()
  }

  function showDrawer(editor: GalleryEditor) {
    changeQuery({ ...defaultGalleryQuery, editor })
    requestAnimationFrame(() => document.getElementById('templates')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
  }

  const counts = { regular: galleryCards.filter((card) => card.editor === 'regular').length, latex: galleryCards.filter((card) => card.editor === 'latex').length }
  const latexFull = latex.status === 'ready' && latex.count >= LATEX_PROJECT_LIMIT
  const showContinue = draft.status !== 'none' || latex.status === 'ready' || latex.status === 'unreadable'

  return <div ref={scroller} className={styles.home} lang={language === 'bn' ? 'bn' : 'en'} data-language={language}>
    <a className={styles.skip} href="#templates">{t(homeText.skip)}</a>
    <ResumeHomeNavbar language={language} onLanguage={changeLanguage} scroller={scroller} />
    <main className={styles.main}>
      <div className={styles.intro}>
        <section className={styles.hero} aria-labelledby="resume-home-title">
          <p className={styles.eyebrow}>{t(homeText.eyebrow)}</p>
          <h1 id="resume-home-title" className={styles.title}>{t(homeText.title)}</h1>
          <p className={styles.lead}>{t(homeText.lead)}</p>
        </section>

        <section className={styles.drawers} aria-label={t(homeText.drawer)}>
          {(['regular', 'latex'] as const).map((editor) => {
            const regular = editor === 'regular'
            return <article key={editor} className={styles.drawer} data-editor={editor} aria-labelledby={`drawer-${editor}`}>
              <div className={styles.drawerHead}>
                <p className={styles.drawerIndex}><HomeIcon name={regular ? 'page' : 'source'} />{t(regular ? homeText.regularIndex : homeText.latexIndex)}</p>
                <button type="button" className={styles.textButton} aria-label={`${t(homeText.openEditor)}: ${regular ? 'Regular' : 'LaTeX'}`} onClick={() => onOpenEditor(editor)}>{t(homeText.openEditor)}</button>
              </div>
              <h2 id={`drawer-${editor}`}>{t(regular ? homeText.regularTitle : homeText.latexTitle)}</h2>
              <p>{t(regular ? homeText.regularBody : homeText.latexBody)}</p>
              <button type="button" className={`${styles.primary} ${styles.drawerBrowse}`} onClick={() => showDrawer(editor)}><span>{t(homeText.browseTemplates)}</span><span className={styles.count}>{language === 'bn' ? counts[editor].toLocaleString('bn-BD') : counts[editor]}</span><HomeIcon name="arrow" /></button>
            </article>
          })}
        </section>
      </div>

      {showContinue && <section className={styles.continue} aria-labelledby="resume-continue-title">
        <h2 id="resume-continue-title">{t(homeText.continueTitle)}</h2>
        <div className={styles.continueRow}>
          {draft.status !== 'none' && <button type="button" className={styles.continueItem} onClick={() => onOpenEditor('regular')}>
            <HomeIcon name="page" />
            <span><b>{t(homeText.regularDraft)}</b>{draft.status === 'ready' ? <small>{draft.title}{draft.savedAt ? ` · ${t(homeText.savedAt)} ${relativeTime(draft.savedAt, language)}` : ''}</small> : <small className={styles.warning}>{t(homeText.unreadableDraft)}</small>}</span>
            <HomeIcon name="arrow" />
          </button>}
          {(latex.status === 'ready' || latex.status === 'unreadable') && <button type="button" className={styles.continueItem} onClick={() => onOpenEditor('latex')}>
            <HomeIcon name="source" />
            <span><b>{t(homeText.latexProjects)}</b>{latex.status === 'ready' ? <small>{latex.latest ? `${latex.latest} · ` : ''}{language === 'bn' ? latex.count.toLocaleString('bn-BD') : latex.count} / {language === 'bn' ? LATEX_PROJECT_LIMIT.toLocaleString('bn-BD') : LATEX_PROJECT_LIMIT} {t(homeText.projectsSuffix)}</small> : <small className={styles.warning}>{t(homeText.latexUnreadable)}</small>}</span>
            <HomeIcon name="arrow" />
          </button>}
        </div>
      </section>}

      <ResumeTemplateGallery language={language} query={query} onQuery={changeQuery} onUse={onOpenTemplate} regularTemplateId={draft.status === 'ready' ? draft.templateId : null} latexFull={latexFull} />

      <section id="compare" className={styles.compare} aria-labelledby="resume-compare-title">
        <p className={styles.eyebrow}>{t(homeText.compareEyebrow)}</p>
        <h2 id="resume-compare-title">{t(homeText.compareTitle)}</h2>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby="resume-compare-title">
          <table className={styles.compareTable}>
            <thead><tr><th scope="col">{t(homeText.compareQuestion)}</th><th scope="col">{t(homeText.regularTitle)}</th><th scope="col">{t(homeText.latexTitle)}</th></tr></thead>
            <tbody>{compareRows.map((row) => <tr key={row.question.en}><th scope="row">{t(row.question)}</th><td>{t(row.regular)}</td><td>{t(row.latex)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section id="import" className={styles.importBand} aria-labelledby="resume-import-title">
        <p className={styles.eyebrow} id="resume-import-title">{t(homeText.importEyebrow)}</p>
        <div className={styles.importGrid}>
          <button type="button" className={styles.importItem} onClick={() => onOpenEditor('latex')}><HomeIcon name="import" /><span><b>{t(homeText.importLatexTitle)}</b><small>{t(homeText.importLatexBody)}</small></span></button>
          <button type="button" className={styles.importItem} onClick={() => onOpenEditor('regular')}><HomeIcon name="copy" /><span><b>{t(homeText.importRegularTitle)}</b><small>{t(homeText.importRegularBody)}</small></span></button>
          <div className={styles.privacy}><HomeIcon name="device" /><span><b>{t(homeText.privacyTitle)}</b><small>{t(homeText.privacyBody)}</small></span></div>
        </div>
      </section>
    </main>
    <footer className={styles.footer}>
      <div>
        <h2>{t(homeText.footerCredits)}</h2>
        <ul>
          <li>Jake&rsquo;s Resume &mdash; Jake Gutierrez, MIT &middot; <a href="https://github.com/jakegut/resume" target="_blank" rel="noreferrer">github.com/jakegut/resume</a></li>
          <li>AltaCV &mdash; LianTze Lim, LPPL 1.3c &middot; <a href="https://github.com/liantze/AltaCV" target="_blank" rel="noreferrer">github.com/liantze/AltaCV</a></li>
          <li>{t(homeText.footerOriginal)}</li>
          <li>{t(homeText.footerFonts)}</li>
        </ul>
      </div>
      <Link href="/" className={styles.footerHome}>{t(homeText.home)}</Link>
    </footer>
  </div>
}
