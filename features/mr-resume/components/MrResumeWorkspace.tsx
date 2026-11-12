'use client'

import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import MrResumeStudio, { type RegularStudioBridge } from './MrResumeStudio'
import { LATEX_MODE_KEY, type LatexImportRequest } from '../latex/types'
import { latexTemplateCards } from '../latex/latexTemplateCards'
import ResumeHome from '../home/ResumeHome'
import { regularTemplateCards } from './regularTemplateCards'
import { resolveTemplateRequest, templateHref, wantsSample, type TemplateRequest } from './templateCatalog'
import styles from './MrResumeWorkspace.module.css'
import theme from './MrResumeTheme.module.css'

// Neither the editor nor PDF.js enters the Regular editor's initial load path.
const LatexResumeStudio = lazy(() => import('../latex/LatexResumeStudio'))
type EditorMode = 'regular' | 'latex'
const editorPaths = { regular: '/mr-resume/regular-editor', latex: '/mr-resume/latex' }

class LatexBoundary extends Component<{ children: ReactNode; onRegular: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className={styles.loadState} role="alert"><b>The LaTeX workspace could not load.</b><p>The Regular editor remains available. Only committed local drafts can be restored after a page reload.</p><button type="button" onClick={this.props.onRegular}>Return to Regular editor</button></div>
  }
}

export default function MrResumeWorkspace() {
  const router = useRouter()
  const segment = useSelectedLayoutSegment()
  const mode: EditorMode | null = segment === 'regular-editor' ? 'regular' : segment === 'latex' ? 'latex' : null
  // The URL owns the visible mode. Once opened, editors stay mounted even when
  // Back returns to the chooser, preserving session-only drafts and copy requests.
  const [workspaceVisited, setWorkspaceVisited] = useState(mode !== null)
  const [latexVisited, setLatexVisited] = useState(mode === 'latex')
  const [importRequest, setImportRequest] = useState<LatexImportRequest | null>(null)
  const [notice, setNotice] = useState('')
  const regular = useRef<RegularStudioBridge>(null)
  const regularPanel = useRef<HTMLDivElement>(null)
  const latexPanel = useRef<HTMLDivElement>(null)
  const importSequence = useRef(0)
  const [templateRequest, setTemplateRequest] = useState<TemplateRequest | null>(null)
  const templateSequence = useRef(0)

  if (mode && !workspaceVisited) setWorkspaceVisited(true)
  if (mode === 'latex' && !latexVisited) setLatexVisited(true)

  useLayoutEffect(() => {
    // History navigation bypasses the copy/switch guards. Cancel only transient
    // Regular dialogs so their native modal ownership cannot block the chooser.
    if (mode !== 'regular') regularPanel.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
      if (dialog.open) dialog.close()
    })
    // Native inert is set via the DOM for React 18 compatibility. Hidden alone
    // is not a sufficient contract for retained focus/print ownership.
    if (regularPanel.current) regularPanel.current.inert = mode !== 'regular'
    if (latexPanel.current) latexPanel.current.inert = mode !== 'latex'
  }, [mode, latexVisited])

  // Gallery deep link: /mr-resume/<editor>?template=<id>. The id is checked
  // against that editor's own catalog, handed to the editor once, and removed
  // from the URL so Reload or Back can never apply the same template twice.
  useEffect(() => {
    if (mode === null) return
    const params = new URLSearchParams(window.location.search)
    const value = params.get('template')
    const resolved = resolveTemplateRequest(mode, value, mode === 'regular' ? regularTemplateCards : latexTemplateCards)
    if (!resolved) return
    router.replace(editorPaths[mode], { scroll: false })
    setTemplateRequest({ editor: mode, id: resolved.kind === 'template' ? resolved.card.id : String(value), sequence: ++templateSequence.current, sample: wantsSample(mode, params) })
  }, [mode, router])

  function templateHandled(sequence: number) {
    setTemplateRequest((current) => current?.sequence === sequence ? null : current)
  }

  function openTemplate(editor: EditorMode, id: string, sample = false) {
    router.push(templateHref(editor, id, sample), { scroll: false })
    try { window.localStorage.setItem(LATEX_MODE_KEY, editor) } catch { /* The gallery remains usable without storage. */ }
  }

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
    router.push(editorPaths[next], { scroll: false })
    try { window.localStorage.setItem(LATEX_MODE_KEY, next) } catch { /* Session mode remains usable. */ }
  }

  function copyRegular() {
    const snapshot = regular.current?.getSnapshot()
    if (!snapshot) { setNotice('Wait for the Regular draft to finish restoring before copying it.'); return }
    const outcome = regular.current!.prepareToHide()
    if (outcome.reason) { setNotice(outcome.reason); return }
    setImportRequest({ id: String(++importSequence.current), snapshot })
    if (mode !== 'latex') router.push(editorPaths.latex, { scroll: false })
    setNotice(outcome.saveFailed ? 'The Regular draft could not save locally. This copy uses your current writing; the Regular draft remains in this session.' : '')
    try { window.localStorage.setItem(LATEX_MODE_KEY, 'latex') } catch { /* No draft storage is repurposed. */ }
  }

  function chooseMode(next: EditorMode) {
    router.push(editorPaths[next], { scroll: false })
    try { window.localStorage.setItem(LATEX_MODE_KEY, next) } catch { /* The chooser remains usable without storage. */ }
  }

  return <div className={`${theme.theme} ${styles.root}${mode ? '' : ` ${styles.entryRoot}`}`} data-editor-mode={mode ?? undefined}>
    {!mode && <ResumeHome onOpenEditor={chooseMode} onOpenTemplate={openTemplate} />}
    {workspaceVisited && <>
      {mode && notice && <div className={styles.status} role="status"><span>{notice}</span><button type="button" aria-label="Dismiss editor notice" onClick={() => setNotice('')}>Close</button></div>}
      <div ref={regularPanel} className={styles.panel} id="mr-resume-panel-regular" role="region" aria-label="Regular resume editor" tabIndex={0} hidden={mode !== 'regular'}>
        <MrResumeStudio embedded workspaceActive={mode === 'regular'} bridgeRef={regular} onCopyToLatex={copyRegular} templateRequest={templateRequest?.editor === 'regular' ? templateRequest : null} onTemplateHandled={templateHandled} />
      </div>
      <div ref={latexPanel} className={styles.panel} id="mr-resume-panel-latex" role="region" aria-label="LaTeX resume editor" tabIndex={0} hidden={mode !== 'latex'}>
        {(latexVisited || mode === 'latex') && <LatexBoundary onRegular={() => changeMode('regular')}><Suspense fallback={<div className={styles.loadState} role="status"><b>Opening the typesetting workspace</b><p>Loading the source editor. Your resume is not uploaded.</p></div>}><LatexResumeStudio active={mode === 'latex'} importRequest={importRequest} onImportHandled={(id: string) => setImportRequest((current) => current?.id === id ? null : current)} onCopyRegular={copyRegular} templateRequest={templateRequest?.editor === 'latex' ? templateRequest : null} onTemplateHandled={templateHandled} /></Suspense></LatexBoundary>}
      </div>
      <p className={styles.printMessage}>Download the compiled PDF from the LaTeX editor to print the typeset document.</p>
    </>}
  </div>
}
