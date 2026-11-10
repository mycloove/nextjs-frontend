'use client'

import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import styles from './kit.module.css'
import { Dialog } from './Dialog'
import { PageThumb } from './PageThumb'

/**
 * View one page large (PageGrid's double-click / Enter). Left and right arrow
 * keys and the two buttons step through the document; the page is re-read at
 * full size, never upscaled from the grid's thumbnail.
 */
export function PageLightbox({
  document,
  page,
  onNavigate,
  onClose,
  fileName,
}: {
  document: PDFDocumentProxy
  /** null = closed. */
  page: number | null
  onNavigate: (page: number) => void
  onClose: () => void
  fileName?: string
}) {
  const pageCount = document.numPages
  const aspect = usePageAspect(document, page)

  useEffect(() => {
    if (page === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' && page < pageCount) onNavigate(page + 1)
      if (event.key === 'ArrowLeft' && page > 1) onNavigate(page - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, pageCount, onNavigate])

  const title = page === null ? '' : `Page ${page} of ${pageCount}${fileName ? ` · ${fileName}` : ''}`

  return (
    <Dialog open={page !== null} onClose={onClose} title={title} size="full">
      {page !== null && (
        <div className={styles.lightbox}>
          <button type="button" className={styles.lightboxStep} onClick={() => onNavigate(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className={styles.lightboxStage}>
            {aspect !== null && (
              <div className={styles.lightboxPage} style={{ aspectRatio: String(aspect) }}>
                <PageThumb key={page} document={document} pageNumber={page} aspect={aspect} eager />
              </div>
            )}
          </div>
          <button type="button" className={styles.lightboxStep} onClick={() => onNavigate(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </Dialog>
  )
}

function usePageAspect(document: PDFDocumentProxy, page: number | null): number | null {
  const [state, setState] = useState<{ page: number; aspect: number } | null>(null)
  useEffect(() => {
    if (page === null) return
    let cancelled = false
    void document.getPage(page).then((proxy) => {
      const viewport = proxy.getViewport({ scale: 1 })
      if (!cancelled) setState({ page, aspect: viewport.width / viewport.height })
    }).catch(() => {
      if (!cancelled) setState({ page, aspect: 595.28 / 841.89 })
    })
    return () => { cancelled = true }
  }, [document, page])
  return state && state.page === page ? state.aspect : null
}
