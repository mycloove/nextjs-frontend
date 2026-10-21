/* ── Markdown Merge — result-edit resolution ───────────────────────────────
   The collated result is derived from the sources and the options, so a manual
   edit can only ever be an *overlay* on top of it, never the source of truth.
   This module is the one pure place that decides what the user actually gets:
   the overlay when present, the generated text otherwise — plus whether the
   overlay has fallen behind a change to the inputs. No imports, no state, no
   React: unit-testable like the engine (CLAUDE.md §5). */

export interface ResultEditState {
  /** The freshly generated collation. */
  generated: string
  /** The user's manual output, or `null` when they have not edited. */
  edited: string | null
  /** The generated text captured when editing began; `null` when untouched. */
  base: string | null
}

export interface ResultOutput {
  /** What Create/Copy must use: the overlay, else the generated text. */
  output: string
  /** True once a manual overlay exists. */
  edited: boolean
  /** True when the inputs have moved on since the overlay was captured. */
  stale: boolean
}

export function resolveResultOutput(state: ResultEditState): ResultOutput {
  const edited = state.edited !== null
  const stale = edited && state.base !== null && state.base !== state.generated
  return { output: state.edited ?? state.generated, edited, stale }
}
