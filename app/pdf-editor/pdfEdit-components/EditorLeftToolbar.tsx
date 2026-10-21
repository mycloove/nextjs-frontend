'use client';
// ─────────────────────────────────────────────────────────────
//  EditorLeftToolbar.tsx
//  Eight primary instruments, icon-only. Names surface as a
//  single fixed tooltip on hover and keyboard focus — the rail
//  stays an instrument rack, not a list with captions.
//  Secondary shapes and insert actions live in flyouts so the
//  rail stays scannable. Redact is primary because a destructive
//  intent must never hide in a flyout: the user needs to see it,
//  and see it is on.
// ─────────────────────────────────────────────────────────────

import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ToolType } from '../pdfEdit-hooks/usePdfEditor';

type FlyoutId = 'shapes' | 'insert';

const PRIMARY: { id: ToolType | FlyoutId; label: string; icon: ReactNode; flyout?: FlyoutId }[] = [
  {
    id: 'select', label: 'Select',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l5 12 2.5-4.5L16 9 4 4z"/>
      </svg>
    ),
  },
  {
    id: 'editText', label: 'Edit text',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16l3.2-.7L15 7.5a1.8 1.8 0 0 0-2.5-2.5L4.7 12.8 4 16z"/>
        <path d="M11.5 5.5l3 3"/>
      </svg>
    ),
  },
  {
    id: 'redact', label: 'Redact text',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5.5" width="14" height="3.4" rx=".6" fill="currentColor" stroke="none"/>
        <line x1="3" y1="12" x2="17" y2="12" strokeOpacity=".55"/>
        <line x1="3" y1="15" x2="12" y2="15" strokeOpacity=".35"/>
      </svg>
    ),
  },
  {
    id: 'annotate', label: 'Annotate',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16.5l1.2-3.2 8.4-8.4a1.6 1.6 0 0 1 2.3 2.3l-8.4 8.4L4 16.5z"/>
        <path d="M12.6 6l1.4 1.4"/>
        <path d="M3 18h14" strokeOpacity=".45"/>
      </svg>
    ),
  },
  {
    id: 'text', label: 'Add text',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 5 16 5"/><line x1="10" y1="5" x2="10" y2="16"/>
      </svg>
    ),
  },
  {
    id: 'highlight', label: 'Highlight',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="14" height="7" rx="1" fill="currentColor" fillOpacity=".22" stroke="currentColor"/>
        <line x1="3" y1="6" x2="17" y2="6" strokeOpacity=".3"/>
      </svg>
    ),
  },
  {
    id: 'signature', label: 'Sign',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16c2-5 4-9 5-9s1 3 2 3 2-5 3-5"/>
        <line x1="3" y1="16" x2="17" y2="16" strokeOpacity=".4"/>
      </svg>
    ),
  },
  {
    id: 'shapes', label: 'Shapes', flyout: 'shapes',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="9" height="8" rx="1"/>
        <circle cx="14" cy="7" r="3"/>
      </svg>
    ),
  },
  {
    id: 'insert', label: 'Insert', flyout: 'insert',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3v14M3 10h14"/>
      </svg>
    ),
  },
];

const SHAPES: { id: ToolType; label: string; icon: ReactNode }[] = [
  {
    id: 'rect', label: 'Rectangle',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="5" width="14" height="10" rx="1.5"/>
      </svg>
    ),
  },
  {
    id: 'circle', label: 'Ellipse',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <ellipse cx="10" cy="10" rx="7" ry="5"/>
      </svg>
    ),
  },
  {
    id: 'line', label: 'Line',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="4" y1="16" x2="16" y2="4"/>
      </svg>
    ),
  },
  {
    id: 'arrow', label: 'Arrow',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="16" x2="14" y2="6"/>
        <polyline points="8 6 14 6 14 12"/>
      </svg>
    ),
  },
];

const INSERTS: { id: ToolType; label: string; icon: ReactNode }[] = [
  {
    id: 'image', label: 'Image',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="14" height="14" rx="2"/>
        <circle cx="7.5" cy="7.5" r="1.5"/>
        <polyline points="17 13 13 8 7 14"/>
      </svg>
    ),
  },
  {
    id: 'emoji', label: 'Emoji',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7"/>
        <path d="M7 12c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5"/>
        <line x1="7.5" y1="8" x2="7.5" y2="8.5"/>
        <line x1="12.5" y1="8" x2="12.5" y2="8.5"/>
      </svg>
    ),
  },
];

