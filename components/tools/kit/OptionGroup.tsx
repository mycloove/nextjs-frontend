'use client'

import { useId, useRef, type KeyboardEvent } from 'react'
import styles from './kit.module.css'

export type Option<V extends string> = {
  value: V
  title: string
  description?: string
  /** A short right-aligned fact about the option, e.g. what it keeps or drops. */
  tag?: string
  /** "danger" marks an option that discards something; the tag must say what. */
  tone?: 'default' | 'danger'
}

/**
 * Radio cards for a tool's few visible choices (roadmap §6.2: at most three
 * up front, with the right default). Implements the WAI-ARIA radio-group
 * keyboard model: one tab stop, arrow keys move and select.
 */
export function OptionGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  options: readonly Option<V>[]
  value: V
  onChange: (value: V) => void
  disabled?: boolean
}) {
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
      : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={styles.options} role="radiogroup" aria-labelledby={labelId}>
      <p id={labelId} className={styles.optionsLegend}>{label}</p>
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.option}
            data-tone={option.tone ?? 'default'}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className={styles.optionDot} aria-hidden="true" />
            <span className={styles.optionHead}>
              <span className={styles.optionTitle}>{option.title}</span>
              {option.tag && <span className={styles.optionTag}>{option.tag}</span>}
            </span>
            {option.description && <span className={styles.optionDesc}>{option.description}</span>}
          </button>
        )
      })}
    </div>
  )
}
