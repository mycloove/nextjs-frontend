'use client'

/**
 * Merge PDF — an interactive merge studio.
 *
 * One job of the former 4-in-1 "PDF Tools" workbench, promoted to its own
 * focused tool with its own URL (/merge-pdf). Everything runs in the browser:
 * pages are embedded with pdf-lib, never rasterised, so text stays selectable
 * and the file never leaves the device.
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
 * tray and the source selection are kept in step by the handlers below.
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

export default function MergePdfTool() {
  const [sources, setSources] = useState<SourcePdfFile[]>([])
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null)
  const [tray, setTray] = useState<TrayItem[]>([])
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState<number>(0)
  const [pageSizeChoice, setPageSizeChoice] = useState<PageSizeOption>('first')
  const [orientation, setOrientation] = useState<OrientationOption>('auto')
  const [outputName, setOutputName] = useState<string>('mycloove_merged-document')
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [previewModal, setPreviewModal] = useState<{ sourceId: number; pageNumber: number } | null>(null)
  const [lastMergedResult, setLastMergedResult] = useState<{ name: string; size: number; blob: Blob } | null>(null)

  const dragSourceItemRef = useRef<{ type: 'source' | 'tray'; index: number } | null>(null)
  const nextSourceIdRef = useRef<number>(1)
  const thumbnailCache = useRef<Map<string, string>>(new Map())
  const previewCloseRef = useRef<HTMLButtonElement>(null)
  const previewReturnFocusRef = useRef<HTMLElement | null>(null)

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


  const handleAddFiles = useCallback(
    async (filesToAdd: File[]) => {
      const pdfFiles = filesToAdd.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      )
      if (!pdfFiles.length) {
        setErrorMessage('Please upload valid PDF files.')
        return
      }

      setErrorMessage(null)
      setNoticeMessage(null)
      setIsImporting(true)
      try {
        const pdfjs = await getPdfjs()
        const newSources: SourcePdfFile[] = []
        const newTrayAdditions: TrayItem[] = []

        for (const file of pdfFiles) {
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
              newTrayAdditions.push({
                id: `${currentId}_p${i}_${Math.random().toString(36).substring(2, 7)}`,
                sourceId: currentId,
                pageNumber: i,
              })
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
            setErrorMessage(`"${file.name}" could not be opened. It may be encrypted or corrupted.`)
          }
        }

        if (newSources.length > 0) {
          setSources((prev) => [...prev, ...newSources])
          setActiveSourceId((prev) => prev ?? newSources[0].id)
          setTray((prev) => [...prev, ...newTrayAdditions])
        }
      } finally {
        setIsImporting(false)
      }
    },
    []
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

  const handleMoveSource = useCallback((index: number, direction: -1 | 1) => {
    setSources((prev) => {
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const updated = [...prev]
      const temp = updated[index]
      updated[index] = updated[targetIndex]
      updated[targetIndex] = temp
      return updated
    })
  }, [])

  /* A true "move to position": dragging source C above source A must put C
     first, not swap C one step. Adjacent-only swapping silently produced the
     wrong document order for multi-step drags. */
  const handleMoveSourceTo = useCallback((fromIndex: number, toIndex: number) => {
    setSources((prev) => {
      if (fromIndex === toIndex) return prev
      if (fromIndex < 0 || fromIndex >= prev.length) return prev
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])


  const handleGroupTrayBySources = useCallback(() => {
    setTray((prev) => {
      const sourceOrderMap = new Map<number, number>()
      sources.forEach((s, idx) => sourceOrderMap.set(s.id, idx))

      const sorted = [...prev].sort((a, b) => {
        const orderA = sourceOrderMap.get(a.sourceId) ?? 999
        const orderB = sourceOrderMap.get(b.sourceId) ?? 999
        if (orderA !== orderB) return orderA - orderB
        return a.pageNumber - b.pageNumber
      })
      return sorted
    })
    setCurrentPreviewIndex(0)
  }, [sources])

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

    setTray((prev) => {
      const existsIndex = prev.findIndex((t) => t.sourceId === sourceId && t.pageNumber === pageNumber)
      if (existsIndex >= 0) {
        return prev.filter((_, idx) => idx !== existsIndex)
      } else {
        return [
          ...prev,
          {
            id: `${sourceId}_p${pageNumber}_${Math.random().toString(36).substring(2, 7)}`,
            sourceId,
            pageNumber,
          },
        ]
      }
    })
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

    setTray((prev) => {
      const otherSourcesPages = prev.filter((t) => t.sourceId !== sourceId)
      const thisSourceKept = prev.filter((t) => t.sourceId === sourceId && targetSet.has(t.pageNumber))
      const keptPageNumbers = new Set(thisSourceKept.map((t) => t.pageNumber))

      const newlyAdded: TrayItem[] = targetPages
        .filter((p) => !keptPageNumbers.has(p))
        .map((p) => ({
          id: `${sourceId}_p${p}_${Math.random().toString(36).substring(2, 7)}`,
          sourceId,
          pageNumber: p,
        }))

      return [...otherSourcesPages, ...thisSourceKept, ...newlyAdded]
    })
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
    setTray((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
    setCurrentPreviewIndex(toIndex)
  }, [])

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


  const executeMerge = useCallback(async () => {
    if (!tray.length || isProcessing) return

    setIsProcessing(true)
    setProgressPercent(0)
    setErrorMessage(null)
    setNoticeMessage(null)
    setLastMergedResult(null)

    try {
      const { PDFDocument } = await import('pdf-lib')
      const mergedPdf = await PDFDocument.create()

      const loadedDocsMap = new Map<number, Awaited<ReturnType<typeof PDFDocument.load>>>()

      for (let i = 0; i < tray.length; i++) {
        const item = tray[i]
        const src = sources.find((s) => s.id === item.sourceId)
        if (!src) continue

        let srcPdfDoc = loadedDocsMap.get(src.id)
        if (!srcPdfDoc) {
          const bytes = await src.file.arrayBuffer()
          srcPdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
          loadedDocsMap.set(src.id, srcPdfDoc)
        }

        const [embeddedPage] = await mergedPdf.embedPages([srcPdfDoc.getPage(item.pageNumber - 1)])
        const [targetWidth, targetHeight] = computeTargetDimensions(item)

        const scale = Math.min(targetWidth / embeddedPage.width, targetHeight / embeddedPage.height)
        const fittedWidth = embeddedPage.width * scale
        const fittedHeight = embeddedPage.height * scale
        const xOffset = (targetWidth - fittedWidth) / 2
        const yOffset = (targetHeight - fittedHeight) / 2

        const newPage = mergedPdf.addPage([targetWidth, targetHeight])
        newPage.drawPage(embeddedPage, {
          x: xOffset,
          y: yOffset,
          width: fittedWidth,
          height: fittedHeight,
        })

        setProgressPercent(Math.round(((i + 1) / tray.length) * 100))
        await new Promise((r) => setTimeout(r, 8))
      }

      const mergedBytes = await mergedPdf.save({ useObjectStreams: true })
      const cleanBaseName = (outputName.trim() || 'mycloove_merged-document').replace(/\.pdf$/i, '')
      const finalFileName = `${cleanBaseName}.pdf`
      const resultBlob = new Blob([mergedBytes.slice()], { type: 'application/pdf' })

      setLastMergedResult({
        name: finalFileName,
        size: mergedBytes.length,
        blob: resultBlob,
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
  }, [tray, sources, isProcessing, outputName, computeTargetDimensions])

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
          bound file as you build it. Each file keeps its own selection while you work.
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
        lastMergedResult={lastMergedResult}
        onExecuteMerge={executeMerge}
        onDownload={() => {
          if (lastMergedResult) {
            downloadOutputs(
              [{ name: lastMergedResult.name, blob: lastMergedResult.blob }],
              lastMergedResult.name.replace(/\.pdf$/, '')
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
