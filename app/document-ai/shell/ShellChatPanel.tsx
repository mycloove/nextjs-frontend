"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UseShellStore } from "./useShellStore";
import type { ShellCitation, ShellMessage, ShellSource } from "./types";
import { IconSend } from "./Icons";


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
    activeDocPage,
    jumpToCitation,
    busy,
    uploading,
    uploadProgress,
    connectionOk,
  } = store;


  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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

  const activePages = useMemo(() => {
    // Try to infer page count. Fall back to 7 like the mockup.
    return activeDoc?.pages || 7;
  }, [activeDoc]);

  const pageStrip = useMemo(() => {
    const total = Math.max(3, Math.min(activePages, 12));
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [activePages]);

  return (
    <main className="panel-chat" id="panel-chat">
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
          pageStrip.map((p, i) => {
            const isActivePage =
              activeDocPage != null ? p === activeDocPage : i === 0;
            return (
              <button
                key={`p-${p}`}
                type="button"
                className={`doc-thumb${isActivePage ? " active" : ""}`}
                title={`Page ${p}`}
                onClick={() =>
                  jumpToCitation({
                    id: `stripp_${p}`,
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
              Indexing document… this usually takes a few seconds.
            </p>
            <div className="upload-progress">
              <div
                className="upload-progress-bar"
                style={{ width: `${Math.round(uploadProgress)}%` }}
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
            docId={activeDoc?.docId}
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
          Answers are grounded only in this document — nothing is inferred
          beyond the page.
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
        Start a grounded conversation
      </h2>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", maxWidth: 420 }}>
        Upload a PDF and ask questions. Every answer is anchored to a specific
        page and clause of the document.
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
  docId,
  onCitationClick,
}: {
  msg: ShellMessage;
  docId?: string;
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

  const isGap = !!msg.isGap;
  const sources: ShellSource[] = msg.sources || [];
  const { html } = formatNoteText(msg.text);

  return (
    <div className="note">
      <div className="note-label-row">
        <div className={`note-label${isGap ? " gap-label" : ""}`}>Answer</div>
        <div
          className="seal"
          title="Verified — grounded fully in source text"
        />
      </div>
      <p
        className="note-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {sources.length > 0 && (
        <div className="cite-row">
          {sources.map((s, i) => {
            const label = s.label?.startsWith("p.")
              ? s.label
              : s.page
              ? `p.${s.page}`
              : s.label;
            return (
              <button
                key={i}
                type="button"
                className={`cite-chip${isGap ? " gap-chip" : ""}`}
                title={s.text || label}
                onClick={() =>
                  onCitationClick({
                    id: `${msg.id}_${i}`,
                    page: s.page || 1,
                    label: label || `p.${s.page || "?"}`,
                    text: s.text,
                    isGap,
                    docId: s.doc_id || docId,
                  })
                }
              >
                {label}
                {isGap ? " · gap" : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
