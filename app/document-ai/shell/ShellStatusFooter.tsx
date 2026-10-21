"use client";

import React, { useEffect, useState } from "react";
import type { UseShellStore } from "./useShellStore";

interface Props {
  store: UseShellStore;
}

export function ShellStatusFooter({ store }: Props) {
  const { activeDoc, activeMessages, busy, uploading, connectionOk } = store;

  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const set = () =>
      setNow(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    set();
    const id = setInterval(set, 30000);
    return () => clearInterval(id);
  }, []);

  const status = uploading
    ? "Indexing document"
    : busy
    ? "Grounding answer"
    : connectionOk
    ? "Grounded · Ready"
    : "Offline — retry required";

  const turns = activeMessages.filter((m) => m.role === "user").length;

  return (
    <div className="status-footer">
      <div className="status-left">
        <span>
          <span
            className="status-dot"
            style={{
              background: connectionOk ? "var(--signal)" : "var(--gap)",
            }}
          />
          {status}
        </span>
        {activeDoc && <span>{activeDoc.name}</span>}
        <span>{turns} turn{turns === 1 ? "" : "s"}</span>
      </div>
      <div>
        <span>{now}</span>
      </div>
    </div>
  );
}
