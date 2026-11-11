/* ═════════════════════════════════════════════════════════════════════════
   Mr. Markdown — extracted figures
   ──────────────────────────────────────────────────────────────────────────
   The converter writes a PDF's figures as `![Figure 1 on page 2](assets/
   asset-<hash>.png)`: portable Markdown that matches the ZIP layout. Those
   paths exist nowhere in the browser, so every figure used to render as the
   "image unavailable" card and fall out of every export. The preview response
   now carries the bytes (`asset_data`); this module is the one place that
   turns them into something the workspace can show and ship.

   The Markdown keeps its `assets/…` paths at all times. Data URLs only ever
   appear in rendered HTML, marked with `data-mr-figure` so the rich editor's
   HTML → Markdown pass writes the path back instead of a megabyte of base64.
   ═════════════════════════════════════════════════════════════════════════ */

/** `assets/<name>` → `data:image/…;base64,…`. */
export type FigureMap = Readonly<Record<string, string>>

export type FigureExportAsset = {
  filename: string
  dataUrl: string
  mimeType: string
  alt: string
}

export const FIGURE_ATTR = 'data-mr-figure'
/** Folder figures travel in inside exports — the same one diagram exports use,
 *  and the one `/api/export/docx` stages uploads into. */
export const EXPORT_FIGURE_DIR = 'images'

const FIGURE_PATH_RE = /^assets\/[A-Za-z0-9._-]+$/
const FIGURE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/]+=*$/
/* A Markdown image whose target is a figure path, optionally with a title. */
const MARKDOWN_FIGURE_RE = /(!\[[^\]\n]*\]\()(assets\/[A-Za-z0-9._-]+)((?:\s+"[^"\n]*")?\))/g

/** Accept only well-formed figure entries from an untrusted response. */
export function figuresFromResponse(data: unknown): { figures: FigureMap; omitted: string[] } {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const raw = record.asset_data && typeof record.asset_data === 'object' ? record.asset_data as Record<string, unknown> : {}
  const figures: Record<string, string> = {}
  for (const [path, value] of Object.entries(raw)) {
    if (FIGURE_PATH_RE.test(path) && typeof value === 'string' && FIGURE_DATA_URL_RE.test(value)) figures[path] = value
  }
  const omitted = Array.isArray(record.assets_omitted)
    ? record.assets_omitted.filter((path): path is string => typeof path === 'string' && FIGURE_PATH_RE.test(path))
    : []
  return { figures, omitted }
}

/** Figure paths the Markdown references, in document order, de-duplicated. */
export function referencedFigurePaths(markdown: string): string[] {
  const seen = new Set<string>()
  for (const match of markdown.matchAll(MARKDOWN_FIGURE_RE)) seen.add(match[2])
  return [...seen]
}

/** Referenced figures the map cannot supply — what an export would lose. */
export function missingFigurePaths(markdown: string, figures: FigureMap | undefined): string[] {
  return referencedFigurePaths(markdown).filter((path) => !figures?.[path])
}

/** Keep only the figures a Markdown document still references. */
export function pickFigures(markdown: string, ...sources: Array<FigureMap | undefined>): FigureMap {
  const picked: Record<string, string> = {}
  for (const path of referencedFigurePaths(markdown)) {
    const found = sources.find((source) => source?.[path])?.[path]
    if (found) picked[path] = found
  }
  return picked
}

/**
 * Point rendered `<img>`s at their figure bytes. Matches `assets/<name>` and,
 * for export HTML built from rewritten Markdown, `images/<name>`, both looked
 * up by name; anything else (remote images, diagrams) is left untouched.
 */
export function resolveFigureSources(html: string, figures: FigureMap | undefined): string {
  if (!figures || !Object.keys(figures).length || !html.includes('<img')) return html
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const source = /\ssrc="((?:assets|images)\/([A-Za-z0-9._-]+))"/.exec(tag)
    if (!source) return tag
    const path = `assets/${source[2]}`
    const dataUrl = figures[path]
    if (!dataUrl) return tag
    return tag.replace(source[0], ` src="${dataUrl}" ${FIGURE_ATTR}="${path}"`)
  })
}

const mimeOf = (dataUrl: string): string => /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png'

/** Decoded size of a base64 data URL, without decoding it. */
const dataUrlBytes = (dataUrl: string): number => {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor((payload.length * 3) / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
}

/**
 * The referenced figures an export endpoint will accept, in document order:
 * at most `maxCount` files, none over `maxBytes`. Everything else is named in
 * `excluded` so the caller can ship what fits and say what stayed a link,
 * instead of the whole export being refused.
 */
export function selectFiguresWithin(
  markdown: string,
  figures: FigureMap | undefined,
  limits: { maxCount: number; maxBytes: number },
): { figures: FigureMap; excluded: string[] } {
  const kept: Record<string, string> = {}
  const excluded: string[] = []
  for (const path of referencedFigurePaths(markdown)) {
    const dataUrl = figures?.[path]
    if (!dataUrl) continue
    if (Object.keys(kept).length >= limits.maxCount || dataUrlBytes(dataUrl) > limits.maxBytes) excluded.push(path)
    else kept[path] = dataUrl
  }
  return { figures: kept, excluded }
}

/**
 * Rewrite figure references to the export folder and list the files to ship
 * beside the Markdown. References with no bytes are left as they are and
 * reported, so the caller can say what the export will not contain.
 */
export function prepareFiguresForExport(markdown: string, figures: FigureMap | undefined): {
  markdown: string
  assets: FigureExportAsset[]
  missing: string[]
} {
  const assets: FigureExportAsset[] = []
  const shipped = new Set<string>()
  const missing = missingFigurePaths(markdown, figures)
  const rewritten = markdown.replace(MARKDOWN_FIGURE_RE, (whole, open: string, path: string, close: string) => {
    const dataUrl = figures?.[path]
    if (!dataUrl) return whole
    const filename = path.slice('assets/'.length)
    if (!shipped.has(path)) {
      shipped.add(path)
      const alt = /^!\[([^\]\n]*)\]/.exec(open)?.[1] ?? ''
      assets.push({ filename, dataUrl, mimeType: mimeOf(dataUrl), alt })
    }
    return `${open}${EXPORT_FIGURE_DIR}/${filename}${close}`
  })
  return { markdown: rewritten, assets, missing }
}
