/**
 * Shared tool kit (roadmap §6, Phase 2) — Tier-2 shared code under
 * components/tools/. A tool depends only on these exports and on its own
 * registry entry (`accepts` / `limits`), never on another tool's internals.
 *
 * Consumers (keep current — this is the blast radius of a kit change):
 *   - features/compress-pdf (pilot, 2026-11-06): intake rules + limits,
 *     drop/paste, picker, file chip, options, progress, notice, receipt, button
 *   - features/rotate-pdf (Wave A, 2026-11-06): intake rules + limits,
 *     drop/paste, file chip + picker, PageThumb, PageRangeField, progress,
 *     notice, receipt, Dialog (confirm), button
 *   - features/split-pdf (Wave A, 2026-11-06): intake rules + limits,
 *     progress, Dialog (confirm), button
 *   - The Intake component itself, PageGrid / PageLightbox / Toast: no
 *     consumer today (Compress and Rotate keep their own drop targets, D8).
 *
 * Each tool keeps its own palette (owner decision D8): a host dresses the kit
 * by setting --kit-accent / -accent-hover / -on-accent / -accent-subtle /
 * -focus-ring and --kit-surface / -line / -line-strong / -text / -muted /
 * -hover on its root; unset hooks fall back to the global --mc-* tokens.
 */
export { ActionButton } from './ActionButton'
export { DropAnywhere, Intake, useFilePicker } from './Intake'
export { FileChip } from './FileChip'
export { OptionGroup, type Option } from './OptionGroup'
export { HonestProgress } from './HonestProgress'
export { Notice, NoticeList, type NoticeTone } from './Notice'
export { Receipt, type ReceiptFact } from './Receipt'
export { PageGrid, PageRangeField } from './PageGrid'
export { PageThumb } from './PageThumb'
export { PageLightbox } from './PageLightbox'
export { Dialog } from './Dialog'
export { ToastRegion, useToasts } from './Toast'
export { DownloadIcon } from './icons'
export { describeSelection, selectionToRange, type PageSet } from './pageSelection'
export type { Toast, ToastTone } from './toastRules'
export {
  acceptsLabel,
  describeLimits,
  formatBytes,
  validateIntake,
  type IntakeRejection,
  type IntakeSpec,
} from './intakeRules'
