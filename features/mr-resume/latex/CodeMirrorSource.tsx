'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { bracketMatching, foldAll, foldGutter, foldKeymap, foldService, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type CompletionContext } from '@codemirror/autocomplete'
import { gotoLine as goToLine, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { classHighlighter } from '@lezer/highlight'
import { environmentFold, latexSnippets, sourceLineSeparator } from './editorHelpers.ts'
import type { LatexDiagnostic, LatexTextFile } from './types.ts'
import styles from './LatexResumeStudio.module.css'

export type SourceJump = { id: number; fileId: string; line: number; registration?: boolean; registrationOnly?: boolean }
type Props = { projectId: string; file: LatexTextFile; active: boolean; wrap: boolean; diagnostics: LatexDiagnostic[]; jump: SourceJump | null; registrationActive: boolean;
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

function completeLatex(context: CompletionContext) {
  const prefix = context.matchBefore(/\\[A-Za-z]*$/u)
  if (!prefix || (prefix.from === prefix.to && !context.explicit)) return null
  return { from: prefix.from, options: latexSnippets.map((item) => snippetCompletion(item.template, { label: item.label, detail: item.detail, type: 'keyword' })), validFor: /^\\[A-Za-z]*$/u }
}

export default function CodeMirrorSource(props: Props) {
  const mount = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), toolbar = useRef<HTMLButtonElement>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const cache = useRef(new Map<string, { state: EditorState; top: number; left: number }>())
  const currentKey = useRef(''), wrap = useRef(new Compartment()), editable = useRef(new Compartment()), language = useRef(new Compartment())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const appliedJump = useRef<number | null>(null)

  useEffect(() => {
    if (!mount.current) return
    const editorCache = cache.current
    const createState = (file: LatexTextFile) => EditorState.create({ doc: file.content, extensions: [
      EditorState.lineSeparator.of(sourceLineSeparator(file.content)), history({ minDepth: 40, newGroupDelay: 700 }),
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), foldGutter(), lintGutter(),
      language.current.of(/\.(?:tex|sty|cls)$/iu.test(file.path) ? texLanguage : []), syntaxHighlighting(classHighlighter),
      indentUnit.of('  '), indentOnInput(), bracketMatching(), closeBrackets(), search({ top: true }),
      autocompletion({ override: [completeLatex], defaultKeymap: false }),
      wrap.current.of(latest.current.wrap ? EditorView.lineWrapping : []),
      editable.current.of([EditorView.editable.of(latest.current.active), EditorState.readOnly.of(!latest.current.active)]), registrationField,
      EditorView.contentAttributes.of({ 'aria-label': 'Editable LaTeX source', 'aria-describedby': 'resume-latex-editor-help', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
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
        ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap,
        { key: 'Mod-Enter', run: () => { latest.current.onCompile(); return true } },
        { key: 'Escape', run: (editor) => { editor.setTabFocusMode(3000); toolbar.current?.focus(); return true } }, indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (!currentKey.current) return
        const previous = editorCache.get(currentKey.current), visible = latest.current.active && update.view.scrollDOM.clientHeight > 0
        editorCache.set(currentKey.current, { state: update.state, top: visible ? update.view.scrollDOM.scrollTop : previous?.top ?? 0, left: visible ? update.view.scrollDOM.scrollLeft : previous?.left ?? 0 })
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(Transaction.userEvent) === 'external')) latest.current.onChange(latest.current.file.id, update.state.sliceDoc())
        if (update.selectionSet || update.docChanged) {
          const line = update.state.doc.lineAt(update.state.selection.main.head)
          setCursor({ line: line.number, column: update.state.selection.main.head - line.from + 1 })
          latest.current.onCursor(latest.current.file.id, line.number)
        }
      }),
      EditorView.domEventHandlers({ scroll: (_event, editor) => {
        if (currentKey.current && latest.current.active && editor.scrollDOM.clientHeight > 0) editorCache.set(currentKey.current, { state: editor.state, top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft })
      } }),
    ] })
    const initial = latest.current, key = `${initial.projectId}:${initial.file.id}`
    currentKey.current = key
    const editor = new EditorView({ state: createState(initial.file), parent: mount.current })
    view.current = editor
    // State construction is retained on the instance, not recreated when React receives its own transaction text.
    const changeFile = (event: Event) => {
      const next = (event as CustomEvent<LatexTextFile>).detail, value = latest.current, key = `${value.projectId}:${next.id}`
      const previous = editorCache.get(currentKey.current), visible = editor.scrollDOM.clientHeight > 0
      editorCache.set(currentKey.current, { state: editor.state, top: visible ? editor.scrollDOM.scrollTop : previous?.top ?? 0, left: visible ? editor.scrollDOM.scrollLeft : previous?.left ?? 0 })
      currentKey.current = key
      const stored = editorCache.get(key)
      editor.setState(stored && stored.state.sliceDoc() === next.content ? stored.state : createState(next))
      editor.dispatch({ effects: [wrap.current.reconfigure(value.wrap ? EditorView.lineWrapping : []), editable.current.reconfigure([EditorView.editable.of(value.active), EditorState.readOnly.of(!value.active)])] })
      editor.scrollDOM.scrollTop = stored?.top ?? 0; editor.scrollDOM.scrollLeft = stored?.left ?? 0
      const line = editor.state.doc.lineAt(editor.state.selection.main.head)
      setCursor({ line: line.number, column: editor.state.selection.main.head - line.from + 1 }); value.onCursor(next.id, line.number)
      if (editorCache.size > 256) editorCache.delete(editorCache.keys().next().value!)
      editor.requestMeasure()
    }
    const host = mount.current
    host.addEventListener('latex-file', changeFile)
    return () => { host.removeEventListener('latex-file', changeFile); editor.destroy(); view.current = null }
  }, [])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor) return
    const key = `${props.projectId}:${props.file.id}`
    if (currentKey.current !== key) mount.current?.dispatchEvent(new CustomEvent('latex-file', { detail: props.file }))
    else if (editor.state.sliceDoc() !== props.file.content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.file.content }, annotations: Transaction.userEvent.of('external') })
  }, [props.projectId, props.file])

  useEffect(() => { view.current?.dispatch({ effects: language.current.reconfigure(/\.(?:tex|sty|cls)$/iu.test(props.file.path) ? texLanguage : []) }) }, [props.file.path])

  useLayoutEffect(() => {
    const editor = view.current, stored = cache.current.get(currentKey.current)
    if (props.active && editor && stored) { editor.scrollDOM.scrollTop = stored.top; editor.scrollDOM.scrollLeft = stored.left }
    view.current?.dispatch({ effects: [wrap.current.reconfigure(props.wrap ? EditorView.lineWrapping : []), editable.current.reconfigure([EditorView.editable.of(props.active), EditorState.readOnly.of(!props.active)])] })
    if (!props.active) view.current?.contentDOM.blur()
    else view.current?.requestMeasure()
  }, [props.wrap, props.active])

  useEffect(() => {
    const line = props.registrationActive && props.jump?.registration && props.jump.fileId === props.file.id ? props.jump.line : null
    view.current?.dispatch({ effects: registration.of(line) })
  }, [props.registrationActive, props.jump, props.file.id, props.projectId])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const diagnostics = props.diagnostics.filter((item) => item.file === props.file.path && item.line && item.line <= editor.state.doc.lines).map((item) => {
      const line = editor.state.doc.line(item.line!)
      return { from: line.from, to: line.to, severity: item.severity, message: item.help ? `${item.message}\n${item.help}` : item.message }
    })
    editor.dispatch(setDiagnostics(editor.state, diagnostics))
  }, [props.file.id, props.file.path, props.diagnostics])

  useEffect(() => {
    const editor = view.current, jump = props.jump
    if (!editor || !jump || jump.fileId !== props.file.id || !props.active || appliedJump.current === jump.id) return
    appliedJump.current = jump.id
    if (jump.registrationOnly) return
    const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, jump.line)))
    editor.dispatch({ selection: EditorSelection.cursor(line.from), effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), registration.of(jump.registration && props.registrationActive ? line.number : null)] })
    editor.focus()
  }, [props.jump, props.file.id, props.active, props.registrationActive])

  const command = (run: (editor: EditorView) => boolean) => { if (view.current) { run(view.current); view.current.focus() } }
  return <div className={styles.sourceEditor}>
    <div className={styles.editorTools} aria-label="Source editing tools">
      <button ref={toolbar} type="button" onClick={() => command(undo)} title="Undo (Ctrl/Cmd Z)">Undo</button>
      <button type="button" onClick={() => command(redo)} title="Redo (Ctrl/Cmd Shift Z)">Redo</button>
      <button type="button" onClick={() => command(openSearchPanel)}>Find / replace</button>
      <button type="button" onClick={() => command(goToLine)}>Go to line</button>
      <label className={styles.snippetControl}>Insert <select aria-label="Insert a LaTeX snippet" value="" onChange={(event) => {
        const snippet = latexSnippets.find((item) => item.label === event.target.value), editor = view.current
        if (snippet && editor) { const completion = snippetCompletion(snippet.template, { label: snippet.label }); if (typeof completion.apply === 'function') completion.apply(editor, completion, editor.state.selection.main.from, editor.state.selection.main.to); editor.focus() }
      }}><option value="">Snippet...</option>{latexSnippets.map((item) => <option key={item.label} value={item.label}>{item.detail}</option>)}</select></label>
      <button type="button" onClick={() => command(foldAll)}>Fold</button><button type="button" onClick={() => command(unfoldAll)}>Unfold</button>
    </div>
    <div ref={mount} className={styles.codeMirror} />
    <div className={styles.sourceStatus}><span id="resume-latex-editor-help">Tab indents. Escape leaves the editor. Ctrl/Cmd Enter compiles.</span><output>Ln {cursor.line}, Col {cursor.column}</output></div>
  </div>
}
