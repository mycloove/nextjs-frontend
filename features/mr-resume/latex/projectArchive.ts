import JSZip from 'jszip'
import { LATEX_LIMITS, LATEX_PROJECT_VERSION, type LatexAsset, type LatexProject } from './types.ts'
import { assertLatexPath, isRecord, LatexProjectError, newLatexId, requiredNativeFonts, sha256, utf8Bytes, validateLatexProject } from './project.ts'
import { latexSourceTemplates, templateNotice } from './templates.ts'

const manifestName = 'smilepdf-project.json'
const requirementsNotice = 'Native fonts and TeX packages are not bundled. Build in a compatible offline TeX environment. Raw TeX must run in an isolated sandbox.'
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export type ZipEntryPolicy = { path: string; directory: boolean; expandedBytes: number; crc32: number }

function fail(message: string, code = 'invalid_archive'): never { throw new LatexProjectError(message, code) }
function archivePath(path: string, directory: boolean) {
  const name = directory ? path.slice(0, -1) : path
  if (name === manifestName && !directory) return
  if (directory) {
    // Folder metadata is supported, but is never allowed to smuggle a traversal path.
    assertLatexPath(`${name}/folder.tex`, 'text')
  } else assertLatexPath(name)
}
function readName(bytes: Uint8Array, flags: number) {
  if (!(flags & 0x800) && bytes.some((byte) => byte > 127)) fail('Non-UTF-8 ZIP filenames are unsupported. Re-export with UTF-8 names.')
  try { return decoder.decode(bytes) } catch { return fail('A ZIP filename is not valid UTF-8.') }
}
function checkExtra(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail('Truncated ZIP extra field.')
    const tag = view.getUint16(offset, true), size = view.getUint16(offset + 2, true)
    if (tag === 1 || tag === 0x9901) fail('ZIP64 and encrypted ZIPs are unsupported.')
    offset += 4 + size
    if (offset > bytes.length) fail('Truncated ZIP extra field.')
  }
}

