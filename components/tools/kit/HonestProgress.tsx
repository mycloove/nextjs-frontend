'use client'

import { useEffect, useState } from 'react'
import styles from './kit.module.css'
import { formatElapsed, progressStage } from './intakeRules'

/**
 * Honest progress (roadmap §5.2/§6.3). The upload is the only stage with a
 * real percentage, so it is the only stage that shows one. Once the bytes are
 * sent the server reports nothing until it answers, so the bar becomes an
 * indeterminate sweep with the elapsed time and the stage's real name — never
 * a fabricated percentage that creeps toward 99%.
 */
export function HonestProgress({
  uploadPercent,
  startedAt,
  processingLabel,
  onCancel,
}: {
  /** From uploadWithProgress's onProgress; null before the first event. */
  uploadPercent: number | null
  /** Date.now() when the run started — the elapsed clock's zero. */
  startedAt: number
  /** What the server is really doing, e.g. "Compressing on the server". */
  processingLabel: string
  onCancel?: () => void
}) {
  const stage = progressStage(uploadPercent)
  const now = useNow(stage.kind === 'processing')
  const elapsed = formatElapsed(now - startedAt)

  const label = stage.kind === 'uploading' ? 'Uploading' : processingLabel
  const figure = stage.kind === 'uploading' ? `${stage.percent}%` : elapsed

  return (
    <div className={styles.progress}>
      <div className={styles.progressRow}>
        <span>{label}</span>
        <span className={styles.progressFigure}>{figure}</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={stage.kind === 'uploading' ? 0 : undefined}
        aria-valuemax={stage.kind === 'uploading' ? 100 : undefined}
        aria-valuenow={stage.kind === 'uploading' ? stage.percent : undefined}
        aria-valuetext={stage.kind === 'uploading' ? `${stage.percent}% uploaded` : `${processingLabel}, ${elapsed} so far`}
      >
        {stage.kind === 'uploading' ? (
          <span className={styles.fill} style={{ transform: `scaleX(${stage.percent / 100})` }} />
        ) : (
          <span className={styles.sweep} />
        )}
      </div>
      {onCancel && (
        <div>
          <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  )
}

/* A one-second clock, running only while it is shown. The first tick may
   read up to a second stale; formatElapsed clamps that to "0 s". */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}
