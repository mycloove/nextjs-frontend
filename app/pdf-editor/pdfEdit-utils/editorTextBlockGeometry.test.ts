import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveTextBlockGeometry,
  documentFontSize,
  MIN_TEXT_BLOCK_EXTENT,
  MIN_TEXT_BLOCK_FONT_SIZE,
} from './editorTextBlockGeometry.ts';

/**
 * A PDF.js device transform for horizontal text of `size` at (`x`, baseline `y`).
 * `[a, b, c, d, e, f]` with the vertical scale in `d`, which is what
 * `Math.hypot(b, d)` reads as the font size.
 */
function transformAt(size: number, x: number, baselineY: number): number[] {
  return [size, 0, 0, size, x, baselineY];
}

test('the rectangle tracks the reported glyph extents, with no floor applied', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'Invoice total', width: 64.5, height: 9 },
    transformAt(9, 72, 700),
    1,
  );

  assert.equal(geometry.width, 64.5);
  // The em-box top quarter is inset: that region is where the previous line's
  // descenders land, and covering it makes the engine refuse the whole edit.
  assert.equal(geometry.height, 9 * 0.75);
  assert.equal(geometry.x, 72);
  assert.equal(geometry.y, 700 - 9 + 9 * 0.25);
});

test('a 9pt line does not reach the lines above or below it (D-C regression)', () => {
  // 9pt type on 11pt leading — ordinary body text, and the case the old
  // `Math.max(12, …)` floor broke: a 12pt-tall box overlapped its neighbours,
  // the engine's unnamed-text guard reported their glyphs, and the atomic
  // transaction refused the entire export. The ascent-line inset is what keeps
  // a solid-set (leading == em) document's descenders out of the box above.
  const leading = 9; // solid set: leading equals the em box exactly
  const middleBaseline = 700;
  // The viewport transform already points y downwards, so the preceding line
  // has the *smaller* baseline value.
  const lines = [middleBaseline - leading, middleBaseline, middleBaseline + leading]
    .map((baselineY) => deriveTextBlockGeometry(
      { str: 'body text', width: 48, height: 9 },
      transformAt(9, 72, baselineY),
      1,
    ));

  const [above, middle, below] = lines;
  assert.ok(
    above.y + above.height <= middle.y,
    `box for the line above ends at ${above.y + above.height}, overlapping ${middle.y}`,
  );
  assert.ok(
    middle.y + middle.height <= below.y,
    `box for the edited line ends at ${middle.y + middle.height}, overlapping ${below.y}`,
  );
});

test('the display font-size floor never widens the redaction rectangle', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'fine print', width: 22, height: 6 },
    transformAt(6, 40, 300),
    1,
  );

  // The control is drawn at a legible size...
  assert.equal(geometry.fontSize, MIN_TEXT_BLOCK_FONT_SIZE);
  // ...but the rectangle the engine redacts stays within the true 6pt extent.
  assert.equal(geometry.height, 6 * 0.75);
  assert.equal(geometry.y, 300 - 6 + 6 * 0.25);
});

test('a viewport zoom scales the whole rectangle, origin and extents alike', () => {
  // The contract with `getTextBlocks`, and the one that was broken: PDF.js
  // reports `item.width`/`item.height` in text-space points at every scale —
  // `getTextContent()` never sees a viewport — while the composed transform
  // carries the viewport's. So the caller must hand its viewport scale to this
  // function as `zoom`, or the block comes back with a zoomed origin and point
  // extents: at Fit width the control kept its 100% width while its text grew
  // with the zoom, so a one-line span wrapped inside a box too narrow to cover
  // the glyphs it hides, and `y` (baseline − height) sat low by the same gap.
  //
  // Same item at every zoom — that is the part PDF.js does not scale.
  const item = { str: 'Phase 1E searchable source text', width: 264.1, height: 18 };
  const base = deriveTextBlockGeometry(item, transformAt(18, 72, 96), 1);

  for (const zoom of [0.4, 0.6, 1.6, 3]) {
    const scaled = deriveTextBlockGeometry(
      item,
      // What `Util.transform(viewport.transform, item.transform)` yields at this
      // scale: the size and the origin are multiplied, the item is untouched.
      transformAt(18 * zoom, 72 * zoom, 96 * zoom),
      zoom,
    );

    for (const field of ['x', 'y', 'width', 'height', 'sourceFontSize'] as const) {
      assert.ok(
        Math.abs(scaled[field] - base[field] * zoom) < 1e-9,
        `zoom ${zoom}: ${field} is ${scaled[field]}, expected ${base[field] * zoom}`,
      );
    }
  }
});

test('sourceFontSize reports the document size, floor-free', () => {
  // `fontSize` carries a legibility floor for the control that is drawn; the
  // number that gets *stored* — seeding the edit record and travelling to the
  // engine as `sourceFontSize` — must be the size the document actually sets,
  // or a 6pt line comes back re-rendered at 8pt without anyone asking.
  const geometry = deriveTextBlockGeometry(
    { str: 'fine print', width: 22, height: 6 },
    transformAt(6, 40, 300),
    1,
  );

  assert.equal(geometry.sourceFontSize, 6);
  assert.equal(geometry.fontSize, MIN_TEXT_BLOCK_FONT_SIZE);
  assert.ok(geometry.sourceFontSize < geometry.fontSize);
});

