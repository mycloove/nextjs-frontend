"use client";

import React, { useEffect, useMemo, useRef } from "react";
import type { UseShellStore } from "./useShellStore";
import type { ShellCitation, SourceBlock, SourcePage } from "./types";
import { sourceCitation } from "./sourceEvidence";

interface Props {
  store: UseShellStore;
}

export function ShellRightPanel({ store }: Props) {
  const {
    activeDoc,
    activeMessages,
    rightPanelMode,
    activeCitation,
    jumpNonce,
    jumpToCitation,
    showInsightsPanel,
  } = store;

  return (
    <aside className="right-panel" data-mode={rightPanelMode}>
      <div className="rp-mode-tabs" role="group" aria-label="Right panel view">
        <button
          type="button"
          aria-pressed={rightPanelMode === "insights"}
          className={`rp-mode-tab${rightPanelMode === "insights" ? " active" : ""}`}
          onClick={showInsightsPanel}
        >
          Insights
        </button>
        <button
          type="button"
          aria-pressed={rightPanelMode === "source"}
          className={`rp-mode-tab${rightPanelMode === "source" ? " active" : ""}`}
          onClick={() => {
            store.setRightPanelMode("source");
          }}
          disabled={!store.sourcePages.length}
          title={
            activeCitation
              ? "Show retrieved excerpts"
              : "Open the excerpts returned with an answer"
          }
        >
          Excerpts
        </button>
        <button type="button" className="rp-mode-tab" onClick={() => { store.setShowRightPanel(false); requestAnimationFrame(() => document.getElementById("panel-chat")?.focus()); }} aria-label="Close source panel">Close</button>
      </div>

      {rightPanelMode === "source" ? (
        <SourceViewerView
          pages={store.sourcePages}
          activeSourcePageId={store.activeSourcePageId}
          activeCitationId={activeCitation?.id ?? null}
          crumbLabel={activeCitation?.label}
          onBack={showInsightsPanel}
          onStep={store.stepPage}
          nonce={jumpNonce}
        />
      ) : (
        <div className="rp-insights-scroll">
          <InsightsView store={store} onCitationClick={jumpToCitation} />

          {activeDoc && (
            <div className="rp-section">
              <div className="rp-section-label">Document</div>
              <div className="rp-meta-row">
                <span>Name</span>
                <span title={activeDoc.name}>{truncate(activeDoc.name, 22)}</span>
              </div>
              <div className="rp-meta-row">
                <span>Doc ID</span>
                <span title={activeDoc.docId}>{truncate(activeDoc.docId, 14)}</span>
              </div>
              <div className="rp-meta-row">
                <span>Doc #</span>
                <span>{activeDoc.docNumber}</span>
              </div>
              {activeDoc.sizeMB !== undefined && (
                <div className="rp-meta-row">
                  <span>Size</span>
                  <span>{activeDoc.sizeMB} MB</span>
                </div>
              )}
              <div className="rp-meta-row">
                <span>Uploaded</span>
                <span>{new Date(activeDoc.uploadedAt).toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="rp-section">
            <div className="rp-section-label">Session</div>
            <div className="rp-meta-row">
              <span>Turn</span>
              <span>
                {activeMessages.filter((m) => m.role === "user").length}
              </span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Insights view (default)                                             */
/* ------------------------------------------------------------------ */

function InsightsView({
  store,
  onCitationClick,
}: {
  store: UseShellStore;
  onCitationClick: (c: ShellCitation) => void;
}) {
  const { activeMessages, sourcePages: citedPages } = store;

  const lastAssistant = useMemo(() => {
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      if (activeMessages[i].role === "assistant" && !activeMessages[i].loading) {
        return activeMessages[i];
      }
    }
    return null;
  }, [activeMessages]);

  return (
    <>
      <div className="rp-head">
        <h3 className="rp-title serif">Insights</h3>
        <div className="rp-sub">Retrieved context, not verification of the answer.</div>
      </div>

      <div className="rp-section">
        <div className="rp-section-label">Retrieved references</div>
        {(!lastAssistant ||
          !(lastAssistant.sources && lastAssistant.sources.length)) && (
          <div className="rp-empty">
            No retrieved references are available for this answer.
          </div>
        )}
        {lastAssistant?.sources?.map((s, i) => (
          <button
            key={i}
            className="rp-source"
            title={s.text || s.label}
            onClick={() =>
              onCitationClick(sourceCitation(lastAssistant, s, i))
            }
          >
            <span className="rp-source-dot" />
            <span style={{ minWidth: 0 }}>
              <b>
                {sourceCitation(lastAssistant, s, i).label}
              </b>
              {s.text && (
                <span
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.text}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="rp-section">
        <div className="rp-section-label">Source groups</div>
        {citedPages.length === 0 ? (
          <div className="rp-empty">No source groups yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {citedPages.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cite-chip"
                onClick={() =>
                  onCitationClick({
                    id: p.citationIds[0],
                    page: p.pageNum,
                    label: p.pageLabel,
                    docId: p.docId,
                  })
                }
              >
                {p.pageLabel}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* SourceViewerView — paginated per-page source viewer                 */
/*                                                                    */
/* Mirrors the reference mockup exactly:                               */
/*   • sticky doc header + breadcrumb (Source · p.4 · §2.1)            */
/*   • PageBar ‹ Page X of Y ›                                         */
/*   • one .sv-page article per page, inline `.sv-hl` highlights.     */
/*   • clicking a chip → scroll target into view + one-time `flash`   */
/*     animation. Same-chip re-click replays the animation via a      */
/*     force-reflow toggle keyed by `nonce`.                           */
/* ------------------------------------------------------------------ */

function SourceViewerView({
  pages,
  activeSourcePageId,
  activeCitationId,
  crumbLabel,
  onBack,
  onStep,
  nonce,
}: {
  pages: SourcePage[];
  activeSourcePageId: string | null;
  activeCitationId: string | null;
  crumbLabel?: string;
  onBack: () => void;
  onStep: (dir: number) => void;
  nonce: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentPage = useMemo(
    () => pages.find((p) => p.id === activeSourcePageId) || (!activeCitationId && activeSourcePageId === null ? pages[0] : null) || null,
    [pages, activeSourcePageId, activeCitationId]
  );
  const currentIndex = pages.findIndex((page) => page.id === currentPage?.id);

  // Scroll + flash effect. Re-runs whenever activeCitationId / activePage
  // / nonce changes. The nonce guarantees a same-citation re-click also
  // replays the flash even though nothing else changed.
  useEffect(() => {
    if (!activeCitationId) { scrollRef.current?.scrollTo({ top: 0 }); return; }
    const raf = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(
        `[data-cid="${cssEscape(activeCitationId)}"]`
      );
      if (!el) return;
      el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth", block: "center" });
      el.focus({ preventScroll: true });
      // Force reflow so the animation replays on repeat clicks.
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
    return () => cancelAnimationFrame(raf);
  }, [activeCitationId, activeSourcePageId, nonce]);

  const disablePrev = currentIndex <= 0;
  const disableNext = currentIndex < 0 || currentIndex >= pages.length - 1;
  const crumb = crumbLabel || currentPage?.pageLabel || "No reference selected";

  return (
    <div className="sv-wrap">
      {/* Sticky doc header + breadcrumb */}
      <div className="sv-doc-header">
        <button
          type="button"
          className="sv-back"
          onClick={onBack}
          aria-label="Back to insights"
          title="Back to Insights"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
            <path
              d="M12 5l-5 5 5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Insights</span>
        </button>
        <div className="sv-doc-meta">
          <div className="sv-doc-name" title={currentPage?.pageLabel}>
            {currentPage?.pageLabel || "Retrieved excerpts"}
          </div>
          <div className="sv-crumb" aria-label="Location">
            <span className="sv-crumb-key">Excerpt</span>
            <span className="sv-crumb-sep">·</span>
            <span className="sv-crumb-val">{crumb}</span>
          </div>
        </div>
      </div>

      <PageBar
        page={currentIndex + 1}
        total={pages.length}
        disablePrev={disablePrev}
        disableNext={disableNext}
        onStep={onStep}
      />

      <div className="sv-scroll" ref={scrollRef}>
        {currentPage ? (
          <article
            className="sv-page-doc"
            id={`source-group-${currentIndex}`}
            data-page={currentPage.pageNum}
          >
            <div className="sv-page-num">{currentPage.pageLabel}</div>
            {currentPage.blocks.map((b, i) => (
              <BlockRenderer
                key={i}
                block={b}
                activeCitationId={activeCitationId}
              />
            ))}
          </article>
        ) : (
          <div className="sv-empty">
            <b style={{ display: "block", marginBottom: 4 }}>
              No retrieved excerpt selected
            </b>
            No excerpt is available for this reference. This does not establish that a clause or fact is absent from the original document.
          </div>
        )}
      </div>

      <div className="sv-footnote">
        These are retrieved excerpts, not original PDF pages or verified claim evidence. Excerpts may be truncated. Check the original before relying on an answer.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageBar — the ‹ Page X of Y › control from the reference mockup.    */
/* ------------------------------------------------------------------ */
function PageBar({
  page,
  total,
  disablePrev,
  disableNext,
  onStep,
}: {
  page: number;
  total: number;
  disablePrev: boolean;
  disableNext: boolean;
  onStep: (dir: number) => void;
}) {
  return (
    <div className="sv-pagebar" role="navigation" aria-label="Retrieved source groups">
      <button
        type="button"
        className="sv-pager-btn"
        onClick={() => onStep(-1)}
        disabled={disablePrev}
        aria-label="Previous source group"
        title="Previous source group"
      >
        <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden>
          <path
            d="M12 5l-5 5 5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="sv-pagebar-label">
        Source group <b>{page}</b> of {total}
      </span>
      <button
        type="button"
        className="sv-pager-btn"
        onClick={() => onStep(1)}
        disabled={disableNext}
        aria-label="Next source group"
        title="Next source group"
      >
        <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden>
          <path
            d="M8 5l5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BlockRenderer — heading | paragraph(inline highlights).             */
/* Each highlight gets a stable id + data-cid so the scroll+flash      */
/* effect above can find it and re-trigger the animation.              */
/* ------------------------------------------------------------------ */
function BlockRenderer({
  block,
  activeCitationId,
}: {
  block: SourceBlock;
  activeCitationId: string | null;
}) {
  if (block.type === "heading") {
    return (
      <div
        className="sv-heading"
        style={block.level === 2 ? { fontSize: "12.5px" } : undefined}
      >
        {block.text}
      </div>
    );
  }
  return (
    <p className="sv-para">
      {block.segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        const isActive = seg.citationId === activeCitationId;
        return (
          <span
            key={i}
            id={seg.citationId}
            data-cid={seg.citationId}
            tabIndex={-1}
            className={`sv-hl${seg.isGap ? " gap" : ""}${
              isActive ? " is-target" : ""
            }`}
          >
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}

function truncate(v: string, n: number) {
  if (!v) return "";
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

/** Minimal CSS.escape shim for attribute selectors. */
function cssEscape(v: string): string {
  const w = typeof window !== "undefined"
    ? (window as unknown as { CSS?: { escape?: (v: string) => string } })
    : undefined;
  if (w?.CSS?.escape) return w.CSS.escape(v);
  return v.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
