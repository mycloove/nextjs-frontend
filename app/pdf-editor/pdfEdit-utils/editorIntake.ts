export const PDF_EDITOR_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PDF_EDITOR_MAX_PAGES = 500;

export type PdfIntakeFailureCode =
  | 'empty-file'
  | 'file-too-large'
  | 'not-pdf'
  | 'password-protected'
  | 'invalid-pdf'
  | 'page-limit'
  | 'load-failed';

export interface PdfIntakeFailure {
  code: PdfIntakeFailureCode;
  title: string;
  message: string;
}

const failure = (code: PdfIntakeFailureCode, title: string, message: string): PdfIntakeFailure => ({
  code,
  title,
  message,
});

export function validatePdfFileMetadata(file: Pick<File, 'name' | 'size' | 'type'>): PdfIntakeFailure | null {
  if (file.size === 0) {
    return failure('empty-file', 'This file is empty', 'Choose a PDF that contains document data.');
  }
  if (file.size > PDF_EDITOR_MAX_FILE_BYTES) {
    return failure('file-too-large', 'PDF is too large', 'The browser editor supports files up to 100 MB.');
  }
  const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf');
  if (!hasPdfExtension && file.type !== 'application/pdf') {
    return failure('not-pdf', 'Choose a PDF file', 'This editor only opens PDF documents.');
  }
  return null;
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  const scanLength = Math.min(bytes.byteLength - 4, 1024);
  for (let index = 0; index < scanLength; index += 1) {
    if (
      bytes[index] === 0x25
      && bytes[index + 1] === 0x50
      && bytes[index + 2] === 0x44
      && bytes[index + 3] === 0x46
      && bytes[index + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

export function classifyPdfLoadFailure(error: unknown): PdfIntakeFailure {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';

  if (name === 'PasswordException') {
    return failure(
      'password-protected',
      'Password-protected PDF',
      'Remove the password in a trusted PDF app, then open the unlocked copy.',
    );
  }
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || name === 'UnexpectedResponseException') {
    return failure('invalid-pdf', 'PDF could not be read', 'The file may be damaged or use an unsupported PDF structure.');
  }
  return failure('load-failed', 'PDF could not be opened', 'Try the file again or open another PDF.');
}

export function validatePdfPageCount(pageCount: number): PdfIntakeFailure | null {
  if (pageCount > PDF_EDITOR_MAX_PAGES) {
    return failure(
      'page-limit',
      'PDF has too many pages',
      `The browser editor supports up to ${PDF_EDITOR_MAX_PAGES} pages per document.`,
    );
  }
  return null;
}