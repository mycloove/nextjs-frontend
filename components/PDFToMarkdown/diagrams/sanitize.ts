import DOMPurify from 'dompurify'

export function sanitizeDiagramMarkup(markup: string): string {
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'style'],
    ADD_ATTR: [
      'class', 'style', 'target', 'xmlns', 'xmlns:xlink', 'viewBox', 'preserveAspectRatio',
      'dominant-baseline', 'text-anchor', 'vector-effect',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'audio', 'video'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
  })
}