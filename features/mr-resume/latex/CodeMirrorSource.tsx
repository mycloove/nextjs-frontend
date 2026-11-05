'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { bracketMatching, foldAll, foldGutter, foldKeymap, foldService, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type CompletionContext } from '@codemirror/autocomplete'
import { gotoLine as goToLine, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { lintGutter, nextDiagnostic, previousDiagnostic } from '@codemirror/lint'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { classHighlighter } from '@lezer/highlight'
import { editorSourceRange, environmentFold, latexCommandPrefix, projectLatexSnippets, projectLatexSuggestions, sourceLineSeparator } from './editorHelpers.ts'
import { checkLocalDiagnostics, compilerEditorDiagnostics, editorDiagnosticsExtension, LOCAL_CHECK_DELAY, mergedEditorDiagnostics, refreshEditorDiagnostics, shouldCheckLocalSource, type EditorDiagnostic, type LocalDiagnosticReport } from './editorDiagnostics.ts'
import { reviewedSourceFixTransaction, type ReviewedSourceFix } from './editorFixes.ts'
import { matchesSourceSnapshot } from './workspaceIdentity.ts'
import type { LatexDiagnostic, LatexProject, LatexRuntime, LatexTextFile } from './types.ts'
import styles from './LatexResumeStudio.module.css'
import LatexIcon from './LatexIcon'

export type SourceJump = { id: number; fileId: string; line: number; column?: number; endLine?: number; endColumn?: number; registration?: boolean; registrationOnly?: boolean }
type Props = { projectId: string; file: LatexTextFile; active: boolean; wrap: boolean; tabSize: 2 | 4; diagnostics: LatexDiagnostic[]; jump: SourceJump | null; registrationActive: boolean;
  revision: number; project?: LatexProject | null; toolbarActions: ReactNode;
  runtime?: LatexRuntime; diagnosticSnapshot?: LatexProject | null; diagnosticRuntime?: LatexRuntime; onLocalDiagnostics?: (report: LocalDiagnosticReport | null) => void;
  sourceIsCurrent?: (snapshot: LatexProject) => boolean; fixRequest?: { id: number; review: ReviewedSourceFix } | null; onFixResult?: (id: number, error: string | null) => void;
  validateChange: (fileId: string, text: string) => string | null; onChange: (fileId: string, text: string) => void;
  onCursor: (fileId: string, line: number) => void; onCompile: () => void; onNotice: (message: string) => void }

const registration = StateEffect.define<number | null>()
const texLanguage = StreamLanguage.define(stex)
const registrationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    // Edits invalidate measured registration, rather than moving an old proof marker onto new writing.
    if (transaction.docChanged) value = Decoration.none
    for (const effect of transaction.effects) if (effect.is(registration)) {
      value = effect.value && effect.value <= transaction.state.doc.lines ? Decoration.set([Decoration.line({ class: styles.sourceRegistration }).range(transaction.state.doc.line(effect.value).from)]) : Decoration.none
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

function completionProject(props: Props) {
  return props.project?.id === props.projectId && props.project.revision === props.revision
    && props.project.files.some((file) => file.id === props.file.id && file.path === props.file.path) ? props.project : null
}

function completeLatex(context: CompletionContext, props: Props) {
  // CodeMirror offsets count one unit per line break. Analysis uses that view,
  // while edits/undo and onChange continue using the original line separator.
  const source = context.state.doc.toString(), project = completionProject(props)
  const argument = projectLatexSuggestions(project, props.file, source, context.pos)
  // The bounded candidates are prefix-filtered. Requery after edits/backspace
  // rather than caching a list that may have excluded the newly requested key.
  if (argument) return argument
  const prefix = latexCommandPrefix(source, context.pos)
  if (!prefix || (prefix.from === prefix.to && !context.explicit)) return null
  return { ...prefix, options: projectLatexSnippets(project, props.file, source).map((item) => snippetCompletion(item.template, { label: item.label, detail: item.detail, type: 'keyword' })), validFor: /^\\[A-Za-z]*$/u }
}

export default function CodeMirrorSource(props: Props) {
  const mount = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), toolbar = useRef<HTMLButtonElement>(null), insertMenu = useRef<HTMLDetailsElement>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const cache = useRef(new Map<string, { state: EditorState; top: number; left: number }>())
  const currentKey = useRef(''), wrap = useRef(new Compartment()), editable = useRef(new Compartment()), language = useRef(new Compartment())
  const indentation = useRef(new Compartment())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const appliedJump = useRef<number | null>(null)
  const appliedFix = useRef<number | null>(null)
  const diagnosticsController = useRef<{ invalidate: (clearReport?: boolean) => void; refresh: () => void; schedule: () => void } | null>(null)

  useEffect(() => {
    if (!mount.current) return
    const editorCache = cache.current
    let local: LocalDiagnosticReport | null = null, timer: ReturnType<typeof setTimeout> | null = null, generation = 0, composing = false, disposed = false
    let compiler: EditorDiagnostic[] = [], compilerInput: { diagnostics: LatexDiagnostic[]; snapshot: LatexProject; runtime: LatexRuntime } | null = null
    const visible = () => latest.current.active && document.visibilityState !== 'hidden' && Boolean(view.current?.scrollDOM.clientHeight)
    const canCheck = () => !disposed && shouldCheckLocalSource({ active: latest.current.active, visible: visible(), composing: composing || Boolean(view.current?.compositionStarted) })
    const invalidate = (clearReport = true) => {
      generation++
      if (timer) clearTimeout(timer)
      timer = null
      if (clearReport && local) { local = null; latest.current.onLocalDiagnostics?.(null) }
    }
    const refresh = () => {
      const editor = view.current, value = latest.current, project = completionProject(value), runtime = value.runtime ?? 'browser'
      if (!editor || disposed) return
      let marks: ReturnType<typeof mergedEditorDiagnostics> = []
      if (canCheck() && project && currentKey.current === `${value.projectId}:${value.file.id}` && editor.state.sliceDoc() === value.file.content
        && project.files.some((file) => file.id === value.file.id && file.content === value.file.content) && (value.sourceIsCurrent?.(project) ?? true)) {
        const snapshot = value.diagnosticSnapshot
        if (snapshot && value.diagnosticRuntime === runtime && matchesSourceSnapshot(project, snapshot) && (value.sourceIsCurrent?.(snapshot) ?? true)) {
          if (compilerInput?.diagnostics !== value.diagnostics || compilerInput.snapshot !== snapshot || compilerInput.runtime !== runtime) {
            compiler = compilerEditorDiagnostics(snapshot, value.diagnostics, runtime); compilerInput = { diagnostics: value.diagnostics, snapshot, runtime }
          }
        } else { compiler = []; compilerInput = null }
        marks = mergedEditorDiagnostics(project, value.file.id, runtime, compiler, local, editor.state.lineBreak)
      }
      editor.dispatch({ effects: refreshEditorDiagnostics.of({ source: editor.state.sliceDoc(), diagnostics: marks }) })
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = null
      const requested = ++generation, key = currentKey.current, runtime = latest.current.runtime ?? 'browser'
      if (!canCheck()) return
      timer = setTimeout(() => {
        timer = null
        const editor = view.current, value = latest.current, project = completionProject(value)
        if (!editor || requested !== generation || key !== currentKey.current || runtime !== (value.runtime ?? 'browser') || !canCheck() || !project
          || editor.state.sliceDoc() !== value.file.content || !project.files.some((file) => file.id === value.file.id && file.content === value.file.content)
          || !(value.sourceIsCurrent?.(project) ?? true)) return
        const report = checkLocalDiagnostics(project, value.file.id, runtime)
        if (!report || requested !== generation || !canCheck() || !(latest.current.sourceIsCurrent?.(report.snapshot) ?? matchesSourceSnapshot(completionProject(latest.current), report.snapshot))) return
        local = report; refresh(); latest.current.onLocalDiagnostics?.(report)
      }, LOCAL_CHECK_DELAY)
    }
    const createState = (file: LatexTextFile) => EditorState.create({ doc: file.content, extensions: [
      EditorState.lineSeparator.of(sourceLineSeparator(file.content)), history({ minDepth: 40, newGroupDelay: 700 }),
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), foldGutter(), lintGutter(),
      language.current.of(/\.(?:tex|sty|cls)$/iu.test(file.path) ? texLanguage : []), syntaxHighlighting(classHighlighter),
      indentation.current.of([indentUnit.of(' '.repeat(latest.current.tabSize)), EditorState.tabSize.of(latest.current.tabSize)]), indentOnInput(), bracketMatching(), closeBrackets(), search({ top: true }),
      autocompletion({ override: [(context) => /\.(?:tex|sty|cls)$/iu.test(latest.current.file.path) ? completeLatex(context, latest.current) : null], defaultKeymap: false }),
      wrap.current.of(latest.current.wrap ? EditorView.lineWrapping : []),
      editable.current.of([EditorView.editable.of(latest.current.active), EditorState.readOnly.of(!latest.current.active)]), registrationField, editorDiagnosticsExtension,
      EditorView.contentAttributes.of({ 'aria-label': 'Editable project source', 'aria-describedby': 'resume-latex-editor-help', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      foldService.of((state, start) => {
        if (!/\\begin\{[^{}]+\}/u.test(state.doc.lineAt(start).text)) return null
        const range = environmentFold(state.sliceDoc(), state.doc.lineAt(start).number)
        if (!range) return null
        // EditorState offsets use one unit per break, even when the source file uses CRLF.
        return { from: state.doc.line(state.doc.lineAt(start).number).to, to: state.doc.line(range.endLine).from }
      }),
      EditorState.transactionFilter.of((transaction) => {
        if (!transaction.docChanged || transaction.annotation(Transaction.userEvent) === 'external') return transaction
        const error = latest.current.validateChange(latest.current.file.id, transaction.newDoc.toString().split('\n').join(transaction.startState.lineBreak))
        if (!error) return transaction
        queueMicrotask(() => latest.current.onNotice(`${error} The source change was not applied.`))
        return []
      }),
      keymap.of([
        // Override the default blank-line command; compiling must not edit source.
        { key: 'Mod-Enter', run: () => { latest.current.onCompile(); return true } },
        { key: 'F8', run: nextDiagnostic }, { key: 'Shift-F8', run: previousDiagnostic },
        ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap,
        { key: 'Escape', run: (editor) => { editor.setTabFocusMode(3000); toolbar.current?.focus(); return true } }, indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (!currentKey.current) return
        const previous = editorCache.get(currentKey.current), visible = latest.current.active && update.view.scrollDOM.clientHeight > 0
        editorCache.set(currentKey.current, { state: update.state, top: visible ? update.view.scrollDOM.scrollTop : previous?.top ?? 0, left: visible ? update.view.scrollDOM.scrollLeft : previous?.left ?? 0 })
        if (update.docChanged) {
          // The extension already cleared marks within this transaction, before onChange or React runs.
          invalidate()
          if (!update.transactions.some((transaction) => transaction.annotation(Transaction.userEvent) === 'external')) latest.current.onChange(latest.current.file.id, update.state.sliceDoc())
          schedule()
        }
        if (update.selectionSet || update.docChanged) {
          const line = update.state.doc.lineAt(update.state.selection.main.head)
          setCursor({ line: line.number, column: update.state.selection.main.head - line.from + 1 })
          latest.current.onCursor(latest.current.file.id, update.state.sliceDoc(0, update.state.selection.main.head).split(/\r\n|\r|\n/u).length)
        }
      }),
      EditorView.domEventHandlers({ compositionstart: () => { composing = true; invalidate(); refresh() }, compositionend: () => {
        composing = false
        // CodeMirror finishes its own composition observer before the next idle check is scheduled.
        queueMicrotask(() => { if (!disposed) schedule() })
      }, scroll: (_event, editor) => {
        if (currentKey.current && latest.current.active && editor.scrollDOM.clientHeight > 0) editorCache.set(currentKey.current, { state: editor.state, top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft })
      } }),
    ] })
    const initial = latest.current, key = `${initial.projectId}:${initial.file.id}`
    currentKey.current = key
    const editor = new EditorView({ state: createState(initial.file), parent: mount.current })
    view.current = editor
    diagnosticsController.current = { invalidate, refresh, schedule }
    // State construction is retained on the instance, not recreated when React receives its own transaction text.
    const changeFile = (event: Event) => {
      const next = (event as CustomEvent<LatexTextFile>).detail, value = latest.current, key = `${value.projectId}:${next.id}`
      invalidate(); composing = false
      const previous = editorCache.get(currentKey.current), visible = editor.scrollDOM.clientHeight > 0
      editorCache.set(currentKey.current, { state: editor.state, top: visible ? editor.scrollDOM.scrollTop : previous?.top ?? 0, left: visible ? editor.scrollDOM.scrollLeft : previous?.left ?? 0 })
      currentKey.current = key
      const stored = editorCache.get(key)
      const state = stored && stored.state.sliceDoc() === next.content ? stored.state : createState(next)
      editor.setState(state.update({ effects: refreshEditorDiagnostics.of({ source: next.content, diagnostics: [] }) }).state)
      editor.dispatch({ effects: [wrap.current.reconfigure(value.wrap ? EditorView.lineWrapping : []), editable.current.reconfigure([EditorView.editable.of(value.active), EditorState.readOnly.of(!value.active)]), indentation.current.reconfigure([indentUnit.of(' '.repeat(value.tabSize)), EditorState.tabSize.of(value.tabSize)])] })
      editor.scrollDOM.scrollTop = stored?.top ?? 0; editor.scrollDOM.scrollLeft = stored?.left ?? 0
      const line = editor.state.doc.lineAt(editor.state.selection.main.head)
      setCursor({ line: line.number, column: editor.state.selection.main.head - line.from + 1 }); value.onCursor(next.id, editor.state.sliceDoc(0, editor.state.selection.main.head).split(/\r\n|\r|\n/u).length)
      if (editorCache.size > 256) editorCache.delete(editorCache.keys().next().value!)
      editor.requestMeasure()
      refresh(); schedule()
    }
    const host = mount.current
    host.addEventListener('latex-file', changeFile)
    // Retain current reports while hidden so mobile Problems can display them without running checks.
    const visibilityChanged = () => { invalidate(false); refresh(); schedule() }
    document.addEventListener('visibilitychange', visibilityChanged)
    let wasVisible = visible()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const nextVisible = visible()
      if (nextVisible !== wasVisible) { wasVisible = nextVisible; visibilityChanged() }
    })
    observer?.observe(editor.scrollDOM)
    refresh(); schedule()
    return () => {
      disposed = true; generation++; if (timer) clearTimeout(timer)
      observer?.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged)
      host.removeEventListener('latex-file', changeFile); diagnosticsController.current = null; editor.destroy(); view.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor) return
    const key = `${props.projectId}:${props.file.id}`
    if (currentKey.current !== key) mount.current?.dispatchEvent(new CustomEvent('latex-file', { detail: props.file }))
    else if (editor.state.sliceDoc() !== props.file.content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.file.content }, annotations: Transaction.userEvent.of('external') })
  }, [props.projectId, props.file])

  useEffect(() => { view.current?.dispatch({ effects: language.current.reconfigure(/\.(?:tex|sty|cls)$/iu.test(props.file.path) ? texLanguage : []) }) }, [props.file.path])

  useEffect(() => { view.current?.dispatch({ effects: indentation.current.reconfigure([indentUnit.of(' '.repeat(props.tabSize)), EditorState.tabSize.of(props.tabSize)]) }) }, [props.tabSize])

  useLayoutEffect(() => {
    const editor = view.current, stored = cache.current.get(currentKey.current)
    if (props.active && editor && stored) { editor.scrollDOM.scrollTop = stored.top; editor.scrollDOM.scrollLeft = stored.left }
    view.current?.dispatch({ effects: [wrap.current.reconfigure(props.wrap ? EditorView.lineWrapping : []), editable.current.reconfigure([EditorView.editable.of(props.active), EditorState.readOnly.of(!props.active)])] })
    if (!props.active) view.current?.contentDOM.blur()
    else view.current?.requestMeasure()
  }, [props.wrap, props.active])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const line = props.registrationActive && props.jump?.registration && props.jump.fileId === props.file.id
      ? editor.state.doc.lineAt(editorSourceRange(editor.state.sliceDoc(), props.jump, editor.state.lineBreak).from).number : null
    editor.dispatch({ effects: registration.of(line) })
  }, [props.registrationActive, props.jump, props.file.id, props.projectId])

  useLayoutEffect(() => {
    const controller = diagnosticsController.current
    controller?.invalidate(); controller?.refresh(); controller?.schedule()
  }, [props.projectId, props.project, props.file, props.revision, props.runtime])

  useLayoutEffect(() => {
    const controller = diagnosticsController.current
    controller?.invalidate(false); controller?.refresh(); controller?.schedule()
  }, [props.active])

  useLayoutEffect(() => { diagnosticsController.current?.refresh() }, [props.diagnostics, props.diagnosticSnapshot, props.diagnosticRuntime])

  useEffect(() => {
    const request = props.fixRequest, editor = view.current
    if (!request || !editor || appliedFix.current === request.id) return
    appliedFix.current = request.id
    let error: string | null = null
    try {
      const value = latest.current, project = completionProject(value)
      if (!value.active || editor.compositionStarted || !editor.scrollDOM.clientHeight || document.visibilityState === 'hidden' || !project || !value.sourceIsCurrent?.(request.review.snapshot)) throw new Error('The reviewed source is no longer active and current. Nothing was applied.')
      const transaction = reviewedSourceFixTransaction(editor.state, project, value.file.id, value.runtime ?? 'browser', request.review, value.validateChange)
      if (view.current !== editor || latest.current.fixRequest?.id !== request.id || !latest.current.sourceIsCurrent?.(request.review.snapshot)
        || latest.current.runtime !== value.runtime || latest.current.file.id !== request.review.fileId) throw new Error('The fix request changed before it could be applied. Nothing was applied.')
      editor.dispatch(transaction)
      editor.focus()
    } catch (failure) { error = failure instanceof Error ? failure.message : 'The reviewed fix could not be applied. Source was kept.' }
    latest.current.onFixResult?.(request.id, error)
  }, [props.fixRequest, props.active, props.file.id, props.projectId, props.runtime])

  useEffect(() => {
    const editor = view.current, jump = props.jump
    if (!editor || !jump || jump.fileId !== props.file.id || !props.active || appliedJump.current === jump.id) return
    appliedJump.current = jump.id
    if (jump.registrationOnly) return
    const { from, to } = editorSourceRange(editor.state.sliceDoc(), jump, editor.state.lineBreak)
    const line = editor.state.doc.lineAt(from)
    editor.dispatch({ selection: EditorSelection.range(from, to), effects: [EditorView.scrollIntoView(from, { y: 'center' }), registration.of(jump.registration && props.registrationActive ? line.number : null)] })
    editor.focus()
  }, [props.jump, props.file.id, props.active, props.registrationActive])

  const command = (run: (editor: EditorView) => boolean, focusEditor = true) => { if (view.current) { run(view.current); if (focusEditor) view.current.focus() } }
  const snippets = projectLatexSnippets(completionProject(props), props.file)
  return <div className={styles.sourceEditor}>
    <div id="resume-latex-editor-tools" className={styles.editorTools} role="group" aria-label="Source editor command bar">
      <div className={styles.commandScroll}>
        <span className={styles.commandTitle}>Editable source</span>
        <span className={styles.commandRevision}>Editing r{props.revision}</span>
        <span className={`${styles.toolDivider} ${styles.commandWideDivider}`} aria-hidden="true" />
        <div className={styles.toolGroup} role="group" aria-label="Edit history">
          <button ref={toolbar} className={styles.toolButton} type="button" aria-label="Undo" onClick={() => command(undo)} title="Undo (Ctrl/Cmd Z)"><LatexIcon name="undo" /></button>
          <button className={styles.toolButton} type="button" aria-label="Redo" onClick={() => command(redo)} title="Redo (Ctrl/Cmd Shift Z)"><LatexIcon name="redo" /></button>
        </div>
        <span className={styles.toolDivider} aria-hidden="true" />
        <div className={styles.toolGroup} role="group" aria-label="Source navigation">
          <button className={styles.toolButton} type="button" aria-label="Find and replace" onClick={() => command(openSearchPanel, false)} title="Find and replace (Ctrl/Cmd F)"><LatexIcon name="search" /></button>
          <button className={styles.toolButton} type="button" aria-label="Go to line" onClick={() => command(goToLine, false)} title="Go to line"><LatexIcon name="hash" /></button>
        </div>
        <span className={styles.toolDivider} aria-hidden="true" />
        <div className={styles.toolGroup} role="group" aria-label="Code folding">
          <button className={styles.toolButton} type="button" aria-label="Fold all matched LaTeX environments" onClick={() => command(foldAll)} title="Fold all matched LaTeX environments"><LatexIcon name="fold" /></button>
          <button className={styles.toolButton} type="button" aria-label="Unfold all environments" onClick={() => command(unfoldAll)} title="Unfold all environments"><LatexIcon name="unfold" /></button>
        </div>
      </div>
      <span className={styles.toolDivider} aria-hidden="true" />
      {/\.(?:tex|sty|cls)$/iu.test(props.file.path) && <details ref={insertMenu} className={styles.snippetMenu} data-latex-menu>
        <summary aria-label="Insert LaTeX snippet" title="Insert LaTeX snippet"><LatexIcon name="plus" /><span>Insert</span><LatexIcon name="chevronDown" /></summary>
        <div className={styles.snippetOptions} aria-label="LaTeX snippets">
          <span className={styles.menuHeading}>Insert snippet</span>
          {snippets.map((item) => <button key={item.label} type="button" disabled={!props.active} onClick={() => {
            const editor = view.current
            if (!editor || !latest.current.active || editor.state.readOnly) return
            const current = projectLatexSnippets(completionProject(latest.current), latest.current.file, editor.state.doc.toString()).find((candidate) => candidate.label === item.label)
            if (!current) return
            const completion = snippetCompletion(current.template, { label: current.label })
            if (typeof completion.apply === 'function') completion.apply(editor, completion, editor.state.selection.main.from, editor.state.selection.main.to)
            if (insertMenu.current) insertMenu.current.open = false
            editor.focus()
          }}><span>{item.detail}</span><code>{item.label}</code></button>)}
        </div>
      </details>}
      {props.toolbarActions}
    </div>
    <div ref={mount} className={styles.codeMirror} />
    <div className={styles.sourceStatus}><span id="resume-latex-editor-help">Tab indents. Escape leaves the editor. F8 / Shift F8 moves between diagnostics. Ctrl/Cmd Enter compiles.</span><output>Ln {cursor.line}, Col {cursor.column}<span className={styles.statusEncoding}>UTF-8</span></output></div>
  </div>
}
