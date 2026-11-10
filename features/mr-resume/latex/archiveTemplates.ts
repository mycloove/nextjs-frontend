import { LatexProjectError, reviseProject, sha256 } from './project.ts'
import { readProjectZip } from './projectArchive.ts'
import type { LatexEngine, LatexProject } from './types.ts'

// Third-party starters that need image assets ship as a pinned same-origin ZIP
// and go through the ordinary import path, so the project is exactly what a
// user importing that archive would get. Bytes are verified before parsing.
export type LatexArchiveTemplate = {
  readonly id: string
  readonly name: string
  readonly engine: LatexEngine
  readonly mainFile: string
  readonly path: `/mr-resume/templates/latex/${string}.zip`
  readonly bytes: number
  readonly sha256: string
  /** Optional engine package groups the build asks consent for. */
  readonly packageGroups: readonly string[]
  /** The real compiler fixture in browser/smoke.mjs that builds this exact archive. */
  readonly fixture: string
}

export const latexArchiveTemplates: readonly LatexArchiveTemplate[] = [
  { id: 'altacv', name: 'AltaCV', engine: 'lualatex', mainFile: 'sample.tex', path: '/mr-resume/templates/latex/altacv-v1.7.4-smilepdf.zip',
    bytes: 50489, sha256: 'd86bea8170ddab3f5e17d6042babd55bca93e900761dc553ddcf7088f1a8f8e3', packageGroups: ['cv-layout', 'cv-fonts', 'bibliography'], fixture: 'altacv-gallery-lualatex' },
]

export async function createArchiveTemplateProject(id: string, fetcher: typeof fetch = fetch): Promise<LatexProject> {
  const template = latexArchiveTemplates.find((item) => item.id === id)
  if (!template) throw new LatexProjectError('That template is no longer available. Nothing was changed.')
  let response: Response
  try { response = await fetcher(template.path, { credentials: 'omit', redirect: 'error' }) }
  catch { throw new LatexProjectError(`The ${template.name} template could not be downloaded. Check the connection and try again; nothing was changed.`) }
  if (!response.ok) throw new LatexProjectError(`The ${template.name} template could not be downloaded. Nothing was changed.`)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== template.bytes || await sha256(bytes) !== template.sha256) throw new LatexProjectError(`The ${template.name} template did not match its pinned bytes and was not opened.`)
  const project = await readProjectZip(bytes, template.name)
  if (!project.files.some((file) => file.path === template.mainFile)) throw new LatexProjectError(`The ${template.name} template is missing ${template.mainFile}.`)
  return reviseProject(project, { mainFile: template.mainFile, engine: template.engine })
}