test('sourceFontSize carries the zoom of the transform it was read from', () => {
  // It is in the transform's own space, so a caller reading blocks at a display
  // zoom divides by that zoom to get points. Callers that store the value rely
  // on this being a plain multiple — nothing else in the field is scale-aware.
  for (const zoom of [0.4, 0.6, 1, 1.6, 3]) {
    const geometry = deriveTextBlockGeometry(
      { str: 'body text', width: 80 * zoom, height: 11 * zoom },
      transformAt(11 * zoom, 72 * zoom, 300 * zoom),
      1,
    );
    assert.ok(
      Math.abs(geometry.sourceFontSize / zoom - 11) < 1e-9,
      `zoom ${zoom}: normalised to ${geometry.sourceFontSize / zoom}, expected 11`,
    );
  }
});

test('zoom scales the extents without changing the transform-derived origin', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'Heading', width: 50, height: 10 },
    transformAt(20, 100, 500),
    2,
  );

  assert.equal(geometry.width, 100);
  assert.equal(geometry.height, 20 * 0.75);
  assert.equal(geometry.x, 100);
  assert.equal(geometry.y, 500 - 20 + 20 * 0.25);
  // Read off the transform, which already carries the zoom.
  assert.equal(geometry.fontSize, 20);
});

test('callers with a zoomed transform must not apply zoom a second time', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'Heading', width: 50, height: 10 },
    transformAt(20, 100, 500),
    1,
  );

  assert.equal(geometry.width, 50);
  assert.equal(geometry.height, 10 * 0.75);
  assert.equal(geometry.x, 100);
  assert.equal(geometry.y, 500 - 10 + 10 * 0.25);
});

test('a page rotated 90 degrees puts the box on the rotated glyphs', () => {
  // Real values from a page with `/Rotate 90`: the composed basis is
  // `[0, 14, 14, 0]`, so the run advances down the page and its ascent points
  // right. The old horizontal-only formula placed this box at x=520 with a
  // 169pt width, i.e. outside the 595pt-wide page - the click target and the
  // redaction rectangle both missed the text.
  const geometry = deriveTextBlockGeometry(
    { str: 'Phase 1E rotated page text', width: 169.666, height: 14 },
    [0, 14, 14, 0, 520, 48],
    1,
  );

  assert.equal(geometry.x, 520);
  assert.equal(geometry.y, 48);
  // Ascent is 0.75em to the right; the advance runs 169.666pt down.
  assert.ok(Math.abs(geometry.width - 14 * 0.75) < 1e-9);
  assert.ok(Math.abs(geometry.height - 169.666) < 1e-9);
  assert.equal(geometry.sourceFontSize, 14);
});

test('a rotated box scales with the viewport exactly once', () => {
  const base = deriveTextBlockGeometry(
    { str: 'rotated', width: 120, height: 10 },
    [0, 10, 10, 0, 200, 80],
    1,
  );
  const zoom = 2;
  const scaled = deriveTextBlockGeometry(
    { str: 'rotated', width: 120, height: 10 },
    [0, 10 * zoom, 10 * zoom, 0, 200 * zoom, 80 * zoom],
    zoom,
  );

  for (const field of ['x', 'y', 'width', 'height', 'sourceFontSize'] as const) {
    assert.ok(
      Math.abs(scaled[field] - base[field] * zoom) < 1e-9,
      `${field} is ${scaled[field]}, expected ${base[field] * zoom}`,
    );
  }
});

test('missing extents fall back to estimates from the transform scale', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'abcd' },
    transformAt(10, 0, 100),
    1,
  );

  assert.equal(geometry.width, 4 * 10 * 0.5);
  assert.equal(geometry.height, 10 * 1.2 * 0.75);
});

test('a scaleless transform falls back to the reported height, then to 12pt', () => {
  const fromHeight = deriveTextBlockGeometry(
    { str: 'x', height: 7 },
    [0, 0, 0, 0, 5, 50],
    1,
  );
  assert.equal(fromHeight.height, 7 * 0.75);
  assert.equal(fromHeight.fontSize, MIN_TEXT_BLOCK_FONT_SIZE);

  const fromNothing = deriveTextBlockGeometry({ str: 'x' }, [0, 0, 0, 0, 5, 50], 1);
  assert.equal(fromNothing.fontSize, 12);
  assert.equal(fromNothing.height, 12 * 1.2 * 0.75);
});

test('a degenerate width is clamped to a non-empty rectangle, not to zero', () => {
  // A zero-area rect would match no glyphs, so the engine would refuse the edit
  // from the other direction. The floor is the smallest side that still
  // encloses its own text.
  const geometry = deriveTextBlockGeometry(
    { str: '', width: 0, height: 0 },
    [0, 0, 0, 0, 10, 10],
    1,
  );

  assert.equal(geometry.width, MIN_TEXT_BLOCK_EXTENT);
  assert.ok(MIN_TEXT_BLOCK_EXTENT > 0);
  // Height has no degenerate case: with nothing reported it estimates from the
  // size, and the size itself falls back to a positive default.
  assert.ok(geometry.height > 0);
});

