'use client';
// ─────────────────────────────────────────────────────────────
//  /pdf-editor/page.tsx
//  Orchestrates the full PDF editor:
//    1. Drop zone — upload PDF
//    2. Editor shell — topbar + left toolbar + canvas + right panel
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo';
import { usePdfEditor, ToolType } from './pdfEdit-hooks/usePdfEditor';
import PdfEditorTopbar   from './pdfEdit-components/PdfEditorTopbar';
import EditorLeftToolbar from './pdfEdit-components/EditorLeftToolbar';
import PdfEditorCanvas   from './pdfEdit-components/PdfEditorCanvas';
import PdfEditorPreview  from './pdfEdit-components/PdfEditorPreview';
import EditorRightPanel from './pdfEdit-components/EditorRightPanel';
import { PdfEditorCommandPalette, PdfEditorShortcutsDialog } from './pdfEdit-components/PdfEditorCommandPalette';
import PdfExportImpactDialog from './pdfEdit-components/PdfExportImpactDialog';
import PdfEditorDocumentDialog from './pdfEdit-components/PdfEditorDocumentDialog';
import type { PdfEditorOcrCopyRequest } from './pdfEdit-hooks/usePdfEditor';
import { pdfEditorAnnotationBlocker } from './pdfEdit-utils/editorCapabilities';
import PdfEditorNavigationPanel from './pdfEdit-components/PdfEditorNavigationPanel';
import PdfEditorCommandBar from './pdfEdit-components/PdfEditorCommandBar';
import PdfEditorStatusBar from './pdfEdit-components/PdfEditorStatusBar';
import { isDeleteShortcut, isEditableShortcutTarget } from './pdfEdit-utils/editorShortcuts';
import { isPdfEditorFeatureEnabled } from './pdfEdit-utils/editorFeatureFlags';
import {
  isPdfEditorTextSelectionVisible,
  resolvePdfEditorInspectorContext,
} from './pdfEdit-utils/editorInspectorContext';
import type { PdfExportImpact } from './pdfEdit-utils/editorPreflight';
import type { ServerTextEditConsentRequest } from './pdfEdit-utils/editorServerTextEdit';
import type { PdfEditorCommentEntry, PdfEditorOutlineEntry, PdfEditorSearchResult } from './pdfEdit-hooks/usePdfEditor';
import {
  calculatePdfEditorFitZoom,
  type PdfEditorFitMode,
  type PdfEditorNavigationTab,
  type PdfEditorViewMode,
} from './pdfEdit-utils/editorShell';

