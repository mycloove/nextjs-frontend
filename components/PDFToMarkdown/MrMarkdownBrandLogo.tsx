'use client'

import { useId } from 'react'

import styles from './MrMarkdownBrandLogo.module.css'

type MrMarkdownBrandLogoProps = {
  className?: string
}

export function MrMarkdownBrandLogo({ className = '' }: MrMarkdownBrandLogoProps) {
  const instanceId = useId().replace(/:/g, '')
  const deepDarkId = `mr-markdown-deep-dark-${instanceId}`
  const vibrantPurpleId = `mr-markdown-vibrant-purple-${instanceId}`
  const hatShadowId = `mr-markdown-hat-shadow-${instanceId}`

  return (
    <span
      className={`${styles.appPlateContainer} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className={styles.floorShadow} />
      <span className={styles.appPlate}>
        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id={deepDarkId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2e1065" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
            <linearGradient id={vibrantPurpleId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
            <filter id={hatShadowId} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="2" dy="4" stdDeviation="3" floodColor="rgba(46,16,101,0.2)" />
            </filter>
          </defs>

          <g transform="translate(0, 4)">
            <g>
              <line x1="26" y1="76" x2="26" y2="28" stroke={`url(#${deepDarkId})`} strokeWidth="12" strokeLinecap="round" />
              <line x1="74" y1="76" x2="74" y2="28" stroke={`url(#${deepDarkId})`} strokeWidth="12" strokeLinecap="round" />
            </g>
            <path className={styles.mRibbon} d="M 26 28 L 50 56 L 74 28" fill="none" stroke={`url(#${vibrantPurpleId})`} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          <g className={styles.gentlemanHat} filter={`url(#${hatShadowId})`}>
            <path d="M -20 2 Q 0 8 20 2" fill="none" stroke={`url(#${deepDarkId})`} strokeWidth="4.5" strokeLinecap="round" />
            <path d="M -12 0 C -12 -18 12 -18 12 0 Z" fill={`url(#${deepDarkId})`} stroke={`url(#${deepDarkId})`} strokeWidth="2" strokeLinejoin="round" />
            <path d="M -12 -4 Q 0 -1 12 -4" fill="none" stroke={`url(#${vibrantPurpleId})`} strokeWidth="4" />
            <path d="M -6 -11 C -2 -13 2 -13 6 -11" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" />
          </g>

          <g className={styles.magicSparkle}>
            <path d="M 80 12 Q 80 22 90 22 Q 80 22 80 32 Q 80 22 70 22 Q 80 22 80 12 Z" fill={`url(#${vibrantPurpleId})`} />
          </g>
        </svg>
      </span>
    </span>
  )
}