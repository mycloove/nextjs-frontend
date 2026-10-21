'use client'

/* ── Markdown Merge — session hook ─────────────────────────────────────────
   All dialog-local state lives here, never in the orchestrator (index.tsx).
   This is the one place that owns the *impure* edges:
     • reading files off disk,
     • the Bijoy transport (injected, defaulting to the `/api/bijoy-convert`
       proxy) — the engine itself stays pure.
   Everything else is derived with `useMemo` from the pure engine, so the live
   preview is exactly what `Create document` will save (WYSIWYG honesty). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getApiErrorMessage, toolRequest } from '@/lib/api/client'

import {
  DEFAULT_MERGE_OPTIONS,
  type MergeDoc,
  type MergeOptions,
  type MergePreset,
  type MergeResult,
  type SeparatorOption,
  type SeparatorStyle,
} from './types.ts'
import { mergeDocuments } from './engine.ts'
import { resolveResultOutput } from './result-edit.ts'
import { detectBijoy, normalizeBangla, type BijoyTransport } from './unicode.ts'

export interface MergeSource extends MergeDoc {
  origin: 'workspace' | 'disk'
  selected: boolean
}

/** Default transport: the thin Next proxy in front of the pinned Python engine. */
export const bijoyTransport: BijoyTransport = async (text: string) => {
  const response = await toolRequest('/api/bijoy-convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Bijoy conversion failed.'))
  }
  const data = (await response.json()) as { text?: unknown; detected_bijoy?: unknown }
  const converted = typeof data.text === 'string' ? data.text : text
  return { text: normalizeBangla(converted), detected: data.detected_bijoy === true }
}

const READABLE = /\.(md|markdown|txt)$/i

const cloneOptions = (): MergeOptions => ({
  ...DEFAULT_MERGE_OPTIONS,
  separator: { ...DEFAULT_MERGE_OPTIONS.separator },
})

export interface MergeSession {
  sources: MergeSource[]
  options: MergeOptions
  result: MergeResult | null
  selectedCount: number
  converting: boolean
  autoNormalize: boolean
  notice: string | null
  activePreset: string | null
  /** The user's manual output, or null when they have not edited. */
  editedMarkdown: string | null
  /** What Create/Copy must use: the overlay, else the generated text. */
  outputMarkdown: string
  /** True once a manual overlay exists. */
  resultEdited: boolean
  /** True when the inputs have moved on since the overlay was captured. */
  editsStale: boolean
  toggle: (id: string) => void
  selectAll: () => void
  clearAll: () => void
  move: (id: string, dir: 'up' | 'down') => void
  reorder: (fromId: string, toId: string) => void
  removeSource: (id: string) => void
  addFiles: (files: File[]) => void
  setOption: <K extends keyof MergeOptions>(key: K, value: MergeOptions[K]) => void
  setSeparator: (style: SeparatorStyle) => void
  setCustomSeparator: (value: string) => void
  setAutoNormalize: (value: boolean) => void
  applyPreset: (preset: MergePreset) => void
  dismissNotice: () => void
  /** Capture the current generated text as the overlay base (call once, on first edit). */
  beginEdit: () => void
  setEditedMarkdown: (text: string | null) => void
  /** Drop the manual overlay and fall back to the generated result. */
  resetEdits: () => void
}

