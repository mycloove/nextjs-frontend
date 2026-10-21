import type { ReactNode } from 'react'
import styles from './LayeredIcon.module.css'

export type LayeredIconVariant =
  | 'pdf-to-word'
  | 'pdf-to-markdown'
  | 'image-to-pdf'
  | 'ai-analyzer'
  | 'pdf-to-images'
  | 'word-to-pdf'
  | 'markdown-to-pdf'
  | 'image-to-text'
  | 'batch'
  | 'fasta-tool'
  | 'bijoy-converter'
  | 'merge-pdf'
  | 'split-pdf'
  | 'rotate-pdf'
  | 'compress-pdf'
  | 'pdf-editor'

type LayeredIconProps = {
  variant: LayeredIconVariant
  className?: string
}

function PdfOutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function ImageOutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

/* Images to PDF only: a stack of photo prints — the tool's actual input, many
   images — instead of the generic single-image glyph, which stays with Image
   to Text where one image is the whole story. */
function PhotoStackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2.5" width="13.5" height="13.5" rx="2.5" />
      <rect x="2.5" y="8" width="13.5" height="13.5" rx="2.5" />
      <circle cx="6.4" cy="12.6" r="1.3" />
      <path d="m4.6 21.5 3.3-3.5 2.3 2.3 1.8-1.8 3.5 3" />
    </svg>
  )
}

function DocumentSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <circle cx="10" cy="12" r="2.5" />
      <line x1="12" y1="14" x2="15" y2="17" />
    </svg>
  )
}

/* Word to PDF's rear glyph: the source, a Word page. The "W" is redrawn as a
   full-width monogram (x 7–17, y 11.3–18) with letter proportions — the three
   tops level, the two feet seated — and a hair-heavier stroke so it reads as
   the letter at the 18px render. The previous squat sawtooth (6 units wide,
   4 tall) collapsed to a scribble at that size. The page outline is shared with
   the PDF→Word rear by design: the two tools are mirrors and each front names
   its output format. */
function WordDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M7 11.3 9.4 18 12 11.3 14.6 18 17 11.3" strokeWidth="2.1" />
    </svg>
  )
}

function CodeBracketsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function StackedFilesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function DnaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4c0 4 8 8 8 16" />
      <path d="M16 4c0 4-8 8-8 16" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  )
}

function BengaliLetterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Stylized "অ" — the first Bengali letter, the tool's front glyph */}
      <circle cx="12" cy="13" r="5.5" />
      <line x1="6.5" y1="13" x2="17.5" y2="13" />
      <line x1="9" y1="4" x2="15" y2="4" />
    </svg>
  )
}

/* The four structural PDF tools each get a glyph of their own operation, not
   a shared "toolbox" mark: merge gathers four blocks under a central clamp, split parts
   one document into two whole sheets, rotate is the quarter-turn itself, compress
   is arrows pressing inward — the same one-operation-one-reading rule the sibling
   glyphs follow.
   All four are drawn against one hard constraint, so measure before redrawing:
   the rear tile renders its glyph at 18px, and the front tile (38px, bottom-right
   of the 56px group) opaquely masks the rear tile's bottom-right 20px. In viewBox
   units that hides everything past x > 10.7 AND y > 10.7, so a mark whose meaning
   lives in its bottom-right corner erases to a scratch on the card while looking
   perfect in isolation. 18px also caps the detail budget: one stroke weight, no
   feature thinner than ~3 units, and no dash pattern (a "2 3" dash is 1.5px of
   ink and renders as a grey smear). */
function ScatteredBlocksIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