interface Props {
  activeTool:     ToolType;
  canUndo:        boolean;
  canRedo:        boolean;
  onToolChange:   (t: ToolType) => void;
  onUndo:         () => void;
  onRedo:         () => void;
  onDelete:       () => void;
  /** Hides Redact when W3 authoring is disabled; no dead button. */
  redactionEnabled?: boolean;
  /**
   * The page's editing layer is live.
   *
   * Some tools act the moment they are chosen — Add text places its box
   * immediately — so a tool picked while the layer is still mounting would do
   * nothing at all. Disabled (rather than silently inert) says so up front and
   * lets the click wait for the layer instead of vanishing into it.
   */
  toolsReady?: boolean;
}

export default function EditorLeftToolbar({
  activeTool, canUndo, canRedo,
  onToolChange, onUndo, onRedo, onDelete,
  redactionEnabled = true,
  toolsReady = true,
}: Props) {
  const [openFlyout, setOpenFlyout] = useState<FlyoutId | null>(null);
  const [flyoutPosition, setFlyoutPosition] = useState<{ top: number; left: number } | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  /** Fixed-coordinate tooltip for the icon rail; one tip at a time. */
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const activeShapes = SHAPES.some(shape => shape.id === activeTool);
  const activeInsert = INSERTS.some(insert => insert.id === activeTool);

  useEffect(() => {
    if (!openFlyout) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpenFlyout(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFlyout(null);
    };
    const close = () => setOpenFlyout(null);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [openFlyout]);

  const choose = (tool: ToolType) => {
    setOpenFlyout(null);
    onToolChange(tool);
  };

  /* Icon rail → names live in one fixed tip, anchored to the button
     the pointer (or keyboard focus) is on. Fixed, because the rail's
     own overflow-y would clip anything positioned inside it. */
  const showTip = (element: HTMLElement, label: string) => {
    const rect = element.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTip = () => setTip(null);
  /* On pointer only — touch never hovers, and a stray pointerenter from
     a scroll gesture must not leave a tip stranded over the canvas. */
  const pointerTip = (event: ReactPointerEvent<HTMLButtonElement>, label: string) => {
    if (event.pointerType === 'touch') return;
    showTip(event.currentTarget, label);
  };
  const focusTip = (event: { currentTarget: HTMLElement }, label: string) => {
    if (!event.currentTarget.matches(':focus-visible')) return;
    showTip(event.currentTarget, label);
  };

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    /* The rail below the button may scroll the tip away mid-read. */
    const onScroll = (event: Event) => {
      if (event.target === railRef.current) setTip(null);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, [tip]);

  const flyoutItems = openFlyout === 'shapes' ? SHAPES : INSERTS;

  return (
    <>
      <style>{`
        .pe-ltb {
          position: relative;
          width: 64px;
          background: var(--pe-panel);
          border-right: 1px solid var(--pe-line);
          display: flex; flex-direction: column; align-items: center;
          padding: 14px 0 12px;
          gap: 4px;
          overflow-y: auto;
          flex-shrink: 0;
          scrollbar-width: none;
          transition: background-color .35s var(--pe-ease-in-out), border-color .35s var(--pe-ease-in-out);
        }
        .pe-ltb::-webkit-scrollbar { display: none; }

        .pe-tool-btn {
          width: 44px; height: 44px; border-radius: var(--pe-r-sm);
          display: flex; align-items: center; justify-content: center;
          border: 1px solid transparent;
          background: transparent; cursor: pointer;
          color: var(--pe-text-2);
          transition:
            background-color var(--pe-dur-fast) var(--pe-ease-out),
            border-color var(--pe-dur-fast) var(--pe-ease-out),
            color var(--pe-dur-fast) var(--pe-ease-out);
          padding: 0;
          position: relative;
        }
        .pe-tool-btn:hover:not(:disabled) { background: var(--pe-panel-3); color: var(--pe-text); }
        /* Waiting for the editing layer. Same dimming as the toolbar's own
           action buttons — a tool that cannot land yet is shown as exactly
           that, instead of accepting a click it would drop. */
        .pe-tool-btn:disabled { opacity: .32; cursor: not-allowed; }
        .pe-tool-btn.active {
          background: var(--pe-signal-soft);
          border-color: var(--pe-signal-line);
          color: var(--pe-signal-ink);
          box-shadow: inset 2px 0 0 var(--pe-signal);
        }
        .pe-tool-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
        .pe-tool-icon svg { width: 18px; height: 18px; }
        .pe-tool-caret {
          position: absolute; right: 3px; bottom: 3px;
          color: var(--pe-text-3); font-size: 8px; line-height: 1;
        }

        /* One tip for the whole rail. It reads as chrome, not as copy:
           panel surface, hairline, a soft two-layer shadow — no color. */
        .pe-ltb-tip {
          position: fixed;
          z-index: 130;
          padding: 6px 10px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel-3);
          color: var(--pe-text);
          box-shadow: 0 2px 6px rgba(0, 0, 0, .18), 0 8px 24px rgba(0, 0, 0, .14);
          font-size: 11px; font-weight: 600; letter-spacing: .01em; line-height: 1.2;
          white-space: nowrap;
          pointer-events: none;
          transform: translateY(-50%);
          animation: pe-tip-in var(--pe-dur-fast) var(--pe-ease-out) both;
        }
        [data-theme="light"] .pe-ltb-tip {
          box-shadow: 0 2px 6px rgba(30, 24, 48, .10), 0 8px 24px rgba(30, 24, 48, .10);
        }
        @keyframes pe-tip-in {
          from { opacity: 0; translate: -3px 0; }
          to { opacity: 1; translate: 0 0; }
        }

        .pe-tb-divider { width: 32px; height: 1px; background: var(--pe-line); margin: 8px 0 6px; flex: 0 0 1px; }
        .pe-tb-group-divider { width: 32px; height: 1px; background: var(--pe-line); margin: 7px 0; flex: 0 0 1px; }

        .pe-action-btn {
          width: 44px; height: 40px; border-radius: var(--pe-r-sm);
          display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--pe-line);
          background: transparent; cursor: pointer;
          color: var(--pe-text-2);
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), color var(--pe-dur-fast) var(--pe-ease-out), border-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-action-btn:hover:not(:disabled) { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-action-btn:disabled { opacity: .32; cursor: not-allowed; }
        .pe-action-btn.danger:hover:not(:disabled) { background: var(--pe-danger-soft); color: var(--pe-danger); border-color: var(--pe-danger); }
        .pe-toolbar-actions { display: flex; flex-direction: column; align-items: center; gap: 4px; }

        .pe-mobile-actions-toggle {
          display: none;
          width: 44px; height: 44px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit; font-size: 18px; font-weight: 700;
          cursor: pointer;
        }
        .pe-mobile-actions {
          position: fixed;
          z-index: 121;
          left: 8px; right: 8px;
          bottom: calc(26px + 56px + 6px + env(safe-area-inset-bottom));
          display: flex; gap: 6px;
          padding: 8px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
        }
        .pe-mobile-actions .pe-action-btn { flex: 1; height: 44px; }

        /* Flyout is fixed: the scrolling rail would otherwise clip it. */
        .pe-tool-flyout {
          position: fixed;
          z-index: 120;
          top: var(--pe-flyout-top, 120px);
          left: var(--pe-flyout-left, 72px);
          display: flex; flex-direction: column; gap: 4px;
          min-width: 148px;
          padding: 6px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
        }
        .pe-tool-flyout-item {
          display: flex; align-items: center; gap: 9px;
          min-height: 38px; padding: 0 9px;
          border: 1px solid transparent; border-radius: var(--pe-r-sm);
          background: transparent; color: var(--pe-text-2);
          font-family: inherit; font-size: 12px; font-weight: 600;
          text-align: left; cursor: pointer;
        }
        .pe-tool-flyout-item svg { width: 16px; height: 16px; flex: 0 0 16px; }
        .pe-tool-flyout-item:hover:not(:disabled),
        .pe-tool-flyout-item.active:not(:disabled) {
          background: var(--pe-panel-3); color: var(--pe-text);
          border-color: var(--pe-line);
        }
        .pe-tool-flyout-item.active:not(:disabled) { border-color: var(--pe-signal-line); color: var(--pe-signal-ink); }
        .pe-tool-flyout-item:disabled { opacity: .32; cursor: not-allowed; }

        @media (max-width: 700px) {
          .pe-ltb {
            position: fixed; z-index: 80; left: 0; right: 0;
            bottom: calc(26px + env(safe-area-inset-bottom));
            width: auto; height: 56px; padding: 4px 7px;
            flex-direction: row; gap: 3px;
            overflow-x: auto; overflow-y: hidden;
            border-right: 0; border-top: 1px solid var(--pe-line);
            background: var(--pe-panel);
          }
          .pe-ltb > div { flex: 0 0 auto; }
          .pe-tool-btn { width: 44px; height: 44px; }
          .pe-tb-divider, .pe-tb-group-divider, .pe-ltb > div[style] { display: none; }
          .pe-toolbar-actions { display: none; }
          .pe-mobile-actions-toggle { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; }
          .pe-action-btn { flex: 0 0 44px; width: 44px; height: 44px; }
          .pe-tool-flyout {
            position: fixed;
            left: 8px; right: 8px; top: auto;
            bottom: calc(26px + 56px + 6px + env(safe-area-inset-bottom));
            flex-direction: row; flex-wrap: wrap;
            min-width: 0;
          }
          .pe-tool-flyout-item { flex: 1 1 44%; min-height: 44px; }
        }
        /* The tip is a pointer-and-focus affordance: touch has neither. */
        @media (max-width: 700px), (hover: none) {
          .pe-ltb-tip { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-ltb, .pe-tool-btn, .pe-action-btn { transition: none; }
          .pe-ltb-tip { animation: none; }
        }
      `}</style>

      <div className="pe-ltb" ref={railRef} role="toolbar" aria-label="Editing tools" aria-orientation="vertical">
        {PRIMARY.filter(tool => tool.id !== 'redact' || redactionEnabled).map((tool, index) => {
          const isFlyout = Boolean(tool.flyout);
          const active = isFlyout
            ? (tool.flyout === 'shapes' ? activeShapes : activeInsert)
            : activeTool === tool.id;
          return (
            <Fragment key={tool.id}>
              {index === 5 && <div className="pe-tb-group-divider" aria-hidden="true" />}
              <button
                type="button"
                data-testid={`pdf-tool-${tool.id}`}
                className={`pe-tool-btn ${active ? 'active' : ''}`}
                disabled={!toolsReady}
                onClick={event => {
                  if (tool.flyout) {
                    if (openFlyout === tool.flyout) {
                      setOpenFlyout(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setFlyoutPosition({
                      top: Math.min(rect.top, Math.max(12, window.innerHeight - 260)),
                      left: rect.right + 8,
                    });
                    setOpenFlyout(tool.flyout);
                    return;
                  }
                  choose(tool.id as ToolType);
                }}
                onPointerEnter={event => pointerTip(event, tool.label)}
                onPointerLeave={hideTip}
                onPointerDown={hideTip}
                onFocus={event => focusTip(event, tool.label)}
                onBlur={hideTip}
                aria-label={tool.label}
                aria-haspopup={isFlyout ? 'menu' : undefined}
                aria-expanded={isFlyout ? openFlyout === tool.flyout : undefined}
              >
                <span className="pe-tool-icon">{tool.icon}</span>
                {isFlyout && <span className="pe-tool-caret" aria-hidden="true">▾</span>}
              </button>
            </Fragment>
          );
        })}

        {openFlyout && (
          <div
            className="pe-tool-flyout"
            role="menu"
            aria-label={openFlyout === 'shapes' ? 'Shapes' : 'Insert'}
            style={flyoutPosition ? ({
              '--pe-flyout-top': `${flyoutPosition.top}px`,
              '--pe-flyout-left': `${flyoutPosition.left}px`,
            } as CSSProperties) : undefined}
          >
            {flyoutItems.map(item => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-testid={`pdf-tool-${item.id}`}
                className={`pe-tool-flyout-item ${activeTool === item.id ? 'active' : ''}`}
                disabled={!toolsReady}
                onClick={() => choose(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <div className="pe-toolbar-actions">
          <div className="pe-tb-divider" />

          <button
            className="pe-action-btn"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            onPointerEnter={event => pointerTip(event, 'Undo · Ctrl+Z')}
            onPointerLeave={hideTip}
            onPointerDown={hideTip}
            onFocus={event => focusTip(event, 'Undo · Ctrl+Z')}
            onBlur={hideTip}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 7v6h6"/><path d="M3 13A9 9 0 1 0 6 6.3"/>
            </svg>
          </button>

          <button
            className="pe-action-btn"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            onPointerEnter={event => pointerTip(event, 'Redo · Ctrl+Y')}
            onPointerLeave={hideTip}
            onPointerDown={hideTip}
            onFocus={event => focusTip(event, 'Redo · Ctrl+Y')}
            onBlur={hideTip}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 7v6h-6"/><path d="M21 13A9 9 0 1 1 18 6.3"/>
            </svg>
          </button>

          <button
            className="pe-action-btn danger"
            onClick={onDelete}
            aria-label="Delete selected"
            onPointerEnter={event => pointerTip(event, 'Delete selected')}
            onPointerLeave={hideTip}
            onPointerDown={hideTip}
            onFocus={event => focusTip(event, 'Delete selected')}
            onBlur={hideTip}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>

        {tip && (
          <div className="pe-ltb-tip" role="tooltip" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>
            {tip.label}
          </div>
        )}

        <button
          type="button"
          className="pe-mobile-actions-toggle"
          aria-label="More actions"
          aria-expanded={mobileActionsOpen}
          onClick={() => setMobileActionsOpen(open => !open)}
        >⋯</button>

        {mobileActionsOpen && (
          <div className="pe-mobile-actions" role="menu" aria-label="More actions">
            <button className="pe-action-btn" onClick={() => { onUndo(); setMobileActionsOpen(false); }} disabled={!canUndo} aria-label="Undo">
              Undo
            </button>
            <button className="pe-action-btn" onClick={() => { onRedo(); setMobileActionsOpen(false); }} disabled={!canRedo} aria-label="Redo">
              Redo
            </button>
            <button className="pe-action-btn danger" onClick={() => { onDelete(); setMobileActionsOpen(false); }} aria-label="Delete selected">
              Delete
            </button>
          </div>
        )}
      </div>
    </>
  );
}
