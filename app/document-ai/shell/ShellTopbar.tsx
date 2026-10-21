"use client";

import React from "react";
import type { UseShellStore } from "./useShellStore";
import { IconHamburger, IconPanel, IconSearch, IconShare } from "./Icons";

interface Props {
  store: UseShellStore;
  onOpenCmdk: () => void;
}

export function ShellTopbar({ store, onOpenCmdk }: Props) {
  const { activeDoc, view, setShowSidebar, showRightPanel, setShowRightPanel } =
    store;

  const workspace = "Acme Legal";
  const crumbTitle =
    view === "resume"
      ? "Senior Backend Engineer — JD"
      : view === "library"
      ? "Document Library"
      : activeDoc?.name || "No document";

  return (
    <div className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <button
          className="icon-btn hamburger"
          style={{ marginLeft: 0 }}
          onClick={() => setShowSidebar(true)}
          aria-label="Open menu"
        >
          <IconHamburger />
        </button>
        <div className="crumb">
          <span>{workspace}</span>
          <span className="sep">/</span>
          <div className="crumb-doc">
            <b id="crumb-title">{crumbTitle}</b>
          </div>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="btn-ghost" onClick={onOpenCmdk} type="button">
          <IconSearch />
          <span className="lbl">Search</span>
          <span className="kbd mono">⌘K</span>
        </button>
        <button className="btn-ghost" type="button">
          <IconShare />
          <span className="lbl">Share</span>
        </button>
        <button
          className="btn-ghost"
          onClick={() => setShowRightPanel(!showRightPanel)}
          type="button"
          aria-pressed={showRightPanel}
        >
          <IconPanel />
          <span className="lbl">Insights</span>
        </button>
      </div>
    </div>
  );
}