export function MergePdfFrontGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" strokeWidth="3" />
      <path d="M12 5v14" strokeWidth="3" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* Split: the engine's output is N *whole* documents — splitPdf() copies whole
   page ranges into fresh PDFDocuments and never touches a page's content — so the
   mark is two congruent sheets parted along a page boundary, the extracted one
   stepped up and to the right. It is deliberately none of the three obvious
   answers:
   · Not the category default (sheet + dashed cut line + scissors, which is what
     stood here): that draws a page being severed through its middle, an operation
     this tool cannot perform, and its lower half — the entire second document —
     sits inside the masked quadrant, so the card showed a document top, a floating
     dotted line and a stub.
   · Not merge mirrored: a rightward fork puts both branches and the arrowhead in
     the masked quadrant.
   · Not the photo stack (Images to PDF): those rects overlap to say "stack";
     these are parted by a channel that is 3 units between stroke *edges* (5
     between centres at strokeWidth 2), which is 2.25px at 18px — wide enough that
     the gap stays open instead of closing into one grey bar.
   Geometry is measured against the mask: the left sheet's outer stroke ends at
   x 10.5, just inside the x 10.7 mask line, so the document that stays is fully
   visible; the extracted sheet keeps its whole 9-unit top edge and ~8.5 units of
   both legs above the y 10.7 line, so it reads as a second sheet passing behind
   the badge. Sheets are congruent because both outputs are equally real files,
   portrait at 7×13 because two of them plus the channel is what 24 units allows,
   and rx 1.5 rather than the siblings' 2/2.5 because a 7-unit-wide sheet with a
   2-unit radius reads as a pill at this size. The up-and-right departure is the
   same diagonal the two tiles themselves take on card hover. */
function SplitDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6" />
      <path d="M9 11h6" />
    </svg>
  )
}

function TiltedDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform="rotate(-15 12 12)">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </g>
    </svg>
  )
}

export function AxisRotationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function StandardDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

export function RadialMinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M4 4l4 4M4 8V4h4M20 4l-4 4M20 8V4h-4M4 20l4-4M4 16v4h4M20 20l-4-4M20 16v4h-4" />
    </svg>
  )
}

function ChaplinHatIcon() {
  return (
    <svg
      className={styles.chaplinHat}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 16c0-6.5 2.5-10 6-10s6 3.5 6 10" />
      <path d="M2 16s1.5 2.5 4 2.5h12c2.5 0 4-2.5 4-2.5" />
      <path d="M6 12c3 1.5 9 1.5 12 0" strokeWidth="2" />
    </svg>
  )
}

function ScissorsCutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

/* PDF Editor: the tool's first act is selecting a text run that is really in
   the file — selectOriginalTextBlock lifts exactly one native block — so the
   mark is a page with its top line bracketed by selection handles, the line
   below it passing behind the front badge the way Split's second sheet does.
   The pencil-on-paper "edit" mark was rejected outright: it sits unchanged on
   every editor on earth and names no operation this tool performs.
   Measured against the mask like its siblings: the handles span y 6.3–10.5 and
   the selected run sits at y 8.5, all inside the visible quadrant (everything
   past x > 10.7 AND y > 10.7 is hidden by the front tile), so the whole
   selection gesture survives the 18px render; the lower text line is the one
   deliberate loss — it reads as the document continuing behind the badge. */
function SelectedTextRunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <line x1="6" y1="8.5" x2="17" y2="8.5" />
      <line x1="6" y1="6.3" x2="6" y2="10.5" />
      <line x1="17" y1="6.3" x2="17" y2="10.5" />
      <line x1="6" y1="12.5" x2="12" y2="12.5" />
    </svg>
  )
}

/* PDF Editor's front glyph: the I-beam text cursor. It is the one universal
   mark whose meaning is "this text can be retyped" — the editor's flagship
   capability — and unlike merge's cross or split's blades it names an act, not
   a document state. The tool is not a format conversion, so like the four
   structural tools it wears a glyph on the front instead of an output-format
   letter. Exported (as Merge's/Rotate's/Compress's fronts are) so the Quantum
   Cube's exhaustive label record can carry it without a drawn-from-scratch
   duplicate. */
export function TextCursorGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="9" y1="4" x2="15" y2="4" />
      <line x1="9" y1="20" x2="15" y2="20" />
    </svg>
  )
}

