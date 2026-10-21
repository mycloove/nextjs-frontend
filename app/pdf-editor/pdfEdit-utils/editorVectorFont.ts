/**
 * Embedded fonts for W2 vector canvas export.
 *
 * Liberation Sans is metric-compatible with Arial/Helvetica and covers Latin,
 * Greek, Cyrillic and common punctuation. Noto Sans Bengali covers Bengali and
 * the Latin characters needed inside a mixed sentence. Both are embedded as
 * subsets, so added text remains selectable and searchable instead of being
 * flattened into a page bitmap. Shaped scripts also carry `/ActualText` for
 * viewers that honour marked content.
 *
 * The files are served from `public/fonts/pdf-editor`; their licences sit beside
 * them. `@pdf-lib/fontkit` ships Babel-compiled bundles that reference
 * `regeneratorRuntime` as a global without defining it, and its Bengali shaper
 * needs generators. The runtime import must stay above the fontkit import, or
 * the first shaped string throws `ReferenceError` instead of exporting.
 */

import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';

import type {
  PdfEditorVectorFontAssets,
  PdfEditorVectorFontRole,
} from './editorVectorOverlay.ts';

const FONT_BASE = '/fonts/pdf-editor';
const FONT_FILES: Readonly<Record<PdfEditorVectorFontRole, string>> = {
  'latin-regular': 'LiberationSans-Regular.ttf',
  'latin-bold': 'LiberationSans-Bold.ttf',
  'latin-italic': 'LiberationSans-Italic.ttf',
  'latin-boldItalic': 'LiberationSans-BoldItalic.ttf',
  'bengali-regular': 'NotoSansBengali-Regular.ttf',
  'bengali-bold': 'NotoSansBengali-Bold.ttf',
};

export const PDF_EDITOR_VECTOR_FONT_ROLES = Object.keys(FONT_FILES) as PdfEditorVectorFontRole[];

const SHAPED_ROLES = new Set<PdfEditorVectorFontRole>(['bengali-regular', 'bengali-bold']);
/**
 * Characters that never need a visible glyph. Line controls are handled by
 * `drawText`; zero-width and word-joiner characters are consumed by shaping or
 * are invisible. Liberation Sans has no glyph for U+200B–U+200D, so requiring
 * one would rasterise a page over an invisible character.
 */
const CONTROL_CHARACTERS = new Set([
  '\n', '\r', '\t',
  '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
]);

export type PdfEditorVectorFontSet = {
  /** Roles that loaded successfully. Export embeds only the roles it writes. */
  fonts: PdfEditorVectorFontAssets;
  /** Per-code-point coverage against the exact font bytes that will be embedded. */
  covers: (role: PdfEditorVectorFontRole, text: string) => boolean;
  /** Requested roles that could not be fetched or parsed. */
  missingRoles: PdfEditorVectorFontRole[];
};

const bytesCache = new Map<PdfEditorVectorFontRole, Uint8Array>();
const coverageCache = new Map<PdfEditorVectorFontRole, {
  bytes: Uint8Array;
  covers: (text: string) => boolean;
}>();
const pending = new Map<PdfEditorVectorFontRole, Promise<Uint8Array | null>>();

async function fetchFont(
  role: PdfEditorVectorFontRole,
  fetcher: typeof fetch,
): Promise<Uint8Array | null> {
  const cached = bytesCache.get(role);
  if (cached) return cached;

  const inFlight = pending.get(role);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const response = await fetcher(`${FONT_BASE}/${FONT_FILES[role]}`);
      if (!response.ok) {
        throw new Error(`Embedded export font ${role} is unavailable (${response.status}).`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytesCache.set(role, bytes);
      return bytes;
    } catch (error) {
      console.warn(`Embedded export font ${role} could not be loaded; affected pages will use the disclosed raster fallback.`, error);
      return null;
    } finally {
      pending.delete(role);
    }
  })();

  pending.set(role, request);
  return request;
}

function createCoverage(
  role: PdfEditorVectorFontRole,
  bytes: Uint8Array,
): (text: string) => boolean {
  try {
    const font = fontkit.create(bytes);
    return (text: string) => {
      try {
        for (const char of text) {
          if (CONTROL_CHARACTERS.has(char)) continue;
          if (!font.hasGlyphForCodePoint(char.codePointAt(0) ?? 0)) return false;
        }
        if (SHAPED_ROLES.has(role)) {
          // Coverage is not capability: run the shaper too, so a font layout
          // failure is caught here rather than mid-export.
          const run = font.layout(text.replace(/[\n\r\t]/g, ' '));
          if (run.glyphs.some(glyph => glyph.id === 0)) return false;
        }
        return true;
      } catch {
        return false;
      }
    };
  } catch (error) {
    console.warn(`Embedded export font ${role} could not be parsed; affected pages will use the disclosed raster fallback.`, error);
    return () => false;
  }
}

function coverageFor(
  role: PdfEditorVectorFontRole,
  bytes: Uint8Array,
): (text: string) => boolean {
  const cached = coverageCache.get(role);
  if (cached && cached.bytes === bytes) return cached.covers;
  const covers = createCoverage(role, bytes);
  coverageCache.set(role, { bytes, covers });
  return covers;
}

/**
 * Builds a coverage set from already-loaded bytes. Pure apart from fontkit
 * parsing, so tests can exercise the exact fonts that ship without a network.
 */
export function createPdfEditorVectorFontSet(
  fonts: PdfEditorVectorFontAssets,
): PdfEditorVectorFontSet {
  const available: PdfEditorVectorFontAssets = {};
  const missingRoles: PdfEditorVectorFontRole[] = [];

  for (const role of PDF_EDITOR_VECTOR_FONT_ROLES) {
    const bytes = fonts[role];
    if (!bytes) {
      missingRoles.push(role);
      continue;
    }
    available[role] = bytes;
  }

  return {
    fonts: available,
    covers: (role, text) => {
      const bytes = available[role];
      if (!bytes) return false;
      return coverageFor(role, bytes)(text);
    },
    missingRoles,
  };
}

/**
 * Loads the roles a plan actually needs. A missing asset is reported through
 * `covers`, so only the pages that use it fall back to raster; the rest of the
 * document still exports as vector text and shapes.
 */
export async function loadPdfEditorVectorFonts(
  roles: readonly PdfEditorVectorFontRole[],
  fetcher: typeof fetch = fetch,
): Promise<PdfEditorVectorFontSet> {
  const requested = [...new Set(roles)];
  const loaded = await Promise.all(requested.map(async (role) => [role, await fetchFont(role, fetcher)] as const));
  const fonts: PdfEditorVectorFontAssets = {};
  for (const [role, bytes] of loaded) {
    if (bytes) fonts[role] = bytes;
  }
  return createPdfEditorVectorFontSet(fonts);
}

/** Test hook: drop caches without touching module load order. */
export function resetPdfEditorVectorFontCache() {
  bytesCache.clear();
  coverageCache.clear();
  pending.clear();
}
