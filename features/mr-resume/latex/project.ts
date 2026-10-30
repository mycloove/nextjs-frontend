import { LATEX_LIMITS, LATEX_PROJECT_VERSION, type LatexAsset, type LatexCheckpoint, type LatexEngine, type LatexProject, type LatexProof, type LatexTextFile } from './types.ts'

export class LatexProjectError extends Error {
  code: string
  constructor(message: string, code = 'invalid_project') { super(message); this.name = 'LatexProjectError'; this.code = code }
}

export const textExtensions = ['tex', 'sty', 'cls', 'bib', 'bst'] as const
const engines: LatexEngine[] = ['lualatex', 'xelatex', 'pdflatex']
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const reservedIds = new Set(Object.getOwnPropertyNames(Object.prototype))
const encoder = new TextEncoder()
export const utf8Bytes = (text: string) => encoder.encode(text).byteLength
export const newLatexId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // getRandomValues also works outside secure contexts; compile/hash integrity still requires HTTPS.
  if (typeof globalThis.crypto?.getRandomValues === 'function') return `p-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  throw new LatexProjectError('Secure project identity is unavailable in this browser. No stored project was changed.')
}
export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function isWellFormedText(text: string) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

/** Only paths are constrained. Source text, including joiners and raw macros, is not rewritten. */
export function assertLatexPath(path: string, kind: 'text' | 'asset' | 'either' = 'either') {
  if (path.length > 240 || path !== path.normalize('NFC') || !/^[\p{L}\p{M}\p{N}_.\/-]+$/u.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || part.endsWith('.') || part.startsWith('.'))
    || path.split('/').some((part) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new LatexProjectError('Use a relative NFC filename with letters, numbers, hyphens or underscores. Empty, hidden and traversal segments are not supported.', 'unsafe_path')
  }
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const text = textExtensions.some((item) => item === extension)
  const asset = ['png', 'jpg', 'jpeg'].includes(extension)
  if ((kind === 'text' && !text) || (kind === 'asset' && !asset) || (kind === 'either' && !text && !asset)) {
    throw new LatexProjectError(`Unsupported file: ${path}. Use .tex, .sty, .cls, .bib, .bst, PNG or JPEG.`, 'unsupported_file')
  }
  return path
}

export function projectSize(project: LatexProject) {
  const source = project.files.reduce((sum, file) => sum + utf8Bytes(file.content), 0)
  const assets = project.assets.reduce((sum, asset) => sum + asset.blob.size, 0)
  const manifest = JSON.stringify({ version: project.version, operationKey: 'x'.repeat(36), projectId: project.id, title: project.title,
    revision: project.revision, mainFile: project.mainFile, engine: project.engine, files: project.files,
    assets: project.assets.map((asset) => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.blob.size })) })
  // Reserve multipart headers and boundaries rather than presenting text bytes as the upload size.
  return { source, assets, upload: utf8Bytes(manifest) + assets + 16 * 1024 + project.assets.length * 512 }
}

export function validateLatexProject(value: unknown): LatexProject {
  if (!isRecord(value)) throw new LatexProjectError('The saved project is not a project record.')
  if (value.version !== LATEX_PROJECT_VERSION) throw new LatexProjectError('This project format is not supported. Its original stored record has been preserved.', 'unsupported_version')
  const fields = ['version', 'id', 'title', 'revision', 'mainFile', 'engine', 'files', 'assets', 'templateId', 'templateVersion', 'createdAt', 'updatedAt']
  if (Object.keys(value).some((field) => !fields.includes(field))) throw new LatexProjectError('The project has unsupported metadata. Its original was preserved.', 'unsupported_version')
  if (typeof value.id !== 'string' || !idPattern.test(value.id) || reservedIds.has(value.id) || typeof value.title !== 'string' || utf8Bytes(value.title) > 512 || !isWellFormedText(value.title)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !engines.includes(value.engine as LatexEngine)
    || typeof value.mainFile !== 'string' || !Array.isArray(value.files) || !Array.isArray(value.assets)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !(value.templateId === null || (typeof value.templateId === 'string' && idPattern.test(value.templateId)))
    || !(value.templateVersion === null || (Number.isSafeInteger(value.templateVersion) && (value.templateVersion as number) > 0))
    || (value.templateId === null) !== (value.templateVersion === null)) throw new LatexProjectError('The project contains invalid identity or build settings.')
  if (value.files.length < 1 || value.files.length + value.assets.length > LATEX_LIMITS.files) throw new LatexProjectError(`A project needs 1-${LATEX_LIMITS.files} supported files and assets.`, 'file_limit')
  const paths = new Set<string>(), ids = new Set<string>()
  for (const item of [...value.files, ...value.assets]) {
    if (!isRecord(item) || typeof item.id !== 'string' || !idPattern.test(item.id) || typeof item.path !== 'string') throw new LatexProjectError('A project file has an invalid identity.')
    assertLatexPath(item.path, value.files.includes(item) ? 'text' : 'asset')
    const alias = item.path.toLowerCase()
    if (paths.has(alias) || ids.has(item.id)) throw new LatexProjectError(`Duplicate file identity or case alias: ${item.path}`, 'duplicate_path')
    paths.add(alias); ids.add(item.id)
  }
  for (const file of value.files) {
    if (Object.keys(file).some((field) => !['id', 'path', 'content'].includes(field))) throw new LatexProjectError('A source file has unsupported metadata. Its original was preserved.', 'unsupported_version')
    if (typeof file.content !== 'string' || !isWellFormedText(file.content)) throw new LatexProjectError('Source must be valid Unicode text. Unpaired UTF-16 surrogates are not supported.', 'invalid_unicode')
  }
  for (const asset of value.assets) {
    if (Object.keys(asset).some((field) => !['id', 'path', 'mediaType', 'blob'].includes(field))) throw new LatexProjectError('An image has unsupported metadata. Its original was preserved.', 'unsupported_version')
    if (!(asset.blob instanceof Blob) || !['image/png', 'image/jpeg'].includes(asset.mediaType)
      || (asset.mediaType === 'image/png') !== /\.png$/iu.test(asset.path) || (asset.blob.type && asset.blob.type !== asset.mediaType) || asset.blob.size === 0) throw new LatexProjectError(`Invalid image asset: ${asset.path}`, 'invalid_asset')
  }
  if (!value.files.some((file) => file.path === value.mainFile && /\.tex$/iu.test(file.path))) throw new LatexProjectError('Select an existing .tex file as the main file.', 'missing_main')
  const project = value as LatexProject
  const size = projectSize(project)
  if (size.source > LATEX_LIMITS.sourceBytes || size.upload > LATEX_LIMITS.uploadBytes) throw new LatexProjectError('This project exceeds the 1 MiB source or 3 MiB upload limit. No file was discarded.', 'project_too_large')
  return project
}

export function reviseProject(project: LatexProject, changes: Partial<Omit<LatexProject, 'version' | 'id' | 'revision' | 'createdAt'>>, now = new Date().toISOString()) {
  if (project.revision >= Number.MAX_SAFE_INTEGER) throw new LatexProjectError('Revision limit reached. Make an independent project copy.')
  return validateLatexProject({ ...project, ...changes, revision: project.revision + 1, updatedAt: now })
}

export function cloneAsNewProject(project: LatexProject, title = `${project.title || 'Untitled project'} copy`, now = new Date().toISOString()): LatexProject {
  return validateLatexProject({ ...project, id: newLatexId(), title, revision: 1, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })), createdAt: now, updatedAt: now })
}

export function makeCheckpoint(project: LatexProject, label: string, now = new Date().toISOString()): LatexCheckpoint {
  return { id: newLatexId(), label: label.slice(0, 120), project: { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }, createdAt: now }
}

export function restoreCheckpointProject(current: LatexProject, checkpoint: LatexCheckpoint) {
  if (checkpoint.project.id !== current.id) throw new LatexProjectError('This checkpoint belongs to a different project.')
  const { files, assets, title, mainFile, engine, templateId, templateVersion } = validateLatexProject(checkpoint.project)
  return reviseProject(current, { files: files.map((file) => ({ ...file })), assets: assets.map((asset) => ({ ...asset })), title, mainFile, engine, templateId, templateVersion })
}

export function addTextFile(project: LatexProject, path: string, content = '') {
  assertLatexPath(path, 'text')
  return reviseProject(project, { files: [...project.files, { id: newLatexId(), path, content }] })
}

export function addProjectAsset(project: LatexProject, asset: LatexAsset) {
  return reviseProject(project, { assets: [...project.assets, asset] })
}

export function renameProjectFile(project: LatexProject, id: string, path: string) {
  const file = project.files.find((item) => item.id === id), asset = project.assets.find((item) => item.id === id)
  if (!file && !asset) throw new LatexProjectError('The file no longer exists.')
  assertLatexPath(path, file ? 'text' : 'asset')
  if (file?.path === project.mainFile && !/\.tex$/iu.test(path)) throw new LatexProjectError('The main file must keep its .tex extension.')
  if (asset && (asset.mediaType === 'image/png') !== /\.png$/iu.test(path)) throw new LatexProjectError('Renaming an image does not convert its format. Keep its existing image extension.')
  return reviseProject(project, { files: project.files.map((item) => item.id === id ? { ...item, path } : item),
    assets: project.assets.map((item) => item.id === id ? { ...item, path } : item), mainFile: file?.path === project.mainFile ? path : project.mainFile })
}

export function deleteProjectFile(project: LatexProject, id: string) {
  if (project.files.find((file) => file.id === id)?.path === project.mainFile) throw new LatexProjectError('Choose another main .tex file before deleting this one.')
  return reviseProject(project, { files: project.files.filter((file) => file.id !== id), assets: project.assets.filter((asset) => asset.id !== id) })
}

function withoutComments(line: string) {
  for (let i = 0; i < line.length; i++) if (line[i] === '%') {
    let slashes = 0
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++
    if (slashes % 2 === 0) return line.slice(0, i)
  }
  return line
}

export type SourceOutlineItem = { fileId: string; file: string; line: number; level: number; title: string }
export function sourceOutline(files: readonly LatexTextFile[]): SourceOutlineItem[] {
  const entries: SourceOutlineItem[] = []
  for (const file of files.filter((item) => /\.tex$/iu.test(item.path))) file.content.split(/\r\n|\n|\r/u).forEach((line, index) => {
    const match = withoutComments(line).match(/\\(chapter|section|subsection|subsubsection|cvsection)\*?(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/u)
    if (match && entries.length < 256) entries.push({ fileId: file.id, file: file.path, line: index + 1,
      level: match[1] === 'subsection' ? 1 : match[1] === 'subsubsection' ? 2 : 0, title: match[2] })
  })
  return entries
}

/** Best-effort references warn before destructive edits; macros are deliberately not auto-rewritten. */
export function referencesToFile(project: LatexProject, path: string) {
  const references: { file: string; line: number }[] = []
  const target = path.replace(/\.(?:tex|sty|cls|bib|bst|png|jpe?g)$/iu, '')
  for (const file of project.files) file.content.split(/\r\n|\n|\r/u).forEach((line, index) => {
    const text = withoutComments(line)
    for (const match of text.matchAll(/\\(?:input|include|includegraphics|addbibresource|bibliography|documentclass|usepackage)(?:\[[^\]]*\])?\s*\{([^{}]*)\}/gu)) {
      if (match[1].split(',').some((value) => {
        const ref = value.trim().replace(/\.(?:tex|sty|cls|bib|bst|png|jpe?g)$/iu, '')
        const relative = `${file.path.slice(0, Math.max(0, file.path.lastIndexOf('/') + 1))}${ref}`
        return ref === target || relative === target
      })) { references.push({ file: file.path, line: index + 1 }); break }
    }
  })
  return references
}

export function requiredNativeFonts(source: string) {
  const fonts = new Set<string>()
  for (const match of source.matchAll(/\\(?:set(?:main|sans|mono)font|newfontfamily\s*\\[A-Za-z]+)(?:\s*\[[^\]]*\])?\s*\{([^{}\\]+)\}/gu)) fonts.add(match[1])
  return [...fonts]
}

export function applyNativeFontChoices(source: string, choices: Readonly<Record<string, string>>) {
  for (const font of Object.values(choices)) if (!font || /[{}\\%\r\n]/u.test(font) || utf8Bytes(font) > 120) throw new LatexProjectError('Choose a literal native font name from the compatibility options.')
  return source.replace(/(\\(?:set(?:main|sans|mono)font|newfontfamily\s*\\[A-Za-z]+)(?:\s*\[[^\]]*\])?\s*\{)([^{}\\]+)(\})/gu,
    (match, before: string, font: string, after: string) => Object.prototype.hasOwnProperty.call(choices, font) && choices[font] ? `${before}${choices[font]}${after}` : match)
}

export function isCurrentProof(project: LatexProject | null, proof: LatexProof | null | undefined) {
  return Boolean(project && proof && proof.projectId === project.id && proof.revision === project.revision && proof.engine === project.engine)
}

/** Local revisions can fork between tabs before CAS rejects a write. A revision number alone is not source identity. */
export function sameProjectSource(left: LatexProject | null | undefined, right: LatexProject | null | undefined) {
  if (!left || !right) return false
  if (left === right) return true
  if (left.mainFile !== right.mainFile || left.engine !== right.engine || left.files.length !== right.files.length || left.assets.length !== right.assets.length) return false
  for (const file of left.files) if (!right.files.some((item) => item.id === file.id && item.path === file.path && item.content === file.content)) return false
  for (const asset of left.assets) if (!right.assets.some((item) => item.id === asset.id && item.path === asset.path && item.mediaType === asset.mediaType && item.blob === asset.blob)) return false
  return true
}

export async function sha256(bytes: ArrayBuffer | Uint8Array) {
  const copy = bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes.slice(0)
  const hash = await crypto.subtle.digest('SHA-256', copy)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function projectSnapshotHash(project: LatexProject) {
  validateLatexProject(project)
  const compare = (a: { path: string }, b: { path: string }) => {
    const left = Array.from(a.path, (letter) => letter.codePointAt(0)!), right = Array.from(b.path, (letter) => letter.codePointAt(0)!)
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i]
    return left.length - right.length
  }
  const assets = []
  for (const asset of project.assets) assets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.blob.size, sha256: await sha256(await asset.blob.arrayBuffer()) })
  const canonical = JSON.stringify({ version: project.version, projectId: project.id, revision: project.revision, mainFile: project.mainFile, engine: project.engine,
    files: project.files.map(({ id, path, content }) => ({ id, path, content })).sort(compare), assets: assets.sort(compare) })
  return sha256(new TextEncoder().encode(canonical))
}

export function downloadName(title: string) {
  return title.trim().replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100) || 'resume-project'
}
