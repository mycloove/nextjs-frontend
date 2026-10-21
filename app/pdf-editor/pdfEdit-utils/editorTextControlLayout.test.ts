import assert from 'node:assert/strict';
import test from 'node:test';

import {
  layoutPdfEditorTextControl,
  resizedTextControlExtent,
  MIN_TEXT_CONTROL_EXTENT,
  MIN_TEXT_CONTROL_FONT_SIZE,
  PDF_EDITOR_TEXT_CONTROL_CHROME as CHROME,
} from './editorTextControlLayout.ts';

/**
 * What these tests are for
 * -----------------------
 * The bug they pin down was reported as "at Fit page / Fit width / Actual size
 * the rectangles go outside the PDF and the text is not properly visible". Both
 * halves were arithmetic, and neither was provable from the component: the
 * control's box came from the glyph rect with absolute CSS minimums bolted on
 * (`minHeight: 18` on a page scaled to 60%, plus a `<textarea>`'s default two
 * rows), and nothing in the pipeline ever compared the result against the page
 * it was drawn on.
 *
 * So every test below is one of the three invariants stated in the module
 * header, checked at real zoom levels rather than at 1 — which is exactly why
 * the defect shipped: at Actual size the arithmetic happens to be correct.
 */

const CHROME_X = 2 * (CHROME.borderWidth + CHROME.paddingX);
const CHROME_Y = 2 * (CHROME.borderWidth + CHROME.paddingY);

/** A4 at a given zoom, in CSS pixels — the page the controls must stay inside. */
function a4At(zoom: number) {
  return { width: 595.28 * zoom, height: 841.89 * zoom };
}

/**
 * One line of `points`pt text rendered at `zoom`, as `getTextBlocks` reports it.
 *
 * `height` is 0.75 em because `deriveTextBlockGeometry` insets the em box's top
 * quarter: that region is where the previous line's descenders land, and
 * covering it makes the engine refuse the whole export. The control therefore
 * always has to grow past the glyph rect to show a line — the point of the
 * layout function is that it grows *inside the page*.
 */
function lineAt(points: number, zoom: number, x: number, baselineY: number) {
  const em = points * zoom;
  return {
    x,
    y: baselineY - em + em * 0.25,
    width: points * 0.5 * 10 * zoom,
    height: em * 0.75,
  };
}

function layoutLine(points: number, zoom: number, x: number, baselineY: number) {
  return layoutPdfEditorTextControl({
    block: lineAt(points, zoom, x, baselineY),
    fontSize: points * zoom,
    lineHeight: 1.15,
    page: a4At(zoom),
  });
}

function atLeast(actual: number, expected: number, message: string) {
  assert.ok(actual >= expected - 1e-6, `${message}: ${actual} < ${expected}`);
}

function atMost(actual: number, expected: number, message: string) {
  assert.ok(actual <= expected + 1e-6, `${message}: ${actual} > ${expected}`);
}

// --------------------------------------------------------------------------- //
// Invariant 1: the control never leaves the page
// --------------------------------------------------------------------------- //

test('the last line on the page keeps its control inside the page', () => {
  // The reported symptom. A 10pt line whose baseline sits 6px above the bottom
  // margin: the glyph rect fits, but a control tall enough to show the line
  // does not, so an unclamped layout hangs off the paper.
  const zoom = 0.6;
  const page = a4At(zoom);
  const layout = layoutLine(10, zoom, 72 * zoom, page.height - 2);

  atMost(layout.top + layout.height, page.height, 'control crosses the bottom edge');
  atLeast(layout.top, 0, 'control crosses the top edge');
});

test('a narrow span at the right margin keeps its control inside the page', () => {
  // A one-character run 3px wide is widened to the pointer minimum. Against the
  // right margin that widening is what pushes it off the page.
  const zoom = 1;
  const page = a4At(zoom);
  const layout = layoutPdfEditorTextControl({
    block: { x: page.width - 3, y: 100, width: 3, height: 7.5 },
    fontSize: 10,
    lineHeight: 1.15,
    page,
  });

  atLeast(layout.width, MIN_TEXT_CONTROL_EXTENT, 'control is too small to click');
  atMost(layout.left + layout.width, page.width, 'control crosses the right edge');
  assert.ok(layout.left < page.width - 3, 'control was not moved back onto the page');
});

