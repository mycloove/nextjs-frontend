export type PdfEditorProcessingPurpose = 'export' | 'preview' | 'ocr';

export interface PdfEditorProcessingRequest {
  session: number;
  sequence: number;
  fileName: string;
  purpose: PdfEditorProcessingPurpose;
}

/** Memory only. A hash, filename, restored draft or loss approval is not permission. */
export function createPdfEditorProcessingConsent() {
  let session = 0;
  let sequence = 0;
  let allowed = false;
  let pending: PdfEditorProcessingRequest | null = null;
  return {
    reset(nextSession: number) {
      session = nextSession;
      allowed = false;
      pending = null;
    },
    isAllowed(currentSession: number) {
      return currentSession === session && allowed;
    },
    request(currentSession: number, fileName: string, purpose: PdfEditorProcessingPurpose) {
      if (currentSession !== session) return null;
      pending = { session, sequence: ++sequence, fileName, purpose };
      return pending;
    },
    approve(request: PdfEditorProcessingRequest, currentSession: number) {
      if (pending !== request || request.session !== currentSession || currentSession !== session) return false;
      allowed = true;
      pending = null;
      return true;
    },
    cancel(request: PdfEditorProcessingRequest) {
      if (pending !== request) return false;
      pending = null;
      return true;
    },
  };
}
