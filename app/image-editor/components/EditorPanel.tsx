'use client';

import { ReactNode } from 'react';
import { TabId, TAB_META } from '../constants/editorConfig';
import { PanelArrowIcon } from './EditorIcons';

interface EditorPanelProps {
  activeTab:        TabId;
  isCollapsed:      boolean;
  onToggleCollapse: () => void;
  imageLoaded:      boolean;
  isApplying:       boolean;
  hasEdited:        boolean;
  historyLength:    number;
  onApply:          () => void;
  children:         ReactNode;
}

export default function EditorPanel({
  activeTab, isCollapsed, onToggleCollapse,
  imageLoaded, isApplying, hasEdited, historyLength,
  onApply, children,
}: EditorPanelProps) {
  return (
    <aside className={`ie-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Panel header */}
      <div className="ie-panel-header">
        {!isCollapsed && (
          <div className="ie-panel-title-wrap">
            <h3 className="ie-panel-title">{TAB_META[activeTab].label}</h3>
            <p className="ie-panel-desc">{TAB_META[activeTab].desc}</p>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="ie-panel-toggle"
          title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
        >
          <PanelArrowIcon collapsed={isCollapsed} />
        </button>
      </div>

      {/* Panel body — tab-specific controls */}
      <div className={`ie-panel-body ${isCollapsed ? 'hidden' : ''}`}>
        {children}
      </div>

      {/* Panel footer — apply button */}
      <div className={`ie-panel-footer ${isCollapsed ? 'hidden' : ''}`}>
        <button
          onClick={onApply}
          className="ie-apply-btn"
          disabled={!imageLoaded || isApplying || activeTab === 'crop'}
        >
          {isApplying ? (
            <><span className="ie-btn-spinner" /> Processing…</>
          ) : (
            `Apply ${TAB_META[activeTab].label}`
          )}
        </button>

        {hasEdited && (
          <div className="ie-history-count">
            {historyLength} edit{historyLength !== 1 ? 's' : ''} in history
          </div>
        )}
      </div>
    </aside>
  );
}
