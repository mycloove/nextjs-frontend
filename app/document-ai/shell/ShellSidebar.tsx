"use client";

import React from "react";
import type { UseShellStore } from "./useShellStore";
import {
  IconChat,
  IconFolder,
  IconFolderSmall,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSun,
} from "./Icons";

interface Props {
  store: UseShellStore;
  onOpenCmdk: () => void;
  onOpenUpload: () => void;
}

export function ShellSidebar({ store, onOpenCmdk, onOpenUpload }: Props) {
  const {
    view,
    setView,
    theme,
    setTheme,
    recents,
    activeDoc,
    documents,
    selectDoc,
    setShowSidebar,
    showSidebar,
    startNewChat,
  } = store;

  const closeMobile = () => setShowSidebar(false);

  const projects = [
    { name: "Vendor Contracts — Q3", count: 7 },
    { name: "Backend Hiring — Fintech", count: 50 },
    { name: "Board Deck Review", count: 3 },
  ];

  return (
    <aside className={`sidebar${showSidebar ? " open" : ""}`} id="shell-sidebar">
      <div className="sb-brand">
        <span className="sb-mark">Document AI</span>
      </div>

      <div className="sb-scroll">
        <button
          className="new-chat-btn"
          onClick={() => {
            startNewChat();
            onOpenUpload();
            closeMobile();
          }}
        >
          <IconPlus />
          New chat
        </button>

        <button
          className="cmdk-trigger"
          onClick={() => {
            onOpenCmdk();
            closeMobile();
          }}
        >
          <IconSearch />
          Search or jump to…
          <span className="kbd">⌘K</span>
        </button>

        <div className="sb-section-label">Workspace</div>
        <button
          className={`sb-nav-item${view === "chat" ? " active" : ""}`}
          onClick={() => {
            setView("chat");
            closeMobile();
          }}
        >
          <IconChat />
          Document Chat
        </button>
        <button
          className={`sb-nav-item${view === "resume" ? " active" : ""}`}
          onClick={() => {
            setView("resume");
            closeMobile();
          }}
        >
          <IconShieldCheck />
          Resume Match
        </button>
        <button
          className={`sb-nav-item${view === "library" ? " active" : ""}`}
          onClick={() => {
            setView("library");
            closeMobile();
          }}
        >
          <IconFolder />
          Document Library
        </button>

        <div className="sb-section-label">Projects</div>
        {projects.map((p) => (
          <div className="sb-project" key={p.name}>
            <IconFolderSmall />
            <span className="sb-project-name">{p.name}</span>
            <span className="sb-project-count">{p.count}</span>
          </div>
        ))}

        <div className="sb-section-label">Recent</div>
        {recents.length === 0 && documents.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", padding: "6px 10px" }}>
            No activity yet — upload a document to start.
          </div>
        )}

        {/* Recent documents shown as jump-to items */}
        {documents
          .slice()
          .reverse()
          .slice(0, 3)
          .map((d) => (
            <button
              className={`sb-recent${activeDoc?.docId === d.docId ? " active" : ""}`}
              key={d.docId}
              onClick={() => {
                selectDoc(d.docId);
                closeMobile();
              }}
              title={d.name}
            >
              <span className="sb-recent-title">{d.name}</span>
              <span className="sb-recent-meta">
                {relativeTime(d.uploadedAt)}
              </span>
            </button>
          ))}

        {/* Recent activity (queries) */}
        {recents.slice(0, 5).map((r) => (
          <button
            className="sb-recent"
            key={r.id}
            onClick={() => {
              if (r.docId) selectDoc(r.docId);
              closeMobile();
            }}
            title={r.title}
          >
            <span className="sb-recent-title">{r.title}</span>
            <span className="sb-recent-meta">{r.timeLabel}</span>
          </button>
        ))}
      </div>

      <div className="sb-footer">
        <div className="theme-toggle" id="theme-toggle-el">
          <div className="slider" />
          <button
            className={theme === "light" ? "active" : ""}
            data-mode="light"
            onClick={() => setTheme("light")}
            type="button"
          >
            <IconSun />
            Light
          </button>
          <button
            className={theme === "dark" ? "active" : ""}
            data-mode="dark"
            onClick={() => setTheme("dark")}
            type="button"
          >
            <IconMoon />
            Dark
          </button>
        </div>

        <div className="sb-user-row">
          <div className="sb-avatar">R</div>
          <div>
            <div className="sb-user-name">Rafiq H.</div>
            <div className="sb-user-plan">PREMIUM PLAN</div>
          </div>
          <button className="icon-btn" aria-label="Settings">
            <IconSettings />
          </button>
        </div>
      </div>
    </aside>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}