/** Inspect central AND local headers before JSZip can sanitize names or collapse duplicates. */
export function inspectProjectZip(bytes: Uint8Array): ZipEntryPolicy[] {
  if (bytes.length < 22 || bytes.length > LATEX_LIMITS.uploadBytes) fail('ZIP input must be at most 3 MiB.', 'archive_too_large')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50
    && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  if (end < 0) fail('The ZIP directory is missing or truncated.')
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), centralStart = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count
    || count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff || count > 96 || count === 0
    || centralStart + centralSize !== end) fail('Multi-disk, ZIP64, empty or oversized ZIP directories are unsupported.')
  const entries: ZipEntryPolicy[] = [], aliases = new Set<string>(), ranges: [number, number][] = []
  const unsupported: string[] = []
  let offset = centralStart, expanded = 0, source = 0, fileCount = 0
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('Invalid ZIP directory entry.')
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true)
    const crc32 = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true), next = offset + 46 + nameLength + extraLength + commentLength
    if (next > end || !nameLength || flags & 0x2041 || ![0, 8].includes(method) || view.getUint16(offset + 34, true)
      || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail('Encrypted, unsupported or malformed ZIP entry.')
    const unixMode = view.getUint32(offset + 38, true) >>> 16, kind = unixMode & 0xf000
    if (kind && kind !== 0x8000 && kind !== 0x4000) fail('ZIP symlinks and special files are not supported.', 'unsafe_archive')
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength), path = readName(rawName, flags), directory = path.endsWith('/')
    if ((kind === 0x4000 && !directory) || (kind === 0x8000 && directory)) fail('ZIP directory metadata disagrees with its filename.')
    const alias = (directory ? path.slice(0, -1) : path).toLowerCase()
    if (aliases.has(alias)) fail(`Duplicate ZIP entry or case alias: ${path}`, 'duplicate_path')
    aliases.add(alias)
    try { archivePath(path, directory) } catch (error) {
      if (error instanceof LatexProjectError && error.code === 'unsupported_file') unsupported.push(path)
      else throw error
    }
    checkExtra(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength))
    if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags
      || view.getUint16(local + 8, true) !== method) fail('ZIP local header disagrees with the directory.')
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true)
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed
    if (dataEnd > centralStart || dataStart > centralStart || localNameLength !== nameLength
      || readName(bytes.subarray(local + 30, local + 30 + localNameLength), flags) !== path) fail('ZIP local path or byte range is invalid.')
    if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size || view.getUint32(local + 14, true) !== crc32)) fail('ZIP declared sizes or CRC disagree.')
    checkExtra(bytes.subarray(local + 30 + localNameLength, dataStart))
    if (ranges.some(([start, finish]) => local < finish && dataEnd > start)) fail('Overlapping ZIP file ranges are unsupported.')
    ranges.push([local, dataEnd])
    if (directory && (size || compressed)) fail('ZIP folders must not contain data.')
    if (!directory) {
      fileCount += path === manifestName ? 0 : 1
      expanded += size
      if (/\.(?:tex|sty|cls|bib|bst)$/iu.test(path)) source += size
      if (path === manifestName && size > 32 * 1024) fail('The project manifest exceeds 32 KiB.')
    }
    if (fileCount > LATEX_LIMITS.files || expanded > LATEX_LIMITS.uploadBytes || source > LATEX_LIMITS.sourceBytes) fail('ZIP declared expanded content exceeds project limits. Nothing was imported.', 'archive_too_large')
    entries.push({ path, directory, expandedBytes: size, crc32 }); offset = next
  }
  if (offset !== end) fail('Unexpected bytes in the ZIP directory.')
  if (Math.min(...ranges.map(([start]) => start)) !== 0) fail('Self-extracting/prefixed ZIPs are unsupported. Import a plain source ZIP.', 'unsupported_entries')
  if (unsupported.length) fail(`Unsupported ZIP entries: ${unsupported.join(', ')}. Nothing was discarded or imported. Remove them explicitly before importing.`, 'unsupported_entries')
  for (const folder of entries.filter((entry) => entry.directory)) if (!entries.some((entry) => !entry.directory && entry.path.startsWith(folder.path))) fail(`Empty directory ${folder.path} cannot be represented in a source project. Nothing was imported.`, 'unsupported_entries')
  return entries
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let i = 0; i < 8; i++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function updateCrc(previous: number, bytes: Uint8Array) {
  let crc = previous
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return crc >>> 0
}
function streamBytes(stream: JSZip.JSZipStreamHelper<Uint8Array>, limit: number, observed?: (bytes: number) => void, expectedCrc?: number) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let count = 0, crc = 0xffffffff, failed = false
    stream.on('data', (chunk) => {
      if (failed) return
      try {
        count += chunk.byteLength
        if (count > limit) fail('Observed expanded ZIP bytes exceed the project limit.', 'archive_too_large')
        observed?.(chunk.byteLength)
        crc = updateCrc(crc, chunk)
        chunks.push(new Uint8Array(chunk))
      } catch (error) { failed = true; stream.pause(); reject(error) }
    }).on('error', (error) => { failed = true; reject(error) }).on('end', () => {
      if (failed) return
      if (expectedCrc !== undefined && ((crc ^ 0xffffffff) >>> 0) !== expectedCrc) { reject(new LatexProjectError('ZIP file checksum failed. Nothing was imported.')); return }
      const output = new Uint8Array(count)
      let offset = 0
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
      resolve(output)
    }).resume()
  })
}

export function imageDimensions(bytes: Uint8Array, mediaType: LatexAsset['mediaType']) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0
  if (mediaType === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
      || view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('Invalid PNG header.', 'invalid_asset')
    width = view.getUint32(16); height = view.getUint32(20)
    if (!width || !height || width > 4096 || height > 4096 || width * height > 12_000_000) fail('Images must have valid dimensions, at most 4096px per side and 12 megapixels.', 'invalid_asset')
    let offset = 8, hasData = false, ended = false
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), finish = offset + 12 + length
      if (finish > bytes.length) fail('Truncated PNG chunk.', 'invalid_asset')
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      if (!/^[A-Za-z]{4}$/u.test(type) || ((updateCrc(0xffffffff, bytes.subarray(offset + 4, offset + 8 + length)) ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) fail('PNG chunk checksum failed.', 'invalid_asset')
      if (type === 'IDAT') hasData = true
      if (type === 'IEND') { if (length || finish !== bytes.length) fail('Invalid PNG end chunk or trailing payload.', 'invalid_asset'); ended = true; break }
      offset = finish
    }
    if (!hasData || !ended) fail('PNG image data/end chunks are missing.', 'invalid_asset')
  } else {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) fail('Invalid or truncated JPEG header/end marker.', 'invalid_asset')
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 255) fail('Invalid JPEG marker.', 'invalid_asset')
      while (offset < bytes.length && bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) fail('Truncated JPEG marker.', 'invalid_asset')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) fail('Invalid JPEG dimensions.', 'invalid_asset')
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break
      }
      offset += length
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 12_000_000) fail('Images must have valid dimensions, at most 4096px per side and 12 megapixels.', 'invalid_asset')
  return { width, height }
}

