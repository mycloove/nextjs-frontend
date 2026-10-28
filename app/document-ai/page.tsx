"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useShellStore } from "./shell/useShellStore";
import { ShellSidebar } from "./shell/ShellSidebar";
import { ShellTopbar } from "./shell/ShellTopbar";
import { ShellChatPanel } from "./shell/ShellChatPanel";
import { ShellRightPanel } from "./shell/ShellRightPanel";
import { ShellCommandPalette } from "./shell/ShellCommandPalette";
import { ShellStatusFooter } from "./shell/ShellStatusFooter";

export default function DocumentAIPage() {
  const store = useShellStore();
  const {
    theme,
    showSidebar,
    setShowSidebar,
    showRightPanel,
    setShowCmdk,
    showCmdk,
    uploadFile,
  } = store;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // ---- Global hotkeys ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setShowCmdk(true);
      } else if (e.key === "Escape") {
        if (showCmdk) setShowCmdk(false);
        if (showSidebar) setShowSidebar(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowCmdk, showCmdk, showSidebar, setShowSidebar]);

  // ---- File pickers ----
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await uploadFile(file);
      }
      // Reset so same file can be re-picked
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFile]
  );

  // ---- Drag & drop anywhere on the shell ----
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // Only unset when leaving to outside window
    if (e.currentTarget === e.target) setDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === "application/pdf") {
      await uploadFile(file);
    }
  };

  return (
    <div
      className={`doc-ai-shell${showRightPanel ? " right-panel-open" : ""}`}
      data-theme={theme}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Drag overlay */}
      {dragging && (
        <div
          style={{
            position: "fixed",
            inset: 12,
            border: "2px dashed var(--signal)",
            borderRadius: 20,
            background: "rgba(47,111,94,0.06)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontFamily: "Source Serif 4, Georgia, serif",
            color: "var(--signal-deep)",
            fontSize: 20,
          }}
        >
          Drop your PDF to index
        </div>
      )}

      <div className="app-shell">
        <ShellSidebar
          store={store}
          onOpenCmdk={() => setShowCmdk(true)}
          onOpenUpload={openFilePicker}
        />

        {/* Mobile sidebar overlay */}
        <div
          className={`overlay${showSidebar ? " show" : ""}`}
          onClick={() => setShowSidebar(false)}
          aria-hidden
        />

        <div className="main-col">
          <ShellTopbar store={store} onOpenCmdk={() => setShowCmdk(true)} />

          <div className="content-row">
            <ShellChatPanel store={store} onOpenUpload={openFilePicker} />
            {showRightPanel && <ShellRightPanel store={store} />}
          </div>

          <ShellStatusFooter store={store} />
        </div>
      </div>

      <ShellCommandPalette store={store} onOpenUpload={openFilePicker} />
    </div>
  );
}
