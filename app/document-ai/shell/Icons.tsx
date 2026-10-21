"use client";

import React from "react";

type Props = React.SVGProps<SVGSVGElement>;

const base: Props = {
  className: "icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const IconSearch = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const IconPlus = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChat = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5H6l-3.5 3 .8-4.4A8.5 8.5 0 1 1 21 11.5Z" />
  </svg>
);

export const IconShieldCheck = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M9 11l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Z" />
  </svg>
);

export const IconFolder = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
  </svg>
);

export const IconFolderSmall = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
  </svg>
);

export const IconHamburger = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconShare = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M16 6l-4-4-4 4M12 2v13" />
  </svg>
);

export const IconPanel = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);

export const IconSun = (p: Props) => (
  <svg {...base} {...p} style={{ width: 13, height: 13, ...(p.style || {}) }}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = (p: Props) => (
  <svg {...base} {...p} style={{ width: 13, height: 13, ...(p.style || {}) }}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
  </svg>
);

export const IconMoonSmall = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.4 5.4 0 0 1 12 3Z" />
  </svg>
);

export const IconSettings = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09c0 .69.4 1.3 1.04 1.56.6.25 1.3.12 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.46.46-.59 1.17-.34 1.87.25.6.87 1.04 1.56 1.04H21a2 2 0 1 1 0 4h-.09c-.69 0-1.31.4-1.56 1.04Z" />
  </svg>
);

export const IconSend = (p: Props) => (
  <svg {...base} {...p} stroke="#fff">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
