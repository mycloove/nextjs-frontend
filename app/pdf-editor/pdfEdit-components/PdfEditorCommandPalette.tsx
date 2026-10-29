'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterPdfEditorCommands,
  type PdfEditorCommand,
} from '../pdfEdit-utils/editorCommandPalette';

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onRun: (id: string) => void;
  editingReady: boolean;
  redactionEnabled: boolean;
  sourceTextEnabled: boolean;
}

export function PdfEditorCommandPalette({ open, onClose, onRun, editingReady, redactionEnabled, sourceTextEnabled }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const commands = useMemo(() => filterPdfEditorCommands(query), [query]);
  const disabled = (command: PdfEditorCommand) => (command.id.startsWith('tool-') && !editingReady)
    || (command.id === 'tool-redact' && !redactionEnabled) || (command.id === 'tool-editText' && !sourceTextEnabled);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(index => Math.min(index + 1, Math.max(0, commands.length - 1)));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(index => Math.max(0, index - 1));
      }
      if (event.key === 'Enter') {
        const command = commands[activeIndex];
        if (command && !((command.id.startsWith('tool-') && !editingReady) || (command.id === 'tool-redact' && !redactionEnabled) || (command.id === 'tool-editText' && !sourceTextEnabled))) {
          event.preventDefault();
          onRun(command.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, commands, activeIndex, onRun, onClose, editingReady, redactionEnabled, sourceTextEnabled]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div
      className="pe-palette-backdrop"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <style>{`
        .pe-palette-backdrop {
          position: fixed; inset: 0; z-index: 600;
          display: grid; place-items: start center;
          padding: min(12vh, 96px) 16px 24px;
          background: var(--pe-scrim);
          overflow: auto;
        }
        .pe-palette {
          width: min(560px, 100%);
          max-height: min(620px, calc(100dvh - 48px));
          display: flex; flex-direction: column;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
          overflow: hidden;
        }
        .pe-palette-input {
          width: 100%; min-height: 50px;
          padding: 0 16px;
          border: 0; border-bottom: 1px solid var(--pe-line);
          background: transparent;
          color: var(--pe-text);
          font-family: inherit; font-size: 14px;
          outline: none;
        }
        .pe-palette-input::placeholder { color: var(--pe-text-3); }
        .pe-palette-list {
          flex: 1; min-height: 0; overflow: auto;
          padding: 6px;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
        }
        .pe-palette-group {
          padding: 8px 10px 4px;
          color: var(--pe-text-3);
          font-size: 11px; font-weight: 800;
          letter-spacing: .1em; text-transform: uppercase;
        }
        .pe-palette-item {
          width: 100%; min-height: 38px;
          padding: 0 10px;
          display: flex; align-items: center; gap: 10px;
          border: 1px solid transparent; border-radius: var(--pe-r-sm);
          background: transparent; color: var(--pe-text-2);
          font-family: inherit; font-size: 12.5px; font-weight: 600;
          text-align: left; cursor: pointer;
        }
        .pe-palette-item.active,
        .pe-palette-item:hover {
          background: var(--pe-panel-3);
          color: var(--pe-text);
          border-color: var(--pe-line);
        }
        .pe-palette-item.active {
          border-color: var(--pe-signal-line);
          background: var(--pe-signal-soft);
          color: var(--pe-text);
        }
        .pe-palette-shortcut {
          margin-left: auto;
          color: var(--pe-text-3);
          font-size: 11px; font-weight: 650;
          font-variant-numeric: tabular-nums;
        }
        .pe-palette-item:disabled { opacity: .45; cursor: not-allowed; }
        .pe-palette-empty {
          padding: 28px 16px;
          color: var(--pe-text-3); font-size: 12px; text-align: center;
        }
        .pe-palette-foot {
          display: flex; justify-content: space-between; gap: 10px;
          padding: 8px 14px;
          border-top: 1px solid var(--pe-line);
          color: var(--pe-text-3); font-size: 11px;
        }
        .pe-palette-foot kbd,
        .pe-shortcuts kbd {
          padding: 1px 5px;
          border: 1px solid var(--pe-line-strong);
          border-radius: 4px;
          background: var(--pe-panel-2);
          color: var(--pe-text-2);
          font-family: inherit; font-size: 11px;
        }

        .pe-shortcuts-backdrop {
          position: fixed; inset: 0; z-index: 600;
          display: grid; place-items: center;
          padding: 16px;
          background: var(--pe-scrim);
          overflow: auto;
        }
        .pe-shortcuts {
          width: min(500px, 100%);
          max-height: calc(100dvh - 32px);
          overflow: auto;
          padding: 18px 20px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
          color: var(--pe-text);
        }
        .pe-shortcuts-head {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          margin-bottom: 12px;
        }
        .pe-shortcuts-title {
          margin: 0;
          font-family: 'Manrope', sans-serif; font-size: 17px;
        }
        .pe-shortcuts-close {
          min-height: 30px; padding: 0 9px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: transparent; color: var(--pe-text-2);
          font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
        }
        .pe-shortcuts-close:hover { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-shortcuts-list { display: flex; flex-direction: column; gap: 2px; }
        .pe-shortcuts-row {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          min-height: 32px; padding: 0 4px;
          border-bottom: 1px solid var(--pe-line);
          font-size: 12px;
        }
        .pe-shortcuts-row:last-child { border-bottom: 0; }
        .pe-shortcuts-row span { color: var(--pe-text-2); }
        .pe-shortcuts-row kbd { white-space: nowrap; }
        @media (max-width: 520px) {
          .pe-palette-backdrop { padding: 10px; align-items: start; }
          .pe-shortcuts-row { font-size: 11.5px; }
        }
      `}</style>

      <div className="pe-palette" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="pdf-command-palette">
        <input
          className="pe-palette-input"
          data-testid="pdf-palette-input"
          placeholder="Search commands…"
          value={query}
          autoFocus
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          aria-controls="pe-palette-list"
          aria-activedescendant={commands[activeIndex] ? `pe-palette-${commands[activeIndex].id}` : undefined}
        />
        <div className="pe-palette-list" id="pe-palette-list" role="listbox" ref={listRef}>
          {commands.length ? commands.map((command, index) => (
            <CommandRow
              key={command.id}
              command={command}
              disabled={disabled(command)}
              index={index}
              active={index === activeIndex}
              showGroup={index === 0 || commands[index - 1].group !== command.group}
              onHover={() => setActiveIndex(index)}
              onRun={() => onRun(command.id)}
            />
          )) : <div className="pe-palette-empty">No command matches “{query}”.</div>}
        </div>
        <div className="pe-palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function CommandRow({
  command,
  index,
  active,
  showGroup,
  onHover,
  onRun,
  disabled,
}: {
  command: PdfEditorCommand;
  index: number;
  active: boolean;
  showGroup: boolean;
  onHover: () => void;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <>
      {showGroup && <div className="pe-palette-group">{command.group}</div>}
      <button
        type="button"
        id={`pe-palette-${command.id}`}
        data-index={index}
        role="option"
        aria-selected={active}
        disabled={disabled}
        title={disabled ? 'This tool is unavailable until its editing layer and capability are ready.' : undefined}
        className={`pe-palette-item ${active ? 'active' : ''}`}
        onMouseEnter={onHover}
        onClick={onRun}
      >
        {command.label}
        {command.shortcut && <span className="pe-palette-shortcut">{command.shortcut}</span>}
      </button>
    </>
  );
}

export function PdfEditorShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const rows: [string, string][] = [
    ['Command palette', 'Ctrl / ⌘ + K'],
    ['Shortcut sheet', '?'],
    ['Undo / redo', 'Ctrl + Z / Ctrl + Y'],
    ['Delete selected object', 'Delete / Backspace'],
    ['Pages (no object selected)', '→ / ←'],
    ['Nudge selected object', 'Arrow keys / Shift + Arrow'],
    ['Find in document', 'Ctrl + F'],
    ['Zoom in / out', 'Ctrl + + / Ctrl + −'],
    ['Fit page / width / actual', '1 / 2 / 3'],
    ['Move page in organiser', 'Alt + ↑ / ↓'],
    ['Close dialog', 'Esc'],
  ];

  return (
    <div
      className="pe-shortcuts-backdrop"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="pe-shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="pdf-shortcuts-dialog">
        <div className="pe-shortcuts-head">
          <h2 className="pe-shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="pe-shortcuts-close" onClick={onClose}>Close</button>
        </div>
        <div className="pe-shortcuts-list">
          {rows.map(([label, keys]) => (
            <div className="pe-shortcuts-row" key={label}>
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