export async function readProjectZip(buffer: ArrayBuffer, title = 'Imported project'): Promise<LatexProject> {
  const entries = inspectProjectZip(new Uint8Array(buffer))
  // checkCRC32:true makes JSZip eagerly inflate everything. CRC is instead checked on each bounded stream.
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false })
  let total = 0
  const extracted = new Map<string, Uint8Array>()
  for (const entry of entries.filter((item) => !item.directory)) {
    const file = zip.file(entry.path)
    if (!file || (file.unsafeOriginalName && file.unsafeOriginalName !== entry.path)) fail('ZIP decoder changed a source path. Nothing was imported.')
    // JSZip exposes this streamed API at runtime but omits it from JSZipObject's declarations.
    const streamed = file as JSZip.JSZipObject & { internalStream: (type: 'uint8array') => JSZip.JSZipStreamHelper<Uint8Array> }
    const bytes = await streamBytes(streamed.internalStream('uint8array'), Math.min(entry.expandedBytes, LATEX_LIMITS.uploadBytes), (size) => {
      total += size
      if (total > LATEX_LIMITS.uploadBytes) fail('Observed ZIP expansion exceeds 3 MiB.', 'archive_too_large')
    }, entry.crc32)
    if (bytes.length !== entry.expandedBytes) fail('ZIP observed and declared file sizes disagree.')
    extracted.set(entry.path, bytes)
  }
  let manifest: Record<string, unknown> | null = null
  if (extracted.has(manifestName)) {
    try { const decoded: unknown = JSON.parse(decoder.decode(extracted.get(manifestName)!)); if (!isRecord(decoded)) fail('Invalid project manifest.'); manifest = decoded } catch (error) {
      if (error instanceof LatexProjectError) throw error
      fail('The project manifest is not valid UTF-8 JSON.')
    }
    const allowed = ['format', 'version', 'sourceProjectId', 'title', 'mainFile', 'engine', 'templateId', 'templateVersion', 'files', 'assets', 'nativeFonts', 'requirements', 'templateNotice']
    if (Object.keys(manifest).some((key) => !allowed.includes(key))) fail('The ZIP manifest has unsupported fields. Nothing was discarded or imported.', 'unsupported_entries')
    if (manifest.format !== 'smilepdf-latex' || manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.assets)) fail('Unsupported project manifest format or version.', 'unsupported_version')
    if ((manifest.templateNotice !== undefined && manifest.templateNotice !== templateNotice) || (manifest.requirements !== undefined && manifest.requirements !== requirementsNotice)) fail('Unsupported manifest license/requirements text. Preserve it in a supported source file or use its original archive; nothing was imported or discarded.', 'unsupported_entries')
    if (manifest.files.length + manifest.assets.length !== entries.filter((entry) => !entry.directory && entry.path !== manifestName).length) fail('The project manifest does not list every ZIP file.')
  }
  const files: LatexProject['files'] = [], assets: LatexAsset[] = []
  for (const [path, bytes] of extracted) {
    if (path === manifestName) continue
    const list = (manifest?.[/\.(?:tex|sty|cls|bib|bst)$/iu.test(path) ? 'files' : 'assets'] ?? []) as unknown[]
    const metadata = list.find((item) => isRecord(item) && item.path === path)
    if (manifest && (!isRecord(metadata) || typeof metadata.id !== 'string')) fail(`Missing ZIP manifest identity for ${path}.`)
    const id = isRecord(metadata) ? String(metadata.id) : newLatexId()
    if (/\.(?:tex|sty|cls|bib|bst)$/iu.test(path)) {
      try { files.push({ id, path, content: decoder.decode(bytes) }) } catch { fail(`Source ${path} is not valid UTF-8. No lossy conversion was applied.`, 'invalid_unicode') }
    } else {
      const mediaType = /\.png$/iu.test(path) ? 'image/png' : 'image/jpeg'
      imageDimensions(bytes, mediaType)
      if (isRecord(metadata) && (metadata.mediaType !== mediaType || metadata.bytes !== bytes.length || metadata.sha256 !== await sha256(bytes))) fail(`Asset manifest checksum or type mismatch: ${path}.`)
      assets.push({ id, path, mediaType, blob: new Blob([new Uint8Array(bytes)], { type: mediaType }) })
    }
  }
  const tex = files.filter((file) => /\.tex$/iu.test(file.path))
  const main = manifest?.mainFile ?? (tex.find((file) => file.path === 'main.tex')?.path ?? (tex.length === 1 ? tex[0].path : null))
  if (!main) fail('The archive has multiple .tex files but no main.tex or build manifest. Add smilepdf-project.json with a main file, or rename the entry point explicitly.', 'missing_main')
  const now = new Date().toISOString()
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: newLatexId(), title: manifest?.title ?? title, revision: 1, mainFile: main, engine: manifest?.engine ?? 'lualatex',
    files, assets, templateId: manifest?.templateId ?? null, templateVersion: manifest?.templateVersion ?? null, createdAt: now, updatedAt: now })
}

