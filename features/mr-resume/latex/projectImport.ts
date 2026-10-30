import { LATEX_LIMITS, LATEX_PROJECT_VERSION, type LatexAsset, type LatexProject, type RegularLatexSnapshot } from './types.ts'
import { applyNativeFontChoices, assertLatexPath, LatexProjectError, newLatexId, validateLatexProject } from './project.ts'
import { decodeSourceBytes, imageDimensions } from './projectArchive.ts'

function runArchiveWorker<T>(request: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./projectImport.worker.ts', import.meta.url), { type: 'module' })
    const id = newLatexId()
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Archive processing timed out. Nothing was imported.')) }, 30_000)
    const finish = () => { window.clearTimeout(timeout); worker.terminate() }
    worker.onmessage = (event: MessageEvent<{ id: string; error?: string; project?: LatexProject; buffer?: ArrayBuffer }>) => {
      if (event.data.id !== id) return
      finish()
      if (event.data.error) reject(new LatexProjectError(event.data.error))
      else resolve((event.data.project ?? event.data.buffer) as T)
    }
    worker.onerror = () => { finish(); reject(new Error('The local archive worker could not run. Your current project is unchanged.')) }
    worker.postMessage({ ...request, id }, transfer)
  })
}

export async function importProjectFile(file: File) {
  if (!/\.(?:tex|zip)$/iu.test(file.name) || file.size > LATEX_LIMITS.uploadBytes) throw new LatexProjectError('Choose a .tex or source ZIP file no larger than 3 MiB.')
  const buffer = await file.arrayBuffer()
  return validateLatexProject(await runArchiveWorker<LatexProject>({ action: 'import', buffer, filename: file.name }, [buffer]))
}

export async function exportProjectFile(project: LatexProject) {
  return new Blob([await runArchiveWorker<ArrayBuffer>({ action: 'export', project: validateLatexProject(project) })], { type: 'application/zip' })
}

export async function importSupportedFile(file: File): Promise<{ path: string; content: string } | LatexAsset> {
  assertLatexPath(file.name)
  if (file.size > LATEX_LIMITS.uploadBytes) throw new LatexProjectError('This file exceeds the 3 MiB project limit.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (/\.(?:tex|sty|cls|bib|bst)$/iu.test(file.name)) return { path: file.name, content: decodeSourceBytes(bytes) }
  const mediaType = /\.png$/iu.test(file.name) ? 'image/png' : 'image/jpeg'
  imageDimensions(bytes, mediaType)
  const blob = new Blob([new Uint8Array(bytes)], { type: mediaType })
  if (typeof createImageBitmap !== 'function') throw new Error('Local image validation is unavailable in this browser. The image was not added; existing source is unchanged.')
  const bitmap = await createImageBitmap(blob)
  try { if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 12_000_000) throw new Error('The decoded image exceeds supported dimensions. Nothing was added.') }
  finally { bitmap.close() }
  return { id: newLatexId(), path: file.name, mediaType, blob }
}

export function photoDataUriBlob(uri: string) {
  const match = uri.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/u)
  if (!match || match[2].length > Math.ceil(LATEX_LIMITS.uploadBytes / 3) * 4 || match[2].length % 4) throw new LatexProjectError('The displayed Regular photo is not a bounded PNG/JPEG data image. No project was created.')
  let decoded: string
  try { decoded = atob(match[2]) } catch { throw new LatexProjectError('The displayed photo is not valid base64.') }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  imageDimensions(bytes, match[1] as LatexAsset['mediaType'])
  return new Blob([bytes], { type: match[1] })
}

async function displayedPhotoJpeg(uri: string) {
  const blob = photoDataUriBlob(uri)
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element); element.onerror = () => reject(new Error('The displayed Regular photo could not be decoded. Nothing was imported.')); element.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096 || image.naturalWidth * image.naturalHeight > 12_000_000) throw new Error('The displayed photo exceeds supported dimensions. The Regular draft is unchanged.')
    if (blob.type === 'image/jpeg') return blob
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('JPEG photo conversion is unavailable. Your Regular draft is unchanged.')
    // JPEG has no alpha. The displayed treated pixels are copied onto a white photo sidecar.
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0)
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The displayed photo could not be saved as JPEG.')), 'image/jpeg', 0.95))
    return jpeg
  } finally { URL.revokeObjectURL(url) }
}

export async function createRegularLatexProject(snapshot: RegularLatexSnapshot, fonts: Readonly<Record<string, string>> = {}): Promise<LatexProject> {
  const now = new Date().toISOString()
  const source = applyNativeFontChoices(snapshot.source, fonts)
  const assets: LatexAsset[] = snapshot.photo ? [{ id: newLatexId(), path: 'profile-photo.jpg', mediaType: 'image/jpeg', blob: await displayedPhotoJpeg(snapshot.photo) }] : []
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: newLatexId(), title: snapshot.title || 'Regular source copy', revision: 1, mainFile: 'main.tex', engine: 'lualatex',
    files: [{ id: newLatexId(), path: 'main.tex', content: source }], assets, templateId: null, templateVersion: null, createdAt: now, updatedAt: now })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
