'use client'

import styles from './ErrorBanner.module.css'

type ErrorBannerProps = {
  /** The message to show. A falsy value renders nothing. */
  message: string | null | undefined
  /** Optional recovery action, e.g. retry the failed conversion. */
  onRetry?: () => void
  retryLabel?: string
  /** Optional dismiss affordance; when omitted no close button renders. */
  onDismiss?: () => void
  className?: string
}

/**
 * Shared inline error surface for tool components.
 *
 * Before this existed every tool re-implemented its own error UI (inline
 * banners, `alert()`, hand-rolled JSON parsing), so the same failure looked
 * different on every page. This is the one banner: it carries the global tool
 * tokens from app/theme.css, so it reads correctly in both themes and inside
 * any tool's chrome. It is intentionally presentational - callers own the
 * message via lib/api/client's getApiErrorMessage.
 */
export default function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'Try again',
  onDismiss,
  className,
}: ErrorBannerProps) {
  if (!message) return null

  return (
    <div
      className={`${styles.banner} ${className ?? ''}`.trim()}
      role="alert"
    >
      <span className={styles.icon} aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12.5" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </span>
      <p className={styles.text}>{message}</p>
      {onRetry ? (
        <button
          type="button"
          className={styles.action}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Dismiss message"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
