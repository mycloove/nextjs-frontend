'use client'

import { useState } from 'react'
import { deriveBuildDetails, type BuildDetailsInput } from './buildDetails.ts'
import { downloadName } from './project.ts'
import { downloadBlob } from './projectImport'
import styles from './LatexBuildDetails.module.css'

export default function LatexBuildDetails(props: BuildDetailsInput & { onNotice?: (message: string) => void }) {
  const report = deriveBuildDetails(props)
  const [downloadError, setDownloadError] = useState<{ identity: string; message: string } | null>(null)
  if (!report) return <p className={styles.empty}>No compiled proof is available. Current build settings are not evidence of a completed build.</p>
  return <section className={styles.details} aria-label="Compiled proof build details">
    <header className={styles.heading}><div><h3>Compiled proof details</h3><p>Recorded for r{report.project.revision}. Editing settings and later attempts are not substituted for this proof.</p></div>
      <button type="button" onClick={() => {
        try {
          downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }), `${downloadName(report.project.title ?? 'resume')}-r${report.project.revision}-build-report.json`)
          setDownloadError(null)
        } catch {
          const message = 'The report download could not start. The source and PDF are unchanged.'
          setDownloadError({ identity: report.identity, message }); props.onNotice?.(message)
        }
      }}>Download report</button></header>
    {downloadError?.identity === report.identity && <p>{downloadError.message}</p>}
    <dl className={styles.facts}>
      <div><dt>Project</dt><dd>{report.project.title ?? 'Title not recorded'}<code>{report.project.id}</code></dd></div>
      <div><dt>Compiled revision / main</dt><dd>r{report.project.revision} / {report.project.mainFile ?? 'Main not recorded'}</dd></div>
      <div><dt>Engine / profile</dt><dd>{report.engine} / {report.profileVersion}</dd></div>
      <div><dt>Runtime</dt><dd>{report.runtime === 'browser' ? 'Local browser' : 'Private native'}<span>Present availability is not determined by a retained proof.</span></dd></div>
      <div><dt>Source SHA-256</dt><dd><code>{report.project.snapshotHash}</code><span>{report.project.sourceEvidence}</span></dd></div>
      <div><dt>PDF SHA-256</dt><dd><code>{report.pdf.sha256}</code></dd></div>
      <div><dt>PDF pages / bytes</dt><dd>{report.pdf.pages} / {report.pdf.bytes.toLocaleString('en-US')} bytes</dd></div>
      <div><dt>Manifest identity</dt><dd>{report.manifest ? <code>{report.manifest.path} / {report.manifest.sha256}</code> : 'Not recorded'}</dd></div>
      <div><dt>Worker identity</dt><dd>{report.worker ? <code>{report.worker.path} / {report.worker.sha256}</code> : 'Not recorded'}</dd></div>
      <div><dt>Available fonts / used in PDF</dt><dd>{report.fonts.availability} / {report.fonts.usedInPdf}{report.fonts.families.length > 0 && <span>{report.fonts.families.join(', ')}</span>}<span>A font-family inventory does not prove font resolution, embedding or glyph shaping.</span></dd></div>
      <div><dt>Package availability</dt><dd>{report.packages.available.length ? report.packages.available.join(', ') : 'Not recorded'}<span>{report.packages.availability}</span></dd></div>
      <div><dt>Packages used in PDF</dt><dd>{report.packages.usedInPdf}</dd></div>
      <div><dt>Renderer override / used in PDF</dt><dd>{report.renderer.override} / {report.renderer.usedInPdf}<span>Engine names and source feature requests alone do not establish the applied renderer.</span></dd></div>
      <div><dt>TeX passes in retained log</dt><dd>{report.passes.observed.length ? report.passes.observed.join(', ') : 'Not recorded'}{report.passes.final !== null && <span>Explicit final-pass record: {report.passes.final}</span>}<span>Per-pass exit status: {report.passes.outcome}</span></dd></div>
      <div><dt>Bibliography in retained log</dt><dd>{report.bibliography.tools.join(', ') || 'Not recorded'}<span>Backend exit status: {report.bibliography.outcome}</span>{report.bibliography.outputEvidence && <code>{report.bibliography.outputEvidence}</code>}</dd></div>
    </dl>
    {(report.passes.evidence.length > 0 || report.bibliography.evidence.length > 0) && <details className={styles.disclosure}><summary>Inspect retained log evidence</summary><p>These are recorded log lines, not independently verified execution metadata.{report.logLimited && ' The retained log is truncated; missing entries cannot establish that a step did not run.'}</p><pre>{[...report.passes.evidence, ...report.bibliography.evidence].join('\n')}</pre></details>}
    <details className={styles.disclosure}><summary>Captured engine assets ({report.assets.length})</summary><p>{report.assetEvidence}</p>{report.assets.length > 0 && <ul>{report.assets.map((asset) => <li key={asset.path}><strong>{asset.path}</strong><span>{asset.bytes.toLocaleString('en-US')} bytes / {asset.source === 'indexeddb-reuse' ? 'Verified IndexedDB reuse' : 'Verified fetch response; HTTP cache may have been used'}</span><code>{asset.sha256}</code></li>)}</ul>}</details>
    <details className={styles.disclosure}><summary>Final proof diagnostics ({report.diagnostics.length})</summary>{report.diagnostics.length ? <ul>{report.diagnostics.map((item, index) => <li key={index}><strong>{item.severity}{item.code ? ` / ${item.code}` : ''}</strong><span>{item.message}</span>{item.file && <code>{item.file}{item.line ? `:${item.line}` : ''}</code>}{item.help && <span>{item.help}</span>}</li>)}</ul> : <p>No final diagnostics were recorded. This is not a visual-layout certification.</p>}</details>
    <p className={styles.qualification}>{report.qualification} Report download is optional and includes these identifiers, diagnostics and log excerpts. No source payload or PDF bytes are added to the report.</p>
  </section>
}
