"use client";

import React, { useEffect, useMemo, useRef } from "react";
import type { UseShellStore } from "./useShellStore";
import type { ShellCitation, SourceBlock, SourcePage } from "./types";

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
      <div className="rp-mode-tabs" role="tablist" aria-label="Right panel view">
        <button
          type="button"
          role="tab"
          aria-selected={rightPanelMode === "insights"}
          className={`rp-mode-tab${rightPanelMode === "insights" ? " active" : ""}`}
          onClick={showInsightsPanel}
        >
          Insights
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rightPanelMode === "source"}
          className={`rp-mode-tab${rightPanelMode === "source" ? " active" : ""}`}
          onClick={() => {
            if (activeCitation) jumpToCitation(activeCitation);
          }}
          disabled={!activeCitation}
          title={
            activeCitation
              ? "Show the exact source snippet"
              : "Click a cited page in a chat answer to open the source"
          }
        >
          Source
        </button>
      </div>

      {rightPanelMode === "source" ? (
        <SourceViewerView
          store={store}
          pages={store.sourcePages}
          totalPages={store.totalPages}
          activePage={
            store.activeDocPage ?? activeCitation?.page ?? 1
          }
          activeCitationId={activeCitation?.id ?? null}
          isGap={!!activeCitation?.isGap}
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
              <span>Model</span>
              <span>Groq · llama-3.1</span>
            </div>
            <div className="rp-meta-row">
              <span>Retrieval</span>
              <span>RAG · pgvector</span>
            </div>
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
  const { activeMessages, activeDoc } = store;

  const citedPages = useMemo(() => {
    const set = new Set<number>();
    for (const m of activeMessages) {
      if (m.role !== "assistant") continue;
      for (const s of m.sources || []) {
        if (s.page) set.add(s.page);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [activeMessages]);

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
        <div className="rp-sub">Everything the answer stands on.</div>
      </div>

      <div className="rp-section">
        <div className="rp-section-label">Sources cited</div>
        {(!lastAssistant ||
          !(lastAssistant.sources && lastAssistant.sources.length)) && (
          <div className="rp-empty">
            Ask a question — cited pages and gaps will appear here.
          </div>
        )}
        {lastAssistant?.sources?.map((s, i) => (
          <button
            key={i}
            className={`rp-source${lastAssistant.isGap ? " gap" : ""}`}
            title={s.text || s.label}
            onClick={() =>
              onCitationClick({
                id: `${lastAssistant.id}_src_${i}`,
                page: s.page || 1,
                label: s.label?.startsWith("p.")
                  ? s.label
                  : `p.${s.page || "?"}`,
                text: s.text,
                isGap: !!lastAssistant.isGap,
                docId: s.doc_id || activeDoc?.docId,
              })
            }
          >
            <span className="rp-source-dot" />
            <span style={{ minWidth: 0 }}>
              <b>
                {s.label?.startsWith("p.") ? s.label : `p.${s.page || "?"}`}
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
        <div className="rp-section-label">Cited pages</div>
        {citedPages.length === 0 ? (
          <div className="rp-empty">No pages cited yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {citedPages.map((p) => (
              <button
                key={p}
                type="button"
                className="cite-chip"
                onClick={() =>
                  onCitationClick({
                    id: `pageidx_${p}`,
                    page: p,
                    label: `p.${p}`,
                    docId: activeDoc?.docId,
                  })
                }
              >
                p.{p}
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
  store,
  pages,
  totalPages,
  activePage,
  activeCitationId,
  isGap,
  crumbLabel,
  onBack,
  onStep,
  nonce,
}: {
  store: UseShellStore;
  pages: SourcePage[];
  totalPages: number;
  activePage: number;
  activeCitationId: string | null;
  isGap: boolean;
  crumbLabel?: string;
  onBack: () => void;
  onStep: (dir: number) => void;
  nonce: number;
}) {
  const { activeDoc } = store;
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentPage = useMemo(
    () => pages.find((p) => p.pageNum === activePage) || null,
    [pages, activePage]
  );

  // Scroll + flash effect. Re-runs whenever activeCitationId / activePage
  // / nonce changes. The nonce guarantees a same-citation re-click also
  // replays the flash even though nothing else changed.
  useEffect(() => {
    if (!activeCitationId) return;
    const raf = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(
        `[data-cid="${cssEscape(activeCitationId)}"]`
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Force reflow so the animation replays on repeat clicks.
      el.classList.remove("flash");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void el.offsetWidth;
      el.classList.add("flash");
    });
    return () => cancelAnimationFrame(raf);
  }, [activeCitationId, activePage, nonce]);

  const disablePrev = activePage <= 1;
  const disableNext = activePage >= totalPages;
  const crumb = crumbLabel || `p.${activePage}`;

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
          <div className="sv-doc-name" title={activeDoc?.name}>
            {activeDoc?.name || "Document"}
          </div>
          <div className="sv-crumb" aria-label="Location">
            <span className="sv-crumb-key">Source</span>
            <span className="sv-crumb-sep">·</span>
            <span className="sv-crumb-val">{crumb}</span>
            {isGap && (
              <>
                <span className="sv-crumb-sep">·</span>
                <span className="sv-gap-tag" title="No matching clause found">
                  gap
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <PageBar
        page={activePage}
        total={totalPages}
        disablePrev={disablePrev}
        disableNext={disableNext}
        onStep={onStep}
      />

      <div className="sv-scroll" ref={scrollRef}>
        {currentPage ? (
          <article
            className="sv-page-doc"
            id={`page-${currentPage.pageNum}`}
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
              Page {activePage} not loaded
            </b>
            No cited snippet is available for this page yet. Ask something
            grounded in this page to bring it in.
          </div>
        )}
      </div>

      <div className="sv-footnote">
        {isGap
          ? "The model flagged this citation as missing — the highlight marks the absent clause."
          : "Highlighted text is the exact passage the answer was grounded in."}
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
    <div className="sv-pagebar" role="navigation" aria-label="Page pager">
      <button
        type="button"
        className="sv-pager-btn"
        onClick={() => onStep(-1)}
        disabled={disablePrev}
        aria-label="Previous page"
        title="Previous page"
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
        Page <b>{page}</b> of {total}
      </span>
      <button
        type="button"
        className="sv-pager-btn"
        onClick={() => onStep(1)}
        disabled={disableNext}
        aria-label="Next page"
        title="Next page"
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
