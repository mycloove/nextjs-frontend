'use client';

import { DragEvent, RefObject } from 'react';
import { PreviewMode } from '../types/editorTypes';
import { FORMAT_CHIPS } from '../constants/editorConfig';
import { UploadIcon, ArrowRightIcon } from './EditorIcons';

interface EditorCanvasProps {
  imageLoaded:        boolean;
  isDragging:         boolean;
  isApplying:         boolean;
  previewMode:        PreviewMode;
  originalPreviewUrl: string | null;
  previewUrl:         string | null;
  originalDimensions: string;
  outputDimensions:   string;
  originalFormat:     string;
  editedFormat:       string;
  originalFileSize:   string;
  editedFileSize:     string;
  fileInputRef:       RefObject<HTMLInputElement | null>;
  onDrop:             (e: DragEvent<HTMLDivElement>) => void;
  onDragOver:         (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave:        () => void;
  onFileChange:       (file: File) => void;
  onClickZone:        () => void;
}

export default function EditorCanvas({
  imageLoaded, isDragging, isApplying, previewMode,
  originalPreviewUrl, previewUrl,
  originalDimensions, outputDimensions,
  originalFormat, editedFormat,
  originalFileSize, editedFileSize,
  fileInputRef, onDrop, onDragOver, onDragLeave,
  onFileChange, onClickZone,
}: EditorCanvasProps) {
  return (
    <div
      className={`ie-canvas-wrap ${isDragging ? 'dragging' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Corner brackets */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <div key={c} className={`ie-corner ie-corner-${c}`} />
      ))}

      {/* Drop zone */}
      {!imageLoaded ? (
        <div
          onClick={onClickZone}
          className={`ie-dropzone ${isDragging ? 'dragging' : ''}`}
        >
          <div className="ie-dz-icon"><UploadIcon /></div>
          <h4 className="ie-dz-title">
            {isDragging ? 'Drop it here' : 'Drop image here'}
          </h4>
          <p className="ie-dz-sub">or <strong>click to browse</strong></p>
          <div className="ie-dz-chips">
            {FORMAT_CHIPS.map((f) => <span key={f}>{f}</span>)}
            <span className="ie-dz-limit">20 MB max</span>
          </div>
        </div>

      /* Side-by-side preview */
      ) : previewMode === 'side' ? (
        <div className="ie-two-col">
          <div className="ie-preview-card">
            <div className="ie-preview-badge">Original</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalPreviewUrl!} alt="original" className="ie-preview-img" />
            <div className="ie-preview-meta">
              {originalDimensions} · {originalFormat} · {originalFileSize}
            </div>
          </div>

          <div className="ie-preview-arrow">
            <ArrowRightIcon />
          </div>

          <div className="ie-preview-card edited">
            <div className="ie-preview-badge edited">Edited</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl!} alt="edited" className="ie-preview-img" />
            <div className="ie-preview-meta">
              {outputDimensions} · {editedFormat} · {editedFileSize}
            </div>
          </div>
        </div>

      /* Split-view preview */
      ) : (
        <div className="ie-split-view">
          <div className="ie-split-half">
            <span className="ie-split-label left">Original</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalPreviewUrl!} alt="original" className="ie-preview-img full" />
          </div>
          <div className="ie-split-divider" />
          <div className="ie-split-half">
            <span className="ie-split-label right">Edited</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl!} alt="edited" className="ie-preview-img full" />
          </div>
        </div>
      )}

      {/* Processing overlay */}
      {isApplying && (
        <div className="ie-applying-overlay">
          <div className="ie-spinner" />
          <span>Processing…</span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileChange(f);
        }}
      />
    </div>
  );
}