export async function createProjectZip(project: LatexProject) {
  validateLatexProject(project)
  const zip = new JSZip()
  for (const file of project.files) zip.file(file.path, file.content)
  const assetManifest = []
  for (const asset of project.assets) {
    const bytes = await asset.blob.arrayBuffer()
    imageDimensions(new Uint8Array(bytes), asset.mediaType)
    zip.file(asset.path, bytes)
    assetManifest.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, bytes: bytes.byteLength, sha256: await sha256(bytes) })
  }
  const manifest = JSON.stringify({ format: 'smilepdf-latex', version: 1, sourceProjectId: project.id, title: project.title, mainFile: project.mainFile,
    engine: project.engine, templateId: project.templateId, templateVersion: project.templateVersion,
    files: project.files.map((file) => ({ id: file.id, path: file.path })), assets: assetManifest,
    nativeFonts: requiredNativeFonts(project.files.map((file) => file.content).join('\n')),
    requirements: requirementsNotice,
    ...(latexSourceTemplates.some((template) => template.id === project.templateId && template.version === project.templateVersion) ? { templateNotice } : {}) }, null, 2)
  if (utf8Bytes(manifest) > 32 * 1024) fail('The portable build manifest exceeds 32 KiB. Source was kept; download the main .tex file or simplify the file/font declarations before ZIP export.', 'archive_too_large')
  zip.file(manifestName, manifest)
  const bytes = await streamBytes(zip.generateInternalStream({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, streamFiles: true }), LATEX_LIMITS.uploadBytes)
  return new Uint8Array(bytes).buffer
}

export function readTexProject(bytes: Uint8Array, path: string, title: string): LatexProject {
  assertLatexPath(path, 'text')
  if (!/\.tex$/iu.test(path) || bytes.length > LATEX_LIMITS.sourceBytes) fail('Import a .tex source no larger than 1 MiB.', 'source_too_large')
  let content: string
  try { content = decoder.decode(bytes) } catch { return fail('The .tex file is not valid UTF-8. Its original bytes were not changed.', 'invalid_unicode') }
  const now = new Date().toISOString()
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: newLatexId(), title, revision: 1, mainFile: path, engine: 'lualatex', files: [{ id: newLatexId(), path, content }], assets: [], templateId: null, templateVersion: null, createdAt: now, updatedAt: now })
}

export function decodeSourceBytes(bytes: Uint8Array) {
  if (bytes.length > LATEX_LIMITS.sourceBytes) fail('The source file exceeds 1 MiB.', 'source_too_large')
  try { return decoder.decode(bytes) } catch { return fail('Source is not valid UTF-8. No lossy conversion was applied.', 'invalid_unicode') }
}
