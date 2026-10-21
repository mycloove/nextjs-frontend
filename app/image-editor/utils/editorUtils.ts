// ─────────────────────────────────────────────────────────────
//  Image Editor — Utility Functions
//  Pure functions, no React dependencies.
// ─────────────────────────────────────────────────────────────

/** Human-readable file size string */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/** Parse a human-readable size string back to bytes (for savings calc) */
export const parseSizeToBytes = (s: string): number => {
  const [num, unit] = s.split(' ');
  const n = parseFloat(num);
  if (unit === 'GB') return n * 1024 * 1024 * 1024;
  if (unit === 'MB') return n * 1024 * 1024;
  if (unit === 'KB') return n * 1024;
  return n;
};

/**
 * Returns the % size difference between original and edited.
 * Positive = smaller (saved), negative = larger.
 * Returns null when data is unavailable.
 */
export const getSavingsPercent = (
  originalFileSize: string,
  editedFileSize:   string,
  hasEdited:        boolean,
): number | null => {
  if (!hasEdited || editedFileSize === '—' || originalFileSize === '—') return null;
  const orig = parseSizeToBytes(originalFileSize);
  const edit = parseSizeToBytes(editedFileSize);
  if (orig === 0) return null;
  return Math.round(((orig - edit) / orig) * 100);
};

/** Derive a file extension from the outputFormat setting + original file */
export const getExportExtension = (
  outputFormat: string,
  originalFile: File | null,
): string => {
  if (outputFormat === 'JPG')  return 'jpg';
  if (outputFormat === 'WEBP') return 'webp';
  if (outputFormat === 'PNG')  return 'png';
  // 'same' — fall back to original
  return originalFile?.type?.split('/')[1] ?? 'png';
};
