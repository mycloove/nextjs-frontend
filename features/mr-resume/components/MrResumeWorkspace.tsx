'use client'

import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import MrResumeStudio, { type RegularStudioBridge } from './MrResumeStudio'
import { LATEX_MODE_KEY, type LatexImportRequest } from '../latex/types'
import styles from './MrResumeWorkspace.module.css'
import theme from './MrResumeTheme.module.css'

// Neither the editor nor PDF.js enters the Regular editor's initial load path.
const LatexResumeStudio = lazy(() => import('../latex/LatexResumeStudio'))
type EditorMode = 'regular' | 'latex'

class LatexBoundary extends Component<{ children: ReactNode; onRegular: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className={styles.loadState} role="alert"><b>The LaTeX workspace could not load.</b><p>The Regular editor remains available. Only committed local drafts can be restored after a page reload.</p><button type="button" onClick={this.props.onRegular}>Return to Regular editor</button></div>
  }
}

export default function MrResumeWorkspace() {
  // Every visit begins at the chooser. Editors mount only after an explicit
  // choice, keeping the entry page lightweight and preserving the saved mode key.
  const [selectedMode, setMode] = useState<EditorMode | null>(null)
  const mode = selectedMode
  const [latexVisited, setLatexVisited] = useState(false)
  const [importRequest, setImportRequest] = useState<LatexImportRequest | null>(null)
  const [notice, setNotice] = useState('')
  const regular = useRef<RegularStudioBridge>(null)
  const regularPanel = useRef<HTMLDivElement>(null)
  const latexPanel = useRef<HTMLDivElement>(null)
  const importSequence = useRef(0)

  useEffect(() => {
    // Native inert is set via the DOM for React 18 compatibility. Hidden alone
    // is not a sufficient contract for retained focus/print ownership.
    if (regularPanel.current) regularPanel.current.inert = mode !== 'regular'
    if (latexPanel.current) latexPanel.current.inert = mode !== 'latex'
  }, [mode, latexVisited])

  function changeMode(next: EditorMode) {
    if (next === mode) return
    if (mode === 'regular') {
      const outcome = regular.current?.prepareToHide()
      if (!outcome || outcome.reason) {
        setNotice(outcome?.reason ?? 'The Regular editor is still loading.')
        return
      }
      setNotice(outcome.saveFailed ? 'Regular autosave is unavailable. Its writing is retained in this session; export a backup before reloading.' : '')
    } else setNotice('')
    if (next === 'latex' || mode === 'latex') setLatexVisited(true)
    setMode(next)
    try { window.localStorage.setItem(LATEX_MODE_KEY, next) } catch { /* Session mode remains usable. */ }
  }

  function copyRegular() {
    const snapshot = regular.current?.getSnapshot()
    if (!snapshot) { setNotice('Wait for the Regular draft to finish restoring before copying it.'); return }
    const outcome = regular.current!.prepareToHide()
    if (outcome.reason) { setNotice(outcome.reason); return }
    setImportRequest({ id: String(++importSequence.current), snapshot })
    setLatexVisited(true)
    setMode('latex')
    setNotice(outcome.saveFailed ? 'The Regular draft could not save locally. This copy uses your current writing; the Regular draft remains in this session.' : '')
    try { window.localStorage.setItem(LATEX_MODE_KEY, 'latex') } catch { /* No draft storage is repurposed. */ }
  }

  function chooseMode(next: EditorMode) {
    setMode(next)
    if (next === 'latex') setLatexVisited(true)
    try { window.localStorage.setItem(LATEX_MODE_KEY, next) } catch { /* The chooser remains usable without storage. */ }
  }

  if (!mode) return <div className={`${theme.theme} ${styles.root} ${styles.entryRoot}`}>
    <main className={styles.entry}>
      <header className={styles.entryHeader}>
        <Link className={styles.entryBrand} href="/" aria-label="SmilePDF home"><span aria-hidden="true">S</span><span>MR.RESUME <i>by ASTRUM</i></span></Link>
        <span className={styles.entryLabel}>DOCUMENT STUDIO <span aria-hidden="true">·</span> BANGLA + ENGLISH</span>
      </header>
      <section className={styles.entryIntro} aria-labelledby="resume-entry-title">
        <p className={styles.entryEyebrow}>YOUR NEXT DOCUMENT STARTS HERE</p>
        <h1 id="resume-entry-title">Choose how you want to build.</h1>
        <p className={styles.entryLead}>Start with a visual editor, or work directly in LaTeX. Your projects stay separate, and you can choose either one whenever you visit.</p>
      </section>
      <section className={styles.choiceGrid} aria-label="Choose a resume editor">
        <article className={`${styles.choice} ${styles.regularChoice}`}>
          <div className={styles.choiceTop}><span className={styles.choiceIndex}>01 / VISUAL</span><span className={styles.choiceGlyph} aria-hidden="true">Aa</span></div>
          <div className={styles.paperSample} aria-hidden="true"><div className={styles.sampleName}></div><div className={styles.sampleRule}></div><div className={styles.sampleColumns}><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i><i></i></div></div></div>
          <div className={styles.choiceCopy}><h2>Regular editor</h2><p>Build visually with guided sections and see your document take shape as you write.</p><ul><li>Live page preview</li><li>Resume, CV, biodata &amp; more</li><li>Draft PDF via print dialog</li></ul></div>
          <button className={styles.chooseRegular} type="button" onClick={() => chooseMode('regular')}>Open Regular editor <span aria-hidden="true">→</span></button>
        </article>
        <article className={`${styles.choice} ${styles.latexChoice}`}>
          <div className={styles.choiceTop}><span className={styles.choiceIndex}>02 / SOURCE</span><span className={styles.choiceGlyph} aria-hidden="true">TeX</span></div>
          <div className={styles.sourceSample} aria-hidden="true"><span><b>\documentclass</b>{'{'}resume{'}'}</span><span><em>\begin</em>{'{'}document{'}'}</span><span className={styles.sourceIndent}>\section*{'{'}Experience{'}'}</span><span className={styles.sourceIndent}><i>Senior designer</i> · 2022—now</span><span><em>\end</em>{'{'}document{'}'}</span></div>
          <div className={styles.choiceCopy}><h2>LaTeX editor</h2><p>Shape a typeset resume with source files, project assets, and compiled PDF proof.</p><ul><li>Direct source editing</li><li>Project files &amp; checkpoints</li><li>Compile to a typeset PDF</li></ul></div>
          <button className={styles.chooseLatex} type="button" onClick={() => chooseMode('latex')}>Open LaTeX editor <span aria-hidden="true">→</span></button>
        </article>
      </section>
      <footer className={styles.entryFooter}><span>Separate drafts for each editor.</span><span>Already started? Choose that editor to continue.</span></footer>
    </main>
  </div>

  return <div className={`${theme.theme} ${styles.root}`} data-editor-mode={mode}>
    {notice && <div className={styles.status} role="status"><span>{notice}</span><button type="button" aria-label="Dismiss editor notice" onClick={() => setNotice('')}>Close</button></div>}
    <div ref={regularPanel} className={styles.panel} id="mr-resume-panel-regular" role="region" aria-label="Regular resume editor" tabIndex={0} hidden={mode !== 'regular'}>
      <MrResumeStudio embedded workspaceActive={mode === 'regular'} bridgeRef={regular} onCopyToLatex={copyRegular} />
    </div>
    <div ref={latexPanel} className={styles.panel} id="mr-resume-panel-latex" role="region" aria-label="LaTeX resume editor" tabIndex={0} hidden={mode !== 'latex'}>
      {(latexVisited || mode === 'latex') && <LatexBoundary onRegular={() => changeMode('regular')}><Suspense fallback={<div className={styles.loadState} role="status"><b>Opening the typesetting workspace</b><p>Loading the source editor. Your resume is not uploaded.</p></div>}><LatexResumeStudio active={mode === 'latex'} importRequest={importRequest} onImportHandled={(id: string) => setImportRequest((current) => current?.id === id ? null : current)} onCopyRegular={copyRegular} /></Suspense></LatexBoundary>}
    </div>
    <p className={styles.printMessage}>Download the compiled PDF from the LaTeX editor to print the typeset document.</p>
  </div>
}
