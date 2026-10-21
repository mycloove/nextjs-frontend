'use client';

import type { CSSProperties, ReactNode } from 'react';
import styles from './HelixLoader.module.css';

export type HelixTone = 'bases' | 'accent';

/* The four FASTA base colours are the tool's data-encoding palette; when the
   loader renders inside `.ft-root` these tokens resolve, otherwise the literal
   fallbacks keep the helix legible (e.g. the workspace mount fallback). */
const BASE_COLORS = [
  'var(--ft-base-a, #82b37a)',
  'var(--ft-base-c, #76a5d8)',
  'var(--ft-base-g, #d3a94e)',
  'var(--ft-base-t, #d97f7f)',
];
const ACCENT_COLOR = 'var(--accent-start, #e0695a)';

type Vars = CSSProperties & Record<string, string | number>;

export function HelixLoader({
  size = 44,
  columns = 7,
  tone = 'bases',
  label,
  decorative = false,
  className,
}: {
  size?: number;
  columns?: number;
  tone?: HelixTone;
  label?: string;
  decorative?: boolean;
  className?: string;
}) {
  const helix = (
    <span
      className={styles.helix}
      style={{ '--helix-size': `${size}px`, '--helix-cols': columns } as Vars}
      aria-hidden="true"
    >
      {Array.from({ length: columns }, (_, n) => (
        <u
          key={n}
          className={styles.col}
          style={{
            '--n': n,
            '--helix-c': tone === 'bases' ? BASE_COLORS[n % BASE_COLORS.length] : ACCENT_COLOR,
          } as Vars}
        />
      ))}
    </span>
  );

  if (decorative) {
    return (
      <span className={`${styles.deco} ${className ?? ''}`} aria-hidden="true">
        {helix}
      </span>
    );
  }

  return (
    <span className={`${styles.wrap} ${className ?? ''}`} role="status" aria-live="polite">
      {helix}
      {label ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className={styles.srOnly}>Loading</span>
      )}
    </span>
  );
}

/* Centered overlay used by the Convert / Report / Chunk panels. The parent
   panel must be `position: relative`. */
export function HelixOverlay({ label, tone = 'bases' }: { label: string; tone?: HelixTone }) {
  return (
    <span className={styles.overlay} role="status" aria-live="polite">
      <HelixLoader size={38} tone={tone} decorative />
      <span className={styles.overlayLabel}>{label}</span>
    </span>
  );
}

export type HelixButtonState = 'idle' | 'busy' | 'done';

/* Morphing primary button: idle label → helix → drawn check. */
export function HelixButton({
  state,
  idle,
  busyLabel,
  doneLabel,
  onClick,
  disabled,
  className,
}: {
  state: HelixButtonState;
  idle: ReactNode;
  busyLabel: string;
  doneLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.action} ${className ?? ''}`}
      data-state={state}
      onClick={onClick}
      disabled={disabled}
      aria-busy={state === 'busy'}
    >
      <span className={styles.actionIdle}>{idle}</span>
      <span className={styles.actionBusy}>
        <HelixLoader size={24} columns={7} tone="bases" decorative />
        <span>{busyLabel}</span>
      </span>
      <span className={styles.actionDone}>
        <svg className={styles.check} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
        <span>{doneLabel}</span>
      </span>
    </button>
  );
}
