'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react'
import { convertTailForCaret, previewForCaret, type BanglishContext } from './banglish'
import { isSingleTypingInsertion, replaceBanglishSource, restoreBanglishAtCaret, type BanglishSource } from './banglishEditing'
import styles from './MrResumeStudio.module.css'

type Suggestion = {
  source: string
  start: number
  end: number
  options: string[]
  snapshot: string
  applied: boolean
  selected: number
  armed: boolean
  caret: number
  commitEnd: number
  phonetic: boolean
}

type BanglishInputProps = {
  id: string
  className: string
  inputRef: RefObject<HTMLInputElement | null> | RefObject<HTMLTextAreaElement | null>
  value: string
  onValueChange: (value: string, kind: 'typing' | 'action') => void
  enabled: boolean
  phonetic?: boolean
  context: BanglishContext
  learned: Readonly<Record<string, string>>
  sources: readonly BanglishSource[]
  onConversion: (source: BanglishSource, value: string) => void
  onLearn: (source: string, reading: string) => void
  onPasteText?: (text: string, start: number, end: number, snapshot: string) => void
  onHistory?: (direction: 'undo' | 'redo') => void
  placeholder: string
  rows?: number
  t: (value: string) => string
}

/** One input method for both the name/heading field and the section textarea. */
export default function BanglishInput({ id, className, inputRef, value, onValueChange, enabled, phonetic = false, context, learned, sources, onConversion, onLearn, onPasteText, onHistory, placeholder, rows, t }: BanglishInputProps) {
  const [storedSuggestion, setSuggestion] = useState<Suggestion | null>(null)
  const suggestion = enabled && storedSuggestion?.snapshot === value && storedSuggestion.phonetic === phonetic ? storedSuggestion : null
  const pendingCaret = useRef<number | null>(null)
  const composing = useRef(false)
  const dismissed = useRef<{ source: string; start: number } | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listId = `banglish-readings-${useId()}`
  const hintId = `${listId}-hint`
  const options = { context, learned, force: phonetic }

  useEffect(() => {
    const caret = pendingCaret.current
    pendingCaret.current = null
    if (caret === null) return
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(Math.min(caret, input.value.length), Math.min(caret, input.value.length))
  }, [value, inputRef])

  function preview(next: string, caret: number) {
    if (!enabled || composing.current) return setSuggestion(null)
    const result = previewForCaret(next, caret, options)
    if (!result || !result.candidates.length || (dismissed.current?.source === result.source && dismissed.current.start === result.start)) {
      setSuggestion(null)
      return
    }
    setSuggestion({ ...result, options: result.candidates, snapshot: next, applied: false, selected: 0, armed: false, caret, commitEnd: caret, phonetic })
  }

  function handleType(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const next = event.currentTarget.value
    const caret = event.currentTarget.selectionStart ?? next.length
    const native = event.nativeEvent as InputEvent
    // IME composition, pasted text and selected-text replacements must stay raw.
    const typed = !native.inputType || ['insertText', 'insertLineBreak', 'insertParagraph'].includes(native.inputType)
    if (enabled && typed && !composing.current && !native.isComposing && isSingleTypingInsertion(value, next, caret)) {
      const result = convertTailForCaret(next, caret, options)
      if (result && !(dismissed.current?.source === result.source && dismissed.current.start === result.start)) {
        pendingCaret.current = result.caret
        onValueChange(result.next, 'action')
        onConversion({ source: result.source, reading: result.converted, start: result.start, end: result.newEnd }, result.next)
        setSuggestion({ source: result.source, start: result.start, end: result.newEnd, options: result.candidates, snapshot: result.next, applied: true, selected: 0, armed: false, caret: result.caret, commitEnd: result.caret, phonetic })
        dismissed.current = null
        return
      }
    }
    onValueChange(next, 'typing')
    preview(next, caret)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const text = event.clipboardData.getData('text').replace(/\r\n?/gu, '\n')
    const pasted = rows ? text : text.replace(/\n/gu, ' ')
    if (!pasted) return
    event.preventDefault()
    const input = event.currentTarget
    const start = input.selectionStart ?? value.length
    const end = input.selectionEnd ?? start
    pendingCaret.current = start + pasted.length
    setSuggestion(null)
    dismissed.current = null
    const next = value.slice(0, start) + pasted + value.slice(end)
    onValueChange(next, 'action')
    onPasteText?.(pasted, start, start + pasted.length, next)
    // An identical replacement will not run the value-dependent effect.
    // Collapse the selection now and do not leak a caret into the next keystroke.
    if (next === value) {
      pendingCaret.current = null
      input.setSelectionRange(start + pasted.length, start + pasted.length)
    }
  }

  function applyReading(reading: string, learn = true, separator: '' | ' ' = '') {
    if (!suggestion || suggestion.snapshot !== value) return
    const replacement = replaceBanglishSource(value, { ...suggestion, reading: value.slice(suggestion.start, suggestion.end) }, reading, suggestion.caret, separator)
    if (!replacement) return
    const next = replacement.next
    pendingCaret.current = replacement.caret
    onValueChange(next, 'action')
    if (/[\u0980-\u09ff]/u.test(reading)) {
      onConversion({ source: suggestion.source, reading, start: suggestion.start, end: suggestion.start + reading.length }, next)
      if (learn) onLearn(suggestion.source, reading)
    }
    dismissed.current = learn ? null : { source: suggestion.source, start: suggestion.start }
    setSuggestion(null)
    // Choosing the already-applied candidate still needs to return focus.
    if (next === value) {
      const input = inputRef.current
      input?.focus({ preventScroll: true })
      input?.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (composing.current || event.nativeEvent.isComposing) return
    const key = event.key.toLowerCase()
    if (event.ctrlKey || event.metaKey) {
      if (onHistory && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault()
        setSuggestion(null)
        onHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
      }
      return
    }
    if (!enabled) return
    const input = inputRef.current
    const inField = event.target === input
    const inOptions = optionRefs.current.some((option) => option === event.target)
    if (!inField && !inOptions || event.shiftKey) return
    if (inField && event.key === 'Backspace' && !event.altKey && input && input.selectionStart === input.selectionEnd) {
      const restored = restoreBanglishAtCaret(value, input.selectionStart ?? value.length, sources)
      if (restored) {
        event.preventDefault()
        pendingCaret.current = restored.caret
        onValueChange(restored.next, 'action')
        preview(restored.next, restored.caret)
        return
      }
    }
    if (!suggestion || suggestion.snapshot !== value) return
    if (inField && event.key === ' ' && suggestion.armed && !event.altKey) {
      event.preventDefault()
      applyReading(suggestion.options[suggestion.selected], true, ' ')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissed.current = { source: suggestion.source, start: suggestion.start }
      setSuggestion(null)
      input?.focus({ preventScroll: true })
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const selected = (suggestion.selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestion.options.length) % suggestion.options.length
      setSuggestion({ ...suggestion, selected, armed: true })
      if (!inField) optionRefs.current[selected]?.focus()
      return
    }
    // Ordinary digits remain digits. Numeric candidate mode is entered explicitly
    // with the arrows; Alt+1..3 also chooses directly without stealing dates/GPA.
    if (/^[1-3]$/u.test(event.key) && (event.altKey || suggestion.armed || !inField)) {
      const reading = suggestion.options[Number(event.key) - 1]
      if (reading) { event.preventDefault(); applyReading(reading) }
    } else if (event.key === 'Enter' && (!suggestion.applied || suggestion.armed || !inField)) {
      event.preventDefault()
      applyReading(suggestion.options[suggestion.selected])
    }
  }

  const fieldProps = {
    id, className, value, placeholder, onChange: handleType, onPaste: handlePaste,
    spellCheck: enabled ? false : undefined,
    autoCapitalize: enabled ? 'off' : undefined,
    autoCorrect: enabled ? 'off' : undefined,
    'aria-autocomplete': enabled ? 'list' as const : undefined,
    'aria-controls': suggestion ? listId : undefined,
    'aria-activedescendant': suggestion?.armed ? `${listId}-${suggestion.selected}` : undefined,
    'aria-describedby': enabled ? hintId : undefined,
    onFocus: (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = event.currentTarget
      if (input.selectionStart === input.selectionEnd) preview(input.value, input.selectionStart ?? input.value.length)
    },
    onCompositionStart: () => { composing.current = true; setSuggestion(null) },
    onCompositionEnd: () => { composing.current = false },
    onSelect: (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = event.currentTarget
      if (input.selectionStart !== input.selectionEnd) return setSuggestion(null)
      const caret = input.selectionStart ?? input.value.length
      if (suggestion?.applied && suggestion.snapshot === input.value && caret >= suggestion.start && caret <= suggestion.commitEnd) {
        if (caret !== suggestion.caret) setSuggestion({ ...suggestion, caret })
        return
      }
      preview(input.value, caret)
    },
  }

  return <div className={styles.banglishField} onKeyDown={handleKeys} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSuggestion(null)
  }}>
    {rows ? <textarea {...fieldProps} ref={inputRef as RefObject<HTMLTextAreaElement | null>} rows={rows} /> : <input {...fieldProps} ref={inputRef as RefObject<HTMLInputElement | null>} />}
    {enabled && <p id={hintId} className={styles.srOnly}>{t('Space converts a completed word. Arrow keys choose a suggestion; Enter applies it. Alt+1 to Alt+3 selects directly. Escape dismisses. Backspace restores the original Banglish word.')}</p>}
    {enabled && suggestion && <div className={styles.typeSuggest}>
      <div className={styles.typeSuggestHeading}><span className={styles.typeSuggestLabel}>{t(suggestion.applied ? 'Converted word' : 'Suggestion, not applied')}</span><code>{suggestion.source}</code></div>
      <div id={listId} className={styles.typeSuggestOptions} role="listbox" aria-label={t('Bangla suggestions')}>
        {suggestion.options.map((option, index) => <button key={option} ref={(element) => { optionRefs.current[index] = element }} id={`${listId}-${index}`} type="button" role="option" aria-selected={suggestion.selected === index} tabIndex={suggestion.selected === index ? 0 : -1} className={`${styles.typeSuggestButton} ${suggestion.selected === index ? styles.typeSuggestSelected : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => applyReading(option)}><kbd aria-hidden="true">{index + 1}</kbd><span lang="bn">{option}</span></button>)}
      </div>
      <div className={styles.typeSuggestFoot}><span>{t('Arrows + Enter, or Alt+1–3')}</span><button type="button" onClick={() => applyReading(suggestion.source, false)}>{t('Keep Latin')}</button></div>
    </div>}
  </div>
}
