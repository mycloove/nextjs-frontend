// ─────────────────────────────────────────────────────────────
//  Image Editor — Icon Components
//  All SVG icons as named React components.
//  Import only what you need — tree-shakeable.
// ─────────────────────────────────────────────────────────────

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  viewBox: '0 0 20 20',
  width: size,
  height: size,
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

// ── Tool tab icons ─────────────────────────────────────────────

export const ResizeIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
    <path d="M13 7h4v10H7v-4" />
    <path d="M10 10l7 7M14 17h3v-3" />
  </svg>
);

export const CropIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 2v11a2 2 0 0 0 2 2h11" />
    <path d="M2 5h11a2 2 0 0 1 2 2v11" />
  </svg>
);

export const CompressIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 2v8M7 7l3 3 3-3" />
    <path d="M4 11v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" />
  </svg>
);

export const EnhanceIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
  </svg>
);

export const HelpIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M7.5 7.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-2.5 2.5v.5" />
    <circle cx="10" cy="14" r=".5" fill="currentColor" />
  </svg>
);

// ── Toolbar action icons ───────────────────────────────────────

const base16 = (size: number) => ({
  viewBox: '0 0 16 16',
  width: size,
  height: size,
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const UndoIcon = ({ size = 16 }: IconProps) => (
  <svg {...base16(size)}>
    <path d="M3 7V4M3 7h3" />
    <path d="M3 4a6 6 0 1 1-1 5" />
  </svg>
);

export const ResetIcon = ({ size = 16 }: IconProps) => (
  <svg {...base16(size)}>
    <path d="M8 2a6 6 0 1 0 5.2 3" />
    <path d="M13 2v3h-3" />
  </svg>
);

export const ExportIcon = ({ size = 16 }: IconProps) => (
  <svg {...base16(size)}>
    <path d="M8 2v8M5 7l3 3 3-3" />
    <path d="M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
  </svg>
);

// ── Drop zone ─────────────────────────────────────────────────

export const UploadIcon = ({ size = 48 }: IconProps) => (
  <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="36" height="36" rx="8" strokeOpacity="0.2" />
    <path d="M24 32V18M18 24l6-6 6 6" />
    <path d="M16 36h16" strokeOpacity="0.5" />
  </svg>
);

// ── Preview mode icons ─────────────────────────────────────────

export const SideBySideIcon = ({ size = 14 }: IconProps) => (
  <svg viewBox="0 0 14 14" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="1" y="2" width="5" height="10" rx="1" />
    <rect x="8" y="2" width="5" height="10" rx="1" />
  </svg>
);

export const SplitViewIcon = ({ size = 14 }: IconProps) => (
  <svg viewBox="0 0 14 14" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="1" y="2" width="12" height="10" rx="1" />
    <line x1="7" y1="2" x2="7" y2="12" />
  </svg>
);

// ── Panel / misc ───────────────────────────────────────────────

export const PanelArrowIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg viewBox="0 0 10 16" width={10} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
    <path d={collapsed ? 'M3 2l4 6-4 6' : 'M7 2L3 8l4 6'} />
  </svg>
);

export const ArrowRightIcon = ({ size = 24 }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg viewBox="0 0 14 16" width={14} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
    <rect x="2" y="7" width="10" height="8" rx="1.5" />
    {locked
      ? <path d="M4 7V5a3 3 0 0 1 6 0v2" />
      : <path d="M4 7V5a3 3 0 0 1 5.7-1" />
    }
  </svg>
);
