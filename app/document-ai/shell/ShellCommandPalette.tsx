"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UseShellStore } from "./useShellStore";
import { IconChat, IconFolder, IconPlus, IconSearch } from "./Icons";

interface Props {
  store: UseShellStore;
  onOpenUpload: () => void;
}

type CmdkItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  action: () => void;
};

export function ShellCommandPalette({ store, onOpenUpload }: Props) {
  const {
    showCmdk,
    setShowCmdk,
    documents,
    recents,
    setView,
    selectDoc,
    startNewChat,
  } = store;

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCmdk) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [showCmdk]);

  const items = useMemo<CmdkItem[]>(() => {
    const list: CmdkItem[] = [
      {
        id: "new",
        group: "Actions",
        label: "Start new chat",
        hint: "N",
        icon: <IconPlus />,
        action: () => {
          startNewChat();
          onOpenUpload();
          setShowCmdk(false);
        },
      },
      {
        id: "upload",
        group: "Actions",
        label: "Upload a document",
        icon: <IconPlus />,
        action: () => {
          onOpenUpload();
          setShowCmdk(false);
        },
      },
      {
        id: "chat-view",
        group: "Navigate",
        label: "Go to Document Chat",
        icon: <IconChat />,
        action: () => {
          setView("chat");
          setShowCmdk(false);
        },
      },
      {
        id: "resume-view",
        group: "Navigate",
        label: "Go to Resume Match",
        icon: <IconFolder />,
        action: () => {
          setView("resume");
          setShowCmdk(false);
        },
      },
      {
        id: "library-view",
        group: "Navigate",
        label: "Go to Document Library",
        icon: <IconFolder />,
        action: () => {
          setView("library");
          setShowCmdk(false);
        },
      },
      ...documents.slice(-8).map<CmdkItem>((d) => ({
        id: `doc-${d.docId}`,
        group: "Documents",
        label: `Open ${d.name}`,
        hint: `#${d.docNumber}`,
        icon: <IconFolder />,
        action: () => {
          selectDoc(d.docId);
          setShowCmdk(false);
        },
      })),
      ...recents.slice(0, 6).map<CmdkItem>((r) => ({
        id: r.id,
        group: "Recent",
        label: r.title,
        hint: r.timeLabel,
        icon: <IconSearch />,
        action: () => {
          if (r.docId) selectDoc(r.docId);
          setShowCmdk(false);
        },
      })),
    ];
    return list;
  }, [documents, recents, setView, selectDoc, setShowCmdk, startNewChat, onOpenUpload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    setSel(0);
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CmdkItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group) || [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowCmdk(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[sel];
      if (it) it.action();
    }
  };

  if (!showCmdk) return null;

  let flatIdx = -1;

  return (
    <div
      className="cmdk-overlay show"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowCmdk(false);
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="cmdk-modal" onKeyDown={handleKey}>
        <div className="cmdk-input-row">
          <IconSearch />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command, document name, or action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <span className="cmdk-esc mono">ESC</span>
        </div>
        <div className="cmdk-list">
          {grouped.length === 0 && (
            <div style={{ padding: 18, fontSize: 13, color: "var(--ink-faint)", textAlign: "center" }}>
              No results.
            </div>
          )}
          {grouped.map(([group, list]) => (
            <div key={group}>
              <div className="cmdk-group-label">{group}</div>
              {list.map((it) => {
                flatIdx++;
                const isSel = flatIdx === sel;
                return (
                  <button
                    key={it.id}
                    className={`cmdk-item${isSel ? " sel" : ""}`}
                    onMouseEnter={() => setSel(flatIdx)}
                    onClick={() => it.action()}
                    type="button"
                  >
                    {it.icon}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.label}
                    </span>
                    {it.hint && <span className="kbd">{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
