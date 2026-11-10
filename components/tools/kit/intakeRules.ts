import type { ToolFileType, ToolLimits } from '../../../lib/tools/registry.ts'

/**
 * Shared intake rules (roadmap §6.1) — pure, so every tool validates a drop,
 * a paste and a file-picker pick the same way and with the same words.
 *
 * The registry entry is the single source of the accepted types and limits;
 * this module only turns them into a decision and into copy. The route stays
 * the authority: these checks exist so an oversized or wrong file is refused
 * before an upload starts, not to replace the server's own checks.
 *
 * Relative `.ts` import + type-only usage so the colocated node:test suite
 * runs without a bundler (the lib/pdf/pdfUtils.ts pattern).
 */

export type IntakeSpec = {
  accepts: readonly ToolFileType[]
  limits: ToolLimits
}

/** The subset of `File` the rules read — lets tests use plain objects. */
export type IntakeFile = { name: string; size: number; type: string }

export type IntakeRejectionReason = 'type' | 'size' | 'count' | 'total'

export type IntakeRejection = {
  name: string
  reason: IntakeRejectionReason
  message: string
}

export type IntakeResult<F extends IntakeFile> = {
  accepted: F[]
  rejections: IntakeRejection[]
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${bytes} B`
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** What a file looks like to a person: "DOCX", "PNG", or "a file with no extension". */
export function fileKindLabel(file: IntakeFile): string {
  const ext = extensionOf(file.name)
  if (ext) return ext.slice(1).toUpperCase()
  if (file.type) return file.type
  return 'a file with no extension'
}

export function matchesFileType(file: IntakeFile, accepts: readonly ToolFileType[]): boolean {
  const ext = extensionOf(file.name)
  return accepts.some((type) => file.type === type.mime || (ext !== '' && type.extensions.includes(ext)))
}

/** "PDF" / "PDF or ZIP" / "PNG, JPG or WEBP". */
export function acceptsLabel(accepts: readonly ToolFileType[]): string {
  const labels = accepts.map((type) => type.label)
  if (labels.length <= 1) return labels[0] ?? 'files'
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** The limits line shown under the intake button, before anything is dropped. */
export function describeLimits(spec: IntakeSpec): string {
  const { limits } = spec
  const count =
    limits.maxFiles === 1 ? 'one file'
    : limits.minFiles && limits.minFiles > 1 ? `${limits.minFiles}–${limits.maxFiles} files`
    : `up to ${limits.maxFiles} files`
  return `${acceptsLabel(spec.accepts)} · ${count} · up to ${formatBytes(limits.maxFileBytes)}${limits.maxFiles === 1 ? '' : ' each'}`
}

/**
 * Decide which of the offered files a tool takes.
 *
 * `held` is what the tool already has. Single-file tools (maxFiles 1) treat a
 * new drop as a replacement, so `held` is ignored for them; the first
 * acceptable file wins and every other file is reported, never silently
 * dropped.
 */
export function validateIntake<F extends IntakeFile>(
  files: readonly F[],
  spec: IntakeSpec,
  held: { count: number; bytes: number } = { count: 0, bytes: 0 },
): IntakeResult<F> {
  const { limits, accepts } = spec
  const single = limits.maxFiles === 1
  const accepted: F[] = []
  const rejections: IntakeRejection[] = []
  let count = single ? 0 : held.count
  let total = single ? 0 : held.bytes
  const kinds = acceptsLabel(accepts)

  for (const file of files) {
    if (!matchesFileType(file, accepts)) {
      rejections.push({
        name: file.name,
        reason: 'type',
        message: `${file.name} is ${withArticle(fileKindLabel(file))}; this tool takes ${kinds}.`,
      })
      continue
    }
    if (file.size > limits.maxFileBytes) {
      rejections.push({
        name: file.name,
        reason: 'size',
        message: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(limits.maxFileBytes)} per file.`,
      })
      continue
    }
    if (count >= limits.maxFiles) {
      rejections.push({
        name: file.name,
        reason: 'count',
        message: single
          ? `${file.name} was not added — this tool works on one file at a time.`
          : `${file.name} was not added — the limit is ${limits.maxFiles} files.`,
      })
      continue
    }
    if (limits.maxTotalBytes !== undefined && total + file.size > limits.maxTotalBytes) {
      rejections.push({
        name: file.name,
        reason: 'total',
        message: `${file.name} was not added — together the files would pass the ${formatBytes(limits.maxTotalBytes)} job limit.`,
      })
      continue
    }
    accepted.push(file)
    count += 1
    total += file.size
  }

  return { accepted, rejections }
}

/* Letter names that start with a vowel sound take "an": an SVG, an MP4, an XLSX. */
function withArticle(kind: string): string {
  if (kind.startsWith('a file')) return kind
  return /^([AEFHILMNORSX]|[aeiou])/.test(kind) ? `an ${kind}` : `a ${kind}`
}

/** What a drag in progress carries, read from `DataTransfer.items` before the drop. */
export type DragItem = { kind: string; type: string }

export type DragSummary = {
  /** Files in the drag; 0 means this drag is not carrying files at all. */
  count: number
  /** False only when every file's MIME is known and none is accepted. */
  acceptable: boolean
  label: string
}

/**
 * Browsers expose only MIME types (no names or sizes) during a drag, and some
 * leave the type empty. An empty type counts as "maybe" so the frame never
 * refuses a file it cannot actually see; the drop itself is validated.
 */
export function summarizeDrag(items: readonly DragItem[], spec: IntakeSpec): DragSummary {
  const files = items.filter((item) => item.kind === 'file')
  const kinds = acceptsLabel(spec.accepts)
  if (files.length === 0) return { count: 0, acceptable: false, label: '' }
  const known = files.filter((item) => item.type !== '')
  const matching = known.filter((item) => spec.accepts.some((type) => type.mime === item.type))
  const acceptable = known.length < files.length || matching.length > 0
  if (!acceptable) return { count: files.length, acceptable, label: `This tool takes ${kinds} only` }
  if (spec.limits.maxFiles === 1) {
    return {
      count: files.length,
      acceptable,
      label: files.length > 1 ? `Drop — the first ${kinds} is used` : `Drop to add your ${kinds}`,
    }
  }
  return { count: files.length, acceptable, label: `Drop to add ${files.length} ${files.length === 1 ? 'file' : 'files'}` }
}

/* Upload is the only stage with a real percentage; once the bytes are sent the
   server gives no progress signal, so the honest display is indeterminate
   plus elapsed time. Pure so the hand-off point is testable. */
export type ProgressStage =
  | { kind: 'uploading'; percent: number }
  | { kind: 'processing' }

export function progressStage(uploadPercent: number | null): ProgressStage {
  if (uploadPercent === null || uploadPercent >= 100) return { kind: 'processing' }
  return { kind: 'uploading', percent: Math.max(0, Math.round(uploadPercent)) }
}

/** "4 s", "1 min 05 s" — elapsed time for the indeterminate stage. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`
}