export default function PdfEditorPage() {
  const editor = usePdfEditor();
  const { state, set, dprEpoch, loadPdf, renderPage, getTextBlocks, getOriginalTextEdit, getEditedText, setTextEdit, selectOriginalTextBlock, clearOriginalTextSelection, registerFabricCanvas,
      unregisterFabricCanvas, snapshotFabricPage, snapshotAllFabricPages,
      addTextbox, addEmoji, addImage, addShape, addShapeFromDrag,
      startSignature, stopSignature, renderExportedPageToCanvas,
      applyStyleToSelection, undo, redo, deleteSelected, isFabricTextEditing,
       exportPdf, grantTextEditConsent, flushAutosave, getRecoverableSession, restoreRecoverableSession,
       requestProcessingConsent, confirmProcessingConsent, cancelProcessingConsent, clearCurrentRecovery,
       prepareOcrCopy, runOcrCopy, getExportRevision,
      commitAllEdits, setPageSize, getPageBaseDimensions, renderThumbnail,
      searchDocument, getDocumentOutline, getDocumentComments, applyPageOperation, positionForSourcePage,
      toggleRedactionMark, unmarkRedaction, clearRedactions,
      toggleAnnotationForBlock, addAnnotationAtPoint, replyToAnnotation,
      updateAnnotation, removeAnnotation, selectAnnotation, setAnnotationKind, setAnnotationStyle,
      updateSelectedObjectGeometry, nudgeSelectedObject, updateSelectedObjectStyle,
      toggleSelectedObjectLock, toggleSelectedObjectHidden, duplicateSelectedObject,
      copySelectedObject, pasteObjectToCurrentPage,
      alignSelectedObjects, distributeSelectedObjects,
      selectPageLayer, togglePageLayerLock, togglePageLayerHidden, movePageLayer,
      groupSelectedObjects, ungroupSelectedObject } = editor;

  const redactionEnabled = isPdfEditorFeatureEnabled('redactionAuthoring');

  // Derived from the canvas tool: the button label can never drift out of sync
  // with the actual drawing state, even when other tools interrupt a draw.
  const isSignatureMode = state.activeTool === 'signature';
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; visible: boolean }>({ msg: '', visible: false });
  const [pendingDocumentDialog, setPendingDocumentDialog] = useState<{
    kind: 'recovery' | 'ocr' | 'close'; session: number; revision: string; ocrRequest?: PdfEditorOcrCopyRequest;
  } | null>(null);
  const approvedOcrRequestRef = useRef<PdfEditorOcrCopyRequest | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<{ fileName: string; savedAt: number } | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [pendingExportImpact, setPendingExportImpact] = useState<PdfExportImpact | null>(null);
  const [pendingExportRevision, setPendingExportRevision] = useState<string | null>(null);
  /**
   * The page plan's own impact, kept beside the dialog record because its
   * approval token — not the dialog's export mode — is what authorises the
   * rebuilt document. The dialog reads only presentation fields.
   */
  const [pendingPageImpact, setPendingPageImpact] =
    useState<import('./pdfEdit-utils/editorPageImpact').PdfEditorPageExportImpact | null>(null);
  /**
   * The loss the text engine asked the user to accept, held alongside the impact
   * the dialog is showing. It is separate state because the two are not the same
   * thing: the impact is what the user reads, this is what gets sent back if they
   * agree. An export-mode confirmation carries no consent at all, so this stays
   * null for those and the retry sends no flag.
   */
  const [pendingExportConsent, setPendingExportConsent] =
    useState<ServerTextEditConsentRequest | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [navigationTab, setNavigationTab] = useState<PdfEditorNavigationTab>('pages');
  const [fitMode, setFitMode] = useState<PdfEditorFitMode>('fit-page');
  const [viewMode, setViewMode] = useState<PdfEditorViewMode>('single');

  // Output position → source page. Edits are stored against the source page, so
  // reordering changes where a page appears, never which page the work belongs to.
  const planEntries = state.pagePlan?.entries ?? [];
  const activeEntry = planEntries[state.currentPage - 1] ?? null;
  const activeSourcePage = activeEntry?.sourcePage ?? state.currentPage;
  const hasDuplicateSourcePages = planEntries.length > 0
    && new Set(planEntries.map(entry => entry.sourcePage)).size !== planEntries.length;
  const effectiveViewMode = hasDuplicateSourcePages ? 'single' : viewMode;
  /**
   * What the inspector is describing, and which selection it may trust.
   *
   * The matrix itself lives in `pdfEdit-utils/editorInspectorContext` so it can
   * be proven combination by combination. Two facts come back from it here:
   * the context the rail renders, and whether the Edit-text block selection is
   * really on screen — the latter is shared with the clearing effect below, so
   * the panel and the state can never disagree about which block is selected.
   */
  const textSelectionVisible = isPdfEditorTextSelectionVisible({
    activeTool: state.activeTool,
    selectedTextKey: state.selectedOriginalTextKey,
    sourcePage: activeSourcePage,
  });
  const inspectorContext = resolvePdfEditorInspectorContext({
    activeTool: state.activeTool,
    hasVisibleTextSelection: textSelectionVisible,
    selectedObjectKind: state.selectedObjectKind,
  });
  const inspectorContextLabel = inspectorContext === 'redaction'
    ? 'Redaction'
    : inspectorContext === 'annotation'
      ? 'Annotation'
      : inspectorContext === 'text'
      ? textSelectionVisible ? 'Original text' : 'Added text'
      : inspectorContext === 'signature'
        ? 'Signature'
        : inspectorContext === 'image'
          ? 'Image'
          : inspectorContext === 'emoji'
            ? 'Emoji'
            : inspectorContext === 'shape'
              ? 'Shape'
              : 'Document';
  const [outline, setOutline] = useState<PdfEditorOutlineEntry[]>([]);
  const [comments, setComments] = useState<PdfEditorCommentEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PdfEditorSearchResult[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [pageBaseSize, setPageBaseSize] = useState<{ width: number; height: number } | null>(null);
  /**
   * The file whose fit zoom has been settled.
   *
   * Held as the File itself, not a boolean, so opening another document
   * re-arms by identity: a new File can never inherit the old one's
   * approval. Until this matches, the stage shows one honest card and the
   * canvas is not mounted — its very first raster is then drawn at the
   * fitted zoom instead of at 1.0 and immediately re-drawn.
   */
  const [fitArmedFile, setFitArmedFile] = useState<File | null>(null);
  /** The file whose first committed raster is on screen; clears the prep card. */
  const [firstFrameFile, setFirstFrameFile] = useState<File | null>(null);
  const [isClientReady, setIsClientReady] = useState(false);
  /**
   * The workspace/preview split, as the preview column's maximum.
   *
   * The 320px minimum lives in the track's `minmax()`, so a drag can only
   * make the preview smaller than that by never resolving — the floor is
   * structural, not arithmetic. Dragging is a measurement gesture with no
   * animation and no representative variable to smooth.
   */
  const [previewSplit, setPreviewSplit] = useState(42);
  /**
   * Bumped when the split is dragged. The preview owns its own rebuild
   * debounce; this epoch is only the signal that the panel's width moved and
   * the next build should rasterise for what the panel now measures.
   */
  const [previewLayoutEpoch, setPreviewLayoutEpoch] = useState(0);
  const previewSplitDragRef = useRef(false);
  const workspaceMainRef = useRef<HTMLDivElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  /* Root of the drop screen — the surface the octopus eyes track across. */
  const dropPageRef = useRef<HTMLDivElement | null>(null);
  const dropErrorButtonRef = useRef<HTMLButtonElement | null>(null);
  const dropLoadingRef = useRef<HTMLDivElement | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const fitDebounceRef = useRef<number | null>(null);
  const fitRequestRef = useRef(0);
  /**
   * The page the last fit application ran for.
   *
   * When this lags behind `state.currentPage` the fit is answering a
   * navigation — the page's own size is what changed — and it runs without
   * the settle debounce. A run for the same page is a reaction to layout
   * churn (panels, scrollbars) and keeps the debounce that stops zoom from
   * feeding its own reflow.
   */
  const fitAppliedPageRef = useRef<number | null>(null);
  const editorSetRef = useRef(set);
  const zoomRef = useRef(state.zoom);
  const pageBaseSizeRef = useRef<{ width: number; height: number } | null>(null);

  /**
   * Whether the canvas may exist yet.
   *
   * `custom` zoom is a promise the app can keep on its own — the user chose a
   * scale, and the stage owes them exactly that scale — so it mounts without
   * waiting for a fit calculation. Every other mode waits for the one fit
   * application for this file (or the bounded fallback that arms it anyway).
   */
  const fitArmed = !!state.pdfFile && (fitArmedFile === state.pdfFile || fitMode === 'custom');
  /** The document is open and measurable, so a canvas may exist at all. */
  const documentReady = !!state.pdfFile && !state.isLoading && state.totalPages > 0;
  const pageCanvasMounted = documentReady && fitArmed;
  const firstFrameShown = !!state.pdfFile && firstFrameFile === state.pdfFile;
  /**
   * The prep card covers exactly the window where no raster exists yet: from
   * file open until the first committed frame. It never covers a frame that is
   * already there — the previous page stays readable while the next is drawn.
   */
  const showStagePrep = !!state.pdfFile && !state.loadFailure && !firstFrameShown;
  /**
   * Identity of the open document, as used to key the single-view canvas.
   *
   * Page switches must *not* change a single-view key (that remount was the
   * shaking), but opening another file must: the new document is entitled to a
   * fresh canvas, and the same key would let the old raster survive when the
   * new file happens to land on page 1 at the same zoom.
   */
  const canvasFileKey = state.pdfFile
    ? `${state.pdfFile.name}:${state.pdfFile.size}:${state.pdfFile.lastModified}`
    : 'none';
  /** Read by `scheduleFit`, which must not be re-bound when arming flips. */
  const fitArmedRef = useRef(false);
  fitArmedRef.current = fitArmed;

  /**
   * Pages whose Fabric editing layer is live right now.
   *
   * A set rather than a flag, because continuous view can hold several mounted
   * pages at once; the toolbar only cares about the page the user is on. It
   * exists because some tools do their work the moment they are chosen (Add
   * text places a box immediately), and choosing one while the layer is still
   * mounting used to do nothing at all — the click vanished. The toolbar is
   * disabled until the page it would act on is ready, so the choice always
   * lands somewhere.
   */
  const [fabricLivePages, setFabricLivePages] = useState<ReadonlySet<number>>(() => new Set<number>());
  const handleFabricReady: typeof registerFabricCanvas = useCallback(async (page, fc) => {
    if (!await registerFabricCanvas(page, fc)) return false;
    setFabricLivePages(prev => {
      if (prev.has(page)) return prev;
      const next = new Set(prev);
      next.add(page);
      return next;
    });
    return true;
  }, [registerFabricCanvas]);
  const handleFabricDispose: typeof unregisterFabricCanvas = useCallback((page) => {
    unregisterFabricCanvas(page);
    setFabricLivePages(prev => {
      if (!prev.has(page)) return prev;
      const next = new Set(prev);
      next.delete(page);
      return next;
    });
  }, [unregisterFabricCanvas]);
  /** The page the user is on has an editing layer that can accept work. */
  const editingLayerReady = fabricLivePages.has(activeSourcePage) && !state.isRestoringCanvas;
  const annotationBlocker = pdfEditorAnnotationBlocker({
    page: activeSourcePage, pageSize: state.pageSize,
    sourceRotation: state.sourcePageRotations[activeSourcePage], entries: planEntries,
  });

  useEffect(() => {
    setPendingDocumentDialog(null);
    approvedOcrRequestRef.current = null;
    setPendingExportImpact(null);
    setPendingExportRevision(null);
    setPendingPageImpact(null);
    setPendingExportConsent(null);
  }, [state.documentSession]);

  useEffect(() => {
    editorSetRef.current = set;
  }, [set]);

  useEffect(() => {
    zoomRef.current = state.zoom;
  }, [state.zoom]);

  const showToast = (msg: string, ms = 2500) => {
    setToast({ msg, visible: true });
    setTimeout(() => setToast({ msg: '', visible: false }), ms);
  };

  const runObjectCommand = useCallback((command: () => unknown) => {
    void Promise.resolve().then(command).catch(error => {
      setToast({ msg: error instanceof Error ? error.message : 'The object command failed. Please retry.', visible: true });
      window.setTimeout(() => setToast({ msg: '', visible: false }), 6000);
    });
  }, []);

  useEffect(() => {
    if (state.saveStatus !== 'error' || !state.saveMessage) return;
    setToast({ msg: state.saveMessage, visible: true });
    const timer = window.setTimeout(() => setToast({ msg: '', visible: false }), 7000);
    return () => window.clearTimeout(timer);
  }, [state.saveStatus, state.saveMessage]);

  const handleRunOcr = useCallback(async () => {
    const request = await prepareOcrCopy();
    if (request) setPendingDocumentDialog({ kind: 'ocr', session: request.session, revision: request.revision, ocrRequest: request });
  }, [prepareOcrCopy]);

  // The upload control is present in server-rendered HTML before React has
  // attached react-dropzone's change handler. Expose a deterministic readiness
  // signal so automation (and very fast users) cannot dispatch a file into an
  // inert pre-hydration input and then wait forever for a document to appear.
  useEffect(() => {
    const readyTimer = window.setTimeout(() => setIsClientReady(true), 0);
    return () => window.clearTimeout(readyTimer);
  }, []);

  useEffect(() => {
    let active = true;
    void getRecoverableSession().then(session => {
      if (active && session) {
        setRecoverableDraft({ fileName: session.fileName, savedAt: session.draft.savedAt });
      }
    });
    return () => { active = false; };
  }, [getRecoverableSession]);

  useEffect(() => {
    if (state.loadFailure && !state.isLoading) dropErrorButtonRef.current?.focus();
  }, [state.loadFailure, state.isLoading]);

  useEffect(() => {
    if (state.isLoading && !state.pdfFile) dropLoadingRef.current?.focus();
  }, [state.isLoading, state.pdfFile]);

  useEffect(() => {
    if (!state.pdfFile || !state.totalPages) return;
    let cancelled = false;
    void Promise.all([getDocumentOutline(), getDocumentComments()]).then(([nextOutline, nextComments]) => {
      if (cancelled) return;
      setOutline(nextOutline);
      setComments(nextComments);
    });
    return () => { cancelled = true; };
  }, [getDocumentComments, getDocumentOutline, state.pdfFile, state.totalPages]);

  useEffect(() => {
    if (searchQuery.trim().length < 2 || !state.pdfFile) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      void searchDocument(searchQuery).then(results => {
        if (cancelled) return;
        setSearchResults(results);
        setActiveSearchIndex(0);
        if (results[0]) set({ currentPage: results[0].position });
        setIsSearching(false);
      });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchDocument, searchQuery, set, state.editVersion, state.pdfFile]);

  const applyFitMode = useCallback(async (mode: Exclude<PdfEditorFitMode, 'custom'>) => {
    const area = canvasAreaRef.current;
    const requestId = ++fitRequestRef.current;
    if (!area) return;
    const sourcePage = state.pagePlan?.entries[state.currentPage - 1]?.sourcePage ?? state.currentPage;
    const dimensions = await getPageBaseDimensions(sourcePage);
    if (requestId !== fitRequestRef.current || !dimensions) return;
    const editStage = area.querySelector<HTMLElement>('.pe-edit-stage');
    const viewport = editStage ?? area;
    const previousPageSize = pageBaseSizeRef.current;
    if (previousPageSize?.width !== dimensions.width || previousPageSize?.height !== dimensions.height) {
      pageBaseSizeRef.current = dimensions;
      setPageBaseSize(dimensions);
    }
    const nextZoom = calculatePdfEditorFitZoom({
      mode,
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
      // clientWidth changes when fit-width itself causes a scrollbar to
      // appear/disappear. Use the stable border-box dimensions so zoom does
      // not feed a scrollbar change back into another zoom calculation.
      viewportWidth: viewport.getBoundingClientRect().width,
      viewportHeight: viewport.getBoundingClientRect().height,
      horizontalPadding: 64,
      verticalPadding: 64,
    });
    // ResizeObserver can report sub-pixel layout changes while the rendered
    // page is being resized. Avoid turning those no-op fit calculations into
    // a fresh PDF.js/Fabric render cycle.
    //
    // Arming happens *before* that early return on purpose: the fit has
    // produced a real page size either way, and it is the size that this
    // gate is waiting for. A fit that lands on the zoom already in state is
    // still the moment the first frame may be drawn.
    if (state.pdfFile) {
      setFitArmedFile(current => (current === state.pdfFile ? current : state.pdfFile));
    }
    if (Math.abs(zoomRef.current - nextZoom) < 0.001) return;
    zoomRef.current = nextZoom;
    editorSetRef.current({ zoom: nextZoom });
  }, [getPageBaseDimensions, state.currentPage, state.pagePlan, state.pdfFile]);

  useEffect(() => {
    if (!state.pdfFile || state.isLoading || state.totalPages < 1 || fitMode === 'custom') return;
    const scheduleFit = () => {
      // Panel transitions and scrollbar changes can produce several resize
      // notifications in a single layout pass. Wait for the layout to settle
      // before applying fit-width so zoom cannot participate in that reflow.
      //
      // Two exceptions run on the next task instead:
      //  - the first application for a file that is not armed yet: that layout
      //    was just produced by the open itself, and there is no transition to
      //    wait out. Running it immediately is what makes the first frame
      //    appear promptly — behind it there is only the prep card;
      //  - the first application after a page change: the page's own size is
      //    already known, and letting the render start at the previous page's
      //    fit means committing a raster at the wrong scale and replacing it
      //    moments later (a second commit the user sees as a lurch). One
      //    settled fit, one commit.
      // Every other run (panel moves, window resizes) keeps the full debounce.
      const pageChanged = fitAppliedPageRef.current !== state.currentPage;
      if (fitDebounceRef.current !== null) window.clearTimeout(fitDebounceRef.current);
      fitDebounceRef.current = window.setTimeout(() => {
        fitDebounceRef.current = null;
        if (fitFrameRef.current !== null) return;
        fitFrameRef.current = window.requestAnimationFrame(() => {
          fitFrameRef.current = null;
          fitAppliedPageRef.current = state.currentPage;
          void applyFitMode(fitMode);
        });
      }, (!fitArmedRef.current || pageChanged) ? 0 : 220);
    };
    scheduleFit();
    // Fit-width changes the rendered page's intrinsic size. Observing a
    // container that owns that page creates a resize feedback loop when a
    // scrollbar is added or removed during the render. Panel state changes
    // are already effect dependencies; browser resizes are the only other
    // layout changes that need to recalculate fit-width.
    const layout = workspaceMainRef.current;
    const observer = fitMode === 'fit-width' || !layout || typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleFit);
    if (layout && observer) observer.observe(layout, { box: 'border-box' });
    if (fitMode === 'fit-width') window.addEventListener('resize', scheduleFit);
    return () => {
      fitRequestRef.current += 1;
      if (fitDebounceRef.current !== null) {
        window.clearTimeout(fitDebounceRef.current);
        fitDebounceRef.current = null;
      }
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      observer?.disconnect();
      if (fitMode === 'fit-width') window.removeEventListener('resize', scheduleFit);
    };
  }, [applyFitMode, fitMode, inspectorOpen, isPreviewOpen, navigationOpen, state.currentPage, state.isLoading, state.pdfFile, state.totalPages]);

  /**
   * Safety valve for the arming gate.
   *
   * If the fit never lands — dimensions that never arrive, a layout the fit
   * refuses, a request the observer cancels — the stage must not sit behind
   * the prep card forever. After one bounded wait the file is armed regardless:
   * the first raster may then be drawn at the document's default zoom, which is
   * still a correct, complete frame, and every later fit corrects it the normal
   * way. Bounded, so it can never fire for a file that is already armed.
   */
  useEffect(() => {
    if (!documentReady || fitArmed) return;
    const file = state.pdfFile;
    const timer = window.setTimeout(() => {
      setFitArmedFile(current => (current === file ? current : file));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [documentReady, fitArmed, state.pdfFile]);

  useEffect(() => {
    if (effectiveViewMode !== 'continuous') return;
    const target = canvasAreaRef.current?.querySelector<HTMLElement>(`[data-pdf-page-shell="${state.currentPage}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [state.currentPage, effectiveViewMode]);

  /**
   * A text-block selection that is no longer on screen is dropped, not hidden.
   *
   * `textSelectionVisible` is the same predicate the rail uses, so the state
   * field, the status line and the panel always describe the same block. The
   * sync lives here, driven by state, because a block can leave the screen
   * through a dozen doors — the tool changing, and a page change from any of
   * the navigation paths (thumbnails, prev/next, search, palette, page
   * operations), none of which go through `handleToolChange` or know that a
   * text block was selected at all.
   */
  useEffect(() => {
    if (state.selectedOriginalTextKey && !textSelectionVisible) clearOriginalTextSelection();
  }, [state.selectedOriginalTextKey, textSelectionVisible, clearOriginalTextSelection]);

  // ── Dropzone ────────────────────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    const pdf = accepted[0];
    if (pdf) {
      setPendingFileName(pdf.name);
      setIsPreviewOpen(false);
      void loadPdf(pdf);
    }
  }, [loadPdf]);

  const onDropRejected = useCallback((rejections: { file: File }[]) => {
    const rejectedFile = rejections[0]?.file;
    if (rejectedFile) {
      setPendingFileName(rejectedFile.name);
      void loadPdf(rejectedFile);
    }
  }, [loadPdf]);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024,
    noClick: !!state.pdfFile,   // disable click once a file is loaded
    noDrag:  !!state.pdfFile,
    disabled: !isClientReady || state.isLoading,
  });

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      const modifier = e.ctrlKey || e.metaKey;
      if (modifier && !e.altKey && key === 'k') {
        e.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen(open => !open);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        return;
      }
      if (isEditableShortcutTarget(e.target) || isFabricTextEditing()) return;

      if (!modifier && e.key === '?') {
        e.preventDefault();
        setPaletteOpen(false);
        setShortcutsOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'c') {
        e.preventDefault();
        runObjectCommand(copySelectedObject);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'v') {
        e.preventDefault();
        runObjectCommand(pasteObjectToCurrentPage);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight'
        || e.key === 'ArrowUp' || e.key === 'ArrowDown')
        && !modifier && !e.altKey && state.selectedObjectGeometry) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        runObjectCommand(() => nudgeSelectedObject(dx, dy));
        return;
      }
      if (isDeleteShortcut(e)) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, deleteSelected, isFabricTextEditing, nudgeSelectedObject, state.selectedObjectGeometry, copySelectedObject, pasteObjectToCurrentPage, runObjectCommand]);

  /**
   * Presentation adapter for the shared impact dialog. The page plan remains
   * the source of truth for approval; this only maps its disclosure into the
   * fields the dialog renders, so the product keeps one refusal language.
   */
  const pageImpactToExportImpact = (
    impact: import('./pdfEdit-utils/editorPageImpact').PdfEditorPageExportImpact,
  ): PdfExportImpact => ({
    decision: {
      mode: impact.strategy === 'byte-preserving'
        ? 'byte-preserving'
        : impact.strategy === 'rotation-in-place'
          ? 'structure-preserving'
          : 'compatibility-render',
      preservation: impact.preservation === 'exact'
        ? 'exact'
        : impact.preservation === 'source-structure'
          ? 'source-structure'
          : 'visual-and-searchable',
      reason: impact.summary,
    },
    severity: state.redactionMarks.length > 0
      ? 'critical'
      : impact.severity === 'none' ? 'none' : impact.severity,
    requiresConfirmation: impact.requiresConfirmation || state.redactionMarks.length > 0,
    title: impact.title,
    summary: `${impact.summary} ${impact.pageChanges.join(' ')}${state.redactionMarks.length > 0
      ? ` ${state.redactionMarks.length} redaction${state.redactionMarks.length === 1 ? '' : 's'} will also be removed permanently.`
      : ''}`.trim(),
    consequences: [
      ...(impact.pageChanges.length
        ? [{
            id: 'page-plan-changes',
            severity: impact.severity === 'none' ? 'info' as const : 'warning' as const,
            title: 'Page changes in this export',
            detail: impact.pageChanges.join(' '),
          }]
        : []),
      ...impact.consequences,
      ...(state.redactionMarks.length > 0
        ? [{
            id: 'redaction',
            severity: 'critical' as const,
            title: 'Redacted text will be removed permanently',
            detail: `${state.redactionMarks.length} marked text run${state.redactionMarks.length === 1 ? '' : 's'} will be deleted from the exported content stream and verified absent. This cannot be undone in the downloaded file.`,
          }]
        : []),
      ...impact.scanWarnings.map((warning, index) => ({
        id: `page-scan-warning-${index}`,
        severity: 'warning' as const,
        title: 'Preservation could not be fully confirmed',
        detail: warning,
      })),
    ],
    preservationNotes: impact.preservationNotes,
    confirmLabel: state.redactionMarks.length > 0 ? 'Export redacted PDF' : impact.confirmLabel,
  });

  const finishExport = async (result: Awaited<ReturnType<typeof exportPdf>>) => {
    if (!result.ok && result.processingRequired) {
      requestProcessingConsent('export');
      return;
    }
    if (!result.ok && result.impact) {
      setPendingExportRevision(result.approvalRevision ?? null);
      // Only a real, material loss — signed or encrypted documents, or a text
      // edit the engine cannot do without permission — still asks.
      setPendingExportConsent(result.consent ?? null);
      setPendingExportImpact(result.impact);
      return;
    }
    if (!result.ok && result.pageImpact) {
      setPendingExportRevision(result.approvalRevision ?? null);
      setPendingExportConsent(null);
      setPendingPageImpact(result.pageImpact);
      setPendingExportImpact(pageImpactToExportImpact(result.pageImpact));
      return;
    }
    if (!result.ok) {
      showToast(`Export failed: ${result.message}`, 5000);
      return;
    }
    try {
      void fetch('/api/usage/feature-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_id: 'pdf-editor', event_id: crypto.randomUUID(), file_name: result.fileName }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* Usage reporting never interrupts an export. */ }
    // Success toasts stay short and positive; any fidelity details are already
    // surfaced in the status bar with the full explanation on hover.
    showToast(`${result.fileName} exported and verified successfully`, 3000);
  };

  const handleExport = async () => {
    commitAllEdits();
    snapshotAllFabricPages();
    await finishExport(await exportPdf());
  };

  const handleProcessingConfirm = async () => {
    const request = state.processingRequest;
    if (!request || !confirmProcessingConsent(request)) return;
    if (request.purpose === 'export') await handleExport();
    if (request.purpose === 'ocr' && approvedOcrRequestRef.current?.session === request.session) {
      const ocrRequest = approvedOcrRequestRef.current;
      approvedOcrRequestRef.current = null;
      await runOcrCopy(ocrRequest);
    }
  };

  const handleDocumentConfirm = async () => {
    const request = pendingDocumentDialog;
    setPendingDocumentDialog(null);
    if (!request || request.session !== state.documentSession) return;
    if (request.kind === 'recovery') {
      await clearCurrentRecovery(request.session);
      setRecoverableDraft(null);
    } else if (request.revision !== getExportRevision()) {
      showToast('The document changed after this review. Review the current document before continuing.', 5000);
    } else if (request.kind === 'close') {
      setIsPreviewOpen(false);
      set({ pdfFile: null, totalPages: 0, sourcePageCount: 0, pagePlan: null, currentPage: 1 });
    } else if (request.ocrRequest) {
      if (state.processingAllowed) await runOcrCopy(request.ocrRequest);
      else {
        approvedOcrRequestRef.current = request.ocrRequest;
        requestProcessingConsent('ocr');
      }
    }
  };

  const handleConfirmedExport = async () => {
    const impact = pendingExportImpact;
    const pageImpact = pendingPageImpact;
    if (!impact) return;
    const requestedConsent = pendingExportConsent;
    const approvalRevision = pendingExportRevision;
    setPendingExportImpact(null);
    setPendingExportRevision(null);
    setPendingPageImpact(null);
    setPendingExportConsent(null);
    if (pageImpact) {
      // Page approval is bound to the exact plan/strategy that was shown.
      await finishExport(await exportPdf({
        pageApprovalToken: pageImpact.approvalToken,
        approvalRevision: approvalRevision ?? undefined,
        // The page-change dialog carries the redaction consequence when marks
        // exist, so confirming it is also the redaction acknowledgement.
        redactionApproved: state.redactionMarks.length > 0,
      }));
      return;
    }
    // The grant has to be passed explicitly as well as recorded: the state it
    // writes is not visible to this same tick, so relying on it would refuse the
    // retry for the loss the user just accepted.
    const consent = requestedConsent ? grantTextEditConsent(requestedConsent, approvalRevision) : undefined;
    await finishExport(await exportPdf({
      confirmedMode: impact.decision.mode,
      approvalRevision: approvalRevision ?? undefined,
      consent,
      redactionApproved: state.redactionMarks.length > 0,
    }));
  };

  const closePendingExportDialog = () => {
    setPendingExportImpact(null);
    setPendingExportRevision(null);
    setPendingPageImpact(null);
    setPendingExportConsent(null);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="pdf-export-button"]')?.focus();
    }, 0);
  };

  // ── Handlers ────────────────────────────────────────────────
  const handleToolChange = (tool: ToolType) => {
    // Textarea values only live in the DOM until committed. Switching tools must
    // flush them first, or a line typed just before choosing Redact would be
    // visible on screen but absent from the next preview/export.
    if (state.activeTool === 'editText' && tool !== 'editText') {
      commitAllEdits();
    }
    // Leaving draw mode must always clean up the free-drawing brush state
    // before the new tool takes over, so the UI stays consistent.
    if (isSignatureMode && tool !== 'signature') {
      stopSignature(activeSourcePage);
    }
    set({ activeTool: tool });
    // Canvas double-click adds text — handled inside PdfEditorCanvas
    if (tool === 'text') {
      addTextbox(activeSourcePage);
    } else if (tool === 'signature') {
      startSignature(activeSourcePage);
    } else if (tool === 'annotate') {
      setInspectorOpen(true);
    } else if (tool === 'highlight') {
      // The standalone Highlight tool remains click-to-place: it drops a marker
      // rectangle. The Annotate tool is the one that writes real PDF
      // highlight annotations on a text run.
      addShape(activeSourcePage, 'highlight');
      set({ activeTool: 'select' });
    }
    // Shape tools arm the canvas: the object is created from the drag, not at a
    // fixed preset position. `addShape` remains available for callers that want
    // click-to-place, but the toolbar gesture is a drag.
  };

  /**
   * A completed drag becomes a real object through the hook, and the tool returns
   * to Select so the new shape can be moved immediately. A cancelled drag leaves
   * the tool armed for another attempt.
   */
  const handleShapeDragCreate = (
    page: number,
    shape: import('./pdfEdit-utils/editorShapeDrag').PdfEditorDragShape,
    geometry: import('./pdfEdit-utils/editorShapeDrag').PdfEditorDragGeometry,
  ) => {
    if (addShapeFromDrag(page, shape, geometry)) set({ activeTool: 'select' });
  };

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      setActiveSearchIndex(0);
      setIsSearching(false);
    }
  };

  const stepSearchResult = (direction: -1 | 1) => {
    if (!searchResults.length) return;
    const next = (activeSearchIndex + direction + searchResults.length) % searchResults.length;
    setActiveSearchIndex(next);
    set({ currentPage: searchResults[next].position });
  };

  const handleSignatureStop = () => {
    stopSignature(activeSourcePage);
  };

  const handleEmojiSelect = (emoji: string) => {
    addEmoji(activeSourcePage, emoji);
    set({ activeTool: 'select' });
  };

  const handleImageInsert = (file: File) => {
    addImage(activeSourcePage, file);
    set({ activeTool: 'select' });
  };

  const handleSignatureUpload = (file: File) => {
    if (isSignatureMode) {
      stopSignature(activeSourcePage);
    }
    addImage(activeSourcePage, file, {
      defaultWidth: 180,
      objectName: 'uploaded-signature',
    });
    set({ activeTool: 'select' });
  };

  const handleClose = async () => {
    commitAllEdits();
    snapshotAllFabricPages();
    if (state.recoveryStatus !== 'enabled') {
      setPendingDocumentDialog({ kind: 'close', session: state.documentSession, revision: getExportRevision() });
      return;
    }
    const saved = await flushAutosave();
    if (!saved) {
      showToast(state.saveMessage ?? 'Draft could not be saved. Export before closing.', 5000);
      return;
    }
    setIsPreviewOpen(false);
    set({ pdfFile: null, totalPages: 0, sourcePageCount: 0, pagePlan: null, currentPage: 1 });
  };

  const handleRecoverDraft = async () => {
    setIsRecovering(true);
    setRecoveryError(null);
    const restored = await restoreRecoverableSession();
    setIsRecovering(false);
    if (restored) {
      setRecoverableDraft(null);
    } else {
      setRecoveryError("This draft couldn't be restored. Open the PDF again to start a new session.");
    }
  };

  // ── Zoom ────────────────────────────────────────────────────
  const ZOOM_STEP = 0.15;
  const zoomIn    = () => { setFitMode('custom'); set({ zoom: Math.min(state.zoom + ZOOM_STEP, 3.0) }); };
  const zoomOut   = () => { setFitMode('custom'); set({ zoom: Math.max(state.zoom - ZOOM_STEP, 0.4) }); };
  const zoomReset = () => { setFitMode('actual-size'); set({ zoom: 1.0 }); };

  // ── Page nav ────────────────────────────────────────────────
  const prevPage = () => {
    commitAllEdits();
    snapshotFabricPage(activeSourcePage);
    set({ currentPage: Math.max(1, state.currentPage - 1) });
  };

  const nextPage = () => {
    commitAllEdits();
    snapshotFabricPage(activeSourcePage);
    set({ currentPage: Math.min(state.totalPages, state.currentPage + 1) });
  };

  // ── Page plan ────────────────────────────────────────────────
  const handlePageOperation = (operation: import('./pdfEdit-utils/editorPageModel').PdfEditorPageOperation) => {
    const result = applyPageOperation(operation);
    if (!result.ok) {
      const messages: Record<string, string> = {
        'invalid-source-page-count': 'This document has no usable pages.',
        'invalid-rotation': 'Only quarter turns are supported.',
        'page-out-of-range': 'That page is no longer in the document.',
        'invalid-target-index': 'That position is outside the document.',
        'empty-page-selection': 'Select at least one page.',
        'would-delete-every-page': 'A PDF must keep at least one page.',
      };
      showToast(('message' in result ? result.message : undefined) ?? messages[result.reason] ?? 'That page change could not be applied.', 4000);
      return;
    }
    if (result.changed && operation.type === 'duplicate') {
      // Two output pages would share one Fabric overlay. Single view keeps the
      // editing surface honest until per-entry overlays exist.
      setViewMode('single');
    }
  };

  const handleViewModeChange = (mode: PdfEditorViewMode) => {
    if (mode === 'continuous' && hasDuplicateSourcePages) {
      showToast('Continuous view is unavailable while a page appears more than once.', 4000);
      setViewMode('single');
      return;
    }
    setViewMode(mode);
  };

  const handlePreviewToggle = () => {
    commitAllEdits();
    snapshotAllFabricPages();
    setIsPreviewOpen(open => !open);
  };

  /**
   * The split drag. The divider measures against the canvas area: 100% is the
   * whole split row, so what the user sets is literally "how much of the row
   * the preview may take". The 24–68 clamp is the usable band — beyond either
   * end one of the two panels stops being a workspace, and clamping at the
   * ends is also what keeps keyboard and pointer users in the same range.
   */
  const PREVIEW_SPLIT_MIN = 24;
  const PREVIEW_SPLIT_MAX = 68;

  const applyPreviewSplit = (pct: number) => {
    const clamped = Math.min(PREVIEW_SPLIT_MAX, Math.max(PREVIEW_SPLIT_MIN, pct));
    setPreviewSplit((current) => (Math.abs(current - clamped) < 0.25 ? current : clamped));
  };

  const handlePreviewDividerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    previewSplitDragRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePreviewDividerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!previewSplitDragRef.current) return;
    const area = canvasAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    applyPreviewSplit(100 - ((event.clientX - rect.left) / rect.width) * 100);
  };

  const handlePreviewDividerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!previewSplitDragRef.current) return;
    previewSplitDragRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePreviewDividerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -2, ArrowRight: 2 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    applyPreviewSplit(previewSplit + step);
  };

  /**
   * A moved split is the preview rebuild signal, though only once the value
   * has actually changed — the effect on a mount fires a first bump (the
   * epoch starts at 1, never 0), which is harmless: the panel's first build
   * is the rebuild it was doing anyway.
   */
  useEffect(() => {
    setPreviewLayoutEpoch(epoch => epoch + 1);
  }, [previewSplit]);

  /** Palette ids are stable strings; this is the only place they become actions. */
  const runPaletteCommand = (id: string) => {
    setPaletteOpen(false);
    const toolIds: Record<string, ToolType> = {
      'tool-select': 'select',
      'tool-editText': 'editText',
      'tool-text': 'text',
      'tool-highlight': 'highlight',
      'tool-annotate': 'annotate',
      'tool-signature': 'signature',
      'tool-shape-rect': 'rect',
      'tool-shape-circle': 'circle',
      'tool-shape-line': 'line',
      'tool-shape-arrow': 'arrow',
      'tool-image': 'image',
      'tool-emoji': 'emoji',
    };
    const tool = toolIds[id];
    if (tool) {
      handleToolChange(tool);
      if (tool === 'image' || tool === 'emoji' || tool === 'signature') setInspectorOpen(true);
      return;
    }

    switch (id) {
      case 'view-fit-page':
        setFitMode('fit-page');
        void applyFitMode('fit-page');
        break;
      case 'view-fit-width':
        setFitMode('fit-width');
        break;
      case 'view-actual':
        setFitMode('actual-size');
        void applyFitMode('actual-size');
        break;
      case 'view-single':
        handleViewModeChange('single');
        break;
      case 'view-continuous':
        handleViewModeChange('continuous');
        break;
      case 'page-prev':
        prevPage();
        break;
      case 'page-next':
        nextPage();
        break;
      case 'page-first':
        set({ currentPage: 1 });
        break;
      case 'page-last':
        set({ currentPage: state.totalPages });
        break;
      case 'panel-organizer':
        setNavigationOpen(true);
        setNavigationTab('organize');
        break;
      case 'panel-navigation':
        setNavigationOpen(open => !open);
        break;
      case 'panel-inspector':
        setInspectorOpen(open => !open);
        break;
      case 'document-preview':
        handlePreviewToggle();
        break;
      case 'document-export':
        void handleExport();
        break;
      case 'edit-undo':
        undo();
        break;
      case 'edit-redo':
        redo();
        break;
      case 'shortcuts':
        setShortcutsOpen(true);
        break;
      default:
        break;
    }
  };

  const shortcutActionsRef = useRef({
    handleExport,
    zoomIn,
    zoomOut,
    prevPage,
    nextPage,
    applyFitMode,
    setFitMode,
    set,
    isFabricTextEditing,
    totalPages: state.totalPages,
  });
  // The listener below is registered once and reads the latest closures through
  // this ref, so it must be refreshed after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    shortcutActionsRef.current = {
      handleExport,
      zoomIn,
      zoomOut,
      prevPage,
      nextPage,
      applyFitMode,
      setFitMode,
      set,
      isFabricTextEditing,
      totalPages: state.totalPages,
    };
  });

  // Navigation, fit and delivery keys. The handler reads the latest actions
  // through a ref so the listener is registered once and never churns.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]') || event.defaultPrevented) return;
      const actions = shortcutActionsRef.current;
      if (isEditableShortcutTarget(event.target) || actions.isFabricTextEditing()) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && !event.altKey && key === 'f') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-testid="pdf-document-search"]')?.focus();
        return;
      }
      if (modifier && !event.altKey && key === 's') {
        event.preventDefault();
        void actions.handleExport();
        return;
      }
      if (modifier && !event.altKey && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        actions.zoomIn();
        return;
      }
      if (modifier && !event.altKey && event.key === '-') {
        event.preventDefault();
        actions.zoomOut();
        return;
      }
      if (event.altKey || modifier) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        actions.prevPage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        actions.nextPage();
      } else if (event.key === 'Home') {
        event.preventDefault();
        actions.set({ currentPage: 1 });
      } else if (event.key === 'End') {
        event.preventDefault();
        actions.set({ currentPage: actions.totalPages });
      } else if (event.key === '1') {
        actions.setFitMode('fit-page');
        void actions.applyFitMode('fit-page');
      } else if (event.key === '2') {
        actions.setFitMode('fit-width');
      } else if (event.key === '3') {
        actions.setFitMode('actual-size');
        void actions.applyFitMode('actual-size');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // RENDER — Drop zone (no file loaded yet)
  // ══════════════════════════════════════════════════════════════
  if (!state.pdfFile) {
    const dropIsRejecting = isDragActive && isDragReject;
    const dropSheetLabel = dropIsRejecting
      ? 'PDF ONLY'
      : isDragActive
        ? 'READY'
        : state.isLoading
          ? 'OPENING'
          : state.loadFailure
            ? 'NOT OPENED'
            : 'INTAKE';
    const dropTitle = dropIsRejecting
      ? 'PDF only'
      : isDragActive
        ? 'Release to open'
        : 'Drop your document here';
    const dropSub = dropIsRejecting
      ? "This editor can't open that file type. Choose a PDF to continue."
      : isDragActive
        ? 'Release to open the document.'
        : 'or choose a file from your device';

    return (
      <>
        <style>{`
          .pe-drop-page {
            --pe-drop-canvas: #ededea;
            --pe-drop-sheet: #fcfcfa;
            --pe-drop-sheet-hover: #ffffff;
            --pe-drop-ink: #17161b;
            --pe-drop-muted: #55515d;
            --pe-drop-faint: #5f5b66;
            --pe-drop-line: rgba(23,22,27,.14);
            --pe-drop-line-strong: rgba(23,22,27,.30);
            --pe-drop-signal: #c44735;
            --pe-drop-signal-ink: #9e3226;
            --pe-drop-signal-soft: rgba(196,71,53,.08);
            --pe-drop-button: #17161b;
            --pe-drop-button-hover: #262430;
            --pe-drop-button-ink: #ffffff;
            --pe-drop-success: #236b50;
            --pe-drop-shadow: 0 30px 70px rgba(31,27,40,.10), 0 2px 6px rgba(31,27,40,.05);
            --pe-drop-shadow-lift: 0 40px 90px rgba(31,27,40,.14), 0 3px 8px rgba(31,27,40,.06);
            --pe-drop-ease-out: cubic-bezier(.16,1,.3,1);
            --pe-drop-ease-in-out: cubic-bezier(.4,0,.2,1);
            --pe-drop-dur-fast: 120ms;
            --pe-drop-dur-base: 200ms;
            min-height: 100vh; min-height: 100dvh;
            padding: 28px 40px 40px; box-sizing: border-box;
            background: var(--pe-drop-canvas);
            display: flex; flex-direction: column;
            font-family: 'DM Sans', sans-serif;
            position: relative; overflow-x: hidden; overflow-y: auto;
            color: var(--pe-drop-ink);
            transition: background-color .35s var(--pe-drop-ease-in-out), color .35s var(--pe-drop-ease-in-out);
          }
          [data-theme="dark"] .pe-drop-page {
            --pe-drop-canvas: #0b0a0f;
            --pe-drop-sheet: #141319;
            --pe-drop-sheet-hover: #17161d;
            --pe-drop-ink: #f3f0ea;
            --pe-drop-muted: #b3aeba;
            --pe-drop-faint: #8f8a9a;
            --pe-drop-line: rgba(243,240,234,.14);
            --pe-drop-line-strong: rgba(243,240,234,.30);
            --pe-drop-signal: #ff8a72;
            --pe-drop-signal-ink: #ffb09f;
            --pe-drop-signal-soft: rgba(255,138,114,.10);
            --pe-drop-button: #f3f0ea;
            --pe-drop-button-hover: #ffffff;
            --pe-drop-button-ink: #141319;
            --pe-drop-success: #7fc8a4;
            --pe-drop-shadow: 0 30px 80px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.04) inset;
            --pe-drop-shadow-lift: 0 40px 100px rgba(0,0,0,.46), 0 1px 0 rgba(255,255,255,.05) inset;
          }

          .pe-drop-head {
            width: 100%; max-width: 1120px; margin: 0 auto;
            display: flex; align-items: center; justify-content: space-between; gap: 24px;
            padding-bottom: 16px; border-bottom: 1px solid var(--pe-drop-line);
            animation: pe-drop-enter .36s var(--pe-drop-ease-out) both;
          }
          .pe-drop-brand {
            display: inline-flex; align-items: center; gap: 10px;
            min-height: 44px; color: var(--pe-drop-ink); text-decoration: none;
            border-radius: 10px;
          }
          .pe-drop-brand:focus-visible { outline: 2px solid var(--pe-drop-signal); outline-offset: 4px; }
          .pe-drop-logo-mark {
            /* Wrapper for the animated octopus (hard-fixed at 42px in its own
               module) slotted at 40px — scaled from the wrapper, the same
               approach the topbar uses. Its eye-tracking reads
               getBoundingClientRect(), which stays correct under the scale. */
            position: relative; display: block; width: 40px; height: 40px; flex: 0 0 auto;
          }
          .pe-drop-logo-mark > span {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0.9524);
          }
          .pe-drop-wordmark {
            display: inline-flex; align-items: center; color: var(--pe-drop-ink);
            font-family: 'Syne', sans-serif; font-size: 25px; font-weight: 800;
            letter-spacing: -.05em; line-height: 1;
          }
          .pe-drop-wordmark::after {
            content: ''; width: 7px; height: 7px; margin: 0 0 0 4px;
            border-radius: 50%; background: var(--pe-drop-signal);
            box-shadow: 0 0 0 4px var(--pe-drop-signal-soft);
          }
          .pe-drop-head-label {
            color: var(--pe-drop-muted); font-size: 9.5px; font-weight: 700;
            letter-spacing: .16em; text-transform: uppercase; white-space: nowrap;
          }
          .pe-drop-recovery {
            display: flex; align-items: center; gap: 12px;
            max-width: min(100%, 420px); padding: 6px 6px 6px 12px;
            border: 1px solid var(--pe-drop-line); border-radius: 10px;
            background: var(--pe-drop-sheet);
          }
          .pe-drop-recovery-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--pe-drop-muted); flex: 0 0 auto;
          }
          .pe-drop-recovery-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
          .pe-drop-recovery-title { color: var(--pe-drop-ink); font-size: 11.5px; font-weight: 700; }
          .pe-drop-recovery-meta {
            color: var(--pe-drop-faint); font-size: 10px; line-height: 1.4;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            font-variant-numeric: tabular-nums;
          }
          .pe-drop-recovery-error { color: var(--pe-drop-signal-ink); font-size: 10px; line-height: 1.45; }
          .pe-drop-recovery-btn {
            flex-shrink: 0; min-height: 30px; padding: 0 12px; border-radius: 8px;
            border: 1px solid transparent; background: var(--pe-drop-button); color: var(--pe-drop-button-ink);
            font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 700; cursor: pointer;
            transition: transform var(--pe-drop-dur-fast) var(--pe-drop-ease-out), border-color var(--pe-drop-dur-fast) var(--pe-drop-ease-out);
          }
          .pe-drop-recovery-btn:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--pe-drop-signal); }
          .pe-drop-recovery-btn:disabled { opacity: .55; cursor: wait; }
          .pe-drop-recovery-btn:focus-visible { outline: 2px solid var(--pe-drop-signal); outline-offset: 3px; }

          .pe-drop-shell {
            flex: 1; width: 100%; max-width: 1120px; margin: 0 auto;
            display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px);
            justify-content: space-between; align-items: center;
            gap: clamp(40px, 7vw, 112px);
            padding: clamp(32px, 5vh, 64px) 0;
          }
          .pe-drop-intro {
            max-width: 460px;
            animation: pe-drop-enter .36s var(--pe-drop-ease-out) 60ms both;
            transition: opacity var(--pe-drop-dur-base) var(--pe-drop-ease-out);
          }
          .pe-drop-page.is-intake-dragging .pe-drop-intro { opacity: .55; }
          .pe-drop-eyebrow {
            margin: 0 0 16px; color: var(--pe-drop-muted); font-size: 10px;
            font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
          }
          .pe-drop-title {
            margin: 0; color: var(--pe-drop-ink);
            font-family: 'Syne', sans-serif; font-size: clamp(44px, 5.4vw, 68px);
            font-weight: 800; line-height: .95; letter-spacing: -.045em;
          }
          .pe-drop-title-dot { color: var(--pe-drop-signal); }
          .pe-drop-sub {
            max-width: 40ch; margin: 22px 0 0;
            color: var(--pe-drop-muted); font-size: 15.5px; line-height: 1.65;
          }
          .pe-drop-ledger {
            list-style: none; display: flex; flex-wrap: wrap; gap: 14px 20px;
            margin: 34px 0 0; padding: 18px 0 0; border-top: 1px solid var(--pe-drop-line);
          }
          .pe-drop-ledger li {
            display: inline-flex; align-items: center; gap: 7px;
            color: var(--pe-drop-ink); font-size: 11.5px; font-weight: 600; letter-spacing: .01em;
          }
          .pe-drop-ledger svg { width: 14px; height: 14px; color: var(--pe-drop-faint); flex: 0 0 auto; }
          .pe-drop-trust {
            display: flex; align-items: center; gap: 7px; margin: 20px 0 0;
            color: var(--pe-drop-muted); font-size: 11.5px; line-height: 1.5;
          }
          .pe-drop-trust svg { color: var(--pe-drop-success); flex: 0 0 auto; }

          .pe-drop-mount-wrap {
            justify-self: end; position: relative; width: min(100%, 440px, 48vh);
            padding-top: 22px; cursor: pointer;
            animation: pe-drop-enter .36s var(--pe-drop-ease-out) 120ms both;
          }
          .pe-drop-mount-wrap:focus { outline: none; }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) { cursor: copy; }
          .pe-drop-mount-wrap.is-rejecting { cursor: not-allowed; }
          .pe-drop-mount-wrap.is-loading { cursor: progress; }
          .pe-drop-mount-wrap.is-loading .pe-drop-sheet { cursor: progress; }
          .pe-drop-tags {
            position: absolute; top: 0; left: 0; right: 0;
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            pointer-events: none;
          }
          .pe-drop-tag {
            color: var(--pe-drop-muted); font-size: 9px; font-weight: 700;
            letter-spacing: .16em; text-transform: uppercase; line-height: 1;
            font-variant-numeric: tabular-nums;
            transition: color var(--pe-drop-dur-fast) var(--pe-drop-ease-out);
          }
          .pe-drop-tag.is-state { color: var(--pe-drop-faint); }
          .pe-drop-mount-wrap.is-dragging .pe-drop-tag.is-state,
          .pe-drop-mount-wrap.has-error:not(.is-dragging) .pe-drop-tag.is-state { color: var(--pe-drop-signal-ink); }
          .pe-drop-sheet {
            position: relative; width: 100%; aspect-ratio: 1 / 1.34; box-sizing: border-box;
            border: 1px solid var(--pe-drop-line); border-radius: 3px;
            background: var(--pe-drop-sheet); box-shadow: var(--pe-drop-shadow);
            transition:
              transform var(--pe-drop-dur-base) var(--pe-drop-ease-out),
              border-color var(--pe-drop-dur-fast) var(--pe-drop-ease-out),
              background-color .35s var(--pe-drop-ease-in-out),
              box-shadow var(--pe-drop-dur-base) var(--pe-drop-ease-out);
          }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-sheet {
            transform: translateY(-2px); box-shadow: var(--pe-drop-shadow-lift);
          }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-sheet {
            transform: translateY(-4px) scale(1.005);
            border-color: var(--pe-drop-signal);
            background: var(--pe-drop-sheet-hover);
            box-shadow: var(--pe-drop-shadow-lift);
          }
          .pe-drop-mount-wrap.is-rejecting .pe-drop-sheet { border-color: var(--pe-drop-signal-ink); }
          .pe-drop-mount-wrap.has-error:not(.is-dragging) .pe-drop-sheet { border-color: var(--pe-drop-signal-ink); }
          .pe-drop-corners { position: absolute; inset: 14px; pointer-events: none; z-index: 2; }
          .pe-drop-corner {
            position: absolute; width: 18px; height: 18px;
            border-color: var(--pe-drop-line-strong);
            transition: transform var(--pe-drop-dur-base) var(--pe-drop-ease-out), border-color var(--pe-drop-dur-fast) var(--pe-drop-ease-out);
          }
          .pe-drop-corner.tl { top: 0; left: 0; border-top: 2px solid; border-left: 2px solid; }
          .pe-drop-corner.tr { top: 0; right: 0; border-top: 2px solid; border-right: 2px solid; }
          .pe-drop-corner.bl { bottom: 0; left: 0; border-bottom: 2px solid; border-left: 2px solid; }
          .pe-drop-corner.br { right: 0; bottom: 0; border-right: 2px solid; border-bottom: 2px solid; }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-corner.tl { transform: translate(2px, 2px); }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-corner.tr { transform: translate(-2px, 2px); }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-corner.bl { transform: translate(2px, -2px); }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-corner.br { transform: translate(-2px, -2px); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner.tl { transform: translate(6px, 6px); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner.tr { transform: translate(-6px, 6px); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner.bl { transform: translate(6px, -6px); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner.br { transform: translate(-6px, -6px); }
          .pe-drop-mount-wrap.is-rejecting .pe-drop-corner { transform: none; }
          .pe-drop-mount-wrap:focus-within .pe-drop-corner { border-color: var(--pe-drop-signal); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner { border-color: var(--pe-drop-signal); }
          .pe-drop-mount-wrap.is-rejecting .pe-drop-corner,
          .pe-drop-mount-wrap.has-error:not(.is-dragging) .pe-drop-corner { border-color: var(--pe-drop-signal-ink); }

          .pe-drop-state {
            position: absolute; inset: 0; z-index: 1; box-sizing: border-box;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 54px 26px 26px; text-align: center;
          }
          .pe-drop-reg {
            width: 28px; height: 28px; margin-bottom: 18px;
            color: var(--pe-drop-line-strong);
            transition: transform var(--pe-drop-dur-base) var(--pe-drop-ease-out), color var(--pe-drop-dur-fast) var(--pe-drop-ease-out);
          }
          .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-reg { transform: scale(1.04); color: var(--pe-drop-muted); }
          .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-reg { transform: scale(1.08); color: var(--pe-drop-signal); }
          .pe-drop-mount-wrap.is-rejecting .pe-drop-reg { color: var(--pe-drop-signal-ink); }
          .pe-drop-state-title {
            margin: 0; color: var(--pe-drop-ink);
            font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 700;
            letter-spacing: -.02em; line-height: 1.25;
          }
          .pe-drop-state-sub {
            max-width: 30ch; margin: 8px 0 0;
            color: var(--pe-drop-muted); font-size: 12.5px; line-height: 1.55;
          }
          .pe-drop-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 9px;
            min-height: 46px; margin-top: 24px; padding: 0 20px; box-sizing: border-box;
            border: 1px solid transparent; border-radius: 10px;
            background: var(--pe-drop-button); color: var(--pe-drop-button-ink);
            font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
            cursor: pointer; box-shadow: 0 10px 24px rgba(20,18,28,.12);
            transition:
              transform var(--pe-drop-dur-fast) var(--pe-drop-ease-out),
              background-color .35s var(--pe-drop-ease-in-out),
              border-color var(--pe-drop-dur-fast) var(--pe-drop-ease-out),
              box-shadow var(--pe-drop-dur-fast) var(--pe-drop-ease-out),
              color .35s var(--pe-drop-ease-in-out);
          }
          .pe-drop-btn svg { flex: 0 0 auto; }
          .pe-drop-btn:hover:not(:disabled) {
            transform: translateY(-1px); border-color: var(--pe-drop-signal);
            background: var(--pe-drop-button-hover);
            box-shadow: 0 14px 30px var(--pe-drop-signal-soft);
          }
          .pe-drop-btn:active:not(:disabled) { transform: translateY(0); }
          .pe-drop-btn:disabled { opacity: .55; cursor: wait; }
          .pe-drop-btn:focus-visible { outline: 2px solid var(--pe-drop-signal); outline-offset: 3px; }
          .pe-drop-hint {
            margin: 14px 0 0; color: var(--pe-drop-faint);
            font-size: 10.5px; line-height: 1.5; font-variant-numeric: tabular-nums;
          }

          .pe-drop-loading {
            display: flex; flex-direction: column; align-items: center;
            width: 100%; max-width: 300px; outline: none;
            animation: pe-drop-state-in .36s var(--pe-drop-ease-out) both;
          }
          .pe-drop-loading-kicker {
            margin: 0; color: var(--pe-drop-faint); font-size: 9px; font-weight: 700;
            letter-spacing: .16em; text-transform: uppercase;
          }
          .pe-drop-loading-file {
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
            overflow: hidden; max-width: 100%; margin: 8px 0 0;
            color: var(--pe-drop-ink); font-size: 15px; font-weight: 600; line-height: 1.4;
            overflow-wrap: anywhere;
          }
          .pe-drop-loading-sub {
            max-width: 28ch; margin: 8px 0 0;
            color: var(--pe-drop-muted); font-size: 11.5px; line-height: 1.5;
          }
          .pe-drop-loading-track {
            position: relative; display: block; width: 140px; height: 1px;
            margin-top: 20px; overflow: hidden; background: var(--pe-drop-line);
          }
          .pe-drop-loading-bar {
            position: absolute; top: 0; bottom: 0; left: 0; display: block; width: 42%;
            background: var(--pe-drop-signal);
            transform: translateX(-120%);
            animation: pe-drop-sweep 1.4s var(--pe-drop-ease-in-out) infinite;
          }
          @keyframes pe-drop-sweep {
            0% { transform: translateX(-120%); }
            60%, 100% { transform: translateX(340%); }
          }
          .pe-drop-error {
            display: flex; flex-direction: column; align-items: flex-start;
            width: 100%; max-width: 320px; max-height: 100%; overflow-y: auto;
            text-align: left; border-top: 1px solid var(--pe-drop-signal); padding-top: 16px;
            scrollbar-width: thin;
            animation: pe-drop-state-in .36s var(--pe-drop-ease-out) both;
          }
          .pe-drop-error-kicker {
            margin: 0 0 6px; color: var(--pe-drop-signal-ink); font-size: 9px;
            font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
            overflow-wrap: anywhere;
          }
          .pe-drop-error-title {
            margin: 0; color: var(--pe-drop-ink);
            font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700;
            line-height: 1.25; letter-spacing: -.02em;
          }
          .pe-drop-error-message {
            margin: 7px 0 0; color: var(--pe-drop-muted);
            font-size: 11.5px; line-height: 1.55;
          }
          .pe-drop-error .pe-drop-btn {
            min-height: 38px; margin-top: 16px; padding: 0 16px;
            font-size: 12px; box-shadow: none;
          }
          .pe-drop-input { display: none; }

          @media (max-width: 980px) {
            .pe-drop-shell {
              grid-template-columns: minmax(0, 1fr); justify-items: center; justify-content: center;
              gap: 40px; padding: 36px 0 48px;
            }
            .pe-drop-intro { width: 100%; max-width: 560px; }
            .pe-drop-mount-wrap { justify-self: center; width: min(100%, 420px, 52vh); }
          }
          @media (max-width: 640px) {
            .pe-drop-page { padding: 20px 18px 32px; }
            .pe-drop-head { flex-wrap: wrap; align-items: flex-start; gap: 12px; padding-bottom: 14px; }
            .pe-drop-head-label { display: none; }
            .pe-drop-recovery { order: 3; width: 100%; max-width: none; }
            .pe-drop-title { font-size: clamp(36px, 11vw, 46px); }
            .pe-drop-sub { margin-top: 18px; font-size: 14.5px; }
            .pe-drop-ledger { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 28px; }
            .pe-drop-shell { gap: 32px; padding: 28px 0 36px; }
            .pe-drop-mount-wrap { width: min(100%, 360px); }
            .pe-drop-state { padding: 50px 20px 22px; }
            .pe-drop-btn { width: 100%; }
            .pe-drop-error { max-width: 100%; }
            .pe-drop-error .pe-drop-btn { width: 100%; }
          }
          @media (max-height: 720px) and (min-width: 981px) {
            .pe-drop-shell { padding-block: 24px 32px; }
            .pe-drop-mount-wrap { width: min(100%, 440px, 44vh); }
            .pe-drop-title { font-size: clamp(40px, 4.8vw, 56px); }
            .pe-drop-sub { margin-top: 16px; }
            .pe-drop-ledger { margin-top: 24px; }
          }
          @media (prefers-reduced-motion: reduce) {
            .pe-drop-head, .pe-drop-intro, .pe-drop-mount-wrap { animation: none; }
            .pe-drop-sheet, .pe-drop-corner, .pe-drop-reg, .pe-drop-btn,
            .pe-drop-recovery-btn, .pe-drop-tag, .pe-drop-intro { transition: none; }
            .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-sheet,
            .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-sheet { transform: none; }
            .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-corner,
            .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-corner { transform: none; }
            .pe-drop-mount-wrap:not(.is-dragging):hover .pe-drop-reg,
            .pe-drop-mount-wrap.is-dragging:not(.is-rejecting) .pe-drop-reg { transform: none; }
            .pe-drop-btn:hover:not(:disabled) { transform: none; }
            .pe-drop-loading, .pe-drop-error { animation: none; }
            .pe-drop-loading-bar { display: none; animation: none; }
          }
          @media (forced-colors: active) {
            .pe-drop-sheet, .pe-drop-recovery, .pe-drop-btn, .pe-drop-error { border-color: ButtonText; }
            .pe-drop-corner { border-color: ButtonText; }
            .pe-drop-tag, .pe-drop-head-label, .pe-drop-eyebrow { color: CanvasText; }
          }
          @keyframes pe-drop-enter {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pe-drop-state-in {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        <div className={`pe-drop-page${isDragActive ? ' is-intake-dragging' : ''}`} ref={dropPageRef}>
          <header className="pe-drop-head">
            <Link href="/" className="pe-drop-brand" aria-label="mycloove home">
              {/* Logo — the animated blinking-eye octopus (scaled from a wrapper:
                  the component is hard-fixed at 42px in its CSS module, and the
                  drop page slots it at 40px: 40/42 ≈ 0.952). The component's
                  pointermove listeners live on its own 42px container, and the
                  eye-tracking math reads getBoundingClientRect(), so the eyes
                  still track the cursor correctly at the scaled size. */}
              <span className="pe-drop-logo-mark" aria-hidden="true">
                <AnimatedBrandLogo trackingAreaRef={dropPageRef} />
              </span>
              <span className="pe-drop-wordmark">mycloove</span>
            </Link>

            {recoverableDraft ? (
              <div className="pe-drop-recovery" role="status">
                <span className="pe-drop-recovery-dot" aria-hidden="true" />
                <div className="pe-drop-recovery-copy">
                  <span className="pe-drop-recovery-title">Local draft</span>
                  <span className="pe-drop-recovery-meta">
                    {recoverableDraft.fileName} · Saved {new Date(recoverableDraft.savedAt).toLocaleString()}
                  </span>
                  {recoveryError && (
                    <span className="pe-drop-recovery-error" role="alert">{recoveryError}</span>
                  )}
                </div>
                <button
                  data-testid="pdf-recovery-resume"
                  className="pe-drop-recovery-btn"
                  type="button"
                  onClick={handleRecoverDraft}
                  disabled={isRecovering}
                >
                  {isRecovering ? 'Restoring…' : 'Resume'}
                </button>
              </div>
            ) : (
              <span className="pe-drop-head-label">PDF editor</span>
            )}
          </header>

          <main className="pe-drop-shell">
            <section className="pe-drop-intro" aria-labelledby="pe-drop-title">
              <p className="pe-drop-eyebrow">Document workspace</p>
              <h1 className="pe-drop-title" id="pe-drop-title">
                Open a PDF<span className="pe-drop-title-dot" aria-hidden="true">.</span>
              </h1>
              <p className="pe-drop-sub">Drop a document on the mount, or choose one from your device.</p>

              <ul className="pe-drop-ledger" aria-label="Editor capabilities">
                <li>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M4 16l3.2-.7L15 7.5a1.8 1.8 0 0 0-2.5-2.5L4.7 12.8 4 16z" />
                    <path d="M11.5 5.5l3 3" />
                  </svg>
                  <span>Edit text</span>
                </li>
                <li>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <rect x="3" y="8" width="14" height="7" rx="1" />
                    <line x1="3" y1="6" x2="17" y2="6" strokeOpacity=".4" />
                  </svg>
                  <span>Annotate</span>
                </li>
                <li>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M4 16c2-5 4-9 5-9s1 3 2 3 2-5 3-5" />
                    <line x1="3" y1="16" x2="17" y2="16" strokeOpacity=".4" />
                  </svg>
                  <span>Sign</span>
                </li>
                <li>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M17 12v3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-3" />
                    <path d="M6.5 8.5L10 12l3.5-3.5" />
                    <path d="M10 12V3" />
                  </svg>
                  <span>Export</span>
                </li>
              </ul>

              <p className="pe-drop-trust">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="m3 8 3 3 7-7" />
                </svg>
                Your original is never overwritten.
              </p>
            </section>

            <div
              {...getRootProps()}
              className={`pe-drop-mount-wrap${isDragActive ? ' is-dragging' : ''}${dropIsRejecting ? ' is-rejecting' : ''}${state.isLoading ? ' is-loading' : ''}${state.loadFailure ? ' has-error' : ''}`}
              role="group"
              aria-label="PDF drop target"
              tabIndex={-1}
              aria-describedby="pe-drop-limits"
            >
              <input
                {...getInputProps({
                  className: 'pe-drop-input',
                  'aria-label': 'Choose a PDF file',
                })}
                data-testid="pdf-upload-input"
                data-editor-ready={isClientReady ? 'true' : 'false'}
                disabled={!isClientReady || state.isLoading}
              />

              <div className="pe-drop-tags" aria-hidden="true">
                <span className="pe-drop-tag">PDF</span>
                <span className="pe-drop-tag is-state">{dropSheetLabel}</span>
              </div>

              <div className="pe-drop-sheet">
                <div className="pe-drop-corners" aria-hidden="true">
                  <span className="pe-drop-corner tl" />
                  <span className="pe-drop-corner tr" />
                  <span className="pe-drop-corner bl" />
                  <span className="pe-drop-corner br" />
                </div>

                <div className={`pe-drop-state${state.loadFailure && !state.isLoading && !isDragActive ? ' is-error' : ''}`}>
                  {state.isLoading ? (
                    <div
                      className="pe-drop-loading"
                      ref={dropLoadingRef}
                      tabIndex={-1}
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <p className="pe-drop-loading-kicker">Opening</p>
                      <p className="pe-drop-loading-file">{pendingFileName ?? 'Your document'}</p>
                      <p className="pe-drop-loading-sub">Preparing the workspace. Large files can take a moment.</p>
                      <span className="pe-drop-loading-track" aria-hidden="true">
                        <span className="pe-drop-loading-bar" />
                      </span>
                    </div>
                  ) : state.loadFailure && !isDragActive ? (
                    <div className="pe-drop-error" role="alert" onClick={(event) => event.stopPropagation()}>
                      <p className="pe-drop-error-kicker">
                        {pendingFileName ? `Couldn't open ${pendingFileName}` : 'Document not opened'}
                      </p>
                      <p className="pe-drop-error-title">{state.loadFailure.title}</p>
                      <p className="pe-drop-error-message">{state.loadFailure.message}</p>
                      <button
                        ref={dropErrorButtonRef}
                        className="pe-drop-btn"
                        type="button"
                        onClick={(event) => { event.stopPropagation(); open(); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                          <path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" />
                          <path d="M5.5 8h5" />
                        </svg>
                        Choose another PDF
                      </button>
                    </div>
                  ) : (
                    <>
                      <svg className="pe-drop-reg" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" focusable="false">
                        <path d="M14 1v8M14 19v8M1 14h8M19 14h8" />
                        <rect x="11.5" y="11.5" width="5" height="5" />
                      </svg>
                      <p className="pe-drop-state-title">{dropTitle}</p>
                      <p className="pe-drop-state-sub">{dropSub}</p>
                      <button
                        className="pe-drop-btn"
                        type="button"
                        onClick={(event) => { event.stopPropagation(); open(); }}
                        disabled={!isClientReady}
                        aria-describedby="pe-drop-limits"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                          <path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" />
                          <path d="M5.5 8h5" />
                        </svg>
                        Choose PDF
                      </button>
                      <p className="pe-drop-hint" id="pe-drop-limits">
                        One PDF <span aria-hidden="true">·</span> up to 100 MB <span aria-hidden="true">·</span> up to 500 pages
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — Editor
  // ══════════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        /* ─────────────────────────────────────────────────────────────
           Surface 5 token layer — one instrument, one palette.

           Declared on the editor root and on the portalled impact backdrop
           (a portal leaves the root's cascade, so it carries the same local
           tokens). Dark is the default; light overrides values only.
           Component CSS consumes these names and never a bare UI hex.
           ───────────────────────────────────────────────────────────── */
        .pe-editor-page,
        .pe-impact-backdrop,
        .pe-document-backdrop {
          --pe-bg: #0d0c11;
          --pe-panel: #131219;
          --pe-panel-2: #16151c;
          --pe-panel-3: #1c1b25;
          --pe-line: rgba(243,240,234,.09);
          --pe-line-strong: rgba(243,240,234,.20);
          --pe-text: #f3f0ea;
          --pe-text-2: #b9b4c2;
          --pe-text-3: #8f8a9a;
          --pe-signal: #ff6b6b;
          --pe-signal-ink: #ff9b8c;
          --pe-signal-soft: rgba(255,107,107,.12);
          --pe-signal-line: rgba(255,107,107,.34);
          --pe-on-signal: #17161b;
          --pe-success: #65d58a;
          --pe-success-soft: rgba(101,213,138,.12);
          --pe-warning: #ffc76b;
          --pe-warning-soft: rgba(255,199,107,.12);
          --pe-danger: #ff9292;
          --pe-danger-soft: rgba(255,146,146,.12);
          --pe-focus: #ff8e7a;
          --pe-scrim: rgba(7,7,10,.82);
          --pe-shadow-page: 0 8px 40px rgba(0,0,0,.45);
          --pe-shadow-dialog: 0 24px 80px rgba(0,0,0,.55);
          --pe-scrollbar: rgba(243,240,234,.14);
          --pe-search-highlight: rgba(255,199,107,.26);
          --pe-search-ring: rgba(255,199,107,.70);
          --pe-control-outline: rgba(255,107,107,.55);
          --pe-control-outline-soft: rgba(255,107,107,.10);
          --pe-control-focus: rgba(255,142,122,.34);
          --pe-loading-veil: rgba(13,12,17,.82);
          --pe-r-sm: 6px;
          --pe-r-md: 10px;
          --pe-r-lg: 14px;
          --pe-ease-out: cubic-bezier(.16,1,.3,1);
          --pe-ease-in-out: cubic-bezier(.4,0,.2,1);
          --pe-dur-fast: 120ms;
          --pe-dur-base: 200ms;
          --pe-dur-slow: 360ms;
        }
        [data-theme="light"] .pe-editor-page,
        [data-theme="light"] .pe-impact-backdrop,
        [data-theme="light"] .pe-document-backdrop {
          --pe-bg: #ededea;
          --pe-panel: #fcfcfa;
          --pe-panel-2: #f6f5f1;
          --pe-panel-3: #ffffff;
          --pe-line: rgba(23,22,27,.12);
          --pe-line-strong: rgba(23,22,27,.28);
          --pe-text: #17161b;
          --pe-text-2: #55515d;
          --pe-text-3: #5f5b66;
          --pe-signal: #c44735;
          --pe-signal-ink: #9e3226;
          --pe-signal-soft: rgba(196,71,53,.08);
          --pe-signal-line: rgba(196,71,53,.30);
          --pe-on-signal: #ffffff;
          --pe-success: #236b50;
          --pe-success-soft: rgba(35,107,80,.09);
          --pe-warning: #7a4d00;
          --pe-warning-soft: rgba(196,120,0,.12);
          --pe-danger: #a02525;
          --pe-danger-soft: rgba(160,37,37,.08);
          --pe-focus: #c44735;
          --pe-scrim: rgba(23,22,27,.44);
          --pe-shadow-page: 0 8px 30px rgba(30,24,48,.13), 0 2px 8px rgba(30,24,48,.07);
          --pe-shadow-dialog: 0 24px 60px rgba(30,24,48,.22);
          --pe-scrollbar: rgba(23,22,27,.18);
          --pe-search-highlight: rgba(196,120,0,.20);
          --pe-search-ring: rgba(196,120,0,.65);
          --pe-control-outline: rgba(196,71,53,.55);
          --pe-control-outline-soft: rgba(196,71,53,.10);
          --pe-control-focus: rgba(196,71,53,.26);
          --pe-loading-veil: rgba(237,237,234,.84);
        }

        .pe-editor-page {
          display: flex; flex-direction: column;
          height: 100vh; height: 100dvh; overflow: hidden;
          background: var(--pe-bg);
          color: var(--pe-text);
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          transition:
            background-color .35s var(--pe-ease-in-out),
            color .35s var(--pe-ease-in-out);
        }
        .pe-sr-only {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }

        /* Main row: left toolbar + canvas area + right panel */
        .pe-editor-body {
          display: flex; flex: 1; overflow: hidden;
        }
        .pe-workspace-main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
        .pe-inspector-shell { width: 220px; flex: 0 0 220px; display: flex; min-width: 0; transition: width .18s ease, flex-basis .18s ease; }
        .pe-inspector-shell.closed { width: 0; flex-basis: 0; overflow: hidden; }
        /* Redaction is a review workspace, not an inspector: it needs room for
           the matched value, the line it will actually remove, and the action.
           220px forced every one of those into a two-line ellipsis. */
        .pe-inspector-shell.redaction { width: 300px; flex-basis: 300px; }

        /* Scrollable canvas area */
        .pe-canvas-area {
          flex: 1; min-height: 0; overflow: auto;
          background: var(--pe-bg);
          display: flex; flex-direction: column; align-items: center;
          /* 24px everywhere: the editorial padding lands on the 4px grid, and
             the extra 2px it replaces bought nothing readable either way. */
          padding: 24px;
          gap: 24px;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
          scrollbar-gutter: stable;
        }
        .pe-canvas-pages { min-width: min-content; margin-inline: auto; display: flex; flex-direction: column; align-items: center; gap: 28px; }
        .pe-page-shell { display: flex; flex-direction: column; align-items: center; gap: 8px; scroll-margin-top: 18px; }
        /* Long documents: paint/layout work is deferred for off-screen pages,
           while the intrinsic size keeps the scrollbar stable. The remembered
           height is each shell's own committed frame height (the canvas sets
           --pe-page-intr when a frame lands); the 900px is only what a shell
           might hold before its first commit ever arrives. */
        .pe-canvas-area.is-continuous .pe-page-shell {
          content-visibility: auto;
          contain-intrinsic-size: auto var(--pe-page-intr, 900px);
        }
        .pe-canvas-area.preview-open {
          display: grid;
          /* The second track's maximum is the dragged split (--pe-preview-split
             is session state, default 42%). The 320px minimum is the floor of
             a readable preview; dragging below it stops at the floor. */
          grid-template-columns: minmax(0, 1fr) minmax(320px, var(--pe-preview-split, 42%));
          grid-template-rows: minmax(0, 1fr);
          align-items: start;
          padding: 20px;
          overflow: hidden;
        }
        .pe-edit-stage,
        .pe-preview-stage {
          min-width: 0;
          width: 100%;
          display: flex;
          justify-content: center;
        }
        .pe-edit-stage {
          position: relative;
          min-height: 0;
          height: 100%;
          justify-content: flex-start;
          overflow: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
          scrollbar-gutter: stable;
        }
        /* First-open placeholder. It sits over the (still empty) stage until
           the first committed raster arrives, and is deliberately not a
           progress bar: nothing here knows a percentage, so it claims none.
           Plain paper card, same surface as the rest of the editor. */
        .pe-stage-prep {
          position: absolute;
          left: 50%;
          top: 72px;
          transform: translateX(-50%);
          z-index: 5;
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 14px 18px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-page);
          pointer-events: none;
        }
        .pe-stage-prep strong {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .2px;
          color: var(--pe-text);
        }
        .pe-stage-prep span {
          font-size: 11px;
          color: var(--pe-text-2);
        }
        .pe-preview-stage {
          position: sticky;
          top: 0;
          height: 100%;
          min-height: 0;
          padding-left: 20px;
          border-left: 1px solid var(--pe-line);
          overflow: hidden;
        }
        /* The drag edge between the workspace and the preview. A hairline on
           the stage's border is the resting look; the strip only adds an
           affordance — a wider pointer target and an accent line while the
           handle is hovered, pressed, or focused. Nothing animates: the split
           is a measurement, not an effect. */
        .pe-preview-divider {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 11px;
          border: 0;
          padding: 0;
          margin: 0;
          background: transparent;
          cursor: col-resize;
          touch-action: none;
          z-index: 6;
        }
        .pe-preview-divider::after {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 1px;
          background: transparent;
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-preview-divider:hover::after,
        .pe-preview-divider:active::after,
        .pe-preview-divider:focus-visible::after { background: var(--pe-line-strong); }
        .pe-preview-divider:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 2px; }
        @media (max-width: 1100px) { .pe-preview-divider { display: none; } }
        .pe-preview-panel {
          min-width: 0;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }
        .pe-preview-head {
          width: min(100%, 640px);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          color: var(--pe-text-2);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .5px;
          text-transform: uppercase;
          font-variant-numeric: tabular-nums;
        }
        /* The head carries no title: its controls are the whole row — zoom
           strip, the preview's own page navigation, and this label at the
           right end. At the narrowest widths the label gives way to the
           strip rather than pushing it out of the panel. */
        .pe-preview-size {
          min-width: 0;
          flex: 0 1 auto;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--pe-signal-ink);
        }
        .pe-preview-wrap {
          position: relative;
          width: 100%;
          max-width: min(100%, 640px);
          overflow: auto;
          box-shadow: var(--pe-shadow-page);
          /* The hairline is what separates the paper from a light-theme bg it
             nearly matches; in the dark theme it keeps the sheet's edge
             crisp against the glow of its own shadow. */
          border: 1px solid var(--pe-line);
          border-radius: 3px;
          background: #fff;
        }
        .pe-preview-page-frame {
          position: relative;
          width: 100%;
          min-height: 120px;
          background: #fff;
          /* At a numeric zoom the page can be narrower than the wrap (small
             page, low zoom); centring it keeps the paper sitting where the
             panel is centred instead of hugging its left edge. No effect at
             Fit or when the page overflows, where auto margins resolve to 0. */
          margin-inline: auto;
        }
        .pe-preview-canvas {
          display: block;
          width: 100%;
          max-width: 100%;
          height: auto;
        }
        .pe-preview-status {
          position: absolute;
          right: 10px;
          top: 10px;
          padding: 5px 9px;
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel);
          color: var(--pe-text-2);
          border: 1px solid var(--pe-line);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          /* A slow opacity pulse — presence while the build runs, and not a
             second scrollbar or percentage: the text still says only the
             truth, that a build is happening. */
          animation: pe-preview-wait 1.6s var(--pe-ease-in-out) infinite;
        }
        @keyframes pe-preview-wait { 50% { opacity: .68; } }
        @media (prefers-reduced-motion: reduce) {
          .pe-preview-status { animation: none; }
        }
        /* No build to show. Sits inside the white page frame in place of the
           canvas — deliberately not styled as a dismissible toast, because the
           reason the export was refused is the only thing this panel can
           honestly display. The ink stays fixed: the frame is always paper. */
        .pe-preview-blocked {
          padding: 18px 20px;
          color: #23232b;
          font-size: 12.5px;
          line-height: 1.55;
          text-align: left;
        }
        .pe-preview-blocked strong {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
          color: #8a1c1c;
        }
        .pe-preview-blocked p { margin: 0 0 8px; }
        .pe-preview-blocked p:last-child { margin-bottom: 0; }
        /* Fidelity changes the engine did make, or a confirmation Export will
           ask for. The build above is real, so this is a caption on it. */
        .pe-preview-notice {
          padding: 12px 14px;
          border-top: 1px solid rgba(0,0,0,.09);
          background: #fbf3df;
          color: #2c2a1e;
          font-size: 11.5px;
          line-height: 1.5;
          text-align: left;
        }
        .pe-preview-notice strong {
          display: block;
          margin-bottom: 5px;
          font-size: 12px;
        }
        .pe-preview-notice p { margin: 0 0 5px; }
        .pe-preview-notice p:last-child,
        .pe-preview-notice ul:last-child { margin-bottom: 0; }
        .pe-preview-notice ul { margin: 0; padding-left: 18px; }
        @media (max-width: 1100px) {
          .pe-canvas-area.preview-open {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
            overflow: auto;
          }
          .pe-edit-stage { height: auto; overflow: visible; }
          .pe-preview-stage {
            position: static;
            height: auto;
            min-height: auto;
            padding-left: 0;
            padding-top: 20px;
            border-left: 0;
            border-top: 1px solid var(--pe-line);
            overflow: visible;
          }
        }
        @media (max-width: 1180px) {
          .pe-inspector-shell {
            position: fixed; z-index: 84; right: 0; top: 94px; bottom: 28px;
            width: 220px; transform: translateX(100%);
            transition: transform var(--pe-dur-base) var(--pe-ease-out);
            box-shadow: -12px 0 35px rgba(0,0,0,.42);
          }
          .pe-inspector-shell:not(.closed) { transform: translateX(0); }
          .pe-inspector-shell.closed { width: 220px; flex-basis: 220px; }
          .pe-inspector-shell.redaction,
          .pe-inspector-shell.redaction.closed { width: min(92vw, 320px); flex-basis: min(92vw, 320px); }
          [data-theme="light"] .pe-inspector-shell { box-shadow: -12px 0 35px rgba(30,24,48,.16); }
        }
        @media (max-width: 700px) {
          .pe-inspector-shell { top: 94px; bottom: calc(88px + env(safe-area-inset-bottom)); width: min(88vw, 280px); }
          .pe-inspector-shell.closed { width: min(88vw, 280px); flex-basis: min(88vw, 280px); }
          .pe-canvas-area { padding: 16px 12px; }
        }
        .pe-canvas-area::-webkit-scrollbar { width: 6px; }
        .pe-canvas-area::-webkit-scrollbar-thumb { background: var(--pe-scrollbar); border-radius: 4px; }

        /* Page shadow frame */
        .pe-page-frame {
          box-shadow: var(--pe-shadow-page);
          border: 1px solid var(--pe-line);
          border-radius: 3px;
          position: relative;
          flex-shrink: 0;
        }
        .pe-page-num-label {
          position: absolute; top: -22px; left: 0;
          font-size: 11px; font-weight: 600; letter-spacing: .3px;
          color: var(--pe-text-3);
          font-variant-numeric: tabular-nums;
        }

        /* One refusal/loading language: a solid scrim and a small honest card.
           No blur, no percentage, no progress claim. */
        .pe-loading-overlay {
          position: fixed; inset: 0; z-index: 200;
          background: var(--pe-loading-veil);
          display: grid; place-items: center;
          padding: 24px;
        }
        .pe-loading-card {
          display: flex; align-items: center; gap: 14px;
          max-width: min(360px, 100%);
          padding: 16px 18px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
          color: var(--pe-text);
        }
        .pe-loading-ring {
          width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%;
          border: 2px solid var(--pe-line-strong);
          border-top-color: var(--pe-signal);
          animation: pe-ring-spin .75s linear infinite;
        }
        @keyframes pe-ring-spin { to { transform: rotate(360deg); } }
        .pe-loading-text { font-size: 12px; color: var(--pe-text-2); }

        /* Toast — one honest status line, same tokens as the instrument. */
        .pe-toast {
          position: fixed; right: 20px; top: 108px; z-index: 9999;
          max-width: min(360px, calc(100vw - 32px));
          padding: 10px 14px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          color: var(--pe-text);
          box-shadow: var(--pe-shadow-dialog);
          font-size: 12px; line-height: 1.5;
        }

        /* OCR preflight — a disclosure, not a success banner. */
        .pe-preflight {
          margin: 10px 12px 0;
          padding: 10px 12px;
          border: 1px solid var(--pe-warning);
          border-left-width: 3px;
          border-radius: var(--pe-r-sm);
          background: var(--pe-warning-soft);
          color: var(--pe-text);
          font-size: 11.5px; line-height: 1.5;
        }
        .pe-preflight-copy { display: block; }
        .pe-preflight-action {
          min-height: 30px;
          margin-left: 10px;
          padding: 0 10px;
          border: 1px solid var(--pe-line-strong);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel);
          color: var(--pe-text);
          font: inherit; font-weight: 700;
          cursor: pointer;
        }
        .pe-preflight-action:hover:not(:disabled) { border-color: var(--pe-signal); color: var(--pe-signal-ink); }
        .pe-preflight-action:disabled { opacity: .55; cursor: wait; }
        .pe-document-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pe-line); background: var(--pe-panel); color: var(--pe-text-2); font-size: 11.5px; line-height: 1.5; }
        .pe-processing-state { flex: 1 1 210px; }
        .pe-document-controls .pe-preflight-action { margin: 0; }
        .pe-document-message { flex-basis: 100%; margin: 0; color: var(--pe-text-2); }
        .pe-document-message.error { color: var(--pe-danger); }

        :where(.pe-editor-page) :where(button, input, select, textarea, a):focus-visible {
          outline: 2px solid var(--pe-focus);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .pe-editor-page,
          .pe-inspector-shell,
          .pe-navigation { transition: none; }
          .pe-loading-ring { animation: none; }
          .pe-preview-status { animation: none; }
          .pe-preview-divider::after { transition: none; }
        }
      `}</style>

      <div className="pe-editor-page">

        {pendingExportImpact && (
          <PdfExportImpactDialog
            impact={pendingExportImpact}
            fileName={state.pdfFile?.name ?? 'PDF document'}
            onCancel={closePendingExportDialog}
            onConfirm={() => { void handleConfirmedExport(); }}
          />
        )}

        {state.processingRequest && (
          <PdfEditorDocumentDialog key={`processing-${state.processingRequest.sequence}`} kind="processing" fileName={state.processingRequest.fileName}
            onCancel={() => { if (state.processingRequest) cancelProcessingConsent(state.processingRequest); approvedOcrRequestRef.current = null; }}
            onConfirm={() => { void handleProcessingConfirm(); }} />
        )}
        {pendingDocumentDialog && !state.processingRequest && (
          <PdfEditorDocumentDialog key={pendingDocumentDialog.kind} kind={pendingDocumentDialog.kind} fileName={state.pdfFile.name}
            onCancel={() => setPendingDocumentDialog(null)} onConfirm={() => { void handleDocumentConfirm(); }} />
        )}

        {/* Loading overlay — solid scrim, one honest status card. */}
        {(state.isLoading || state.isExporting) && (
          <div className="pe-loading-overlay">
            <div className="pe-loading-card" role="status" aria-live="polite">
              <div className="pe-loading-ring" aria-hidden="true" />
              <span className="pe-loading-text">
                {state.isExporting ? 'Exporting your PDF…' : 'Loading document…'}
              </span>
            </div>
          </div>
        )}

        {/* Topbar — identity, file, save state, preview, download, close. */}
        <PdfEditorTopbar
          fileName={state.pdfFile?.name ?? ''}
          isExporting={state.isExporting}
          onPreviewToggle={handlePreviewToggle}
          isPreviewOpen={isPreviewOpen}
          saveStatus={state.saveStatus}
          saveMessage={state.saveMessage}
          recoveryDisabled={state.recoveryStatus !== 'enabled'}
          onExport={handleExport}
          onClose={handleClose}
        />

        {/* Toast */}
        {toast.visible && (
          <div data-testid="pdf-editor-toast" className="pe-toast" role="status" aria-live="polite">
            {toast.msg}
          </div>
        )}

        <PdfEditorCommandPalette
          key={`palette-${paletteOpen ? 'open' : 'closed'}`}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onRun={runPaletteCommand}
        />
        <PdfEditorShortcutsDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />

      <PdfEditorCommandBar
        currentPage={state.currentPage}
        totalPages={state.totalPages}
        zoom={state.zoom}
        fitMode={fitMode}
        viewMode={viewMode}
        query={searchQuery}
        resultCount={searchResults.length}
        activeResult={activeSearchIndex}
        searching={isSearching}
        navigationOpen={navigationOpen}
        inspectorOpen={inspectorOpen}
        onPageChange={page => set({ currentPage: page })}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onFitModeChange={mode => {
          if (mode === 'custom') return;
          setFitMode(mode);
          if (mode !== 'fit-width') void applyFitMode(mode);
        }}
        onViewModeChange={handleViewModeChange}
        onQueryChange={handleSearchQueryChange}
        onResultStep={stepSearchResult}
        onNavigationToggle={() => setNavigationOpen(open => !open)}
        onInspectorToggle={() => setInspectorOpen(open => !open)}
      />

        <div className="pe-editor-body">
          <EditorLeftToolbar
            activeTool={state.activeTool}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onToolChange={handleToolChange}
            onUndo={undo}
            onRedo={redo}
            onDelete={deleteSelected}
            redactionEnabled={redactionEnabled}
            toolsReady={editingLayerReady}
          />

          <PdfEditorNavigationPanel
            open={navigationOpen}
            activeTab={navigationTab}
            currentPage={state.currentPage}
            totalPages={state.totalPages}
            pagePlan={state.pagePlan}
            annotationPages={state.annotations.map(annotation => annotation.page)}
            outline={outline}
            comments={comments}
            onTabChange={setNavigationTab}
            onPageChange={page => set({ currentPage: page })}
            onPageOperation={handlePageOperation}
            positionForSourcePage={positionForSourcePage}
            onClose={() => { if (window.innerWidth <= 1180) setNavigationOpen(false); }}
            renderThumbnail={renderThumbnail}
          />

          <div ref={workspaceMainRef} className="pe-workspace-main">
            <div className="pe-document-controls">
              <span className="pe-processing-state" data-testid="pdf-processing-status" role="status">
                {state.isServerProcessing ? 'Server processing now' : state.processingAllowed ? 'Local editing. Server permitted, idle.' : 'Local editing. Server processing not allowed.'}
              </span>
              {!state.processingAllowed && <button type="button" className="pe-preflight-action" data-testid="pdf-processing-review" onClick={() => requestProcessingConsent('preview')} disabled={!documentReady}>Review processing</button>}
              <button type="button" className="pe-preflight-action" data-testid="pdf-ocr-copy" onClick={() => { void handleRunOcr(); }} disabled={!documentReady || state.isExporting || state.isOcrProcessing || state.isServerProcessing}>
                {state.isOcrProcessing ? 'Creating OCR copy...' : 'English OCR copy'}
              </button>
              <button type="button" className="pe-preflight-action" data-testid="pdf-recovery-clear" disabled={!documentReady || state.recoveryStatus === 'clearing' || state.recoveryStatus === 'disabled'} onClick={() => setPendingDocumentDialog({ kind: 'recovery', session: state.documentSession, revision: getExportRevision() })}>
                {state.recoveryStatus === 'clearing' ? 'Removing recovery...' : state.recoveryStatus === 'disabled' ? 'Recovery disabled' : 'Clear this PDF\'s recovery'}
              </button>
              {state.ocrMessage && <p className={`pe-document-message${state.ocrFailed ? ' error' : ''}`} role={state.ocrFailed ? 'alert' : 'status'} data-testid="pdf-ocr-status">{state.ocrMessage}</p>}
              {(state.recoveryMessage || (state.saveStatus === 'saved' && !state.recoverySourceStored && state.saveMessage)) && <p className="pe-document-message" role="status" data-testid="pdf-recovery-status">{state.recoveryMessage ?? state.saveMessage}</p>}
            </div>
            <div
              ref={canvasAreaRef}
              data-testid="pdf-editor-workspace"
              className={`pe-canvas-area ${isPreviewOpen ? 'preview-open' : ''} ${effectiveViewMode === 'continuous' ? 'is-continuous' : ''}`}
              style={isPreviewOpen ? { '--pe-preview-split': `${previewSplit}%` } as CSSProperties : undefined}
            >
              <div className="pe-edit-stage">
                {/* First open. This card exists only while no raster exists
                    yet: the fit is being measured and the first frame drawn.
                    It is not a progress bar — there is no percentage to know —
                    and it is gone the moment a real frame commits. */}
                {showStagePrep && (
                  <div className="pe-stage-prep" role="status" data-testid="pdf-stage-preparing">
                    <strong>Preparing page</strong>
                    <span>Measuring the page and drawing its first frame…</span>
                  </div>
                )}
                <div className="pe-canvas-pages">
                  {(effectiveViewMode === 'continuous'
                    ? planEntries.map((entry, index) => ({ entry, position: index + 1 }))
                    : activeEntry
                      ? [{ entry: activeEntry, position: state.currentPage }]
                      : [{ entry: { id: `p${state.currentPage}#1`, sourcePage: state.currentPage, rotation: 0 as const }, position: state.currentPage }]
                  ).map(({ entry, position }) => {
                    const activeResult = searchResults[activeSearchIndex];
                    // Single view keeps one canvas for the whole document —
                    // page changes render into that same component — while
                    // continuous view still keys per entry, because those are
                    // separate surfaces that mount and unmount with the plan.
                    // The file identity stays in the key so opening another
                    // document is guaranteed a fresh canvas, never the old
                    // file's raster.
                    return (
                      <div
                        key={effectiveViewMode === 'continuous' ? entry.id : `active-page:${canvasFileKey}`}
                        className="pe-page-shell"
                        data-pdf-page-shell={position}
                        onMouseDown={() => { if (position !== state.currentPage) set({ currentPage: position }); }}
                      >
                        <span className="pe-page-num-label">
                          Page {position}
                          {entry.sourcePage !== position || entry.rotation !== 0
                            ? ` · source ${entry.sourcePage}${entry.rotation ? ` · ${entry.rotation}°` : ''}`
                            : ''}
                        </span>
                        <div className="pe-page-frame">
                          {pageCanvasMounted ? (
                            <PdfEditorCanvas
                              page={entry.sourcePage}
                              zoom={state.zoom}
                              activeTool={state.activeTool}
                              onReady={handleFabricReady}
                              onBeforeDispose={handleFabricDispose}
                              getTextBlocks={getTextBlocks}
                              getOriginalTextEdit={getOriginalTextEdit}
                              getEditedText={getEditedText}
                              setTextEdit={setTextEdit}
                              selectOriginalTextBlock={selectOriginalTextBlock}
                              selectedOriginalTextKey={state.selectedOriginalTextKey}
                              renderPage={renderPage}
                              onFirstFrame={() => {
                                const file = state.pdfFile;
                                if (file) setFirstFrameFile(current => (current === file ? current : file));
                              }}
                              searchHighlight={activeResult?.page === entry.sourcePage ? activeResult : null}
                              redactionMarks={redactionEnabled ? state.redactionMarks : []}
                              onToggleRedaction={(block) => {
                                void toggleRedactionMark(block, state.zoom);
                              }}
                              onUnmarkRedaction={unmarkRedaction}
                              onShapeDragCreate={handleShapeDragCreate}
                              snapGuides={entry.sourcePage === activeSourcePage ? state.snapGuides : []}
                              annotations={state.annotations}
                              annotationKind={state.annotationKind}
                              selectedAnnotationId={state.selectedAnnotationId}
                              onToggleAnnotation={(block) => {
                                toggleAnnotationForBlock(block, state.zoom);
                              }}
                              onAddAnnotationAt={addAnnotationAtPoint}
                              onSelectAnnotation={selectAnnotation}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {isPreviewOpen && (
                /* Named for assistive tech because the head no longer carries a
                   visible title — the row is the zoom strip, the preview's own
                   page navigation, and the page-size label — this is what keeps
                   the panel identifiable. */
                <div className="pe-preview-stage" role="region" aria-label="Export preview">
                  <div className="pe-preview-panel">
                    <button
                      type="button"
                      className="pe-preview-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize workspace and preview"
                      aria-valuemin={PREVIEW_SPLIT_MIN}
                      aria-valuemax={PREVIEW_SPLIT_MAX}
                      aria-valuenow={Math.round(previewSplit)}
                      title="Drag to resize the preview; arrow keys to nudge"
                      data-testid="pdf-preview-divider"
                      onPointerDown={handlePreviewDividerDown}
                      onPointerMove={handlePreviewDividerMove}
                      onPointerUp={handlePreviewDividerUp}
                      onKeyDown={handlePreviewDividerKeyDown}
                    />
                    <PdfEditorPreview
                      page={state.currentPage}
                      totalPages={state.totalPages}
                      pageSize={state.pageSize}
                      editVersion={state.editVersion}
                      dprEpoch={dprEpoch}
                      resizeEpoch={previewLayoutEpoch}
                      renderExportedPageToCanvas={renderExportedPageToCanvas}
                      onRequestProcessing={() => requestProcessingConsent('preview')}
                      onReviewExport={() => { void handleExport(); }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`pe-inspector-shell ${inspectorOpen ? '' : 'closed'}`} data-testid="pdf-inspector-panel">
            <EditorRightPanel
              textStyle={state.textStyle}
              originalTextSelected={textSelectionVisible}
              annotationBlocker={annotationBlocker}
              pageSize={state.pageSize}
              onStyleChange={applyStyleToSelection}
              onEmojiSelect={handleEmojiSelect}
              onImageInsert={handleImageInsert}
              onSignatureStart={() => startSignature(activeSourcePage)}
              onSignatureStop={handleSignatureStop}
              onSignatureUpload={handleSignatureUpload}
              isSignatureMode={isSignatureMode}
              onPageSizeChange={setPageSize}
              context={inspectorContext}
              contextLabel={inspectorContextLabel}
              selectedObjectKind={state.selectedObjectKind}
              preflightReport={state.preflightReport}
              onOpenAnnotations={() => {
                setNavigationOpen(true);
                setNavigationTab('comments');
              }}
              redactionMarks={state.redactionMarks}
              onUnmarkRedaction={unmarkRedaction}
              onClearRedactions={clearRedactions}
              objectGeometry={state.selectedObjectGeometry}
              objectStyle={state.selectedObjectStyle}
              objectLocked={state.selectedObjectLocked}
              objectHidden={state.selectedObjectHidden}
              selectedObjectCount={state.selectedObjectCount}
              hasObjectClipboard={state.hasObjectClipboard}
              layers={state.pageLayers}
              onObjectGeometryChange={(partial) => void updateSelectedObjectGeometry(partial)}
              onObjectStyleChange={updateSelectedObjectStyle}
              onToggleObjectLock={toggleSelectedObjectLock}
              onToggleObjectHidden={toggleSelectedObjectHidden}
              onDuplicateObject={() => runObjectCommand(duplicateSelectedObject)}
              onCopyObject={() => runObjectCommand(copySelectedObject)}
              onPasteObject={() => runObjectCommand(pasteObjectToCurrentPage)}
              onDeleteObject={deleteSelected}
              onAlignObjects={alignSelectedObjects}
              onDistributeObjects={distributeSelectedObjects}
              onGroupObjects={() => runObjectCommand(groupSelectedObjects)}
              onUngroupObjects={() => runObjectCommand(ungroupSelectedObject)}
              onSelectLayer={selectPageLayer}
              onToggleLayerLock={togglePageLayerLock}
              onToggleLayerHidden={togglePageLayerHidden}
              onMoveLayer={(id, direction) => runObjectCommand(() => movePageLayer(id, direction))}
              annotations={state.annotations}
              annotationPage={activeSourcePage}
              annotationKind={state.annotationKind}
              annotationStyle={state.annotationStyle}
              selectedAnnotationId={state.selectedAnnotationId}
              onAnnotationKindChange={setAnnotationKind}
              onAnnotationStyleChange={setAnnotationStyle}
              onSelectAnnotation={selectAnnotation}
              onUpdateAnnotation={updateAnnotation}
              onRemoveAnnotation={removeAnnotation}
              onReplyToAnnotation={replyToAnnotation}
            />
          </div>
        </div>

        <PdfEditorStatusBar
          page={state.currentPage}
          totalPages={state.totalPages}
          width={pageBaseSize?.width ?? null}
          height={pageBaseSize?.height ?? null}
          zoom={state.zoom}
          fitMode={fitMode}
          selectionLabel={textSelectionVisible ? 'Text selected' : null}
          saveStatus={state.saveStatus}
          recoveryDisabled={state.recoveryStatus !== 'enabled'}
          lastExportVerification={state.lastExportVerification}
          lastExportDisclosures={state.lastExportDisclosures}
        />
      </div>
    </>
  );
}
