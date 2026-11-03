'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
import LatexIcon from './LatexIcon'

export type SourceJump = { id: number; fileId: string; line: number; registration?: boolean; registrationOnly?: boolean }
type Props = { projectId: string; file: LatexTextFile; active: boolean; wrap: boolean; tabSize: 2 | 4; diagnostics: LatexDiagnostic[]; jump: SourceJump | null; registrationActive: boolean;
  revision: number; toolbarActions: ReactNode;
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
  const mount = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), toolbar = useRef<HTMLButtonElement>(null), insertMenu = useRef<HTMLDetailsElement>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const cache = useRef(new Map<string, { state: EditorState; top: number; left: number }>())
  const currentKey = useRef(''), wrap = useRef(new Compartment()), editable = useRef(new Compartment()), language = useRef(new Compartment())
  const indentation = useRef(new Compartment())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const appliedJump = useRef<number | null>(null)

  useEffect(() => {
    if (!mount.current) return
    const editorCache = cache.current
    const createState = (file: LatexTextFile) => EditorState.create({ doc: file.content, extensions: [
      EditorState.lineSeparator.of(sourceLineSeparator(file.content)), history({ minDepth: 40, newGroupDelay: 700 }),
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), foldGutter(), lintGutter(),
      language.current.of(/\.(?:tex|sty|cls)$/iu.test(file.path) ? texLanguage : []), syntaxHighlighting(classHighlighter),
      indentation.current.of([indentUnit.of(' '.repeat(latest.current.tabSize)), EditorState.tabSize.of(latest.current.tabSize)]), indentOnInput(), bracketMatching(), closeBrackets(), search({ top: true }),
      autocompletion({ override: [(context) => /\.(?:tex|sty|cls)$/iu.test(latest.current.file.path) ? completeLatex(context) : null], defaultKeymap: false }),
      wrap.current.of(latest.current.wrap ? EditorView.lineWrapping : []),
      editable.current.of([EditorView.editable.of(latest.current.active), EditorState.readOnly.of(!latest.current.active)]), registrationField,
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
        ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap,
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
      editor.dispatch({ effects: [wrap.current.reconfigure(value.wrap ? EditorView.lineWrapping : []), editable.current.reconfigure([EditorView.editable.of(value.active), EditorState.readOnly.of(!value.active)]), indentation.current.reconfigure([indentUnit.of(' '.repeat(value.tabSize)), EditorState.tabSize.of(value.tabSize)])] })
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

  useEffect(() => { view.current?.dispatch({ effects: indentation.current.reconfigure([indentUnit.of(' '.repeat(props.tabSize)), EditorState.tabSize.of(props.tabSize)]) }) }, [props.tabSize])

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

  const command = (run: (editor: EditorView) => boolean, focusEditor = true) => { if (view.current) { run(view.current); if (focusEditor) view.current.focus() } }
  return <div className={styles.sourceEditor}>
    <div id="resume-latex-editor-tools" className={styles.editorTools} role="group" aria-label="Source editor command bar">
      <div className={styles.commandScroll}>
        <span className={styles.commandTitle}>Editable source</span>
        <span className={styles.commandRevision}>r{props.revision}</span>
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
          {latexSnippets.map((item) => <button key={item.label} type="button" onClick={() => {
            const editor = view.current
            if (!editor) return
            const completion = snippetCompletion(item.template, { label: item.label })
            if (typeof completion.apply === 'function') completion.apply(editor, completion, editor.state.selection.main.from, editor.state.selection.main.to)
            if (insertMenu.current) insertMenu.current.open = false
            editor.focus()
          }}><span>{item.detail}</span><code>{item.label}</code></button>)}
        </div>
      </details>}
      {props.toolbarActions}
    </div>
    <div ref={mount} className={styles.codeMirror} />
    <div className={styles.sourceStatus}><span id="resume-latex-editor-help">Tab indents. Escape leaves the editor. Ctrl/Cmd Enter compiles.</span><output>Ln {cursor.line}, Col {cursor.column}<span className={styles.statusEncoding}>UTF-8</span></output></div>
  </div>
}
