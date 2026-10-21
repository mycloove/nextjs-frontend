'use client';

interface EditorStatusBarProps {
  originalDimensions: string;
  outputDimensions:   string;
  originalFormat:     string;
  editedFormat:       string;
  originalFileSize:   string;
  editedFileSize:     string;
  imageLoaded:        boolean;
}

export default function EditorStatusBar({
  originalDimensions, outputDimensions,
  originalFormat, editedFormat,
  originalFileSize, editedFileSize,
  imageLoaded,
}: EditorStatusBarProps) {
  return (
    <div className="ie-statusbar">
      <div className="ie-status-items">
        <div className="ie-status-group">
          <span className="ie-status-lbl">Original</span>
          <span className="ie-status-val">{originalDimensions}</span>
          <span className="ie-status-dot-sep">·</span>
          <span className="ie-status-val">{originalFormat}</span>
          <span className="ie-status-dot-sep">·</span>
          <span className="ie-status-val">{originalFileSize}</span>
        </div>

        <div className="ie-status-vline" />

        <div className="ie-status-group">
          <span className="ie-status-lbl">Output</span>
          <span className="ie-status-val">{outputDimensions}</span>
          <span className="ie-status-dot-sep">·</span>
          <span className="ie-status-val">{editedFormat}</span>
          <span className="ie-status-dot-sep">·</span>
          <span className="ie-status-val">{editedFileSize}</span>
        </div>
      </div>

      <div className={`ie-status-indicator ${imageLoaded ? 'on' : ''}`} />
    </div>
  );
}
