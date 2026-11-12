import { createHash } from 'node:crypto'
import type { ResumeSpecimen } from '../components/resumeSpecimens.ts'
import type { ResumeTemplate } from '../components/resumeTemplates.ts'
import type { LatexSourceTemplate } from '../latex/templates.ts'

// Fingerprints tie each thumbnail to the exact template it was rendered from.
// A Regular card pictures the template filled with its specimen, so both are
// hashed: changing either one makes the picture stale.
// Node-only (tests and the render script); never imported by the app bundle.
export function regularTemplateFingerprint(template: ResumeTemplate | Readonly<Record<string, unknown>>, specimen: ResumeSpecimen | undefined): string {
  if (!specimen) throw new Error('A Regular template needs a specimen before it can be pictured')
  return createHash('sha256').update(JSON.stringify([template, specimen])).digest('hex')
}

export function latexTemplateFingerprint(template: LatexSourceTemplate | undefined): string {
  if (!template) throw new Error('Unknown LaTeX source template')
  const files = [...template.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((file) => [file.path, file.content])
  return createHash('sha256').update(JSON.stringify([template.id, template.version, template.engine, files])).digest('hex')
}
