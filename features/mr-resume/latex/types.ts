/** MR Resume owns these contracts. Regular drafts and shared tool/billing IDs do not change. */
export const LATEX_PROJECT_VERSION = 1 as const
export const LATEX_MODE_KEY = 'mr-resume:editor-mode:v1'
export const LATEX_DATABASE = 'mr-resume:latex:v1'
export const LATEX_API = '/api/mr-resume/latex'
export const LATEX_LIMITS = {
  files: 32,
  sourceBytes: 1024 * 1024,
  uploadBytes: 3 * 1024 * 1024,
  pdfBytes: 3 * 1024 * 1024,
  pages: 32,
  logBytes: 128 * 1024,
  syncBytes: 8 * 1024 * 1024,
  deadlineSeconds: 30,
} as const

export type LatexEngine = 'lualatex' | 'xelatex' | 'pdflatex'
export type LatexTextFile = { id: string; path: string; content: string }
export type LatexAsset = { id: string; path: string; mediaType: 'image/png' | 'image/jpeg'; blob: Blob }
export type LatexProject = {
  version: typeof LATEX_PROJECT_VERSION
  id: string
  title: string
  revision: number
  mainFile: string
  engine: LatexEngine
  files: LatexTextFile[]
  assets: LatexAsset[]
  templateId: string | null
  templateVersion: number | null
  createdAt: string
  updatedAt: string
}
export type RegularLatexSnapshot = {
  title: string
  source: string
  font: string
  photo: string | null
}
export type LatexImportRequest = { id: string; snapshot: RegularLatexSnapshot }
export type LatexCheckpoint = { id: string; label: string; project: LatexProject; createdAt: string }
export type LatexDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  message: string
  file?: string
  line?: number
  code?: string
  help?: string
}
export type LatexProfile = { id: LatexEngine; name: string; version: string; fonts: string[]; packages: string[] }
export type LatexCapabilities = {
  enabled: boolean
  ready: boolean
  reason: string
  profiles: LatexProfile[]
  limits: { [K in keyof typeof LATEX_LIMITS]: number }
}

/** Multipart `manifest` JSON, plus `asset:<id>` fields containing the original binary blobs. */
export type LatexCompileManifest = {
  version: typeof LATEX_PROJECT_VERSION
  operationKey: string
  projectId: string
  title: string
  revision: number
  mainFile: string
  engine: LatexEngine
  files: LatexTextFile[]
  assets: { id: string; path: string; mediaType: LatexAsset['mediaType']; size: number }[]
}
export type LatexCompileResult = {
  status: 'ready'
  operationKey: string
  projectId: string
  revision: number
  snapshotHash: string
  engine: LatexEngine
  profileVersion: string
  pdf: { id: string; sha256: string; bytes: number; pages: number }
  diagnostics: LatexDiagnostic[]
  log: string
  syncAvailable: boolean
  createdAt: string
}
export type LatexProof = LatexCompileResult & { data: ArrayBuffer }
export type LatexCompileFailure = {
  error: string
  code: string
  request_id: string
  operationKey?: string
  diagnostics?: LatexDiagnostic[]
  log?: string
}
export type LatexOperation =
  | { status: 'running' | 'cancelled' | 'failed'; operationKey: string; error?: string }
  | LatexCompileResult

/** Coordinates are PDF points, converted with the PDF.js viewport, not guessed DOM positions. */
export type LatexPdfLocation = { page: number; x: number; y: number; width: number; height: number }
export type LatexSyncQuery = {
  operationKey: string
  snapshotHash: string
  pdfHash: string
} & (
  | { direction: 'forward'; file: string; line: number }
  | { direction: 'inverse'; page: number; x: number; y: number }
)
export type LatexSyncResult = { available: boolean; file?: string; line?: number; locations: LatexPdfLocation[] }

export const unavailableLatexCapabilities: LatexCapabilities = {
  enabled: false,
  ready: false,
  reason: 'The private LaTeX compiler is not configured. You can keep editing and export your source project.',
  profiles: [],
  limits: { ...LATEX_LIMITS },
}
