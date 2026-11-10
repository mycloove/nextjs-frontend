'use client'

import type { ReactNode } from 'react'
import styles from './kit.module.css'
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons'

export type NoticeTone = 'error' | 'warning' | 'success' | 'info'

const ICONS: Record<NoticeTone, () => ReactNode> = {
  error: () => <ErrorIcon />,
  warning: () => <WarningIcon />,
  success: () => <CheckIcon />,
  info: () => <InfoIcon />,
}

/**
 * Inline status next to where the problem is (§5.2). Errors are announced
 * assertively and stay until the user's next action replaces them; `shake`
 * plays the 2px refusal once (pass a changing `key` to replay it).
 */
export function Notice({
  tone,
  shake = false,
  children,
}: {
  tone: NoticeTone
  shake?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={styles.notice}
      data-tone={tone}
      data-shake={shake}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {ICONS[tone]()}
      <div>{children}</div>
    </div>
  )
}

/** Several refusals at once (e.g. a multi-file drop) as one list. */
export function NoticeList({ items }: { items: readonly string[] }) {
  if (items.length === 1) return <>{items[0]}</>
  return (
    <ul className={styles.noticeList}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}