export function useMergeSession(initialDocs: MergeDoc[], transport: BijoyTransport = bijoyTransport): MergeSession {
  // The dialog mounts per open, so this initialiser is the fresh-start snapshot.
  const [sources, setSources] = useState<MergeSource[]>(() =>
    initialDocs.map((d) => ({ ...d, origin: 'workspace' as const, selected: false })),
  )
  const [options, setOptions] = useState<MergeOptions>(cloneOptions)
  const [normalized, setNormalized] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(0)
  const [autoNormalize, setAutoNormalize] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const attempted = useRef<Set<string>>(new Set())

  /* Manual edits are an overlay on the derived result, never the source of
     truth (see result-edit.ts). `editBase` is the generated text captured when
     the first keystroke landed, so a later input change can be flagged as stale
     without the hook reaching into an effect (which the lint rules reject). */
  const [editedMarkdown, setEditedMarkdownState] = useState<string | null>(null)
  const [editBase, setEditBase] = useState<string | null>(null)

  const selected = useMemo(() => sources.filter((s) => s.selected), [sources])

  const effectiveDocs = useMemo<MergeDoc[]>(
    () =>
      selected.map((s) => ({
        id: s.id,
        title: s.title,
        markdown: normalized[s.id] ?? s.markdown,
      })),
    [selected, normalized],
  )

  const result = useMemo<MergeResult | null>(
    () => (effectiveDocs.length ? mergeDocuments(effectiveDocs, options) : null),
    [effectiveDocs, options],
  )

  /* The resolved output: the manual overlay when it exists, the generated text
     otherwise, with staleness measured against the base captured at first edit. */
  const editOutput = resolveResultOutput({
    generated: result?.markdown ?? '',
    edited: editedMarkdown,
    base: editBase,
  })

  const beginEdit = useCallback(() => {
    setEditBase(result?.markdown ?? '')
  }, [result])

  const setEditedMarkdown = useCallback((text: string | null) => {
    setEditedMarkdownState(text)
    if (text === null) setEditBase(null)
  }, [])

  const resetEdits = useCallback(() => {
    setEditedMarkdownState(null)
    setEditBase(null)
  }, [])

  // Auto-normalise: only sources the local heuristic flags, and only once each,
  // so a merge never spends a convoy of quota gates on plain English.
  useEffect(() => {
    if (!autoNormalize) return
    for (const source of sources) {
      if (!source.selected || attempted.current.has(source.id)) continue
      if (!detectBijoy(source.markdown)) continue
      attempted.current.add(source.id)
      setPending((n) => n + 1)
      transport(source.markdown)
        .then(({ text, detected }) => {
          if (detected) setNormalized((prev) => ({ ...prev, [source.id]: text }))
        })
        .catch(() => {
          attempted.current.delete(source.id)
          setNotice('Bijoy conversion failed for one source — it was left unchanged.')
        })
        .finally(() => setPending((n) => Math.max(0, n - 1)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, autoNormalize])

  const toggle = useCallback((id: string) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)))
  }, [])

  const selectAll = useCallback(() => {
    setSources((prev) => prev.map((s) => ({ ...s, selected: true })))
  }, [])

  const clearAll = useCallback(() => {
    setSources((prev) => prev.map((s) => ({ ...s, selected: false })))
  }, [])

  const move = useCallback((id: string, dir: 'up' | 'down') => {
    setSources((prev) => {
      const i = prev.findIndex((s) => s.id === id)
      if (i < 0) return prev
      const j = dir === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      return next
    })
  }, [])

  const reorder = useCallback((fromId: string, toId: string) => {
    setSources((prev) => {
      const from = prev.findIndex((s) => s.id === fromId)
      const to = prev.findIndex((s) => s.id === toId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = prev.slice()
      const source = next[from]
      next[from] = next[to]
      next[to] = source
      return next
    })
  }, [])

  const removeSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const addFiles = useCallback((files: File[]) => {
    const readable = files.filter((f) => READABLE.test(f.name))
    if (!readable.length) {
      if (files.length) setNotice('Only .md, .markdown and .txt files can be added.')
      return
    }
    const buckets: MergeSource[] = new Array(readable.length)
    let remaining = readable.length
    readable.forEach((file, index) => {
      const reader = new FileReader()
      const finish = () => {
        remaining--
        if (remaining <= 0) {
          const added = buckets.filter(Boolean)
          if (added.length) setSources((prev) => [...prev, ...added])
        }
      }
      reader.onload = () => {
        buckets[index] = {
          id: `disk-${file.name}-${file.lastModified}-${index}`,
          title: file.name.replace(/\.[^.]+$/, ''),
          markdown: typeof reader.result === 'string' ? reader.result : '',
          origin: 'disk',
          selected: true,
        }
        finish()
      }
      reader.onerror = () => {
        setNotice(`Could not read ${file.name}.`)
        finish()
      }
      reader.readAsText(file)
    })
  }, [])

  const setOption = useCallback(
    <K extends keyof MergeOptions>(key: K, value: MergeOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }))
      setActivePreset(null)
    },
    [],
  )

  const setSeparator = useCallback((style: SeparatorStyle) => {
    setOptions((prev) => ({ ...prev, separator: { ...prev.separator, style } }))
    setActivePreset(null)
  }, [])

  const setCustomSeparator = useCallback((value: string) => {
    setOptions((prev) => ({ ...prev, separator: { ...prev.separator, custom: value } }))
    setActivePreset(null)
  }, [])

  const applyPreset = useCallback((preset: MergePreset) => {
    setActivePreset(preset.id)
    const { separator, ...rest } = preset.patch
    setOptions((prev) => ({
      ...prev,
      ...rest,
      separator: separator ? ({ ...separator } as SeparatorOption) : prev.separator,
    }))
    setSources((prev) => prev.map((s) => ({ ...s, selected: true })))
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    sources,
    options,
    result,
    selectedCount: selected.length,
    converting: pending > 0,
    autoNormalize,
    notice,
    activePreset,
    editedMarkdown,
    outputMarkdown: editOutput.output,
    resultEdited: editOutput.edited,
    editsStale: editOutput.stale,
    toggle,
    selectAll,
    clearAll,
    move,
    reorder,
    removeSource,
    addFiles,
    setOption,
    setSeparator,
    setCustomSeparator,
    setAutoNormalize,
    applyPreset,
    dismissNotice,
    beginEdit,
    setEditedMarkdown,
    resetEdits,
  }
}
