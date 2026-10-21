export type ShellDocument = {
  docId: string;
  pdfUrl: string;
  name: string;
  sessionId: string;
  docNumber: number;
  uploadedAt: number;
  pages?: number;
  sizeMB?: number;
};

export type ShellSource = {
  label: string;
  page: number;
  text?: string;
  doc_id?: string;
  doc_number?: number;
  isGap?: boolean;
};

export type ShellMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  sources?: ShellSource[];
  isGap?: boolean; // used to color the note answer as gap-flavor
  createdAt: number;
  loading?: boolean;
  error?: string;
};

export type ShellRecent = {
  id: string;
  title: string;
  timeLabel: string;
  createdAt: number;
  docId?: string;
};

export type Theme = "light" | "dark";

/**
 * A citation-jump target — created when a user clicks a cite-chip in
 * the chat, or a source row in the Insights panel. Drives the
 * right-panel Source Viewer mode.
 */
export type ShellCitation = {
  /** Stable id for re-flashing when the same chip is clicked twice. */
  id: string;
  /** 1-based PDF page number. */
  page: number;
  /** Display label ("p.4 · §2.1"). */
  label: string;
  /** Exact sentence / snippet we want the eye to land on. */
  text?: string;
  /** True when the answer is a "not found / no clause" style callout. */
  isGap?: boolean;
  /** Document that owned the citation (for multi-doc chats). */
  docId?: string;
};

/** Right panel modes. */
export type RightPanelMode = "insights" | "source";

/* ------------------------------------------------------------------ */
/* Source Viewer — paginated per-page contract                         */
/*                                                                    */
/* The chat backend returns raw snippet text per citation. We rebuild  */
/* that into a `SourcePage[]` shape on the fly, one entry per cited   */
/* page, so the SourceViewerView can render a paginated document that */
/* matches the reference mockup 1-to-1.                                */
/* ------------------------------------------------------------------ */

/** Inline segment inside a paragraph — either plain text or a highlight
 *  that is the join-key target of a `Citation.id`. */
export type ParagraphSegment =
  | { type: "text"; text: string }
  | {
      type: "highlight";
      text: string;
      /** Must equal a `ShellCitation.id` — the SourceViewer uses this to
       *  find & flash the exact DOM node when a chip is clicked. */
      citationId: string;
      isGap: boolean;
    };

/** One block on a source page — heading or paragraph. */
export type SourceBlock =
  | { type: "heading"; text: string; level: 1 | 2 }
  | { type: "paragraph"; segments: ParagraphSegment[] };

/** A rendered page in the SourceViewerView. */
export interface SourcePage {
  pageNum: number;
  /** e.g. "Vendor_MSA_2026.pdf — Page 4 of 12" */
  pageLabel: string;
  blocks: SourceBlock[];
}



