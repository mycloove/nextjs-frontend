'use client';

import { TAB_META, TABS, TabId } from '../constants/editorConfig';
import {
  ResizeIcon, CropIcon, CompressIcon, EnhanceIcon, HelpIcon,
} from './EditorIcons';

const ICONS: Record<TabId, React.ComponentType> = {
  resize:   ResizeIcon,
  crop:     CropIcon,
  compress: CompressIcon,
  enhance:  EnhanceIcon,
};

interface EditorSidebarProps {
  activeTab:    TabId;
  onTabChange:  (tab: TabId) => void;
}

export default function EditorSidebar({ activeTab, onTabChange }: EditorSidebarProps) {
  return (
    <aside className="ie-sidebar">
      {/* Logo mark */}
      <div className="ie-sidebar-logo">
        <div className="ie-logo-grid">
          {[0.95, 0.5, 0.5, 0.22].map((op, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '2px', opacity: op }} />
          ))}
        </div>
      </div>

      {/* Tool tabs */}
      <div className="ie-sidebar-tabs">
        {TABS.map(({ id }) => {
          const Icon = ICONS[id];
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`ie-tab-btn ${activeTab === id ? 'active' : ''}`}
              title={TAB_META[id].label}
            >
              <span className="ie-tab-icon"><Icon /></span>
              <span className="ie-tab-lbl">{TAB_META[id].label}</span>
            </button>
          );
        })}
      </div>

      <div className="ie-sidebar-divider" />

      {/* Help */}
      <button className="ie-tab-btn ie-help-btn" title="Help">
        <span className="ie-tab-icon"><HelpIcon /></span>
        <span className="ie-tab-lbl">Help</span>
      </button>
    </aside>
  );
}
