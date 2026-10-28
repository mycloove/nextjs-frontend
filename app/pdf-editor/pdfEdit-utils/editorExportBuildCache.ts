/**
 * Fingerprint + cache for one export build. This is the mechanism that makes
 * **P = E** literal rather than aspirational.
 *
 * The problem it solves
 * --------------------
 * The preview and the download used to be produced by two different pieces of
 * code, so "the preview shows what you will get" was only ever a claim about how
 * carefully those two were kept in step — and they were not in step at all. The
 * fix is structural: there is one build, and both consumers read its output. The
 * preview renders the bytes; Save writes the same bytes to disk. Not equivalent
 * bytes — the same array.
 *
 * That only holds if "the inputs have not changed since the preview" is decided
 * exactly. Hence the fingerprint: a lossless, order-stable encoding of every
 * input that can alter the exported bytes. Equal fingerprint means the build is
 * reusable; anything else means rebuild.
 *
 * Why the key is the whole canonical string and not a hash
 * -------------------------------------------------------
 * A hash collision here would hand the user a file that is not what they
 * previewed, silently — the precise failure the P = E invariant exists to make
 * impossible. A few kilobytes (or, with pasted images, megabytes) of key for at
 * most {@link PDF_EDITOR_EXPORT_BUILD_CACHE_CAPACITY} entries is a cheap price
 * for an exact answer, so this module does not hash. If that ever needs to
 * change, the replacement has to be collision-*proof*, not collision-resistant.
 *
 * Why canonicalisation refuses instead of guessing
 * -----------------------------------------------
 * Every value reachable from the input is encoded losslessly, and any type this
 * module cannot encode losslessly throws {@link PdfEditorExportFingerprintError}.
 * Silently rendering an unsupported value as `{}` would make two different
 * documents share a fingerprint, which is the same wrong file delivered
 * silently. Loud is correct here.
 */

/** Thrown when a value cannot be encoded losslessly. Never caught internally. */
export class PdfEditorExportFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfEditorExportFingerprintError';
  }
}

export type PdfEditorExportFingerprint = string;

/**
 * Everything that can change the exported bytes.
 *
 * The fields are deliberately typed `unknown` where they carry another module's
 * value objects (a text mutation, a Fabric canvas state, a consent grant). The
 * canonicaliser walks whatever it is handed, so a property added to
 * `PdfEditorTextMutation` later is covered by the fingerprint automatically. A
 * hand-maintained field list would have to be updated in lockstep with every
 * style property anyone adds, and the failure mode of forgetting is a stale
 * preview presented as truth.
 */
export type PdfEditorExportFingerprintInput = {
  /** Metadata is not identity: every opened document needs its own session id. */
  file: { name: string; size: number; lastModified: number; sessionId: number } | null;
  /** Target page size key — changes page boxes and the fit scale. */
  pageSize: string;
  /**
   * The export mode the user confirmed, if any. Included because a confirmed
   * downgrade changes which renderer runs, and therefore the bytes.
   */
  confirmedMode: string | null;
  /** Committed text mutations, in the order they will be sent to the engine. */
  textEdits: readonly unknown[];
  /**
   * Reviewed redaction marks. They change the bytes (glyph removal plus
   * metadata sanitization), so a build that omitted them from its identity
   * would be reused for a document the user never previewed.
   */
  redactions: readonly unknown[];
  /**
   * W4 annotations. Annotation dictionaries are written into the output bytes,
   * so a new or edited annotation is a different build and must not reuse a
   * preview produced before it existed.
   */
  annotations?: readonly unknown[];
  /** Added-object state per page. Only pages that carry objects need appear. */
  canvasPages: readonly { page: number; state: unknown }[];
  /**
   * Loss the user has explicitly accepted. Part of the identity of the build:
   * the same document with a granted flag exports different bytes, and a grant
   * must never be inherited by a build the user did not approve it for.
   */
  consent: unknown;
  /**
   * Page order/rotation plan. Page operations change output order and count, so
   * a build that ignored it would be a different document. Optional so older
   * callers and tests remain valid; absent and `null` are both "identity".
   */
  pagePlan?: unknown;
};

export function computePdfEditorExportFingerprint(
  input: PdfEditorExportFingerprintInput,
): PdfEditorExportFingerprint {
  return canonicalize(input, new Set(), 'input');
}

/**
 * A tiny LRU keyed by fingerprint.
 *
 * Generic over the stored value so the contract — "the same fingerprint returns
 * the very same value" — is provable without a browser, a server, or a PDF. The
 * hook stores the in-flight `Promise` of a build, which also collapses a preview
 * and a Save that race into a single engine round trip.
 */
