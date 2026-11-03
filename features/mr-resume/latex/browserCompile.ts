/** Local XeTeX compilation. No source, image or PDF bytes are sent to a compiler service. */
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { BROWSER_ENGINE_VERSION, checkBrowserEngineAvailability, compileBrowserXeTeX, type BrowserEngineProgress } from './browserEngine.ts'
import { LatexTransportError } from './compileTransport.ts'
import { isLatexTextPath, projectSnapshotHash, sha256, validateLatexProject, withoutComments } from './project.ts'
import { imageDimensions } from './projectArchive.ts'
import { readLatexCompileResult, readLatexId, readBoundedLatexBytes } from './server/contract.ts'
import { LATEX_LIMITS, LATEX_MAIN_FILE_NOTICE, type LatexCapabilities, type LatexDiagnostic, type LatexProject, type LatexProof } from './types.ts'

const font = {
  path: 'NotoSerifBengali-Regular.ttf',
  url: 'https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSerifBengali/NotoSerifBengali-Regular.ttf',
  sha256: '04935aea18655c451d05b1d4bb5bdc835226a221663f89a2ecfbcfdc4483e399',
}
let fontBytes: Uint8Array<ArrayBuffer> | undefined
export const BROWSER_FONTS = ['lmroman10-regular.otf', font.path] as const
export const isBrowserProof = (proof: LatexProof | null | undefined) => Boolean(proof?.profileVersion.startsWith('browser-xetex/'))

function refused(operationKey: string, message: string, code = 'browser_compile_failed', log = '', diagnostics: LatexDiagnostic[] = []): LatexTransportError {
  return new LatexTransportError({ error: message, code, request_id: `local-${operationKey}`, operationKey, log: boundedLog(log), diagnostics, status: 422 })
}

function boundedLog(value: string) {
  const bytes = new TextEncoder().encode(value)
  return new TextDecoder().decode(bytes.subarray(0, LATEX_LIMITS.logBytes))
}

export function browserSourceRefusal(project: LatexProject): string | null {
  if (project.engine !== 'xelatex') return 'The free local compiler is XeLaTeX. Switch the engine explicitly; LuaLaTeX and pdfLaTeX are not run or substituted silently.'
  const source = project.files.filter((file) => /\.(?:tex|sty|cls)$/iu.test(file.path)).map((file) => file.content.split(/\r\n|\n|\r/u).map(withoutComments).join('\n')).join('\n')
  if (/\\(?:directlua|latelua|luafunction|luaexec)\b/u.test(source)) return 'Lua-specific commands require LuaLaTeX and are not supported by this browser XeLaTeX engine. Your original source has not been changed.'
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^{}]*\bbiblatex\b/u.test(source) && !/backend\s*=\s*bibtex/u.test(source)) return 'This local engine supports classic BibTeX, not Biber. Use the browser Academic CV template or explicitly update your bibliography source.'
  if (/Renderer\s*=\s*HarfBuzz/iu.test(source)) return 'Renderer=HarfBuzz is LuaLaTeX-specific in this package set. Use the browser Bangla template or explicitly remove that option for XeLaTeX.'
  return null
}

export function browserDiagnostics(log: string, project: LatexProject): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [], paths = new Set(project.files.map((file) => file.path))
  for (const line of log.split(/\r?\n/u)) {
    const match = line.match(/^(?:\.\/)?([^:\s]+\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/u)
    if (match && paths.has(match[1])) diagnostics.push({ severity: 'error', file: match[1], line: Math.max(1, Math.min(Number(match[2]), LATEX_LIMITS.sourceBytes)), message: match[3].slice(0, 4000), code: 'tex_error' })
    else if (/^Missing character:/u.test(line)) diagnostics.push({ severity: 'error', message: line.slice(0, 4000), code: 'missing_glyph', help: 'Select an explicit font file that includes this character. Missing glyphs are not accepted as a successful proof.' })
    else if (/^!\s/u.test(line)) diagnostics.push({ severity: 'error', message: line.slice(2, 4000), code: 'tex_error' })
    if (diagnostics.length >= 128) break
  }
  return diagnostics
}

export async function getBrowserLatexCapabilities(signal?: AbortSignal): Promise<LatexCapabilities> {
  await checkBrowserEngineAvailability(signal)
  return {
    enabled: true, ready: true,
    reason: 'Free browser XeLaTeX is available. First compilation downloads public TeX packages; source stays on this device. LuaLaTeX, Biber and SyncTeX are not available locally.',
    profiles: [{ id: 'xelatex', name: 'Browser XeLaTeX (free)', version: BROWSER_ENGINE_VERSION, fonts: [...BROWSER_FONTS], packages: ['XeTeX / TeX Live 2020', 'fontspec', 'PNG / JPEG', 'classic BibTeX', 'public package downloads (availability varies)'] }],
    limits: { ...LATEX_LIMITS },
  }
}

async function localFont(signal?: AbortSignal) {
  if (fontBytes) return fontBytes.slice()
  const response = await fetch(font.url, { signal, credentials: 'omit', redirect: 'error', cache: 'force-cache' })
  if (!response.ok) throw new Error('The public Bengali font download is unavailable. No source was uploaded.')
  const bytes = new Uint8Array(await readBoundedLatexBytes(response, 4 * 1024 * 1024, signal))
  if (await sha256(bytes) !== font.sha256) throw new Error('The Bengali font download does not match its pinned checksum.')
  fontBytes = bytes
  return bytes.slice()
}