test('non-finite reported extents are treated as absent, never propagated', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'ab', width: Number.NaN, height: Number.POSITIVE_INFINITY },
    transformAt(10, 0, 100),
    Number.NaN,
  );

  assert.ok(Number.isFinite(geometry.width));
  assert.ok(Number.isFinite(geometry.height));
  assert.ok(Number.isFinite(geometry.x));
  assert.ok(Number.isFinite(geometry.y));
  // zoom NaN degrades to 1 rather than producing a NaN rectangle.
  assert.equal(geometry.width, 2 * 10 * 0.5);
});

// --------------------------------------------------------------------------- //
// The point size a record may store
// --------------------------------------------------------------------------- //

test('the same run yields one point size at every zoom the editor offers', () => {
  // The phantom-edit regression, at its source. `sourceFontSize` is read in the
  // space of the viewport it came from, so the caller divides by that scale —
  // and a plain division leaves the last bits of the quotient depending on the
  // zoom. A record seeded at Fit width then held `5.999999999999999` for a line
  // the export path reads as `6`, `isEffectiveTextEdit` called that a size
  // change, and every untouched line on the page went to the engine as an edit.
  const POINTS = 6;
  const sizes = new Set<number>();
  // 0.4 and 3 are the zoom limits; the awkward ones are real fit-mode scales.
  for (const zoom of [0.4, 0.6, 1, 1.0989010989010988, 1.4642857142857142, 1.6, 3]) {
    // What `getTextBlocks` passes: the size as read at that scale.
    sizes.add(documentFontSize({ sourceFontSize: POINTS * zoom, zoom }));
  }

  assert.deepEqual([...sizes], [POINTS], 'the point size moved with the zoom');
});

test('quantising does not move a size a document can actually state', () => {
  for (const size of [6, 6.5, 8, 9, 10.5, 11, 12, 14.4, 18, 24, 72]) {
    assert.equal(documentFontSize({ sourceFontSize: size, zoom: 1 }), size);
    // And the same size read at a non-integer scale still comes back exactly.
    assert.equal(documentFontSize({ sourceFontSize: size * 1.6, zoom: 1.6 }), size);
  }
});

test('a degenerate scale or size yields a usable point size, never NaN', () => {
  for (const input of [
    { sourceFontSize: 12, zoom: 0 },
    { sourceFontSize: 12, zoom: Number.NaN },
    { sourceFontSize: 12, zoom: -2 },
    { sourceFontSize: 0, zoom: 1 },
    { sourceFontSize: Number.NaN, zoom: 1 },
    { sourceFontSize: Number.POSITIVE_INFINITY, zoom: Number.NaN },
  ]) {
    const size = documentFontSize(input);
    assert.ok(Number.isFinite(size), `not finite for ${JSON.stringify(input)}`);
    assert.ok(size > 0, `not positive for ${JSON.stringify(input)}`);
  }
  // A missing scale means "already points", not "divide by nothing".
  assert.equal(documentFontSize({ sourceFontSize: 9, zoom: 0 }), 9);
});

test('the font box covers ascent and descent without reaching the next line', () => {
  // Solid-set 9pt type: the font box is exactly one em tall and its bottom
  // meets the next line's top. No part of a neighbour is included.
  const lines = [691, 700, 709].map(baselineY => deriveTextBlockGeometry(
    { str: 'body text', width: 48, height: 9 },
    transformAt(9, 72, baselineY),
    1,
    { ascent: 0.75, descent: 0.25 },
  ));
  const [above, middle, below] = lines;

  assert.ok(middle.fontBox.height > middle.height, 'the font box must include the descent');
  assert.ok(middle.fontBox.y < middle.y + 1e-9, 'the font box must not start below the ink top');
  assert.ok(
    middle.fontBox.y + middle.fontBox.height > middle.y + middle.height,
    'the font box must cover the descender space below the baseline',
  );
  assert.ok(
    above.fontBox.y + above.fontBox.height <= middle.fontBox.y + 1e-9,
    'the line above must not be covered',
  );
  assert.ok(
    middle.fontBox.y + middle.fontBox.height <= below.fontBox.y + 1e-9,
    'the line below must not be covered',
  );
});

test('a rotated run font box expands across the line, not along it', () => {
  const geometry = deriveTextBlockGeometry(
    { str: 'Phase 1E rotated page text', width: 169.666, height: 14 },
    [0, 14, 14, 0, 520, 48],
    1,
    { ascent: 0.718, descent: 0.207 },
  );

  assert.ok(geometry.fontBox.width > geometry.width, 'the descent must widen the band');
  assert.ok(Math.abs(geometry.fontBox.height - geometry.height) < 1e-9);
  assert.ok(geometry.fontBox.x < geometry.x);
});
