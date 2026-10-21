"use client";

import React from 'react';

const CropIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2v11a2 2 0 0 0 2 2h11" />
    <path d="M2 5h11a2 2 0 0 1 2 2v11" />
  </svg>
);

export default function CropPanel() {
  return (
    <div className="ie-coming-soon">
      <div className="ie-cs-icon">
        <CropIcon />
      </div>
      <p className="ie-cs-title">Crop tool</p>
      <p className="ie-cs-desc">Coming soon — interactive crop with aspect ratio presets, rotation, and straighten.</p>
    </div>
  );
}
