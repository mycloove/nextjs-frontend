import { isCurrentProof, sameProjectSource } from './project.ts'
import type { LatexDiagnostic, LatexProject, LatexProof } from './types.ts'

/** Revisions can fork between tabs. Every delayed source action checks the captured bytes too. */
export function matchesSourceSnapshot(project: LatexProject | null | undefined, snapshot: LatexProject | null | undefined): boolean {
  return Boolean(project && snapshot && project.id === snapshot.id && project.revision === snapshot.revision && sameProjectSource(project, snapshot))
}

export function proofActionIdentity(proof: LatexProof | null | undefined): string {
  return proof ? JSON.stringify([proof.projectId, proof.revision, proof.operationKey, proof.snapshotHash, proof.pdf.sha256,
    proof.runtime ?? 'native', proof.engine, proof.profileVersion]) : ''
}

export function matchesProofSnapshot(project: LatexProject | null | undefined, snapshot: LatexProject | null | undefined, proof: LatexProof | null | undefined): boolean {
  return matchesSourceSnapshot(project, snapshot) && isCurrentProof(project ?? null, proof)
}

/** Unknown and out-of-bounds locations remain build-level issues, never a line-one/clamped jump. */
export function diagnosticSourceTarget(project: LatexProject | null | undefined, snapshot: LatexProject | null | undefined, diagnostic: Pick<LatexDiagnostic, 'file' | 'line'>) {
  if (!matchesSourceSnapshot(project, snapshot) || !diagnostic.file || !Number.isSafeInteger(diagnostic.line) || diagnostic.line! < 1) return null
  const file = project!.files.find((item) => item.path === diagnostic.file)
  if (!file || diagnostic.line! > file.content.split(/\r\n|\r|\n/u).length) return null
  return { fileId: file.id, path: file.path, line: diagnostic.line! }
}
