'use client';

import { TabId, TAB_META } from '../constants/editorConfig';
import { PreviewMode } from '../types/editorTypes';
import {
  UndoIcon, ResetIcon, ExportIcon,
  SideBySideIcon, SplitViewIcon,
} from './EditorIcons';

interface EditorToolbarProps {
  activeTab:      TabId;
  imageLoaded:    boolean;
  hasEdited:      boolean;
  historyLength:  number;
  isApplying:     boolean;
  savings:        number | null;
  previewMode:    PreviewMode;
  onPreviewMode:  (m: PreviewMode) => void;
  onUndo:         () => void;
  onReset:        () => void;
  onExport:       () => void;
}

export default function EditorToolbar({
  activeTab, imageLoaded, hasEdited, historyLength,
  isApplying, savings, previewMode, onPreviewMode,
  onUndo, onReset, onExport,
}: EditorToolbarProps) {
  return (
    <div className="ie-editor-topbar">
      {/* Left — tab name + status badges */}
      <div className="ie-etb-left">
        <span className="ie-etb-tab">{TAB_META[activeTab].label}</span>

        <span className={`ie-status-badge ${imageLoaded ? 'ready' : ''}`}>
          {imageLoaded ? '● Ready' : '○ No image'}
        </span>

        {hasEdited && savings !== null && (
          <span className={`ie-savings-badge ${savings > 0 ? 'positive' : 'negative'}`}>
            {savings > 0
              ? `↓ ${savings}% smaller`
              : savings < 0
                ? `↑ ${Math.abs(savings)}% larger`
                : 'Same size'}
          </span>
        )}
      </div>

      {/* Right — preview toggle + action buttons */}
      <div className="ie-etb-right">
        {imageLoaded && (
          <div className="ie-preview-toggle">
            <button
              onClick={() => onPreviewMode('side')}
              className={previewMode === 'side' ? 'active' : ''}
              title="Side by side"
            >
              <SideBySideIcon />
            </button>
            <button
              onClick={() => onPreviewMode('split')}
              className={previewMode === 'split' ? 'active' : ''}
              title="Split view"
            >
              <SplitViewIcon />
            </button>
          </div>
        )}

        <button
          onClick={onUndo}
          className="ie-action-btn"
          disabled={historyLength === 0}
          title="Undo"
        >
          <UndoIcon /> Undo
        </button>

        <button onClick={onReset} className="ie-action-btn" title="Reset">
          <ResetIcon /> Reset
        </button>

        <button
          onClick={onExport}
          className="ie-action-btn ie-export-btn"
          disabled={!hasEdited}
          title="Export"
        >
          <ExportIcon /> Export
        </button>
      </div>
    </div>
  );
}
