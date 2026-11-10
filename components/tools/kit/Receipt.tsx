'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import styles from './kit.module.css'
import { CheckIcon, InfoIcon, WarningIcon } from './icons'

export type ReceiptFact = {
  tone: 'success' | 'warning' | 'info'
  text: ReactNode
}

/**
 * The conversion receipt (roadmap §6.4): what came out, what really happened
 * to it, and what may have been lost — then the user's own Download. No tool
 * auto-downloads behind a receipt (owner decision D4).
 *
 * `settle` plays Ink Settle (§3.4), the product's one brand moment, and only
 * for a real success; a "nothing changed" or partial outcome opens plainly.
 */
export function Receipt({
  tone,
  title,
  fileName,
  facts,
  actions,
  children,
  settle = tone === 'success',
}: {
  tone: 'success' | 'warning'
  title: string
  /** The output's real name, from the response. */
  fileName?: string
  facts: readonly ReceiptFact[]
  /** Primary action first; it takes the wide slot. */
  actions: ReactNode
  /** A tool-specific figure between the heading and the facts. */
  children?: ReactNode
  settle?: boolean
}) {
  const ref = useRef<HTMLElement>(null)

  /* A receipt appears below the options, often past the fold. Move focus to
     it (so keyboard and screen-reader users land on the outcome) and bring
     the whole card, Download included, into view. */
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus({ preventScroll: true })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  return (
    <section ref={ref} tabIndex={-1} className={styles.receipt} data-tone={tone} data-settle={settle} role="status" aria-label={title}>
      <div className={styles.receiptHead}>
        {tone === 'success' ? <CheckIcon drawClass={styles.checkPath} /> : <WarningIcon />}
        <h2 className={styles.receiptTitle}>{title}</h2>
      </div>
      {fileName && <p className={styles.receiptFile} title={fileName}>{fileName}</p>}
      {children}
      {facts.length > 0 && (
        <ul className={styles.facts}>
          {facts.map((fact, index) => (
            <li key={index} className={styles.fact} data-tone={fact.tone}>
              {fact.tone === 'success' ? <CheckIcon /> : fact.tone === 'warning' ? <WarningIcon /> : <InfoIcon />}
              <span>{fact.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.receiptActions}>{actions}</div>
    </section>
  )
}
