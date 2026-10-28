"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RightPanelMode,
  ShellCitation,
  ShellDocument,
  ShellMessage,
  ShellRecent,
  Theme,
} from "./types";
import { buildSourcePages, normalizeChatSources, sourceGroupForCitation } from "./sourceEvidence";

// -- LocalStorage keys (compatible with existing pages) --
const LS_SESSION_KEY = "doc_session_id";
const LS_DOCS_KEY = "documents";
const LS_ACTIVE_KEY = "activeDocId";
const LS_MSGS_KEY = "docai_shell_messages_v1";
const LS_RECENTS_KEY = "docai_shell_recents_v1";
const LS_THEME_KEY = "docai_shell_theme";
const LS_VIEW_KEY = "docai_shell_view"; // "chat" | "resume" | "library"

type MainView = "chat" | "resume" | "library";

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}

export function useShellStore() {
  // ---- documents / active doc ----
  const [documents, setDocuments] = useState<ShellDocument[]>(() =>
    readLS<ShellDocument[]>(LS_DOCS_KEY, [])
  );
  const [activeDocId, setActiveDocId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(LS_ACTIVE_KEY) || "";
  });
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(LS_SESSION_KEY) || "";
  });

  // ---- messages, per docId ----
  const [messagesByDoc, setMessagesByDoc] = useState<
    Record<string, ShellMessage[]>
  >(() => readLS<Record<string, ShellMessage[]>>(LS_MSGS_KEY, {}));

  // ---- recent chats (sidebar) ----
  const [recents, setRecents] = useState<ShellRecent[]>(() =>
    readLS<ShellRecent[]>(LS_RECENTS_KEY, [])
  );

  // ---- theme ----
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem(LS_THEME_KEY) as Theme | null;
    return saved === "dark" ? "dark" : "light";
  });

  // ---- UI ----
  const [view, setViewState] = useState<MainView>(() => {
    if (typeof window === "undefined") return "chat";
    return (localStorage.getItem(LS_VIEW_KEY) as MainView) || "chat";
  });
  const [showSidebar, setShowSidebar] = useState(false); // mobile sidebar
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [showCmdk, setShowCmdk] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connectionOk, setConnectionOk] = useState(true);

  // ---- Citation / Source viewer ----
  // rightPanelMode = "insights" (default) or "source" (viewer).
  // activeCitation holds the current jump target; jumpNonce lets identical
  // re-clicks retrigger the flash pulse without changing the payload.
  // activeDocPage is the page the doc-strip thumbnail row + Source PageBar
  // both read; kept in the shared store so ChatPanel and RightPanel stay
  // in lockstep on which page is "current".
  const [rightPanelMode, setRightPanelMode] =
    useState<RightPanelMode>("insights");
  const [activeCitation, setActiveCitation] =
    useState<ShellCitation | null>(null);
  const [jumpNonce, setJumpNonce] = useState(0);
  const [activeDocPage, setActiveDocPage] = useState<number | null>(null);
  const [activeSourcePageId, setActiveSourcePageId] = useState<string | null>(null);

  // ---- persist ----
  useEffect(() => {
    writeLS(LS_DOCS_KEY, documents);
  }, [documents]);
  useEffect(() => {
    if (activeDocId) localStorage.setItem(LS_ACTIVE_KEY, activeDocId);
  }, [activeDocId]);
  useEffect(() => {
    if (sessionId) localStorage.setItem(LS_SESSION_KEY, sessionId);
  }, [sessionId]);
  useEffect(() => {
    writeLS(LS_MSGS_KEY, messagesByDoc);
  }, [messagesByDoc]);
  useEffect(() => {
    writeLS(LS_RECENTS_KEY, recents);
  }, [recents]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_VIEW_KEY, view);
  }, [view]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.docId === activeDocId),
    [documents, activeDocId]
  );
  const activeMessages = useMemo<ShellMessage[]>(
    () => (activeDoc ? messagesByDoc[activeDoc.docId] || [] : []),
    [activeDoc, messagesByDoc]
  );

  // recompute recent time labels every minute so they stay fresh visually
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  const recentsView = useMemo<ShellRecent[]>(
    () =>
      recents.map((r) => ({ ...r, timeLabel: timeAgo(r.createdAt) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recents, tick]
  );

  // If the user switches to a different document, clear any active
  // citation so we don't accidentally point at a page in the wrong PDF.
  useEffect(() => {
    setActiveCitation(null);
    setRightPanelMode("insights");
    setActiveDocPage(null);
    setActiveSourcePageId(null);
  }, [activeDocId]);

  // ---- Source pages (paginated view) ----
  // Rebuild a `SourcePage[]` from every assistant answer whose citations
  // belong to the current doc. Each cited page becomes a page whose
  // paragraph contains one `highlight` segment per citation on it — the
  // citationId join-key is what the SourceViewer scrolls to & flashes.
  const sourcePages = useMemo(
    () => buildSourcePages(activeMessages, documents),
    [activeMessages, documents]
  );

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "light" ? "dark" : "light")),
    []
  );
  const setView = useCallback((v: MainView) => setViewState(v), []);

  // ---- Upload ----
  const uploadFile = useCallback(
    async (file: File): Promise<ShellDocument | null> => {
      if (!file) return null;
      setUploading(true);
      setUploadProgress(0);

      const fd = new FormData();
      fd.append("file", file);
      const currentSession =
        sessionId || localStorage.getItem(LS_SESSION_KEY) || "";
      if (currentSession) fd.append("session_id", currentSession);

      try {
        const res = await fetch(`/api/document-ai/upload`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        setUploadProgress(100);

        if (!res.ok || !data.success || !data.doc_id || !data.pdf_url) {
          setConnectionOk(true);
          setUploading(false);
          setUploadProgress(0);
          return null;
        }

        const newDoc: ShellDocument = {
          docId: data.doc_id,
          pdfUrl: data.pdf_url,
          name: file.name || `Document ${data.document_number}`,
          sessionId: data.session_id,
          docNumber: data.document_number || documents.length + 1,
          uploadedAt: Date.now(),
          sizeMB: +(file.size / (1024 * 1024)).toFixed(2),
        };

        setDocuments((prev) => [...prev, newDoc]);
        setActiveDocId(newDoc.docId);
        if (!currentSession) setSessionId(data.session_id);
        setConnectionOk(true);

        // Add a recent
        setRecents((prev) => {
          const r: ShellRecent = {
            id: `rec_${Date.now()}`,
            title: `Uploaded ${newDoc.name}`,
            timeLabel: "just now",
            createdAt: Date.now(),
            docId: newDoc.docId,
          };
          return [r, ...prev].slice(0, 30);
        });

        setUploading(false);
        setUploadProgress(0);

        return newDoc;
      } catch {
        setUploading(false);
        setUploadProgress(0);
        setConnectionOk(false);
        return null;
      }
    },
    [sessionId, documents.length]
  );

  // ---- Send message ----
  const sendMessage = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || !activeDoc) return;

      const now = Date.now();
      const userMsg: ShellMessage = {
        id: `u_${now}`,
        role: "user",
        text: q,
        createdAt: now,
      };
      const loadingMsg: ShellMessage = {
        id: `a_${now}`,
        role: "assistant",
        text: "",
        createdAt: now + 1,
        loading: true,
      };

      setMessagesByDoc((prev) => ({
        ...prev,
        [activeDoc.docId]: [
          ...(prev[activeDoc.docId] || []),
          userMsg,
          loadingMsg,
        ],
      }));

      // record recent
      setRecents((prev) => {
        const shortTitle =
          q.length > 60 ? q.slice(0, 60).trim() + "…" : q;
        const r: ShellRecent = {
          id: `rec_${now}`,
          title: `${activeDoc.name} — ${shortTitle}`,
          timeLabel: "just now",
          createdAt: now,
          docId: activeDoc.docId,
        };
        return [r, ...prev].slice(0, 30);
      });

      setBusy(true);

      try {
        const effectiveSession =
          sessionId || localStorage.getItem(LS_SESSION_KEY) || "";

        const res = await fetch(`/api/document-ai/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: q,
            doc_id: activeDoc.docId,
            session_id: effectiveSession,
          }),
        });

        const data = await res.json();

        if (data?.error) {
          setMessagesByDoc((prev) => {
            const list = [...(prev[activeDoc.docId] || [])];
            const idx = list.findIndex((m) => m.id === loadingMsg.id);
            if (idx >= 0) {
              list[idx] = {
                ...list[idx],
                loading: false,
                error: String(data.error),
                text: "",
              };
            }
            return { ...prev, [activeDoc.docId]: list };
          });
          setBusy(false);
          return;
        }

        const answer: string = data.answer || "No response.";
        const { sources, resolvedDocId } = normalizeChatSources(data);

        setMessagesByDoc((prev) => {
          const list = [...(prev[activeDoc.docId] || [])];
          const idx = list.findIndex((m) => m.id === loadingMsg.id);
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              text: answer,
              sources,
              resolvedDocId,
              isGap: false,
              loading: false,
            };
          }
          return { ...prev, [activeDoc.docId]: list };
        });

        setConnectionOk(true);
      } catch {
        setMessagesByDoc((prev) => {
          const list = [...(prev[activeDoc.docId] || [])];
          const idx = list.findIndex((m) => m.id === loadingMsg.id);
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              loading: false,
              error: "Server error. Please try again.",
              text: "",
            };
          }
          return { ...prev, [activeDoc.docId]: list };
        });
        setConnectionOk(false);
      } finally {
        setBusy(false);
      }
    },
    [activeDoc, sessionId]
  );

  const clearActiveConversation = useCallback(() => {
    if (!activeDoc) return;
    setMessagesByDoc((prev) => ({ ...prev, [activeDoc.docId]: [] }));
  }, [activeDoc]);

  const startNewChat = useCallback(() => {
    // Just clear the current doc's chat if any; otherwise, open uploader
    if (activeDoc) {
      clearActiveConversation();
    }
    setView("chat");
    setShowSidebar(false);
  }, [activeDoc, clearActiveConversation, setView]);

  const selectDoc = useCallback((docId: string) => {
    setActiveDocId(docId);
    setView("chat");
  }, [setView]);

  // ---- Citation jump (Source Viewer) ----
  /**
   * Fired when a cite-chip (chat) or source row (Insights) is clicked.
   * Opens the right panel in "source" mode, points the doc-strip &
   * PageBar at the citation's page, and bumps a nonce so the viewer
   * re-triggers the flash pulse even for the same citation twice.
   */
  const jumpToCitation = useCallback((citation: ShellCitation) => {
    setActiveCitation(citation);
    setRightPanelMode("source");
    setShowRightPanel(true);
    setActiveDocPage(citation.page);
    setActiveSourcePageId(sourceGroupForCitation(sourcePages, citation)?.id ?? null);
    setJumpNonce((n) => n + 1);
  }, [sourcePages]);

  /** Return the right panel to the default Insights mode. */
  const showInsightsPanel = useCallback(() => {
    setRightPanelMode("insights");
    setShowRightPanel(true);
  }, []);

  /** Navigate returned source groups, not invented intervening PDF pages. */
  const stepPage = useCallback(
    (dir: number) => {
      const index = sourcePages.findIndex((page) => page.id === activeSourcePageId);
      const next = sourcePages[Math.max(0, Math.min(sourcePages.length - 1, Math.max(0, index) + dir))];
      if (!next) return;
      setActiveSourcePageId(next.id);
      setActiveDocPage(next.pageNum);
      setActiveCitation(null);
    },
    [activeSourcePageId, sourcePages]
  );

  const removeDoc = useCallback(
    (docId: string) => {
      setDocuments((prev) => prev.filter((d) => d.docId !== docId));
      setMessagesByDoc((prev) => {
        const rest = { ...prev };
        delete rest[docId];
        return rest;
      });
      if (activeDocId === docId) {
        const remaining = documents.filter((d) => d.docId !== docId);
        setActiveDocId(remaining.length ? remaining[0].docId : "");
      }
    },
    [documents, activeDocId]
  );

  return {
    // state
    documents,
    activeDocId,
    activeDoc,
    sessionId,
    activeMessages,
    recents: recentsView,
    theme,
    view,
    showSidebar,
    showRightPanel,
    showCmdk,
    uploading,
    uploadProgress,
    busy,
    connectionOk,
    rightPanelMode,
    activeCitation,
    jumpNonce,
    activeDocPage,
    activeSourcePageId,
    sourcePages,

    // setters / actions
    setTheme,
    toggleTheme,
    setView,
    setShowSidebar,
    setShowRightPanel,
    setShowCmdk,
    setActiveDocId,
    setSessionId,
    setRightPanelMode,
    setActiveDocPage,

    uploadFile,
    sendMessage,
    clearActiveConversation,
    startNewChat,
    selectDoc,
    removeDoc,
    jumpToCitation,
    showInsightsPanel,
    stepPage,
  };
}

export type UseShellStore = ReturnType<typeof useShellStore>;