export async function verifyBrowserPdf(bytes: Uint8Array): Promise<number> {
  if (bytes.byteLength < 5 || bytes.byteLength > LATEX_LIMITS.pdfBytes || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The local compiler did not return a bounded PDF file.')
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true })
  if (document.getPageCount() < 1 || document.getPageCount() > LATEX_LIMITS.pages) throw new Error('The local PDF exceeds the supported page limit.')
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue
    if (['JS', 'JavaScript', 'EmbeddedFiles', 'EF', 'RichMediaContent', 'XFA', 'AA', 'OpenAction'].some((key) => object.has(PDFName.of(key)))) throw new Error('Active scripts, embedded files and automatic actions are not accepted in a local proof.')
    const action = object.get(PDFName.of('S'))
    if (action instanceof PDFName && ['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToE', 'GoToR', 'Rendition'].includes(action.decodeText())) throw new Error('Unsafe PDF actions are not accepted in a local proof.')
    const uri = object.get(PDFName.of('URI'))
    if (uri && 'decodeText' in uri && typeof uri.decodeText === 'function' && !/^(?:https?:|mailto:)/iu.test(uri.decodeText())) throw new Error('The compiled PDF contains an unsafe link URI.')
    const descendants = object.get(PDFName.of('DescendantFonts'))
    if (descendants && !(descendants instanceof PDFArray)) throw new Error('A compiled PDF font resource is malformed.')
  }
  return document.getPageCount()
}

export async function compileBrowserLatexProject(project: LatexProject, operationKey: string, signal?: AbortSignal, onProgress?: (progress: BrowserEngineProgress) => void,
  engine: typeof compileBrowserXeTeX = compileBrowserXeTeX): Promise<LatexProof> {
  readLatexId(operationKey, 8)
  const value = validateLatexProject(project)
  const snapshot: LatexProject = { ...value, files: value.files.map((file) => ({ ...file })), assets: value.assets.map((asset) => ({ ...asset })) }
  const unsupported = browserSourceRefusal(snapshot)
  if (unsupported) throw refused(operationKey, unsupported, 'browser_engine_unsupported')
  if (snapshot.files.some((file) => file.path === font.path) || snapshot.assets.some((asset) => asset.path === font.path)) throw refused(operationKey, 'A project file conflicts with the bundled Bengali font filename.', 'browser_reserved_file')
  onProgress?.({ stage: 'loading', message: 'Preparing the real local XeLaTeX compiler and public font packages. Source is not uploaded.' })
  const snapshotHash = await projectSnapshotHash(snapshot)
  const files: { path: string; data: string | Uint8Array }[] = snapshot.files.filter((file) => isLatexTextPath(file.path) && /\.(?:tex|sty|cls|bib|bst)$/iu.test(file.path)).map((file) => ({ path: file.path, data: file.content }))
  for (const asset of snapshot.assets) {
    const data = new Uint8Array(await asset.blob.arrayBuffer())
    imageDimensions(data, asset.mediaType)
    files.push({ path: asset.path, data })
  }
  if (snapshot.files.some((file) => file.content.includes(font.path))) files.push({ path: font.path, data: await localFont(signal) })
  try {
    if (snapshot.mainFile === null) throw refused(operationKey, LATEX_MAIN_FILE_NOTICE, 'missing_main')
    const output = await engine({ mainFile: snapshot.mainFile, files, signal, onProgress })
    const diagnostics = browserDiagnostics(output.log, snapshot)
    if (diagnostics.some((item) => item.severity === 'error')) throw refused(operationKey, 'TeX reported an error or missing glyph. The previous PDF and original source were retained.', 'browser_tex_error', output.log, diagnostics)
    onProgress?.({ stage: 'converting', message: 'Checking the actual local PDF pages, safe actions and original bytes.' })
    const pages = await verifyBrowserPdf(output.pdf), pdfHash = await sha256(output.pdf)
    if (signal?.aborted) throw new DOMException('Local compilation stopped.', 'AbortError')
    const result = readLatexCompileResult({ status: 'ready', operationKey, projectId: snapshot.id, revision: snapshot.revision, snapshotHash, engine: snapshot.engine,
      profileVersion: `browser-xetex/${BROWSER_ENGINE_VERSION}`, pdf: { id: operationKey, sha256: pdfHash, bytes: output.pdf.byteLength, pages }, diagnostics,
      log: boundedLog(output.log), syncAvailable: false, createdAt: new Date().toISOString() })
    return { ...result, data: new Uint8Array(output.pdf).buffer }
  } catch (error) {
    if (error instanceof LatexTransportError || signal?.aborted) throw error
    const record = error as { log?: unknown }
    const log = typeof record?.log === 'string' ? record.log : ''
    throw refused(operationKey, error instanceof Error ? error.message : 'Local compilation failed. No source was uploaded.', 'browser_compile_failed', log, browserDiagnostics(log, snapshot))
  }
}
