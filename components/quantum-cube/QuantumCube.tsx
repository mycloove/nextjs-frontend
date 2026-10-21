'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { AxisRotationIcon, LayeredIconGlyph, MergePdfFrontGlyph, RadialMinimizeIcon, TextCursorGlyph, type LayeredIconVariant } from '@/components/tools/layered-icons/LayeredIcon'
import styles from './QuantumCube.module.css'

type CubeTone = 'Convert' | 'Extract' | 'Ai' | 'Advanced' | 'Merge' | 'Rotate' | 'Compress'
type CubeIcon = { variant: LayeredIconVariant; tone: CubeTone; label: string }

const cubeIcons: Record<string, CubeIcon> = {
  markdown: { variant: 'pdf-to-markdown', tone: 'Convert', label: 'Mr. Markdown' },
  pdfToWord: { variant: 'pdf-to-word', tone: 'Convert', label: 'PDF to Word' },
  imageToPdf: { variant: 'image-to-pdf', tone: 'Convert', label: 'Images to PDF' },
  markdownToPdf: { variant: 'markdown-to-pdf', tone: 'Convert', label: 'Markdown to PDF' },
  analyzer: { variant: 'ai-analyzer', tone: 'Ai', label: 'AI Analyzer' },
  pdfToImages: { variant: 'pdf-to-images', tone: 'Convert', label: 'PDF to Images' },
  imageToText: { variant: 'image-to-text', tone: 'Extract', label: 'Image to Text' },
  batch: { variant: 'batch', tone: 'Advanced', label: 'Batch Process' },
  wordToPdf: { variant: 'word-to-pdf', tone: 'Convert', label: 'Word to PDF' },
  fasta: { variant: 'fasta-tool', tone: 'Advanced', label: 'FASTA Tools' },
  bijoy: { variant: 'bijoy-converter', tone: 'Extract', label: 'Bijoy to Unicode' },
  mergePdf: { variant: 'merge-pdf', tone: 'Merge', label: 'Merge PDF' },
  splitPdf: { variant: 'split-pdf', tone: 'Convert', label: 'Split PDF' },
  rotatePdf: { variant: 'rotate-pdf', tone: 'Rotate', label: 'Rotate PDF' },
  compressPdf: { variant: 'compress-pdf', tone: 'Compress', label: 'Compress PDF' },
}

const iconLabels: Record<LayeredIconVariant, ReactNode> = {
  'pdf-to-word': 'W',
  'pdf-to-markdown': 'M',
  'image-to-pdf': 'PDF',
  'ai-analyzer': 'AI',
  'pdf-to-images': 'IMG',
  'word-to-pdf': 'PDF',
  'markdown-to-pdf': 'PDF',
  'image-to-text': 'Aa',
  batch: 'ALL',
  'fasta-tool': 'DNA',
  'bijoy-converter': 'অ',
  'merge-pdf': <MergePdfFrontGlyph />,
  'split-pdf': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  'rotate-pdf': <AxisRotationIcon />,
  'compress-pdf': <RadialMinimizeIcon />,
  /* Not shown on the cube (cubeIcons has no entry); present so the exhaustive
     record stays exhaustive when the LayeredIconVariant union grows. */
  'pdf-editor': <TextCursorGlyph />,
}

/* Label-width sizing, decoupled from the tone (same rule as LayeredIcon). */
const iconFrontClass: Record<LayeredIconVariant, string> = {
  'pdf-to-word': styles.icon3dFrontMd,
  'pdf-to-markdown': styles.icon3dFrontLg,
  'image-to-pdf': styles.icon3dFrontSm,
  'ai-analyzer': styles.icon3dFrontMd,
  'pdf-to-images': styles.icon3dFrontSm,
  'word-to-pdf': styles.icon3dFrontSm,
  'markdown-to-pdf': styles.icon3dFrontSm,
  'image-to-text': styles.icon3dFrontMd,
  batch: styles.icon3dFrontSm,
  'fasta-tool': styles.icon3dFrontSm,
  'bijoy-converter': styles.icon3dFrontMd,
  'merge-pdf': styles.icon3dFrontIcon,
  'split-pdf': styles.icon3dFrontIcon,
  'rotate-pdf': styles.icon3dFrontIcon,
  'compress-pdf': styles.icon3dFrontIcon,
  'pdf-editor': styles.icon3dFrontIcon,
}

function CubeIcon({ icon }: { icon: CubeIcon }) {
  return <span className={`${styles.icon3d} ${styles[`tone${icon.tone}`]}`} role="img" aria-label={icon.label}><span className={styles.icon3dBack}><LayeredIconGlyph variant={icon.variant} /></span><span className={`${styles.icon3dFront} ${iconFrontClass[icon.variant]}`}>{iconLabels[icon.variant]}</span></span>
}

function Face({ className, icons = {}, hole = 5 }: { className: string; icons?: Record<number, CubeIcon>; hole?: number }) {
  return <div className={`${styles.face} ${className}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => { const position = index + 1; return <div className={`${styles.cubie}${position === hole ? ` ${styles.cubieHole}` : ''}`} key={position}>{icons[position] && <CubeIcon icon={icons[position]} />}</div> })}</div>
}

export default function QuantumCube() {
  const reference = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const element = reference.current
    if (!element || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => setPaused(!entry.isIntersecting), { threshold: 0.05 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <section ref={reference} className={`${styles.showcase}${paused ? ` ${styles.animPaused}` : ''}`} aria-label="Floating 3D tools cube"><div className={styles.glow} aria-hidden="true" /><div className={styles.stage}><div className={styles.scene}><div className={styles.cube}><div className={styles.core} aria-hidden="true"><Image className={styles.coreLogo} src="/quantum-core-octopus.png" alt="" width={58} height={58} priority /></div><Face className={styles.faceFront} icons={{ 2: cubeIcons.markdown, 4: cubeIcons.pdfToWord, 6: cubeIcons.imageToPdf, 8: cubeIcons.markdownToPdf }} /><Face className={styles.faceRight} icons={{ 3: cubeIcons.analyzer, 6: cubeIcons.pdfToImages }} /><Face className={styles.faceLeft} icons={{ 4: cubeIcons.imageToText }} /><Face className={styles.faceTop} icons={{ 6: cubeIcons.batch }} /><Face className={styles.faceBack} icons={{ 1: cubeIcons.wordToPdf }} /><Face className={styles.faceBottom} icons={{ 9: cubeIcons.fasta }} /></div></div></div></section>
}
