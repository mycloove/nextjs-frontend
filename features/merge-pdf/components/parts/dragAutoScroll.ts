/**
 * Horizontal auto-scroll for the arrange strip.
 *
 * A long merged stack overflows the strip, but native HTML5 drag never scrolls
 * it — so a sheet could only be dropped against a page already on screen. While
 * a sheet is dragged we scroll the strip ourselves whenever the pointer nears
 * either edge, which lets page 2 be dropped against page 40 without scrolling
 * there by hand first.
 *
 * The feel is a pure function of the pointer and the strip's box, so it is
 * testable without a DOM: velocity ramps linearly from 0 at the zone boundary to
 * `maxSpeed` at (or past) the edge.
 *
 * Returns px-per-frame: negative scrolls left, positive scrolls right, and 0 in
 * the neutral middle band where no scrolling should happen.
 */
export function computeAutoScrollVelocity(
  clientX: number,
  rect: { left: number; right: number },
  maxSpeed: number,
  edgeZone: number
): number {
  if (rect.right <= rect.left || edgeZone <= 0 || maxSpeed <= 0) return 0

  const fromLeft = clientX - rect.left
  const fromRight = rect.right - clientX

  /* When the strip is narrower than two edge zones the zones overlap; the
     nearer edge wins so the direction stays unambiguous. */
  if (fromLeft < edgeZone && fromLeft <= fromRight) {
    return -maxSpeed * clamp01((edgeZone - fromLeft) / edgeZone)
  }
  if (fromRight < edgeZone) {
    return maxSpeed * clamp01((edgeZone - fromRight) / edgeZone)
  }
  return 0
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
