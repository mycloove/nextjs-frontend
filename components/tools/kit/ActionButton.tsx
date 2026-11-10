'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './kit.module.css'
import { ArrowIcon } from './icons'

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'quiet'
  /** Stretch to the container width. */
  block?: boolean
  icon?: ReactNode
  /** Primary actions that move the user forward carry a trailing arrow. */
  arrow?: boolean
  children: ReactNode
}

/**
 * The one button shape a tool's main action uses. Its label names the verb and
 * the object ("Compress PDF"), never jargon like "Initialize" (roadmap §6.3).
 */
export function ActionButton({
  variant = 'primary',
  block = false,
  icon,
  arrow = false,
  className,
  type = 'button',
  children,
  ...rest
}: ActionButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      <span>{children}</span>
      {arrow && <ArrowIcon className={styles.arrow} />}
    </button>
  )
}
