'use client'

/**
 * Merge PDF — an interactive merge studio.
 *
 * One job of the former 4-in-1 "PDF Tools" workbench, promoted to its own
 * focused tool with its own URL (/merge-pdf). Everything runs in the browser
 * with pdf-lib, never rasterised, so text stays selectable and the file never
 * leaves the device.
 *
 * The binding is done by `parts/mergeEngine.ts` (tested with real bytes): every
 * sheet stays a real copied page, so annotations, web links and rotation come
 * along, and links that jump to another kept page are re-pointed at it
 * (lib/pdf/pageCopy.ts). "Keep each page's original size" is the default;
 * choosing a target size only fits the page content with one transform, so
 * it keeps links too. (The default used to be "Same as first page", which
 * letterboxed mixed-size documents.)
 *
 * The page is a priority stack, top to bottom:
 *   - Input bench    — the sources rail beside the per-document page picker;
 *                      you start by adding documents and choosing pages.
 *   - Merged tray    — the assembled page stack, drag-reorderable.
 *   - Final preview  — live output sheet, page navigation, and the output
 *                      size / orientation / name rail.
 *   - Action bar     — the merge button closes the page.
 *
 * Per-source selection (`selectedPages` + `rangeInput`) lives on the source
 * record, so switching between documents never loses the user's choices.
 * `TrayItem` is the single source of truth for output order, which is why the
 * tray and the source selection are kept in step by the handlers below. Every
 * tray mutation goes through `parts/trayOrder.ts` (tested), so a re-selected
 * page returns to its natural place instead of jumping to the end, and the
 * binder (`parts/mergeEngine.ts`, tested) writes the tray order verbatim.
 *
 * Styling is a colocated CSS module in the `am-` namespace so this module
 * cannot leak rules into its siblings (CLAUDE.md §0.2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { downloadOutputs } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import styles from './MergePdfTool.module.css'
import {
  SOURCE_COLORS,
  STANDARD_PAGE_SIZES,
  type PageSizeOption,
  type OrientationOption,
  type SourcePdfFile,
  type TrayItem,
  compressRange,
  formatDimensions,
} from './parts/types'
import { generateSamplePdfFiles } from './samples/sampleGenerator'
import { SourcesRail } from './parts/SourcesRail'
import { studioMono, studioSerif } from './parts/fonts'
import { PagePickerSection } from './parts/PagePickerSection'
import { PreviewBindingSection } from './parts/PreviewBindingSection'
import { MergedTraySection } from './parts/MergedTraySection'
import { MergeActionBar } from './parts/MergeActionBar'
import { PageViewer } from './parts/PageViewer'
import { getPdfjs } from './parts/pdfjs'
import {
  groupBySource,
  isGroupedBySource,
  makeTrayId,
  moveTrayItem,
  orderBlocksBySource,
  setSourcePages,
  sortFilesByName,
  toggleSourcePage,
} from './parts/trayOrder'
import { mergeSheets, type MergeSheet } from './parts/mergeEngine'

export default function MergePdfTool() {
  const [sources, setSources] = useState<SourcePdfFile[]>([])
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null)
  const [tray, setTray] = useState<TrayItem[]>([])
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState<number>(0)
  const [pageSizeChoice, setPageSizeChoice] = useState<PageSizeOption>('orig')
  const [orientation, setOrientation] = useState<OrientationOption>('auto')
  const [outputName, setOutputName] = useState<string>('mycloove_merged-document')
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [previewModal, setPreviewModal] = useState<{ sourceId: number; pageNumber: number } | null>(null)
  const [lastMergedResult, setLastMergedResult] = useState<{ name: string; size: number; blob: Blob; signature: string } | null>(null)

  const dragSourceItemRef = useRef<{ type: 'source' | 'tray'; index: number } | null>(null)
  const nextSourceIdRef = useRef<number>(1)
  const thumbnailCache = useRef<Map<string, string>>(new Map())
  const previewCloseRef = useRef<HTMLButtonElement>(null)
  const previewReturnFocusRef = useRef<HTMLElement | null>(null)
  /* Imports run one batch at a time, in the order they were started. Two
     quick drops used to race, and whichever parsed first was committed first
     — a small second file could land ahead of a large first one. */
  const importChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingImportsRef = useRef<number>(0)
  /* Current rail order for the tray-order rules inside state updaters. */
  const sourceOrderRef = useRef<number[]>([])

  useEffect(() => {
    sourceOrderRef.current = sources.map((s) => s.id)
  }, [sources])

  /* A finished file describes the stack it was built from. Once the stack,
     its page size, orientation or name changes, that file no longer matches
     what the user sees, so it is withdrawn rather than offered for download. */
  useEffect(() => {
    setLastMergedResult(null)
  }, [tray, pageSizeChoice, orientation, outputName])

  /* Keep the preview cursor on a real sheet when sheets are removed. */
  useEffect(() => {
    setCurrentPreviewIndex((index) => (tray.length === 0 ? 0 : Math.min(index, tray.length - 1)))
  }, [tray.length])

  const renderPageToDataUrl = useCallback(
    async (sourceId: number, pageNumber: number, width: number): Promise<string | null> => {
      const cacheKey = `${sourceId}:${pageNumber}:${width}`
      if (thumbnailCache.current.has(cacheKey)) {
        return thumbnailCache.current.get(cacheKey)!
      }

      const src = sources.find((s) => s.id === sourceId)
      if (!src || !src.doc) return null

      try {
        const page = await src.doc.getPage(pageNumber)
        const unscaledViewport = page.getViewport({ scale: 1 })
        const scale = width / unscaledViewport.width
        const viewport = page.getViewport({ scale })

        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        // @ts-expect-error pdfjs canvasContext type compatibility
        await page.render({ canvasContext: ctx, viewport }).promise
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        thumbnailCache.current.set(cacheKey, dataUrl)
        return dataUrl
      } catch {
        return null
      }
    },
    [sources]
  )


  const importFiles = useCallback(async (pdfFiles: File[]) => {
    const pdfjs = await getPdfjs()
    const newSources: SourcePdfFile[] = []
    const newTrayAdditions: TrayItem[] = []
    const failed: string[] = []

    for (const file of sortFilesByName(pdfFiles)) {
      try {
        const buffer = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: buffer.slice(0) }).promise
        const pageSizes: Array<[number, number]> = []

        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p)
          const vp = page.getViewport({ scale: 1 })
          pageSizes.push([vp.width, vp.height])
        }

        const currentId = nextSourceIdRef.current++
        const colorIndex = (currentId - 1) % SOURCE_COLORS.length
        const letter = String.fromCharCode(65 + ((currentId - 1) % 26))

        const initialSelected = new Set<number>()
        for (let i = 1; i <= doc.numPages; i++) {
          initialSelected.add(i)
          newTrayAdditions.push({ id: makeTrayId(currentId, i), sourceId: currentId, pageNumber: i })
        }

        newSources.push({
          id: currentId,
          file,
          name: file.name,
          size: file.size,
          doc,
          pageCount: doc.numPages,
          sizes: pageSizes,
          selectedPages: initialSelected,
          rangeInput: compressRange(Array.from(initialSelected)),
          color: SOURCE_COLORS[colorIndex],
          letterBadge: letter,
        })
      } catch {
        failed.push(file.name)
      }
    }

    if (failed.length) {
      setErrorMessage(
        failed.length === 1
          ? `"${failed[0]}" could not be opened. It may be password-protected or damaged.`
          : `${failed.length} files could not be opened (${failed.join(', ')}). They may be password-protected or damaged.`
      )
    }

    if (newSources.length > 0) {
      // New documents join the end of the rail, so their sheets join the end of the stack.
      setSources((prev) => [...prev, ...newSources])
      setActiveSourceId((prev) => prev ?? newSources[0].id)
      setTray((prev) => [...prev, ...newTrayAdditions])
    }
  }, [])

  const handleAddFiles = useCallback(
    (filesToAdd: File[]) => {
      const pdfFiles = filesToAdd.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      )
      if (!pdfFiles.length) {
        setErrorMessage('Please upload valid PDF files.')
        return Promise.resolve()
      }

      setErrorMessage(null)
      setNoticeMessage(null)
      pendingImportsRef.current += 1
      setIsImporting(true)
      const run = importChainRef.current
        .then(() => importFiles(pdfFiles))
        .catch(() => {
          setErrorMessage('The PDF reader could not start. Reload the page and try again.')
        })
        .finally(() => {
          pendingImportsRef.current -= 1
          if (pendingImportsRef.current === 0) setIsImporting(false)
        })
      importChainRef.current = run
      return run
    },
    [importFiles]
  )

  usePasteFiles(handleAddFiles, true)

  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop: handleAddFiles,
    noClick: true,
    accept: { 'application/pdf': ['.pdf'] },
  })

  const handleRemoveSource = useCallback((sourceId: number) => {
    setSources((prev) => prev.filter((s) => s.id !== sourceId))
    setTray((prev) => prev.filter((t) => t.sourceId !== sourceId))
    setActiveSourceId((prev) => (prev === sourceId ? null : prev))
  }, [])

  useEffect(() => {
    if (activeSourceId === null && sources.length > 0) {
      setActiveSourceId(sources[0].id)
    }
  }, [activeSourceId, sources])

  /* A true "move to position": dragging source C above source A must put C
     first, not swap C one step. Adjacent-only swapping silently produced the
     wrong document order for multi-step drags.

     The rail order is the document order the user sees, so the stack follows
     it: whole document blocks move together. Only when the user has
     interleaved sheets by hand is the stack left alone — re-sorting it would
     silently undo their arrangement — and a notice says so. */
  const handleMoveSourceTo = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      if (fromIndex < 0 || fromIndex >= sources.length) return
      if (toIndex < 0 || toIndex >= sources.length) return
      const next = [...sources]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      const order = next.map((s) => s.id)
      sourceOrderRef.current = order
      setSources(next)
      if (isGroupedBySource(tray)) {
        setTray(orderBlocksBySource(tray, order))
        setNoticeMessage(null)
      } else {
        setNoticeMessage(
          'Your merged stack has a custom page arrangement, so it was kept as is. Use “Group by source” to follow the new document order.'
        )
      }
    },
    [sources, tray]
  )

  const handleMoveSource = useCallback(
    (index: number, direction: -1 | 1) => handleMoveSourceTo(index, index + direction),
    [handleMoveSourceTo]
  )

  const handleGroupTrayBySources = useCallback(() => {
    setTray((prev) => groupBySource(prev, sourceOrderRef.current))
    setNoticeMessage(null)
    setCurrentPreviewIndex(0)
  }, [])

  const handleTogglePage = useCallback((sourceId: number, pageNumber: number) => {
    setSources((prev) =>
      prev.map((s) => {
        if (s.id !== sourceId) return s
        const nextSet = new Set(s.selectedPages)
        if (nextSet.has(pageNumber)) {
          nextSet.delete(pageNumber)
        } else {
          nextSet.add(pageNumber)
        }
        return {
          ...s,
          selectedPages: nextSet,
          rangeInput: compressRange(Array.from(nextSet)),
        }
      })
    )

    setTray((prev) => toggleSourcePage(prev, sourceOrderRef.current, sourceId, pageNumber))
  }, [])

  const applyPagesToSource = useCallback((sourceId: number, targetPages: number[]) => {
    const targetSet = new Set(targetPages)

    setSources((prev) =>
      prev.map((s) => {
        if (s.id !== sourceId) return s
        return {
          ...s,
          selectedPages: targetSet,
          rangeInput: compressRange(targetPages),
        }
      })
    )

    /* Kept sheets stay exactly where they are; new ones go to their natural
       place. Rebuilding the stack as "other documents, then this one" is what
       used to push the first document behind the second. */
    setTray((prev) => setSourcePages(prev, sourceOrderRef.current, sourceId, targetPages))
  }, [])

  const handleApplyRangeInput = useCallback(
    (sourceId: number, rawInput: string) => {
      const src = sources.find((s) => s.id === sourceId)
      if (!src) return

      const tokens = rawInput.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
      const resolved = new Set<number>()
      let hadInvalid = false

      for (const token of tokens) {
        const match = token.match(/^(\d+)(?:-(\d+))?$/)
        if (!match) {
          hadInvalid = true
          continue
        }
        let start = parseInt(match[1], 10)
        let end = match[2] ? parseInt(match[2], 10) : start
        if (start > end) [start, end] = [end, start]

        if (start < 1 || end > src.pageCount) {
          hadInvalid = true
        }

        const validStart = Math.max(1, start)
        const validEnd = Math.min(src.pageCount, end)
        for (let p = validStart; p <= validEnd; p++) {
          resolved.add(p)
        }
      }

      if (hadInvalid) {
        setNoticeMessage(`Some page ranges were outside 1-${src.pageCount} and were adjusted.`)
        setErrorMessage(null)
      } else {
        setNoticeMessage(null)
      }

      applyPagesToSource(sourceId, Array.from(resolved).sort((a, b) => a - b))
    },
    [sources, applyPagesToSource]
  )


  const handleSelectAll = useCallback(
    (sourceId: number) => {
      const src = sources.find((s) => s.id === sourceId)
      if (!src) return
      const all = Array.from({ length: src.pageCount }, (_, i) => i + 1)
      applyPagesToSource(sourceId, all)
    },
    [sources, applyPagesToSource]
  )

  const handleClearSourceSelection = useCallback(
    (sourceId: number) => {
      applyPagesToSource(sourceId, [])
    },
    [applyPagesToSource]
  )

  const handleInvertSelection = useCallback(
    (sourceId: number) => {
      const src = sources.find((s) => s.id === sourceId)
      if (!src) return
      const inverted: number[] = []
      for (let i = 1; i <= src.pageCount; i++) {
        if (!src.selectedPages.has(i)) inverted.push(i)
      }
      applyPagesToSource(sourceId, inverted)
    },
    [sources, applyPagesToSource]
  )

  const handleRemoveTrayItem = useCallback((trayItemId: string) => {
    setTray((prev) => {
      const target = prev.find((t) => t.id === trayItemId)
      const nextTray = prev.filter((t) => t.id !== trayItemId)

      if (target) {
        const stillInTray = nextTray.some((t) => t.sourceId === target.sourceId && t.pageNumber === target.pageNumber)
        if (!stillInTray) {
          setSources((srcs) =>
            srcs.map((s) => {
              if (s.id !== target.sourceId) return s
              const newSel = new Set(s.selectedPages)
              newSel.delete(target.pageNumber)
              return {
                ...s,
                selectedPages: newSel,
                rangeInput: compressRange(Array.from(newSel)),
              }
            })
          )
        }
      }
      return nextTray
    })
  }, [])

  const handleReverseTray = useCallback(() => {
    setTray((prev) => [...prev].reverse())
    setCurrentPreviewIndex(0)
  }, [])

  const handleClearTray = useCallback(() => {
    setTray([])
    setSources((prev) =>
      prev.map((s) => ({
        ...s,
        selectedPages: new Set<number>(),
        rangeInput: '',
      }))
    )
    setCurrentPreviewIndex(0)
  }, [])

  const handleMoveTrayItem = useCallback((fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= tray.length || fromIndex === toIndex) return
    setTray(moveTrayItem(tray, fromIndex, toIndex))
    setCurrentPreviewIndex(toIndex)
  }, [tray])

  const computeTargetDimensions = useCallback(
    (item: TrayItem): [number, number] => {
      const src = sources.find((s) => s.id === item.sourceId)
      if (!src) return [595.28, 841.89]

      const [origW, origH] = src.sizes[item.pageNumber - 1] || [595.28, 841.89]

      if (pageSizeChoice === 'orig') {
        return [origW, origH]
      }

      let baseW: number
      let baseH: number

      if (pageSizeChoice === 'first') {
        const firstItem = tray[0]
        const firstSrc = firstItem ? sources.find((s) => s.id === firstItem.sourceId) : null
        const firstSize = firstSrc ? firstSrc.sizes[firstItem.pageNumber - 1] : [595.28, 841.89]
        baseW = firstSize[0]
        baseH = firstSize[1]
      } else {
        const standard = STANDARD_PAGE_SIZES[pageSizeChoice]
        baseW = standard[0]
        baseH = standard[1]
      }

      const shortSide = Math.min(baseW, baseH)
      const longSide = Math.max(baseW, baseH)

      const isLandscape =
        orientation === 'auto'
          ? origW > origH
          : orientation === 'landscape'

      return isLandscape ? [longSide, shortSide] : [shortSide, longSide]
    },
    [sources, pageSizeChoice, orientation, tray]
  )

  const activeSource = sources.find((s) => s.id === activeSourceId) || null
  const currentTrayItem = tray[currentPreviewIndex] || null
  const currentTraySource = currentTrayItem ? sources.find((s) => s.id === currentTrayItem.sourceId) : null
  const previewSource = previewModal ? sources.find((s) => s.id === previewModal.sourceId) ?? null : null
  const previewPageCount = previewSource?.pageCount ?? 0
  const previewPageSize =
    previewModal && previewSource ? previewSource.sizes[previewModal.pageNumber - 1] : undefined

  /* Move the open preview by ±1 page, clamped to the document. Kept in a
     functional update so it can be driven from the header buttons and from
     the keyboard listener without capturing a stale page number. */
  const movePreview = useCallback(
    (delta: number) => {
      setPreviewModal((current) => {
        if (!current) return current
        const src = sources.find((s) => s.id === current.sourceId)
        if (!src) return current
        const next = Math.min(src.pageCount, Math.max(1, current.pageNumber + delta))
        return next === current.pageNumber ? current : { ...current, pageNumber: next }
      })
    },
    [sources]
  )

  /* Latest navigation handler behind a ref, so the dialog's focus/scroll-lock
     effect can depend on open state alone instead of re-firing whenever the
     source list changes. */
  const movePreviewRef = useRef(movePreview)
  useEffect(() => {
    movePreviewRef.current = movePreview
  }, [movePreview])

  /* The preview is a real dialog: Escape closes it, focus moves to the close
     control on open and returns to the trigger on close, and the page behind is
     locked from scrolling while it is up. Arrow / Page keys step through the
     document — but arrow keys inside the sheet are left to caret/selection. */
  useEffect(() => {
    if (!previewModal) return
    previewReturnFocusRef.current = document.activeElement as HTMLElement | null
    previewCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const insideViewer = !!target?.closest?.('[data-page-viewer]')
      if (event.key === 'Escape') {
        setPreviewModal(null)
      } else if (event.key === 'PageUp' || (event.key === 'ArrowLeft' && !insideViewer)) {
        event.preventDefault()
        movePreviewRef.current(-1)
      } else if (event.key === 'PageDown' || (event.key === 'ArrowRight' && !insideViewer)) {
        event.preventDefault()
        movePreviewRef.current(1)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previewReturnFocusRef.current?.focus?.()
    }
  }, [previewModal])

  const sizeDistribution = useMemo(() => {
    const map = new Map<string, number>()
    tray.forEach((t) => {
      const src = sources.find((s) => s.id === t.sourceId)
      if (src && src.sizes[t.pageNumber - 1]) {
        const dim = formatDimensions(src.sizes[t.pageNumber - 1])
        map.set(dim, (map.get(dim) || 0) + 1)
      }
    })
    return Array.from(map.entries())
  }, [tray, sources])


  /* What a merge would produce right now. A finished result is only offered
     while it still matches: editing the tray or the output settings after a
     merge used to leave "Bound successfully" describing a different file. */
  const mergeSignature = useMemo(
    () => `${tray.map((t) => `${t.sourceId}:${t.pageNumber}`).join(',')}|${pageSizeChoice}|${orientation}|${outputName.trim()}`,
    [tray, pageSizeChoice, orientation, outputName],
  )
  const currentMergedResult = lastMergedResult?.signature === mergeSignature ? lastMergedResult : null

  const executeMerge = useCallback(async () => {
    if (!tray.length || isProcessing) return

    setIsProcessing(true)
    setProgressPercent(0)
    setErrorMessage(null)
    setNoticeMessage(null)
    setLastMergedResult(null)

    try {
      /* Snapshot the stack as it is right now: this exact order is what gets
         written, and it is what the success box will describe. */
      const plannedSheets: MergeSheet[] = tray.map((item) => ({
        sourceKey: item.sourceId,
        pageNumber: item.pageNumber,
        target: pageSizeChoice === 'orig' ? null : computeTargetDimensions(item),
      }))
      const usedIds = new Set(tray.map((item) => item.sourceId))
      const mergeSources = await Promise.all(
        sources
          .filter((s) => usedIds.has(s.id))
          .map(async (s) => ({ key: s.id, name: s.name, bytes: await s.file.arrayBuffer() }))
      )

      const cleanBaseName = (outputName.trim() || 'mycloove_merged-document').replace(/\.pdf$/i, '')
      const mergedBytes = await mergeSheets(mergeSources, plannedSheets, {
        title: cleanBaseName,
        onProgress: async (done, total) => {
          setProgressPercent(Math.round((done / total) * 100))
          // Yield so the progress fill can paint on long stacks.
          if (done % 8 === 0) await new Promise((r) => setTimeout(r, 0))
        },
      })
      const finalFileName = `${cleanBaseName}.pdf`
      const resultBlob = new Blob([mergedBytes.slice()], { type: 'application/pdf' })

      setLastMergedResult({
        name: finalFileName,
        size: mergedBytes.length,
        blob: resultBlob,
        signature: mergeSignature,
      })

      await downloadOutputs([{ name: finalFileName, blob: resultBlob }], cleanBaseName)

      addRecentConversion({
        toolId: 'merge-pdf',
        label: 'Merge PDF',
        filename: finalFileName,
        sizeBytes: mergedBytes.length,
      })
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An error occurred while merging your PDF pages.'
      )
    } finally {
      setIsProcessing(false)
      setProgressPercent(0)
    }
  }, [tray, sources, isProcessing, outputName, pageSizeChoice, computeTargetDimensions, mergeSignature])

  const handleLoadSamples = useCallback(async () => {
    try {
      const files = await generateSamplePdfFiles()
      await handleAddFiles(files)
    } catch {
      setErrorMessage('Could not generate sample files.')
    }
  }, [handleAddFiles])

  const targetDims = currentTrayItem ? computeTargetDimensions(currentTrayItem) : [595, 842]

  /* The header stepper is a real progress meter: 01 while there are no
     sources, 02 while the tray is still empty, 03 once pages are queued. It
     mirrors the stage tags on the panel heads so the page reads as one flow. */
  const stage = sources.length === 0 ? 1 : tray.length === 0 ? 2 : 3
  const stepClass = (n: number) =>
    [styles.step, n === stage && styles.stepActive, n < stage && styles.stepDone]
      .filter(Boolean)
      .join(' ')

  return (
    <div
      className={`${styles.astrumMerge} ${studioSerif.variable} ${studioMono.variable}`}
      /* react-dropzone defaults this to role="presentation", which removes the
         whole workbench from the accessibility tree. It is the drop target for
         the page, so it is announced as a labelled group instead. */
      {...getRootProps({
        role: 'group',
        'aria-label': 'Merge PDF workbench — drop PDF files anywhere here',
      })}
    >
      <input {...getInputProps()} />

      <div className={styles.header}>
        <div className={styles.steps}>
          <span className={stepClass(1)}>
            <b>{stage > 1 ? '✓' : '01'}</b> Select
          </span>
          <span className={`${styles.stepArrow} ${stage > 1 ? styles.stepArrowLit : ''}`} aria-hidden="true">
            →
          </span>
          <span className={stepClass(2)}>
            <b>{stage > 2 ? '✓' : '02'}</b> Arrange
          </span>
          <span className={`${styles.stepArrow} ${stage > 2 ? styles.stepArrowLit : ''}`} aria-hidden="true">
            →
          </span>
          <span className={stepClass(3)}>
            <b>03</b> Merge
          </span>
        </div>
        <p className={styles.lede}>
          Choose exact pages from every document, arrange the sheets in any order, and preview the
          bound file as you build it. Files added together line up by name; the download always
          follows the merged stack exactly, sheet for sheet.
        </p>
      </div>

      {errorMessage && (
        <div className={styles.errorBar} role="alert">
          {errorMessage}
        </div>
      )}

      {noticeMessage && (
        <div className={styles.noticeBar} role="status" aria-live="polite">
          {noticeMessage}
        </div>
      )}

      <div className={styles.stack}>
        <div className={styles.inputRow}>
          <SourcesRail
            sources={sources}
            activeSourceId={activeSourceId}
            onSelectSource={setActiveSourceId}
            onMoveSource={handleMoveSource}
            onMoveSourceTo={handleMoveSourceTo}
            onRemoveSource={handleRemoveSource}
            onAddFiles={open}
            isImporting={isImporting}
            dragSourceItemRef={dragSourceItemRef}
          />

          <PagePickerSection
            activeSource={activeSource}
            isImporting={isImporting}
            onApplyRange={handleApplyRangeInput}
            onSelectAll={handleSelectAll}
            onInvert={handleInvertSelection}
            onClear={handleClearSourceSelection}
            onRangeInputChange={(sourceId, val) => {
              setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, rangeInput: val } : s)))
            }}
            onTogglePage={(sourceId, pNum) => handleTogglePage(sourceId, pNum)}
            onPreview={(sourceId, pNum) => setPreviewModal({ sourceId, pageNumber: pNum })}
            onOpenFiles={open}
            onLoadSamples={handleLoadSamples}
            renderThumbnail={renderPageToDataUrl}
          />
        </div>

        <MergedTraySection
          tray={tray}
          sources={sources}
          currentPreviewIndex={currentPreviewIndex}
          onSelectTrayItem={setCurrentPreviewIndex}
          onRemoveTrayItem={handleRemoveTrayItem}
          onMoveTrayItem={handleMoveTrayItem}
          onGroupBySources={handleGroupTrayBySources}
          onReverseTray={handleReverseTray}
          onClearTray={handleClearTray}
          renderThumbnail={renderPageToDataUrl}
        />

        <PreviewBindingSection
          tray={tray}
          currentPreviewIndex={currentPreviewIndex}
          currentTrayItem={currentTrayItem}
          currentTraySource={currentTraySource}
          targetDimensions={targetDims as [number, number]}
          pageSizeChoice={pageSizeChoice}
          orientation={orientation}
          sizeDistribution={sizeDistribution}
          outputName={outputName}
          onPrev={() => setCurrentPreviewIndex((prev) => (prev - 1 + tray.length) % tray.length)}
          onNext={() => setCurrentPreviewIndex((prev) => (prev + 1) % tray.length)}
          onPageSizeChange={setPageSizeChoice}
          onOrientationChange={setOrientation}
          onOutputNameChange={setOutputName}
        />
      </div>

      <MergeActionBar
        pageCount={tray.length}
        isProcessing={isProcessing}
        progressPercent={progressPercent}
        lastMergedResult={currentMergedResult}
        onExecuteMerge={executeMerge}
        onDownload={() => {
          if (currentMergedResult) {
            downloadOutputs(
              [{ name: currentMergedResult.name, blob: currentMergedResult.blob }],
              currentMergedResult.name.replace(/\.pdf$/, '')
            )
          }
        }}
      />

      {previewModal && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of page ${previewModal.pageNumber}`}
          onClick={() => setPreviewModal(null)}
        >
          <div className={styles.lightboxPanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.lightboxHead}>
              <div className={styles.lightboxTitles}>
                <span className={styles.lightboxTitle} title={previewSource?.name}>
                  {previewSource?.name ?? 'Document'}
                </span>
                <span className={styles.lightboxMeta}>
                  {previewPageSize ? (
                    <span>{formatDimensions(previewPageSize)}</span>
                  ) : null}
                  {previewPageSize ? (
                    <span aria-hidden="true">·</span>
                  ) : null}
                  {previewPageSize ? (
                    <span>
                      {Math.round(previewPageSize[0])}×{Math.round(previewPageSize[1])} pt
                    </span>
                  ) : null}
                </span>
              </div>
              <div className={styles.lightboxActions}>
                <div className={styles.lightboxNav}>
                  <button
                    type="button"
                    className={styles.viewerBtn}
                    disabled={previewModal.pageNumber <= 1}
                    onClick={() => movePreview(-1)}
                    aria-label="Previous page"
                    title="Previous page (←)"
                  >
                    ◀
                  </button>
                  <span className={styles.lightboxCount} aria-live="polite">
                    {previewModal.pageNumber} / {previewPageCount}
                  </span>
                  <button
                    type="button"
                    className={styles.viewerBtn}
                    disabled={previewModal.pageNumber >= previewPageCount}
                    onClick={() => movePreview(1)}
                    aria-label="Next page"
                    title="Next page (→)"
                  >
                    ▶
                  </button>
                </div>
                <button
                  type="button"
                  ref={previewCloseRef}
                  className={styles.lightboxClose}
                  onClick={() => setPreviewModal(null)}
                  aria-label="Close preview"
                  title="Close preview (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className={styles.lightboxBody}>
              {previewSource ? (
                <PageViewer
                  doc={previewSource.doc}
                  pageNumber={previewModal.pageNumber}
                  variant="full"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        Nothing leaves your device — every sheet is bound in your browser
      </footer>
    </div>
  )
}
