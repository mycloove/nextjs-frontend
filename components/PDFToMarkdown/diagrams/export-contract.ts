export type DiagramExportCompletion = {
  warnings: string[]
  expectedDiagramCount: number
  renderedDiagramCount: number
}

export function assertCompleteDiagramExport(exported: DiagramExportCompletion): void {
  const warning = exported.warnings[0]
  if (warning || exported.renderedDiagramCount !== exported.expectedDiagramCount) {
    throw new Error(`PDF export stopped because ${warning || 'one or more diagrams could not be rendered.'}`)
  }
}