test('no fit mode lets a control escape the page, at any size', () => {
  // Fit page, Fit width and Actual size differ only by the zoom they set, so
  // the modes are covered by covering their zoom range. Both extremes of the
  // clamp are exercised: the far corner and the origin.
  for (const zoom of [0.4, 0.6, 1, 1.6, 3]) {
    const page = a4At(zoom);
    for (const points of [6, 9, 10, 14, 24]) {
      for (const [x, baseline] of [
        [0, points * zoom],
        [72 * zoom, 400 * zoom],
        [page.width - 1, page.height - 1],
      ] as const) {
        const layout = layoutLine(points, zoom, x, baseline);
        const where = `${points}pt at zoom ${zoom}, origin (${x}, ${baseline})`;
        atLeast(layout.left, 0, `left off page — ${where}`);
        atLeast(layout.top, 0, `top off page — ${where}`);
        atMost(layout.left + layout.width, page.width, `right off page — ${where}`);
        atMost(layout.top + layout.height, page.height, `bottom off page — ${where}`);
      }
    }
  }
});

test('a span wider than the page is clamped to the page, not overflowed', () => {
  const page = a4At(1);
  const layout = layoutPdfEditorTextControl({
    block: { x: 40, y: 60, width: page.width * 2, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    page,
  });

  assert.equal(layout.width, page.width);
  assert.equal(layout.left, 0);
});

test('the room a control may grow into stops at the page edge', () => {
  // `maxWidth`/`maxHeight` are the ceiling the component puts on growth, so they
  // are the last thing between a long replacement and a control lying on the
  // workspace background.
  const zoom = 1.6;
  const page = a4At(zoom);
  for (const baseline of [40, 400, page.height - 2]) {
    const layout = layoutLine(11, zoom, 300, baseline);
    atMost(layout.left + layout.maxWidth, page.width, 'maxWidth allows a drag off the page');
    atMost(layout.top + layout.maxHeight, page.height, 'maxHeight allows a drag off the page');
    atLeast(layout.maxWidth, layout.width, 'maxWidth below the control width');
    atLeast(layout.maxHeight, layout.height, 'maxHeight below the control height');
  }
});

// --------------------------------------------------------------------------- //
// Invariant 2: the text is never clipped
// --------------------------------------------------------------------------- //

test('one line of the rendered font always fits inside the control', () => {
  // `overflow` on the control means a box shorter than its own line box hides
  // the text the user came to edit. This is the "text properly visible" half of
  // the report, and it has to hold at every zoom, not just at Actual size.
  for (const zoom of [0.4, 0.6, 1, 1.6, 3]) {
    for (const points of [6, 8, 10, 12, 18, 32]) {
      const layout = layoutLine(points, zoom, 72 * zoom, 300 * zoom);
      atLeast(
        layout.height - CHROME_Y,
        layout.fontSize * 1.15,
        `${points}pt at zoom ${zoom} clips its own line`,
      );
    }
  }
});

test('the control never shrinks below the glyph rectangle it stands on', () => {
  // Shrinking to fit would cover only part of the run being edited, so the user
  // would be typing into a box narrower than the text it replaces.
  const zoom = 0.6;
  const block = lineAt(10, zoom, 72 * zoom, 300 * zoom);
  const layout = layoutPdfEditorTextControl({
    block,
    fontSize: 10 * zoom,
    lineHeight: 1.15,
    page: a4At(zoom),
  });

  atLeast(layout.width, block.width, 'control narrower than its glyphs');
  atLeast(layout.height, block.height, 'control shorter than its glyphs');
});

test('a taller line-height is honoured rather than clipped', () => {
  const layout = layoutPdfEditorTextControl({
    block: { x: 10, y: 10, width: 200, height: 9 },
    fontSize: 12,
    lineHeight: 2,
    page: a4At(1),
  });

  atLeast(layout.height - CHROME_Y, 12 * 2, 'double leading is clipped');
});

test('a page too small for one line shrinks the font instead of hiding it', () => {
  // Last resort, and the only case where the font gives way. Invisible text in
  // a text editor is never the better failure.
  const layout = layoutPdfEditorTextControl({
    block: { x: 0, y: 0, width: 18, height: 4 },
    fontSize: 20,
    lineHeight: 1.15,
    page: { width: 20, height: 5 },
  });

  assert.equal(layout.height, 5);
  assert.ok(layout.fontSize < 20, 'font was not reduced to fit the page');
  assert.ok(layout.fontSize >= MIN_TEXT_CONTROL_FONT_SIZE);
  atLeast(layout.height - CHROME_Y, layout.fontSize * 1.15, 'still clips after shrinking');
});

// --------------------------------------------------------------------------- //
// Invariant 3: zoom is applied exactly once
// --------------------------------------------------------------------------- //

test('the caller-supplied size is rendered as given, never re-scaled', () => {
  // The defect this replaces multiplied by zoom a second time here, because the
  // record it read from already held a zoomed value: the box grew by zoom and
  // its glyphs by zoom², so Fit width clipped and Fit page shrank to nothing.
  for (const fontSize of [4, 6, 10, 16, 48]) {
    const layout = layoutPdfEditorTextControl({
      block: { x: 20, y: 20, width: 300, height: fontSize * 0.75 },
      fontSize,
      lineHeight: 1.15,
      page: a4At(3),
    });
    assert.equal(layout.fontSize, fontSize);
  }
});

test('a control does not tower over the line pitch the way two rows did', () => {
  // A `<textarea>` with no `rows` is two lines tall, so every control used to be
  // roughly twice its line pitch — overlapping its neighbours everywhere and
  // running off the bottom of the page on the last line. One line plus the
  // hairline border stays within a quarter of the pitch.
  const zoom = 1;
  const pitch = 14;
  const layout = layoutLine(12, zoom, 72, 300);
  atMost(layout.height, pitch * 1.25, 'control is taller than its line pitch allows');
});

test('the same line is a proportionally identical control at every zoom', () => {
  // The whole point of Fit page / Fit width / Actual size is that they show the
  // *same* document larger or smaller. So a span's control must be the zoom
  // multiple of itself: same place on the page, same size relative to the page,
  // same number of lines. This is the layout half of that guarantee: given a
  // block and a font size that both carry the zoom, nothing in here reintroduces
  // it or drops it. The other half — that the block really does carry the zoom on
  // both axes — is `editorTextBlockGeometry.test.ts`'s rectangle-scaling test,
  // and it is the half that was broken: a box that kept its 100% width while its
  // text grew is how a one-line span came to wrap at Fit width.
  // 24pt, so the pointer minimum never binds: it is an absolute pixel floor and
  // therefore the one deliberate exception to proportionality — see the next
  // test, which pins exactly how far it may deviate.
  const base = layoutLine(24, 1, 72, 300);

  for (const zoom of [0.4, 0.6, 1.6, 3]) {
    const scaled = layoutLine(24, zoom, 72 * zoom, 300 * zoom);
    for (const field of ['left', 'top', 'width', 'height', 'fontSize'] as const) {
      assert.ok(
        Math.abs(scaled[field] - base[field] * zoom) < 1e-6,
        `zoom ${zoom}: ${field} is ${scaled[field]}, expected ${base[field] * zoom}`,
      );
    }
    // Same text at the same relative size in the same relative box: the browser
    // wraps it the same way, so the room for lines has to scale too.
    assert.ok(
      Math.abs((scaled.height - CHROME_Y) / scaled.fontSize
        - (base.height - CHROME_Y) / base.fontSize) < 1e-3,
      `zoom ${zoom}: the box holds a different number of lines than at 100%`,
    );
  }
});

test('the pointer minimum is the only thing that may break that proportion', () => {
  // 6pt body text at Fit page is a ~3px line box — unclickable. The floor lifts
  // it to 6px, and that is the whole permitted deviation: never smaller than the
  // proportional size, never more than the floor bigger than it. Anything else
  // here would be an unaccounted-for constant, and constants are what stop a
  // control from tracking the page it is drawn on.
  const base = layoutLine(6, 1, 72, 300);

  for (const zoom of [0.4, 0.6]) {
    const scaled = layoutLine(6, zoom, 72 * zoom, 300 * zoom);
    atLeast(scaled.height, Math.min(base.height * zoom, MIN_TEXT_CONTROL_EXTENT),
      `zoom ${zoom}: shrank below its own proportion`);
    atMost(scaled.height, Math.max(base.height * zoom, MIN_TEXT_CONTROL_EXTENT),
      `zoom ${zoom}: taller than the pointer minimum explains`);
  }
});

test('the original run gets the width its substitute font needs', () => {
  // The document's own font set this run 200 wide; Helvetica needs 214 for the
  // same string. Leave the box at 200 and the line wraps — one line of the
  // document drawn as two, in a box twice as tall as its neighbours.
  const page = a4At(1);
  const layout = layoutPdfEditorTextControl({
    block: { x: 72, y: 300, width: 200, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    contentWidth: 214,
    page,
  });

  atLeast(layout.width - CHROME_X, 214, 'the run does not fit on one line');
  atMost(layout.height, 12 * 1.15 + CHROME_Y + 1e-6, 'the box is more than one line tall');
  assert.equal(layout.left, 72, 'the box moved off its glyphs');
});

test('a substitute font wider than the page cannot push the box off it', () => {
  const page = a4At(1);
  const layout = layoutPdfEditorTextControl({
    block: { x: page.width - 120, y: 300, width: 100, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    contentWidth: 4000,
    page,
  });

  atMost(layout.width, page.width, 'wider than the page');
  atMost(layout.left + layout.width, page.width, 'ran off the right edge');
  atLeast(layout.left, 0, 'ran off the left edge');
});

test('a narrower substitute font never shrinks the box below its glyphs', () => {
  // Courier measures narrower than the embedded font here. The box still has to
  // cover the glyphs it hides, so the reported advance width is a floor.
  const layout = layoutPdfEditorTextControl({
    block: { x: 72, y: 300, width: 200, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    contentWidth: 140,
    page: a4At(1),
  });

  atLeast(layout.width, 200, 'stopped covering its own glyphs');
});

test('text longer than the original grows its box instead of being hidden', () => {
  const page = a4At(1);
  const block = { x: 72, y: 300, width: 200, height: 9 };
  const oneLine = layoutPdfEditorTextControl({
    block, fontSize: 12, lineHeight: 1.15, page,
  });
  const threeLines = layoutPdfEditorTextControl({
    block, fontSize: 12, lineHeight: 1.15, page, contentHeight: 3 * 12 * 1.15 + 2,
  });

  atLeast(threeLines.height, 3 * 12 * 1.15, 'three lines of text do not fit');
  assert.ok(threeLines.height > oneLine.height, 'the box did not grow with its content');
  assert.equal(threeLines.top, oneLine.top, 'growth moved the box');
});

test('growth stops at the page edge, in both directions', () => {
  // A paragraph pasted into a control near the bottom of the page. It may grow
  // over its neighbours — so does the exported text — but not off the paper.
  const page = a4At(0.6);
  const layout = layoutPdfEditorTextControl({
    block: { x: 40, y: page.height - 30, width: 200, height: 5 },
    fontSize: 6,
    lineHeight: 1.15,
    page,
    contentHeight: 4000,
  });

  atMost(layout.height, page.height, 'grew taller than the page');
  atMost(layout.top + layout.height, page.height, 'grew off the bottom of the page');
  atLeast(layout.top, 0, 'grew off the top of the page');
});

test('a shorter measurement never shrinks the box below its line', () => {
  // Deleting text back to nothing must not collapse the control to a sliver the
  // user then cannot click to type into again.
  const layout = layoutPdfEditorTextControl({
    block: { x: 20, y: 20, width: 120, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    page: a4At(1),
    contentHeight: 1,
  });

  atLeast(layout.height - CHROME_Y, 12 * 1.15, 'collapsed below one line');
});

// --------------------------------------------------------------------------- //
// Dragging an edge: the user's own size
// --------------------------------------------------------------------------- //

test('a dragged size enlarges the box and keeps it on the page', () => {
  const page = a4At(1);
  const block = { x: 72, y: 300, width: 200, height: 9 };
  const asLaidOut = layoutPdfEditorTextControl({
    block, fontSize: 12, lineHeight: 1.15, page,
  });
  const dragged = layoutPdfEditorTextControl({
    block, fontSize: 12, lineHeight: 1.15, page, userWidth: 320, userHeight: 90,
  });

  assert.equal(dragged.width, 320);
  assert.equal(dragged.height, 90);
  assert.ok(dragged.width > asLaidOut.width && dragged.height > asLaidOut.height);
  assert.equal(dragged.left, 72, 'the box moved off its glyphs');
  assert.equal(dragged.top, asLaidOut.top, 'the box moved off its line');
});

test('a drag cannot pull a box off the run it covers or below one line', () => {
  // Floors, not overrides. Shrinking below the glyph rectangle would leave part
  // of the run being edited outside the box the user is typing into, and
  // shrinking below the line box hides the text itself — the two failures the
  // rest of this module exists to prevent, reachable here by a mouse drag.
  const block = { x: 72, y: 300, width: 200, height: 9 };
  const layout = layoutPdfEditorTextControl({
    block, fontSize: 12, lineHeight: 1.15, page: a4At(1), userWidth: 20, userHeight: 3,
  });

  atLeast(layout.width, block.width, 'a drag narrowed the box past its glyphs');
  atLeast(layout.height - CHROME_Y, 12 * 1.15, 'a drag shrank the box below its line');
});

test('no drag, at any zoom or edge, can put a box on the workspace background', () => {
  // The reported symptom was controls lying outside the paper. A drag is a new
  // way to ask for exactly that, so it gets the same sweep the fit modes get.
  for (const zoom of [0.4, 0.6, 1, 1.6, 3]) {
    const page = a4At(zoom);
    for (const [x, baseline] of [
      [0, 12 * zoom],
      [page.width - 4, page.height - 4],
    ] as const) {
      const layout = layoutPdfEditorTextControl({
        block: lineAt(12, zoom, x, baseline),
        fontSize: 12 * zoom,
        lineHeight: 1.15,
        page,
        userWidth: 10_000,
        userHeight: 10_000,
      });
      const where = `zoom ${zoom}, origin (${x}, ${baseline})`;
      atLeast(layout.left, 0, `left off page — ${where}`);
      atLeast(layout.top, 0, `top off page — ${where}`);
      atMost(layout.left + layout.width, page.width, `right off page — ${where}`);
      atMost(layout.top + layout.height, page.height, `bottom off page — ${where}`);
    }
  }
});

test('a dragged size is stored zoom-free, so it survives a change of fit mode', () => {
  // What `resizedTextControlExtent` divides out, and why: the drag happens in
  // device pixels on a page drawn at some zoom, and the result is *stored*. Store
  // the device pixels and a box dragged to a third of the page at Fit page comes
  // back three times too big at Actual size — the exact space-mixing that made
  // the original defect invisible at 100% and glaring everywhere else.
  const draggedAtFitPage = resizedTextControlExtent({
    startExtent: 60, delta: 30, zoom: 0.6,
  });
  const draggedAtActualSize = resizedTextControlExtent({
    startExtent: 100, delta: 50, zoom: 1,
  });

  assert.equal(draggedAtFitPage, 150, 'zoom was not divided out');
  assert.equal(draggedAtActualSize, 150);
  // Same box, same gesture, two fit modes: one stored number.
  assert.equal(draggedAtFitPage, draggedAtActualSize);
});

test('dragging inwards stops at the pointer minimum, not at zero', () => {
  // A box dragged to nothing leaves no edge to drag back out. The layout's own
  // floors still apply on top of this — see the floors test above.
  const collapsed = resizedTextControlExtent({ startExtent: 40, delta: -400, zoom: 1 });
  assert.equal(collapsed, MIN_TEXT_CONTROL_EXTENT);

  const collapsedZoomed = resizedTextControlExtent({ startExtent: 40, delta: -400, zoom: 2 });
  assert.equal(collapsedZoomed, MIN_TEXT_CONTROL_EXTENT / 2);
});

test('a drag with nonsense numbers yields a usable extent, never NaN', () => {
  for (const input of [
    { startExtent: Number.NaN, delta: 10, zoom: 1 },
    { startExtent: 40, delta: Number.NaN, zoom: 1 },
    { startExtent: 40, delta: 10, zoom: 0 },
    { startExtent: 40, delta: 10, zoom: Number.NaN },
    { startExtent: -40, delta: Number.POSITIVE_INFINITY, zoom: -2 },
  ]) {
    const extent = resizedTextControlExtent(input);
    assert.ok(Number.isFinite(extent), `not finite for ${JSON.stringify(input)}`);
    atLeast(extent, MIN_TEXT_CONTROL_EXTENT, `below the minimum for ${JSON.stringify(input)}`);
  }
});

// --------------------------------------------------------------------------- //
// Degenerate input
// --------------------------------------------------------------------------- //

test('a page that has not rendered yet returns the block untouched', () => {
  const layout = layoutPdfEditorTextControl({
    block: { x: 33, y: 44, width: 120, height: 9 },
    fontSize: 12,
    lineHeight: 1.15,
    page: { width: 0, height: 0 },
  });

  assert.equal(layout.left, 33);
  assert.equal(layout.top, 44);
  assert.ok(layout.height > 0);
});

test('non-finite input produces a finite on-page layout, never NaN styles', () => {
  const page = a4At(1);
  const layout = layoutPdfEditorTextControl({
    block: {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      width: Number.NaN,
      height: -5,
    },
    fontSize: Number.NaN,
    lineHeight: Number.NaN,
    page,
  });

  for (const [key, value] of Object.entries(layout)) {
    assert.ok(Number.isFinite(value), `${key} is not finite: ${value}`);
  }
  assert.ok(layout.fontSize >= MIN_TEXT_CONTROL_FONT_SIZE);
  atMost(layout.left + layout.width, page.width, 'right off page');
  atMost(layout.top + layout.height, page.height, 'bottom off page');
});
