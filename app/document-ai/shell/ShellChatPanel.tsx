"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UseShellStore } from "./useShellStore";
import type { ShellCitation, ShellMessage, ShellSource } from "./types";
import { IconSend } from "./Icons";
import { sourceCitation } from "./sourceEvidence";


interface Props {
  store: UseShellStore;
  onOpenUpload: () => void;
}

function formatNoteText(raw: string): { html: string } {
  // Very small, safe markdown-ish: **bold** and *italic*. Escape < > &.
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const bolded = esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<i>$1</i>");
  return { html: bolded };
}

export function ShellChatPanel({ store, onOpenUpload }: Props) {
  const {
    activeDoc,
    documents,
    activeMessages,
    selectDoc,
    sendMessage,
    jumpToCitation,
    busy,
    uploading,
    connectionOk,
  } = store;


  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth" });
  }, [activeMessages, busy]);

  const canSend = useMemo(
    () => !!activeDoc && !busy && draft.trim().length > 0,
    [activeDoc, busy, draft]
  );

  const handleSend = () => {
    if (!canSend) return;
    const q = draft;
    setDraft("");
    void sendMessage(q);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const pageStrip = store.sourcePages.filter((page) => page.docId === activeDoc?.docId && page.pageNum !== null);

  return (
    <main className="panel-chat" id="panel-chat" tabIndex={-1}>
      {/* Document strip / thumbnails */}
      <div className="doc-strip">
        {documents.length === 0 && (
          <button
            className="doc-thumb upload"
            onClick={onOpenUpload}
            title="Upload a PDF"
          >
            +
          </button>
        )}

        {documents.map((d) => {
          const isActive = activeDoc?.docId === d.docId;
          return (
            <button
              key={d.docId}
              className={`doc-thumb${isActive ? " active" : ""}`}
              onClick={() => selectDoc(d.docId)}
              title={d.name}
            >
              #{d.docNumber}
            </button>
          );
        })}

        {/* When we have an active doc, also render page thumbs.
            The active thumb tracks `activeDocPage` (set by the last
            citation jump) so clicking a chip in the chat visually moves
            the strip in sync with the right-panel source viewer. */}
        {activeDoc &&
          pageStrip.map((source) => {
            const p = source.pageNum;
            const isActivePage = store.activeSourcePageId === source.id;
            return (
              <button
                key={source.id}
                type="button"
                className={`doc-thumb${isActivePage ? " active" : ""}`}
                title={`Retrieved excerpts from page ${p}`}
                onClick={() =>
                  jumpToCitation({
                    id: source.citationIds[0],
                    page: p,
                    label: `p.${p}`,
                    docId: activeDoc.docId,
                  })
                }
              >
                p.{p}
              </button>
            );
          })}

        {documents.length > 0 && (
          <button
            className="doc-thumb upload"
            onClick={onOpenUpload}
            title="Upload another PDF"
          >
            +
          </button>
        )}
      </div>

      {/* Chat scroll area */}
      <div className="chat-scroll" ref={scrollRef}>
        {!activeDoc && (
          <EmptyState uploading={uploading} onUpload={onOpenUpload} />
        )}

        {uploading && (
          <div className="note" style={{ maxWidth: "78%" }}>
            <div className="note-label-row">
              <div className="note-label">Uploading</div>
            </div>
            <p className="note-body">
              Processing document. Large or scanned files can take longer.
            </p>
            <div className="upload-progress" role="progressbar" aria-label="Processing document">
              <div
                className="upload-progress-bar indeterminate"
              />
            </div>
          </div>
        )}

        {activeDoc &&
          activeMessages.length === 0 &&
          !uploading && <FirstQuestionHint />}

        {activeMessages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            onCitationClick={jumpToCitation}
          />
        ))}

        {!connectionOk && (
          <div className="banner-error">
            Can’t reach the document AI service. Try again in a moment.
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder={
              activeDoc
                ? "Ask about payment terms, renewal, or termination…"
                : "Upload a document to start asking questions…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            disabled={!activeDoc || busy || uploading}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            type="button"
          >
            <IconSend />
          </button>
        </div>
        <div className="composer-hint">
          AI answers can be wrong. Retrieved excerpts are not claim verification; compare important details with the original document.
        </div>
      </div>
    </main>
  );
}

function EmptyState({
  uploading,
  onUpload,
}: {
  uploading: boolean;
  onUpload: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "45vh",
        textAlign: "center",
        gap: 12,
      }}
    >
      <h2
        className="serif"
        style={{ margin: 0, fontSize: 22, color: "var(--ink)" }}
      >
        Ask about your document
      </h2>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", maxWidth: 420 }}>
        Upload a PDF and ask questions. Review any returned excerpts and check important details against the original; sources may be incomplete.
      </p>
      <button
        className="new-chat-btn"
        style={{ maxWidth: 220, marginTop: 6 }}
        onClick={onUpload}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "Upload a document"}
      </button>
    </div>
  );
}

function FirstQuestionHint() {
  return (
    <div className="note" style={{ maxWidth: "78%" }}>
      <div className="note-label-row">
        <div className="note-label">Tip</div>
      </div>
      <p className="note-body">
        Ask something specific — for example, <b>“What&apos;s the liability cap?”</b>{" "}
        or <b>“Is there an indemnification clause?”</b>
      </p>
    </div>
  );
}

function MessageRow({
  msg,
  onCitationClick,
}: {
  msg: ShellMessage;
  onCitationClick: (c: ShellCitation) => void;
}) {
  if (msg.role === "user") {
    return <div className="msg-user">{msg.text}</div>;
  }

  // Assistant / system
  if (msg.loading) {
    return (
      <div className="note">
        <div className="note-label-row">
          <div className="note-label">Thinking</div>
        </div>
        <p className="note-body" style={{ margin: 0 }}>
          <span className="thinking-dots">
            <span />
            <span />
            <span />
          </span>
        </p>
      </div>
    );
  }

  if (msg.error) {
    return (
      <div className="banner-error">
        {msg.error}
      </div>
    );
  }

  const sources: ShellSource[] = msg.sources || [];
  const { html } = formatNoteText(msg.text);

  return (
    <div className="note">
      <div className="note-label-row">
        <div className="note-label">Response</div>
      </div>
      <p
        className="note-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {sources.length > 0 && (
        <div className="cite-row">
          {sources.map((s, i) => {
            const citation = sourceCitation(msg, s, i);
            const label = citation.label;
            return (
              <button
                key={i}
                type="button"
                className="cite-chip"
                title={s.text || label}
                onClick={() => onCitationClick(citation)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
