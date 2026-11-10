import { createHash } from 'node:crypto'
import type { ResumeTemplate } from '../components/resumeTemplates.ts'
import type { LatexSourceTemplate } from '../latex/templates.ts'

// Fingerprints tie each thumbnail to the exact template it was rendered from.
// Node-only (tests and the render script); never imported by the app bundle.
export function regularTemplateFingerprint(template: ResumeTemplate | Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(template)).digest('hex')
}

export function latexTemplateFingerprint(template: LatexSourceTemplate | undefined): string {
  if (!template) throw new Error('Unknown LaTeX source template')
  const files = [...template.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((file) => [file.path, file.content])
  return createHash('sha256').update(JSON.stringify([template.id, template.version, template.engine, files])).digest('hex')
}