/* One material, four signals: the tone class is the tool's capability group
   (matching the home card's --tool-accent family), never an arbitrary per-tool
   hue. frontSize follows the label's width, so sizing is not coupled to colour. */
const iconContent: Record<LayeredIconVariant, { tone: string; back: ReactNode; front: ReactNode; frontSize: string; label: string }> = {
  'pdf-to-word': { tone: styles.toneConvert, back: <PdfOutlineIcon />, front: 'W', frontSize: styles.frontMd, label: 'PDF to Word' },
  'pdf-to-markdown': {
    tone: styles.toneConvert,
    back: <ChaplinHatIcon />,
    front: 'M',
    frontSize: styles.frontLg,
    label: 'Mr. Markdown',
  },
  'image-to-pdf': { tone: styles.toneConvert, back: <ImageOutlineIcon />, front: 'PDF', frontSize: styles.frontSm, label: 'Images to PDF' },
  'ai-analyzer': { tone: styles.toneAi, back: <DocumentSearchIcon />, front: 'AI', frontSize: styles.frontMd, label: 'AI Analyzer' },
  'pdf-to-images': { tone: styles.toneConvert, back: <PdfOutlineIcon />, front: 'IMG', frontSize: styles.frontSm, label: 'PDF to Images' },
  'word-to-pdf': { tone: styles.toneWord, back: <WordDocumentIcon />, front: 'PDF', frontSize: styles.frontSm, label: 'Word to PDF' },
  'markdown-to-pdf': { tone: styles.toneConvert, back: <CodeBracketsIcon />, front: 'PDF', frontSize: styles.frontSm, label: 'Markdown to PDF' },
  'image-to-text': { tone: styles.toneExtract, back: <ImageOutlineIcon />, front: 'Aa', frontSize: styles.frontMd, label: 'Image to Text' },
  batch: { tone: styles.toneAdvanced, back: <StackedFilesIcon />, front: 'ALL', frontSize: styles.frontSm, label: 'Batch Process' },
  'fasta-tool': { tone: styles.toneFasta, back: <DnaIcon />, front: 'DNA', frontSize: styles.frontSm, label: 'FASTA Tools' },
  'bijoy-converter': { tone: styles.toneExtract, back: <BengaliLetterIcon />, front: 'অ', frontSize: styles.frontMd, label: 'Bijoy to Unicode' },
  'merge-pdf': { tone: styles.toneMerge, back: <ScatteredBlocksIcon />, front: <MergePdfFrontGlyph />, frontSize: styles.frontIcon, label: 'Merge PDF' },
  'split-pdf': { tone: styles.toneSplit, back: <SplitDocumentIcon />, front: <ScissorsCutIcon />, frontSize: styles.frontIcon, label: 'Split PDF' },
  'rotate-pdf': { tone: styles.toneRotate, back: <TiltedDocumentIcon />, front: <AxisRotationIcon />, frontSize: styles.frontIcon, label: 'Rotate PDF' },
  'compress-pdf': { tone: styles.toneCompress, back: <StandardDocumentIcon />, front: <RadialMinimizeIcon />, frontSize: styles.frontIcon, label: 'Compress PDF' },
  'pdf-editor': { tone: styles.toneAdvanced, back: <SelectedTextRunIcon />, front: <TextCursorGlyph />, frontSize: styles.frontIcon, label: 'PDF Editor' },
}

export function LayeredIconGlyph({ variant }: Pick<LayeredIconProps, 'variant'>) {
  return <>{iconContent[variant].back}</>
}

export default function LayeredIcon({ variant, className = '' }: LayeredIconProps) {
  const content = iconContent[variant]

  return (
    <span className={`${styles.group} ${content.tone} ${className}`.trim()} role="img" aria-label={content.label}>
      <span className={`${styles.tile} ${styles.back}`}>{content.back}</span>
      <span className={`${styles.tile} ${styles.front} ${content.frontSize}`}>{content.front}</span>
    </span>
  )
}