export type PdfEditorExportBuildCache<T> = {
  /** The stored value, or `undefined`. A hit counts as a use for eviction. */
  get(fingerprint: PdfEditorExportFingerprint): T | undefined;
  /** Stores and returns `value`, so callers can `return cache.set(fp, build)`. */
  set(fingerprint: PdfEditorExportFingerprint, value: T): T;
  /** Drops one entry. Used to un-cache a build that turned out unusable. */
  delete(fingerprint: PdfEditorExportFingerprint): void;
  clear(): void;
  readonly size: number;
};

/**
 * Two: the build the user is looking at, and the one they were looking at
 * before. Enough to make typing-then-saving a hit, small enough that the exact
 * (unhashed) keys and any embedded image data cannot accumulate.
 */
export const PDF_EDITOR_EXPORT_BUILD_CACHE_CAPACITY = 2;

export function createPdfEditorExportBuildCache<T>(
  capacity: number = PDF_EDITOR_EXPORT_BUILD_CACHE_CAPACITY,
): PdfEditorExportBuildCache<T> {
  const limit = Math.max(1, Math.floor(capacity));
  // Insertion-ordered, so the oldest key is the first one iteration yields.
  const entries = new Map<PdfEditorExportFingerprint, T>();

  return {
    get(fingerprint) {
      if (!entries.has(fingerprint)) return undefined;
      const value = entries.get(fingerprint) as T;
      // Re-insert so a repeatedly previewed build is not the one evicted.
      entries.delete(fingerprint);
      entries.set(fingerprint, value);
      return value;
    },
    set(fingerprint, value) {
      entries.delete(fingerprint);
      entries.set(fingerprint, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      return value;
    },
    delete(fingerprint) {
      entries.delete(fingerprint);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** Share in-flight/successful work, but never turn a failed attempt into a permanent failure. */
export async function getOrBuildPdfEditorExport<T extends { ok: boolean }>(
  cache: PdfEditorExportBuildCache<Promise<T>>,
  fingerprint: PdfEditorExportFingerprint,
  build: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(fingerprint);
  if (cached) return cached;
  const pending = Promise.resolve().then(build);
  cache.set(fingerprint, pending);
  try {
    const result = await pending;
    if (!result.ok && cache.get(fingerprint) === pending) cache.delete(fingerprint);
    return result;
  } catch (error) {
    if (cache.get(fingerprint) === pending) cache.delete(fingerprint);
    throw error;
  }
}

/**
 * Lossless, order-stable encoding of an arbitrary value.
 *
 * Object keys are sorted so property order cannot change a fingerprint; array
 * order is preserved because it is meaningful (edit order reaches the engine).
 * Every scalar is tagged with its type so `1`, `'1'` and `true` cannot collide.
 */
function canonicalize(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undef';

  switch (typeof value) {
    case 'boolean':
      return value ? 'b:1' : 'b:0';
    case 'number':
      // `Object.is` distinguishes -0 from 0; JSON would not, and a sign flip on
      // a coordinate is a different redaction rectangle.
      if (Number.isNaN(value)) return 'n:NaN';
      if (Object.is(value, -0)) return 'n:-0';
      return `n:${value}`;
    case 'bigint':
      return `i:${value}`;
    case 'string':
      // Length-prefixed so 'a' + 'bc' cannot encode the same as 'ab' + 'c'.
      return `s${value.length}:${value}`;
    case 'function':
    case 'symbol':
      throw new PdfEditorExportFingerprintError(
        `Cannot fingerprint a ${typeof value} at ${path}. An export input has to be data.`,
      );
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) {
    throw new PdfEditorExportFingerprintError(
      `Cannot fingerprint the circular reference at ${path}.`,
    );
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const parts = object.map((item, index) => canonicalize(item, seen, `${path}[${index}]`));
      return `a${parts.length}:[${parts.join(',')}]`;
    }
    if (object instanceof Uint8Array) {
      // Byte-exact. Bytes are not expected in a fingerprint input, but encoding
      // them precisely is safer than rejecting a caller that has a good reason.
      return `u8${object.length}:[${Array.from(object).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      // Map, Set, Date, class instances: each would need its own lossless
      // encoding, and inventing one on a guess is how two different builds come
      // to share a fingerprint. Refuse until one is written deliberately.
      throw new PdfEditorExportFingerprintError(
        `Cannot fingerprint ${object.constructor?.name ?? 'this value'} at ${path}. `
        + 'Convert it to a plain object or array before including it in an export fingerprint.',
      );
    }
    const keys = Object.keys(object as Record<string, unknown>).sort();
    const parts = keys.map((key) => {
      const encodedKey = `s${key.length}:${key}`;
      return `${encodedKey}=${canonicalize((object as Record<string, unknown>)[key], seen, `${path}.${key}`)}`;
    });
    return `o${parts.length}:{${parts.join(',')}}`;
  } finally {
    seen.delete(object);
  }
}
