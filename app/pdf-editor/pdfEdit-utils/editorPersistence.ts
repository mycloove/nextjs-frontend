import type {
  OriginalTextEdit,
  PageSizeKey,
} from '../pdfEdit-hooks/usePdfEditor';
import type { SerializedPdfEditorPagePlan } from './editorPageSession';
import type { PdfEditorRedactionMark } from './editorRedaction.ts';
import { normalizePdfEditorRedactionMarks } from './editorRedaction.ts';
import type { PdfEditorAnnotation } from './editorAnnotations.ts';
import { normalizePdfEditorAnnotations } from './editorAnnotations.ts';

export type PersistedFabricCanvasState = Record<string, unknown>;

/**
 * Draft schema.
 *
 * v3 adds the page plan. The stored key deliberately stays `draft:v2:*`: the
 * key identifies the document, not the schema, and changing it would strand
 * every draft written before page operations existed. Old records are upgraded
 * in memory (and rewritten on the next save), never discarded.
 */
export interface PdfEditorDraft {
  version: 2 | 3;
  documentId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  savedAt: number;
  pageSize: PageSizeKey;
  textEdits: Record<string, OriginalTextEdit>;
  canvasStates: Record<string, PersistedFabricCanvasState>;
  /** v3 only. Absent means an identity plan for the source document. */
  pagePlan?: SerializedPdfEditorPagePlan;
  /**
   * W3 redaction marks. Optional so v2 drafts still load; an absent value means
   * "no marks", never "unknown, discard the draft". Malformed marks are dropped
   * individually by the normalizer.
   */
  redactionMarks?: PdfEditorRedactionMark[];
  /**
   * W4 annotations. Optional for the same reason as `redactionMarks`: an older
   * v3 draft means "no annotations", never "discard the draft". Malformed
   * annotations are dropped individually by the normalizer.
   */
  annotations?: PdfEditorAnnotation[];
}

export type PdfEditorDraftV2 = PdfEditorDraft & { version: 2 };
export type PdfEditorDraftV3 = PdfEditorDraft & { version: 3 };

export type DraftSaveResult =
  | { ok: true; savedAt: number }
  | { ok: false; reason: 'unavailable' | 'quota' | 'invalid' | 'cancelled'; message: string };

export interface PdfEditorDraftRecord {
  key: string;
  savedAt: number;
  draft: PdfEditorDraft;
}

export interface RecoverablePdfEditorSession {
  draft: PdfEditorDraft;
  source: Blob;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  fileType: string;
}

const DRAFT_VERSION = 3 as const;
/**
 * The stable document-keyed draft prefix. It intentionally retains the v2
 * segment: see the comment on `PdfEditorDraft`.
 */
const STORAGE_PREFIX = 'smilepdf:editor:draft:v2:';
const LEGACY_STORAGE_PREFIX = 'smilepdf:edits:';
const DATABASE_NAME = 'smilepdf:editor:v1';
const DRAFT_STORE_NAME = 'drafts';
const SOURCE_STORE_NAME = 'sources';
const LATEST_DRAFT_KEY = 'latest';

const PAGE_SIZE_KEYS = new Set<PageSizeKey>([
  'original',
  'a4',
  'a3',
  'a2',
  'letter',
  'legal',
]);

const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

const fallbackHash = (data: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export async function createPdfDocumentId(file: File, buffer?: ArrayBuffer) {
  const source = buffer ?? await file.arrayBuffer();
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', source.slice(0));
    return `sha256-${bytesToHex(digest)}`;
  }

  return `fallback-${fallbackHash(new Uint8Array(source))}-${file.size}`;
}

export function getDraftStorageKey(documentId: string) {
  return `${STORAGE_PREFIX}${documentId}`;
}

