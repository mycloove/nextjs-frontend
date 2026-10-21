export const HISTORY_COALESCE_WINDOW_MS = 250;
export const MAX_DOCUMENT_HISTORY_ENTRIES = 80;
export const MAX_DOCUMENT_HISTORY_BYTES = 24 * 1024 * 1024;

export interface DocumentHistoryEntry {
  snapshot: string;
  recordedAt: number;
  coalesceKey?: string;
}

export interface DocumentHistoryAppendResult {
  entries: DocumentHistoryEntry[];
  index: number;
  bytes: number;
  changed: boolean;
}

export interface DocumentHistoryAppendOptions {
  coalesceKey?: string;
  recordedAt?: number;
  maxEntries?: number;
  maxBytes?: number;
  coalesceWindowMs?: number;
}

const estimateSnapshotBytes = (snapshot: string) => snapshot.length * 2;

export function createDocumentHistory(snapshot: string, recordedAt = Date.now()) {
  const entries: DocumentHistoryEntry[] = [{ snapshot, recordedAt }];
  return {
    entries,
    index: 0,
    bytes: estimateSnapshotBytes(snapshot),
  };
}

/**
 * Append one document-level state command, dropping the redo branch and keeping
 * both retained entry count and serialized memory within explicit limits.
 */
export function appendBoundedDocumentHistory(
  entries: DocumentHistoryEntry[],
  index: number,
  snapshot: string,
  options: DocumentHistoryAppendOptions = {},
): DocumentHistoryAppendResult {
  const recordedAt = options.recordedAt ?? Date.now();
  const maxEntries = Math.max(2, options.maxEntries ?? MAX_DOCUMENT_HISTORY_ENTRIES);
  const maxBytes = Math.max(1, options.maxBytes ?? MAX_DOCUMENT_HISTORY_BYTES);
  const coalesceWindowMs = options.coalesceWindowMs ?? HISTORY_COALESCE_WINDOW_MS;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, entries.length - 1));
  const branch = entries.slice(0, safeIndex + 1);
  const previous = branch[branch.length - 1];

  if (previous?.snapshot === snapshot) {
    return {
      entries,
      index: safeIndex,
      bytes: entries.reduce((total, entry) => total + estimateSnapshotBytes(entry.snapshot), 0),
      changed: false,
    };
  }

  const shouldCoalesce = branch.length > 1
    && Boolean(options.coalesceKey)
    && previous?.coalesceKey === options.coalesceKey
    && recordedAt - previous.recordedAt <= coalesceWindowMs;
  const nextEntry: DocumentHistoryEntry = {
    snapshot,
    recordedAt,
    coalesceKey: options.coalesceKey,
  };
  const next = shouldCoalesce
    ? [...branch.slice(0, -1), nextEntry]
    : [...branch, nextEntry];

  let bytes = next.reduce((total, entry) => total + estimateSnapshotBytes(entry.snapshot), 0);
  while (next.length > maxEntries || (bytes > maxBytes && next.length > 2)) {
    const removed = next.shift();
    if (removed) bytes -= estimateSnapshotBytes(removed.snapshot);
  }

  return {
    entries: next,
    index: next.length - 1,
    bytes,
    changed: true,
  };
}


