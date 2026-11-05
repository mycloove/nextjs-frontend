import { sameProjectSource } from './project.ts'
import { pdfProofIdentity } from './pdfProof.ts'
import { LATEX_LIMITS, type LatexProject, type LatexProof, type LatexRuntime } from './types.ts'
import type { LatexCompileProgress, LatexEngineAssetAudit } from './browserCompiler.ts'

/** A structural subset of the hook's captured attempt; importing this report never loads the hook/compiler. */
export type BuildDetailsAttempt = {
  projectId: string; revision: number; operationKey: string; stage: string; runtime: LatexRuntime; snapshot: LatexProject
  progress?: { assetAudit?: LatexEngineAssetAudit[]; buildContext?: LatexCompileProgress['buildContext'] }
}
export type BuildDetailsInput = {
  proof: LatexProof | null
  /** Only the retained, hash-validated source paired with this proof. Never pass the live editing project. */
  proofSource?: LatexProject | null
  currentAttempt?: BuildDetailsAttempt | null
}

const notRecorded = 'Not recorded' as const
const notChecked = 'Not checked' as const
const engineNames = { lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX' } as const

/** Derived, session-only evidence. No new v1 fields, current capability lookups, persistence or source rewriting. */
export function deriveBuildDetails({ proof, proofSource, currentAttempt }: BuildDetailsInput) {
  if (!proof) return null
  const matchesSource = (source: LatexProject | null | undefined): source is LatexProject => Boolean(source
    && source.id === proof.projectId && source.revision === proof.revision && source.engine === proof.engine && source.mainFile !== null)
  const source = matchesSource(proofSource) ? proofSource : null
  const attempt = currentAttempt?.stage === 'ready' && currentAttempt.operationKey === proof.operationKey
    && currentAttempt.projectId === proof.projectId && currentAttempt.revision === proof.revision && currentAttempt.runtime === (proof.runtime ?? 'native')
    && matchesSource(currentAttempt.snapshot) && source && sameProjectSource(currentAttempt.snapshot, source) ? currentAttempt : null
  const suppliedAudit = attempt?.runtime === 'browser' ? attempt.progress?.assetAudit : undefined
  const assets = suppliedAudit && suppliedAudit.length <= 64 && suppliedAudit.every((asset) => asset.path.length <= 256
    && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && /^[0-9a-f]{64}$/u.test(asset.sha256)
    && ['indexeddb-reuse', 'fetch-response'].includes(asset.source) && asset.packages.length <= 128)
    ? suppliedAudit.map((asset) => ({ ...asset, packages: [...asset.packages] })) : []
  const captured = attempt?.runtime === 'browser' ? attempt.progress?.buildContext : undefined
  const context = captured?.profileVersion === proof.profileVersion && captured.profile.id === proof.engine ? captured : null
  const manifest = context?.manifest && context.manifest.path === 'manifest.json' && /^[0-9a-f]{64}$/u.test(context.manifest.sha256)
    && Number.isSafeInteger(context.manifest.bytes) && context.manifest.bytes > 0 ? { ...context.manifest } : assets.find((asset) => asset.path === 'manifest.json') ?? null
  const worker = assets.find((asset) => asset.path === 'compiler-worker.js') ?? null
  // The proof log is the artifact's retained log, not the latest attempt's log.
  // Entries below quote evidence rather than treating arbitrary TeX text as structured execution telemetry.
  const log = proof.log.slice(0, LATEX_LIMITS.logBytes), lines = log.split(/\r\n|\r|\n/u)
  const passEvidence: string[] = [], observed = new Set<number>()
  let finalPass: number | null = null
  for (const line of lines) {
    const pass = /^TeX pass ([1-3]): (LuaHBTeX|LuaLaTeX|XeLaTeX|pdfLaTeX)$/u.exec(line)
    if (pass && (pass[2] === engineNames[proof.engine] || proof.engine === 'lualatex' && pass[2] === 'LuaHBTeX')) { observed.add(Number(pass[1])); if (!passEvidence.includes(line)) passEvidence.push(line) }
    if (line === 'Final TeX pass 3 (earlier pass diagnostics omitted after convergence):') {
      finalPass = 3; observed.add(3); if (!passEvidence.includes(line)) passEvidence.push(line)
    }
  }
  const bibliographyEvidence = lines.filter((line) => /^Biber pass: real Perl Biber [0-9]/u.test(line)
    || /\bINFO\s+-\s+This is Biber [0-9]/u.test(line) || /^This is (?:8-bit Big )?BibTeX\b/u.test(line)).slice(0, 8).map((line) => line.slice(0, 256))
  const bibliographyTools = [...new Set(bibliographyEvidence.map((line) => /Biber/u.test(line) ? 'Biber' : 'BibTeX'))]
  const bibliographyOutput = bibliographyTools.includes('Biber') ? lines.find((line) => /\bINFO\s+-\s+Output to\s+[^\r\n]*\.bbl(?:['"])?\s*$/u.test(line))?.slice(0, 256) ?? null : null
  return {
    identity: pdfProofIdentity(proof), operationKey: proof.operationKey,
    project: { id: proof.projectId, title: source?.title ?? null, revision: proof.revision, mainFile: source?.mainFile ?? null, snapshotHash: proof.snapshotHash,
      sourceEvidence: source ? 'Retained source snapshot paired with this proof' : notRecorded },
    runtime: proof.runtime ?? 'native', engine: proof.engine, profileVersion: proof.profileVersion,
    manifest, worker, assets,
    assetEvidence: assets.length ? 'Verified assets captured for this successful operation; not current cache contents or a network-traffic report' : notRecorded,
    fonts: { availability: context ? 'Declared in the captured pinned profile; optional groups may require approval' : notRecorded, families: context ? [...context.profile.fonts] : [], usedInPdf: notChecked },
    packages: { available: [...new Set([...(context?.profile.packages ?? []), ...assets.flatMap((asset) => asset.packages)])],
      availability: context ? 'Declared in the captured profile and verified asset groups; not a complete or used-in-PDF inventory' : assets.length ? 'Names supplied by the captured verified asset groups, not a complete package inventory' : notRecorded, usedInPdf: notChecked },
    renderer: { override: proof.engine === 'lualatex' && lines.includes('Renderer policy: LuaHBTeX HarfBuzz default; explicit source font features can override.') ? 'Retained log records a LuaHBTeX HarfBuzz default; explicit source font features can override it' : notRecorded, usedInPdf: notChecked },
    passes: { observed: [...observed].sort((a, b) => a - b), final: finalPass, evidence: passEvidence, outcome: notRecorded },
    bibliography: { tools: bibliographyTools, evidence: bibliographyEvidence, outputEvidence: bibliographyOutput, outcome: notRecorded },
    pdf: { sha256: proof.pdf.sha256, pages: proof.pdf.pages, bytes: proof.pdf.bytes },
    diagnostics: proof.diagnostics.map((item) => ({ ...item })), createdAt: proof.createdAt,
    logLimited: proof.log.length > LATEX_LIMITS.logBytes || /\[(?:Earlier compiler log truncated|[^\]\r\n]*truncat[^\]\r\n]*|Raw context omitted at the log display limit; complete streams were checked\.)\]/iu.test(log),
    qualification: 'Recorded build evidence, not an ATS score, visual accuracy certification or a claim of which fonts/packages were used in the PDF.',
  }
}

export type LatexBuildReport = NonNullable<ReturnType<typeof deriveBuildDetails>>