export function getLegacyDraftStorageKey(fileName: string) {
  return `${LEGACY_STORAGE_PREFIX}${fileName}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultTextEdit = (text: string): OriginalTextEdit => ({
  text,
  fontSize: 12,
  fontFamily: 'Helvetica',
  color: '#111111',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  lineHeight: 1.15,
  backgroundColor: 'transparent',
});

const normalizeTextEdit = (value: unknown): OriginalTextEdit | null => {
  if (typeof value === 'string') return defaultTextEdit(value);
  if (!isRecord(value) || typeof value.text !== 'string') return null;

  const align = value.align === 'center' || value.align === 'right' ? value.align : 'left';
  return {
    text: value.text,
    fontSize: typeof value.fontSize === 'number' && Number.isFinite(value.fontSize) ? value.fontSize : 12,
    fontFamily: typeof value.fontFamily === 'string' ? value.fontFamily : 'Helvetica',
    color: typeof value.color === 'string' ? value.color : '#111111',
    bold: value.bold === true,
    italic: value.italic === true,
    underline: value.underline === true,
    align,
    lineHeight: typeof value.lineHeight === 'number' && Number.isFinite(value.lineHeight) ? value.lineHeight : 1.15,
    backgroundColor: typeof value.backgroundColor === 'string' ? value.backgroundColor : 'transparent',
  };
};

const normalizeTextEdits = (value: unknown) => {
  if (!isRecord(value)) return {};
  const edits: Record<string, OriginalTextEdit> = {};
  Object.entries(value).forEach(([key, candidate]) => {
    const edit = normalizeTextEdit(candidate);
    if (edit) edits[key] = edit;
  });
  return edits;
};

const normalizeCanvasStates = (value: unknown) => {
  if (!isRecord(value)) return {};
  const canvasStates: Record<string, PersistedFabricCanvasState> = {};
  Object.entries(value).forEach(([page, candidate]) => {
    if (isRecord(candidate)) canvasStates[page] = candidate;
  });
  return canvasStates;
};

const normalizePagePlan = (value: unknown): SerializedPdfEditorPagePlan | undefined => {
  if (!isRecord(value)) return undefined;
  if (!Number.isInteger(value.sourcePageCount) || !Array.isArray(value.entries)) return undefined;
  const entries: SerializedPdfEditorPagePlan['entries'] = [];
  for (const entry of value.entries) {
    if (!isRecord(entry)) return undefined;
    if (!Number.isInteger(entry.sourcePage) || typeof entry.rotation !== 'number') return undefined;
    entries.push({
      sourcePage: entry.sourcePage as number,
      rotation: entry.rotation as SerializedPdfEditorPagePlan['entries'][number]['rotation'],
    });
  }
  return { sourcePageCount: value.sourcePageCount as number, entries };
};

export function parsePdfEditorDraft(raw: string): PdfEditorDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value)
      || (value.version !== 2 && value.version !== DRAFT_VERSION)
      || typeof value.documentId !== 'string'
    ) {
      return null;
    }

    const pageSize = typeof value.pageSize === 'string' && PAGE_SIZE_KEYS.has(value.pageSize as PageSizeKey)
      ? value.pageSize as PageSizeKey
      : 'original';

    return {
      // Read old records; always write the current schema.
      version: DRAFT_VERSION,
      documentId: value.documentId,
      fileName: typeof value.fileName === 'string' ? value.fileName : '',
      fileSize: typeof value.fileSize === 'number' ? value.fileSize : 0,
      fileLastModified: typeof value.fileLastModified === 'number' ? value.fileLastModified : 0,
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
      pageSize,
      textEdits: normalizeTextEdits(value.textEdits),
      canvasStates: normalizeCanvasStates(value.canvasStates),
      redactionMarks: normalizePdfEditorRedactionMarks(value.redactionMarks),
      annotations: normalizePdfEditorAnnotations(value.annotations),
      ...(value.version === DRAFT_VERSION ? { pagePlan: normalizePagePlan(value.pagePlan) } : {}),
    };
  } catch {
    return null;
  }
}

export function loadPdfEditorDraft(storage: Storage, documentId: string) {
  const raw = storage.getItem(getDraftStorageKey(documentId));
  if (!raw) return null;
  const draft = parsePdfEditorDraft(raw);
  return draft?.documentId === documentId ? draft : null;
}

export function migrateLegacyPdfEditorDraft(
  storage: Storage,
  file: File,
  documentId: string,
): PdfEditorDraft | null {
  const legacyKey = getLegacyDraftStorageKey(file.name);
  const raw = storage.getItem(legacyKey);
  if (!raw) return null;

  try {
    const textEdits = normalizeTextEdits(JSON.parse(raw));
    const draft: PdfEditorDraft = {
      version: DRAFT_VERSION,
      documentId,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      savedAt: Date.now(),
      pageSize: 'original',
      textEdits,
      canvasStates: {},
      redactionMarks: [],
      annotations: [],
    };
    storage.setItem(getDraftStorageKey(documentId), JSON.stringify(draft));
    storage.removeItem(legacyKey);
    return draft;
  } catch {
    return null;
  }
}

export function savePdfEditorDraft(storage: Storage, draft: PdfEditorDraft): DraftSaveResult {
  try {
    storage.setItem(getDraftStorageKey(draft.documentId), JSON.stringify(draft));
    return { ok: true, savedAt: draft.savedAt };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    return {
      ok: false,
      reason: quota ? 'quota' : 'unavailable',
      message: quota
        ? 'Local draft storage is full. Export the PDF before closing this tab.'
        : 'This browser could not save the local draft.',
    };
  }
}

type StoredSource = {
  key: string;
  blob: Blob;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  fileType: string;
};

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

async function openDraftDatabase() {
  if (!hasIndexedDb()) return null;
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        const drafts = database.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'key' });
        drafts.createIndex('savedAt', 'savedAt');
      }
      if (!database.objectStoreNames.contains(SOURCE_STORE_NAME)) {
        database.createObjectStore(SOURCE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
  });
}

async function runTransaction<T>(database: IDBDatabase, storeNames: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>) {
  const transaction = database.transaction(storeNames, mode);
  const completion = transactionToPromise(transaction);
  try {
    const result = await run(transaction);
    await completion;
    return result;
  } finally {
    database.close();
  }
}

export async function savePdfEditorDraftAsync(
  draft: PdfEditorDraft,
  sourceFile?: File,
  isCurrent: () => boolean = () => true,
): Promise<DraftSaveResult> {
  try {
    const database = await openDraftDatabase();
    if (!isCurrent()) {
      database?.close();
      return { ok: false, reason: 'cancelled', message: 'This recovery save was cancelled.' };
    }
    if (database) {
      const record: PdfEditorDraftRecord = {
        key: draft.documentId,
        savedAt: draft.savedAt,
        draft,
      };
      await runTransaction(database, [DRAFT_STORE_NAME, SOURCE_STORE_NAME], 'readwrite', async transaction => {
        const drafts = transaction.objectStore(DRAFT_STORE_NAME);
        await requestToPromise(drafts.put(record));
        await requestToPromise(drafts.put({ ...record, key: LATEST_DRAFT_KEY }));

        if (sourceFile) {
          const source: StoredSource = {
            key: draft.documentId,
            blob: sourceFile,
            fileName: sourceFile.name,
            fileSize: sourceFile.size,
            fileLastModified: sourceFile.lastModified,
            fileType: sourceFile.type || 'application/pdf',
          };
          await requestToPromise(transaction.objectStore(SOURCE_STORE_NAME).put(source));
        }
      });
      return { ok: true, savedAt: draft.savedAt };
    }
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    if (quota) {
      return {
        ok: false,
        reason: 'quota',
        message: 'Local draft storage is full. Export the PDF before closing this tab.',
      };
    }
    // The caller can still use the synchronous localStorage fallback.
  }

  return {
    ok: false,
    reason: 'unavailable',
    message: 'This browser could not save the local draft.',
  };
}

/** One queue survives document replacement; clearing invalidates even delayed opens. */
export function createPdfEditorRecoveryQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let enabled = true;
  return {
    reset() { generation += 1; enabled = true; },
    isEnabled() { return enabled; },
    save(run: (isCurrent: () => boolean) => Promise<boolean>) {
      const owner = generation;
      const isCurrent = () => enabled && owner === generation;
      const pending = tail.catch(() => undefined).then(() => isCurrent() ? run(isCurrent) : false);
      tail = pending;
      return pending;
    },
    clear<T>(remove: () => Promise<T>) {
      enabled = false;
      generation += 1;
      const pending = tail.catch(() => undefined).then(remove);
      tail = pending;
      return pending;
    },
  };
}

/** Called within one readwrite transaction, including the conditional latest delete. */
export async function removePdfEditorRecoveryRecords(documentId: string, stores: {
  readLatest: () => Promise<PdfEditorDraftRecord | undefined>;
  deleteDraft: (key: string) => Promise<unknown>;
  deleteSource: (key: string) => Promise<unknown>;
}) {
  const latest = await stores.readLatest();
  await stores.deleteDraft(documentId);
  await stores.deleteSource(documentId);
  if (latest?.draft.documentId === documentId) await stores.deleteDraft(LATEST_DRAFT_KEY);
}

export async function deletePdfEditorRecovery(documentId: string, storage?: Storage | (() => Storage)): Promise<
  { ok: true } | { ok: false; message: string }
> {
  let failed = false;
  try {
    const database = await openDraftDatabase();
    if (database) {
      await runTransaction(database, [DRAFT_STORE_NAME, SOURCE_STORE_NAME], 'readwrite', async transaction => {
        const drafts = transaction.objectStore(DRAFT_STORE_NAME);
        const sources = transaction.objectStore(SOURCE_STORE_NAME);
        await removePdfEditorRecoveryRecords(documentId, {
          readLatest: () => requestToPromise(drafts.get(LATEST_DRAFT_KEY)),
          deleteDraft: key => requestToPromise(drafts.delete(key)),
          deleteSource: key => requestToPromise(sources.delete(key)),
        });
      });
    }
  } catch { failed = true; }
  try {
    // Filename-keyed legacy drafts may belong to another PDF. Never wipe them here.
    (typeof storage === 'function' ? storage() : storage)?.removeItem(getDraftStorageKey(documentId));
  } catch { failed = true; }
  return failed
    ? { ok: false, message: 'Recovery is disabled for this open PDF, but some stored data could not be removed. Retry clearing it. Your current work remains open.' }
    : { ok: true };
}

export async function loadPdfEditorDraftAsync(documentId: string, storage?: Storage) {
  try {
    const database = await openDraftDatabase();
    if (database) {
      const record = await runTransaction(database, [DRAFT_STORE_NAME], 'readonly', async transaction => (
        requestToPromise<PdfEditorDraftRecord | undefined>(transaction.objectStore(DRAFT_STORE_NAME).get(documentId))
      ));
      if (record?.draft?.documentId === documentId) return record.draft;
    }
  } catch {
    // localStorage remains the compatibility fallback below.
  }

  return storage ? loadPdfEditorDraft(storage, documentId) : null;
}

export async function loadRecoverablePdfEditorSession(): Promise<RecoverablePdfEditorSession | null> {
  try {
    const database = await openDraftDatabase();
    if (!database) return null;
    const result = await runTransaction(database, [DRAFT_STORE_NAME, SOURCE_STORE_NAME], 'readonly', async transaction => {
      const drafts = transaction.objectStore(DRAFT_STORE_NAME);
      const sources = transaction.objectStore(SOURCE_STORE_NAME);
      const record = await requestToPromise<PdfEditorDraftRecord | undefined>(drafts.get(LATEST_DRAFT_KEY));
      if (!record?.draft?.documentId) return null;
      const source = await requestToPromise<StoredSource | undefined>(sources.get(record.draft.documentId));
      if (!source?.blob) return null;
      return {
        draft: record.draft,
        source: source.blob,
        fileName: source.fileName,
        fileSize: source.fileSize,
        fileLastModified: source.fileLastModified,
        fileType: source.fileType,
      } satisfies RecoverablePdfEditorSession;
    });
    return result;
  } catch {
    return null;
  }
}
